-- ===========================================================================
-- 202609230019 - the society's registry stops being called an "organisation"
--
-- P1 of docs/MULTI_ORG_PLAN.md. NO BEHAVIOUR CHANGE. Nothing is added, nothing
-- is removed, no column changes type, no row moves. One table, one index and
-- one policy are renamed, and twelve functions are reproduced verbatim except
-- for the table name they write to.
--
-- ---------------------------------------------------------------------------
-- Why
-- ---------------------------------------------------------------------------
--
-- "Organisation" means two unrelated things in this schema, and the only thing
-- separating them is one letter:
--
--   organis-A-tion  the society's registry of members, groups and vehicles
--   organi-Z-ation  the service - DVD Tivat or Sluzba zastite i spasavanja
--
-- A one-letter distinction is invisible in review, invisible in a grep, and a
-- typo targets the wrong concept silently. The multi-service rewrite is about
-- to spread `organization_*` across fifty-one policies, so the collision has to
-- go first or every later migration is written next to a trap.
--
-- The registry side moves, because `evidencija` - the route this screen has
-- always served - is the Montenegrin word for exactly this. The name was
-- already in the product; only the code drifted.
--
-- ---------------------------------------------------------------------------
-- The part that is not obvious: a bare rename breaks the Records screen
-- ---------------------------------------------------------------------------
--
-- Twelve `security definer` functions write to this table, and PL/pgSQL stores
-- its body as TEXT and re-parses it. `alter table ... rename` does not rewrite
-- them. Measured on a real server rather than assumed:
--
--   before the rename:  admin_create_member -> OK
--   after  the rename:  admin_create_member -> FAILED:
--                       relation "public.organisation_audit" does not exist
--
-- That is every command behind Evidencija - adding a member, a group or a
-- vehicle, linking an account, standing any of them down. So each of the twelve
-- is reproduced below with the new table name and nothing else changed.
--
-- The bodies are `pg_get_functiondef` output taken from a database with every
-- prior migration applied, with `organisation_audit` substituted. They are
-- therefore normalised by PostgreSQL rather than copied from the original
-- migration text, so the formatting differs from 202609120005 while the
-- behaviour is identical - which is the point of generating them rather than
-- retyping five hundred lines by hand.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT renamed
-- ---------------------------------------------------------------------------
--
-- * `202609120005_organisational_writes.sql` keeps its filename and its
--   contents. An applied migration is a historical record and is never edited.
--   It still creates `organisation_audit`; this migration renames it after.
-- * `organizations`, `organization_memberships`, `organization_id` - the
--   service vocabulary - are untouched. They are the side that stays.
-- ===========================================================================

alter table public.organisation_audit rename to registry_audit;

alter index public.organisation_audit_entity_idx rename to registry_audit_entity_idx;

alter policy organisation_audit_admin_read on public.registry_audit
  rename to registry_audit_admin_read;

comment on table public.registry_audit is
  'Append-only record of every change to the society''s registry: members, groups and vehicles. Named for the Evidencija screen it serves. Not to be confused with organization_memberships, which is about which SERVICE somebody belongs to.';

-- ---------------------------------------------------------------------------
-- The twelve writers, reproduced with the new table name
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_group(requested_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  clean_name text := btrim(coalesce(requested_name, ''));
  new_id uuid;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if exists (select 1 from public.groups where lower(name) = lower(clean_name)) then
    raise exception 'GROUP_NAME_TAKEN';
  end if;

  insert into public.groups(name) values (clean_name) returning id into new_id;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('GROUP', new_id, 'GROUP_CREATED',
          jsonb_build_object('name', clean_name), auth.uid());

  return new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_member(requested_full_name text, requested_specialties text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  clean_name text := btrim(coalesce(requested_full_name, ''));
  new_id uuid;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'FULL_NAME_REQUIRED'; end if;

  insert into public.members(full_name, specialties)
  values (clean_name, coalesce(requested_specialties, '{}'))
  returning id into new_id;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('MEMBER', new_id, 'MEMBER_CREATED',
          jsonb_build_object('full_name', clean_name), auth.uid());

  return new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_vehicle(requested_callsign text, requested_name text, requested_kind text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  clean_callsign text := btrim(coalesce(requested_callsign, ''));
  clean_name text := btrim(coalesce(requested_name, ''));
  clean_kind text := btrim(coalesce(requested_kind, ''));
  new_id uuid;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_callsign) < 1 then raise exception 'CALLSIGN_REQUIRED'; end if;
  if char_length(clean_name) < 1 or char_length(clean_kind) < 1 then
    raise exception 'NAME_REQUIRED';
  end if;
  if exists (select 1 from public.vehicles where lower(callsign) = lower(clean_callsign)) then
    raise exception 'CALLSIGN_TAKEN';
  end if;

  insert into public.vehicles(callsign, name, kind)
  values (clean_callsign, clean_name, clean_kind)
  returning id into new_id;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('VEHICLE', new_id, 'VEHICLE_CREATED',
          jsonb_build_object('callsign', clean_callsign, 'name', clean_name, 'kind', clean_kind),
          auth.uid());

  return new_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_link_member_account(target_member uuid, target_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  existing_user uuid;
  existing_member uuid;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;

  -- FOUND rather than a NULL check: `user_id` is legitimately NULL for a member
  -- who has no account yet, so the value cannot distinguish "no such member"
  -- from "member not linked". FOUND is set by the SELECT itself.
  select user_id into existing_user
  from public.members where id = target_member for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;

  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  -- Both directions are one-to-one. Reporting them separately matters: "this
  -- person already has an account" and "this account is already somebody else"
  -- need different corrections from the administrator.
  if existing_user is not null and existing_user <> target_user then
    raise exception 'MEMBER_ALREADY_LINKED';
  end if;

  select id into existing_member
  from public.members where user_id = target_user and id <> target_member;
  if existing_member is not null then raise exception 'ACCOUNT_ALREADY_LINKED'; end if;

  -- Already linked to this same account: a retry, not a second link.
  if existing_user = target_user then return; end if;

  update public.members set user_id = target_user, updated_at = now()
  where id = target_member;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('MEMBER', target_member, 'MEMBER_ACCOUNT_LINKED',
          jsonb_build_object('user_id', target_user), auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_rename_group(target_group uuid, requested_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  clean_name text := btrim(coalesce(requested_name, ''));
  before_name text;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'NAME_REQUIRED'; end if;

  select name into before_name from public.groups where id = target_group for update;
  if before_name is null then raise exception 'GROUP_NOT_FOUND'; end if;

  if exists (
    select 1 from public.groups where lower(name) = lower(clean_name) and id <> target_group
  ) then raise exception 'GROUP_NAME_TAKEN'; end if;

  update public.groups set name = clean_name where id = target_group;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('GROUP', target_group, 'GROUP_RENAMED',
          jsonb_build_object('previous_name', before_name, 'next_name', clean_name), auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_group_active(target_group uuid, requested_active boolean, requested_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  clean_reason text := btrim(coalesce(requested_reason, ''));
  before_active boolean;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select active into before_active from public.groups where id = target_group for update;
  if before_active is null then raise exception 'GROUP_NOT_FOUND'; end if;

  update public.groups set active = requested_active where id = target_group;

  insert into public.registry_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('GROUP', target_group, 'GROUP_ACTIVE_CHANGED',
          jsonb_build_object('previous_active', before_active, 'next_active', requested_active),
          clean_reason, auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_group_members(target_group uuid, member_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  requested uuid[] := coalesce(member_ids, '{}');
  group_exists boolean;
  added uuid[];
  removed uuid[];
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;

  select true into group_exists from public.groups where id = target_group for update;
  if group_exists is null then raise exception 'GROUP_NOT_FOUND'; end if;

  -- Every requested member must exist. Silently dropping an unknown id would
  -- leave the administrator believing they had assigned somebody they had not.
  if exists (
    select 1 from unnest(requested) as requested_id
    where not exists (select 1 from public.members where id = requested_id)
  ) then raise exception 'MEMBER_NOT_FOUND'; end if;

  select coalesce(array_agg(candidate), '{}') into added
  from unnest(requested) as candidate
  where not exists (
    select 1 from public.group_members
    where group_id = target_group and member_id = candidate);

  select coalesce(array_agg(existing.member_id), '{}') into removed
  from public.group_members existing
  where existing.group_id = target_group and not (existing.member_id = any(requested));

  delete from public.group_members
  where group_id = target_group and not (member_id = any(requested));

  insert into public.group_members(group_id, member_id)
  select target_group, candidate from unnest(requested) as candidate
  on conflict do nothing;

  if array_length(added, 1) is not null or array_length(removed, 1) is not null then
    insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
    values ('GROUP', target_group, 'GROUP_MEMBERS_CHANGED',
            jsonb_build_object('added', to_jsonb(added), 'removed', to_jsonb(removed)),
            auth.uid());
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_member_active(target_member uuid, requested_active boolean, requested_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  clean_reason text := btrim(coalesce(requested_reason, ''));
  before_active boolean;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select active into before_active from public.members where id = target_member for update;
  if before_active is null then raise exception 'MEMBER_NOT_FOUND'; end if;

  update public.members set active = requested_active, updated_at = now()
  where id = target_member;

  insert into public.registry_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('MEMBER', target_member, 'MEMBER_ACTIVE_CHANGED',
          jsonb_build_object('previous_active', before_active, 'next_active', requested_active),
          clean_reason, auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_vehicle_active(target_vehicle uuid, requested_active boolean, requested_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  clean_reason text := btrim(coalesce(requested_reason, ''));
  before_active boolean;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select active into before_active from public.vehicles where id = target_vehicle for update;
  if before_active is null then raise exception 'VEHICLE_NOT_FOUND'; end if;

  update public.vehicles set active = requested_active where id = target_vehicle;

  insert into public.registry_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('VEHICLE', target_vehicle, 'VEHICLE_ACTIVE_CHANGED',
          jsonb_build_object('previous_active', before_active, 'next_active', requested_active),
          clean_reason, auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_unlink_member_account(target_member uuid, requested_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  clean_reason text := btrim(coalesce(requested_reason, ''));
  existing_user uuid;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select user_id into existing_user
  from public.members where id = target_member for update;
  if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
  -- Already unlinked: nothing to record.
  if existing_user is null then return; end if;

  update public.members set user_id = null, updated_at = now() where id = target_member;

  insert into public.registry_audit(
    entity_kind, entity_id, event_type, detail, reason, changed_by)
  values ('MEMBER', target_member, 'MEMBER_ACCOUNT_UNLINKED',
          jsonb_build_object('previous_user_id', existing_user), clean_reason, auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_member(target_member uuid, requested_full_name text, requested_specialties text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  clean_name text := btrim(coalesce(requested_full_name, ''));
  before_row record;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_name) < 2 then raise exception 'FULL_NAME_REQUIRED'; end if;

  select * into before_row from public.members where id = target_member for update;
  if before_row is null then raise exception 'MEMBER_NOT_FOUND'; end if;

  update public.members
  set full_name = clean_name,
      specialties = coalesce(requested_specialties, '{}'),
      updated_at = now()
  where id = target_member;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('MEMBER', target_member, 'MEMBER_UPDATED',
          jsonb_build_object(
            'previous_full_name', before_row.full_name,
            'next_full_name', clean_name,
            'previous_specialties', to_jsonb(before_row.specialties),
            'next_specialties', to_jsonb(coalesce(requested_specialties, '{}'::text[]))),
          auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_vehicle(target_vehicle uuid, requested_callsign text, requested_name text, requested_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  clean_callsign text := btrim(coalesce(requested_callsign, ''));
  clean_name text := btrim(coalesce(requested_name, ''));
  clean_kind text := btrim(coalesce(requested_kind, ''));
  before_row record;
begin
  if not public.is_dvd_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if char_length(clean_callsign) < 1 then raise exception 'CALLSIGN_REQUIRED'; end if;
  if char_length(clean_name) < 1 or char_length(clean_kind) < 1 then
    raise exception 'NAME_REQUIRED';
  end if;

  select * into before_row from public.vehicles where id = target_vehicle for update;
  if before_row is null then raise exception 'VEHICLE_NOT_FOUND'; end if;

  if exists (
    select 1 from public.vehicles
    where lower(callsign) = lower(clean_callsign) and id <> target_vehicle
  ) then raise exception 'CALLSIGN_TAKEN'; end if;

  update public.vehicles
  set callsign = clean_callsign, name = clean_name, kind = clean_kind
  where id = target_vehicle;

  insert into public.registry_audit(entity_kind, entity_id, event_type, detail, changed_by)
  values ('VEHICLE', target_vehicle, 'VEHICLE_UPDATED',
          jsonb_build_object(
            'previous_callsign', before_row.callsign, 'next_callsign', clean_callsign,
            'previous_name', before_row.name, 'next_name', clean_name,
            'previous_kind', before_row.kind, 'next_kind', clean_kind),
          auth.uid());
end;
$function$;
