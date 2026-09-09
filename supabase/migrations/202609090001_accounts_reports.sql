-- DVD Tivat production foundation: verified accounts, owner-controlled roles,
-- citizen reports and a role audit trail. Apply only to a dedicated Supabase
-- project after review. This migration contains no real member data.

create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  profile_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (full_name is null or char_length(full_name) between 4 and 100)
);

create table public.access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'CITIZEN'
    check (role in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER', 'CITIZEN')),
  active boolean not null default true,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now()
);

create table public.role_audit (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete restrict,
  previous_role text not null,
  next_role text not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create table public.citizen_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('POZAR_ILI_DIM', 'SAOBRACAJNA_NEZGODA', 'TEHNICKA_POMOC', 'DRUGO')),
  description text not null check (char_length(description) between 10 and 2000),
  incident_location text not null check (char_length(incident_location) between 2 and 300),
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  coordinate_source text check (coordinate_source in ('DEVICE', 'MAP_PIN')),
  coordinate_captured_at timestamptz,
  status text not null default 'UNVERIFIED'
    check (status in ('UNVERIFIED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'CLOSED')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_reason text,
  constraint report_latitude check (latitude is null or latitude between -90 and 90),
  constraint report_longitude check (longitude is null or longitude between -180 and 180),
  constraint report_coordinate_pair check ((latitude is null) = (longitude is null))
);

create table public.report_status_audit (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.citizen_reports(id) on delete restrict,
  previous_status text not null,
  next_status text not null,
  reason text not null check (char_length(reason) between 2 and 500),
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create table public.report_media (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.citizen_reports(id) on delete cascade,
  object_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 8388608),
  created_at timestamptz not null default now()
);

create index citizen_reports_status_created_idx on public.citizen_reports(status, created_at desc);
create index citizen_reports_reporter_idx on public.citizen_reports(reporter_user_id, created_at desc);

create or replace function public.current_dvd_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.access_grants
  where user_id = auth.uid() and active = true
$$;

create or replace function public.is_dvd_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_dvd_role() in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'), false)
$$;

create or replace function public.handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(user_id, email) values (new.id, lower(new.email));
  insert into public.access_grants(user_id, role, active) values (new.id, 'CITIZEN', true);
  return new;
end;
$$;

create trigger create_dvd_account
after insert on auth.users
for each row execute function public.handle_new_account();

create or replace function public.complete_own_profile(requested_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized text := regexp_replace(trim(requested_full_name), '\s+', ' ', 'g');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(normalized) < 4 or char_length(normalized) > 100 or position(' ' in normalized) = 0 then
    raise exception 'FULL_NAME_REQUIRED';
  end if;
  update public.profiles
  set full_name = normalized, profile_complete = true, updated_at = now()
  where user_id = auth.uid();
end;
$$;

create or replace function public.owner_set_role(target_user uuid, requested_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_role text;
begin
  if coalesce(public.current_dvd_role(), '') <> 'OWNER' then raise exception 'OWNER_REQUIRED'; end if;
  if requested_role not in ('ADMIN', 'COMMANDER', 'FIREFIGHTER', 'CITIZEN') then
    raise exception 'ROLE_NOT_ASSIGNABLE';
  end if;
  select role into old_role from public.access_grants where user_id = target_user for update;
  if old_role is null or old_role = 'OWNER' then raise exception 'ACCOUNT_NOT_ASSIGNABLE'; end if;
  update public.access_grants
  set role = requested_role, granted_by = auth.uid(), granted_at = now()
  where user_id = target_user;
  if old_role is distinct from requested_role then
    insert into public.role_audit(target_user_id, previous_role, next_role, changed_by)
    values (target_user, old_role, requested_role, auth.uid());
  end if;
end;
$$;

create or replace function public.review_report(target_report uuid, requested_status text, requested_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_status text;
  normalized_reason text := trim(requested_reason);
begin
  if coalesce(public.current_dvd_role(), '') not in ('OWNER', 'ADMIN', 'COMMANDER') then
    raise exception 'REPORT_REVIEW_PERMISSION_REQUIRED';
  end if;
  if char_length(normalized_reason) < 2 or char_length(normalized_reason) > 500 then
    raise exception 'REVIEW_REASON_REQUIRED';
  end if;

  select status into old_status from public.citizen_reports where id = target_report for update;
  if old_status is null then raise exception 'REPORT_NOT_FOUND'; end if;
  if not (
    (old_status = 'UNVERIFIED' and requested_status in ('UNDER_REVIEW', 'CONFIRMED', 'REJECTED'))
    or (old_status = 'UNDER_REVIEW' and requested_status in ('CONFIRMED', 'REJECTED'))
    or (old_status = 'CONFIRMED' and requested_status = 'CLOSED')
  ) then
    raise exception 'INVALID_REPORT_TRANSITION';
  end if;

  update public.citizen_reports
  set status = requested_status,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_reason = normalized_reason
  where id = target_report;

  insert into public.report_status_audit(report_id, previous_status, next_status, reason, changed_by)
  values (target_report, old_status, requested_status, normalized_reason, auth.uid());
end;
$$;

alter table public.profiles enable row level security;
alter table public.access_grants enable row level security;
alter table public.role_audit enable row level security;
alter table public.citizen_reports enable row level security;
alter table public.report_media enable row level security;
alter table public.report_status_audit enable row level security;

create policy profiles_self_read on public.profiles for select
  using (user_id = auth.uid());
create policy profiles_owner_read on public.profiles for select
  using (public.current_dvd_role() = 'OWNER');
create policy grants_self_read on public.access_grants for select
  using (user_id = auth.uid());
create policy grants_owner_read on public.access_grants for select
  using (public.current_dvd_role() = 'OWNER');
create policy audit_owner_read on public.role_audit for select
  using (public.current_dvd_role() = 'OWNER');

create policy reports_create_own on public.citizen_reports for insert
  with check (
    reporter_user_id = auth.uid()
    and status = 'UNVERIFIED'
    and reviewed_at is null
    and reviewed_by is null
  );
create policy reports_read_own on public.citizen_reports for select
  using (reporter_user_id = auth.uid());
create policy reports_staff_read on public.citizen_reports for select
  using (public.is_dvd_staff());
create policy report_audit_leader_read on public.report_status_audit for select
  using (public.current_dvd_role() in ('OWNER', 'ADMIN', 'COMMANDER'));

create policy media_owner_or_staff_read on public.report_media for select
  using (
    public.is_dvd_staff() or exists (
      select 1 from public.citizen_reports report
      where report.id = report_id and report.reporter_user_id = auth.uid()
    )
  );
create policy media_create_for_own_report on public.report_media for insert
  with check (
    exists (
      select 1 from public.citizen_reports report
      where report.id = report_id
        and report.reporter_user_id = auth.uid()
        and report.status = 'UNVERIFIED'
    )
  );

-- Private object storage. The object path is
-- <authenticated-user-uuid>/<report-uuid>/<generated-filename>.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('report-media', 'report-media', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy report_objects_create_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.citizen_reports report
      where report.id::text = (storage.foldername(name))[2]
        and report.reporter_user_id = auth.uid()
        and report.status = 'UNVERIFIED'
    )
  );

create policy report_objects_read_authorized on storage.objects for select to authenticated
  using (
    bucket_id = 'report-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_dvd_staff()
    )
  );

revoke all on function public.owner_set_role(uuid, text) from public;
grant execute on function public.owner_set_role(uuid, text) to authenticated;
revoke all on function public.complete_own_profile(text) from public;
grant execute on function public.complete_own_profile(text) to authenticated;
revoke all on function public.review_report(uuid, text, text) from public;
grant execute on function public.review_report(uuid, text, text) to authenticated;

-- Bootstrap is deliberately manual and one-time. After the owner's verified
-- account exists, an operator must assign OWNER to that exact auth.users UUID.
-- Never promote "the first account" automatically and never derive a role from
-- user-editable signup metadata.
