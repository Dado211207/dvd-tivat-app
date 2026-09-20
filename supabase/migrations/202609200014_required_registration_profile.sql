-- Boka Operativa: require the minimum complete identity profile before an
-- account can be approved for operational access.
--
-- Email remains owned by Supabase Auth. The application stores only the
-- display name, contact telephone and date of birth needed by the owner to
-- identify the applicant. Address, JMBG, blood group and health data are
-- deliberately not collected.

alter table public.profiles
  add column if not exists phone_e164 text,
  add column if not exists date_of_birth date;

alter table public.profiles
  drop constraint if exists profiles_phone_e164_format,
  add constraint profiles_phone_e164_format
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  drop constraint if exists profiles_birth_date_floor,
  add constraint profiles_birth_date_floor
    check (date_of_birth is null or date_of_birth >= date '1900-01-01');

-- Converts a Montenegrin local number or an explicit international number to
-- E.164. Returning NULL is intentional: callers decide whether an invalid
-- value leaves a new account incomplete or refuses an explicit save command.
create or replace function public.normalize_profile_phone(requested_phone text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  compact text := btrim(coalesce(requested_phone, ''));
begin
  if compact = '' or compact !~ '^[0-9+(). /-]+$' then return null; end if;
  compact := regexp_replace(compact, '[[:space:]()./-]', '', 'g');

  if compact like '00%' then
    compact := '+' || substr(compact, 3);
  elsif compact like '+%' then
    null;
  elsif compact like '0%' then
    compact := '+382' || substr(compact, 2);
  elsif compact like '382%' then
    compact := '+' || compact;
  else
    return null;
  end if;

  if compact ~ '^\+[1-9][0-9]{7,14}$' then return compact; end if;
  return null;
end;
$$;

create or replace function public.valid_profile_birth_date(requested_value text)
returns date
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  parsed date;
begin
  begin
    parsed := requested_value::date;
  exception when others then
    return null;
  end;
  if parsed < date '1900-01-01' or parsed > current_date then return null; end if;
  return parsed;
end;
$$;

-- Supabase Auth fires this after sign-up. User metadata is untrusted input: it
-- is normalized and checked here, and missing/invalid values create an
-- incomplete PENDING account rather than operational access.
create or replace function public.handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_name text := regexp_replace(
    btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '\s+', ' ', 'g'
  );
  normalized_phone text := public.normalize_profile_phone(
    new.raw_user_meta_data ->> 'phone'
  );
  normalized_birth_date date := public.valid_profile_birth_date(
    new.raw_user_meta_data ->> 'date_of_birth'
  );
  is_complete boolean;
begin
  is_complete := char_length(normalized_name) between 4 and 100
    and position(' ' in normalized_name) > 0
    and normalized_phone is not null
    and normalized_birth_date is not null;

  insert into public.profiles(
    user_id, email, full_name, phone_e164, date_of_birth, profile_complete
  ) values (
    new.id,
    lower(new.email),
    case when is_complete then normalized_name else null end,
    case when is_complete then normalized_phone else null end,
    case when is_complete then normalized_birth_date else null end,
    is_complete
  ) on conflict (user_id) do nothing;

  insert into public.access_grants(user_id, role, active)
  values (new.id, 'PENDING', true)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- The old one-argument command would let an older client mark a profile
-- complete without the new required fields. Remove that bypass before exposing
-- the replacement.
drop function if exists public.complete_own_profile(text);

create function public.complete_own_profile(
  requested_full_name text,
  requested_phone text,
  requested_date_of_birth date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_name text := regexp_replace(
    btrim(coalesce(requested_full_name, '')), '\s+', ' ', 'g'
  );
  normalized_phone text := public.normalize_profile_phone(requested_phone);
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(normalized_name) < 4
     or char_length(normalized_name) > 100
     or position(' ' in normalized_name) = 0 then
    raise exception 'FULL_NAME_REQUIRED';
  end if;
  if normalized_phone is null then raise exception 'PHONE_REQUIRED'; end if;
  if requested_date_of_birth is null
     or requested_date_of_birth < date '1900-01-01'
     or requested_date_of_birth > current_date then
    raise exception 'BIRTH_DATE_REQUIRED';
  end if;

  update public.profiles
     set full_name = normalized_name,
         phone_e164 = normalized_phone,
         date_of_birth = requested_date_of_birth,
         profile_complete = true,
         updated_at = now()
   where user_id = auth.uid();
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
end;
$$;

-- Existing accounts must complete the new fields at their next sign-in. Role
-- policies already fail closed whenever profile_complete is false.
update public.profiles
   set profile_complete = false,
       updated_at = now()
 where phone_e164 is null or date_of_birth is null;

revoke all on function public.normalize_profile_phone(text) from public, anon, authenticated;
revoke all on function public.valid_profile_birth_date(text) from public, anon, authenticated;
revoke all on function public.complete_own_profile(text, text, date) from public, anon;
grant execute on function public.complete_own_profile(text, text, date) to authenticated;

-- New columns inherit no assumptions from an earlier blanket grant: the owner
-- and the profile owner still need SELECT on the table, while RLS decides rows.
grant select on public.profiles to authenticated;
