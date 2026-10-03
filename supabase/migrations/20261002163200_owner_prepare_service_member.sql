-- One reviewed owner action links (or creates) a roster record and grants a
-- service role in the same transaction. Existing commands keep their audit
-- triggers; any refusal rolls the entire operation back.
create function public.owner_prepare_service_member(
  target_user uuid,
  organization_code text,
  requested_role text,
  selected_member uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_code text := upper(btrim(coalesce(organization_code, '')));
  role_name text := upper(btrim(coalesce(requested_role, '')));
  org_id uuid;
  record_id uuid;
  profile_name text;
  complete boolean;
  grant_active boolean;
  grant_role text;
  record_org uuid;
  record_user uuid;
  record_active boolean;
begin
  if auth.uid() is null or not public.is_dvd_owner() then raise exception 'OWNER_REQUIRED'; end if;
  if target_user = auth.uid() then raise exception 'CANNOT_CHANGE_OWN_ROLE'; end if;
  if role_name not in ('FIREFIGHTER', 'COMMANDER', 'ADMIN') then
    raise exception 'ROLE_NOT_ASSIGNABLE';
  end if;

  select org.id into org_id from public.organizations org
  where org.code = normalized_code and org.active;
  if org_id is null then raise exception 'ORGANIZATION_NOT_FOUND'; end if;

  select profile.full_name, profile.profile_complete, grant_row.active, grant_row.role
  into profile_name, complete, grant_active, grant_role
  from public.profiles profile
  join public.access_grants grant_row on grant_row.user_id = profile.user_id
  where profile.user_id = target_user;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if grant_role = 'OWNER' then raise exception 'PROTECTED_ACCOUNT'; end if;
  if not grant_active then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if not complete or char_length(btrim(coalesce(profile_name, ''))) < 2 then
    raise exception 'PROFILE_REQUIRED';
  end if;

  if selected_member is not null then
    select member.organization_id, member.user_id, member.active
    into record_org, record_user, record_active
    from public.members member where member.id = selected_member for update;
    if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
    if record_org <> org_id then raise exception 'ORGANIZATION_MISMATCH'; end if;
    if not record_active then raise exception 'MEMBER_INACTIVE'; end if;
    if record_user is not null and record_user <> target_user then
      raise exception 'MEMBER_ALREADY_LINKED';
    end if;
    record_id := selected_member;
  else
    select member.id into record_id from public.members member
    where member.organization_id = org_id and member.user_id = target_user;
    if record_id is null then
      record_id := public.admin_create_member_in(org_id, btrim(profile_name), '{}');
    elsif not exists (select 1 from public.members member
      where member.id = record_id and member.active) then
      raise exception 'MEMBER_INACTIVE';
    end if;
  end if;

  perform public.admin_link_member_account(record_id, target_user);
  perform public.owner_set_organization_membership(target_user, normalized_code, role_name);
  return record_id;
end;
$$;

comment on function public.owner_prepare_service_member(uuid, text, text, uuid) is
  'Owner-reviewed atomic roster link or creation and operational membership. '
  'Existing roster and membership commands supply their audit trails.';

revoke all on function public.owner_prepare_service_member(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.owner_prepare_service_member(uuid, text, text, uuid)
  to authenticated;
