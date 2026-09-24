-- ===========================================================================
-- 202609250027 - a call-out belongs to the service that ran it
--
-- P4b of docs/MULTI_ORG_PLAN.md, the second of the six policy PRs. Six read
-- policies over `interventions`, `intervention_recipients`,
-- `intervention_updates` and `intervention_acknowledgements`, the eight
-- `security definer` commands that drive them, and the two policies on
-- `operational_audit`, which P4b is what starts filling with SZS rows.
--
-- ---------------------------------------------------------------------------
-- The defect, in both of its directions
-- ---------------------------------------------------------------------------
--
-- Every policy and every command asks `is_dvd_command()` or `is_dvd_staff()`,
-- and after P2 there are two services. One question produces two failures:
--
--   a DVD commander    reads and can act on SZS call-outs - where a fire is,
--                      who was sent, who has seen the message - because
--                      nothing asks which service the intervention belongs to
--   an SZS commander   can do nothing at all, not even run their own service's
--                      call-out, because the only question asked is about DVD
--
-- ---------------------------------------------------------------------------
-- The same division of labour P4a found
-- ---------------------------------------------------------------------------
--
-- All four tables are `enable row level security` WITHOUT `force`, and all
-- eight commands are `security definer` owned by `postgres` - which bypasses
-- those policies. So the policies close the READ path only, and the commands
-- need their own checks:
--
--   EDIT    the service is read from the STORED intervention and never from
--           the caller, so there is nothing to forge and no parameter to add.
--           All six edits keep their signatures EXACTLY.
--   CREATE  there is no row yet, so the service has to be named.
--           `create_intervention_draft_in` takes it, and the original becomes
--           a DVD wrapper with its signature untouched.
--
-- Signatures matter more here than in P4a.
-- `202609130006a_restore_exact_repository_function_text.sql` re-creates
-- `create_intervention_draft`, `update_intervention_draft`,
-- `discard_intervention_draft` and `acknowledge_intervention` at their old,
-- DVD-only text. It sorts BEFORE this file, so in the committed order these
-- definitions win - but a changed signature would leave the two coexisting as
-- an ambiguous overload the moment it replayed out of order, and the older of
-- the two is the insecure one. `organisation_interventions.test.ts` asserts
-- that no migration sorting after this one re-creates any of them.
--
-- ---------------------------------------------------------------------------
-- Refusals
-- ---------------------------------------------------------------------------
--
--   COMMAND_REQUIRED       you command nothing. Checked BEFORE the intervention
--                          is read, both because that is what the schema does
--                          today and so ids cannot be probed.
--   ORGANIZATION_MISMATCH  you command a different service than this call-out.
--
-- ---------------------------------------------------------------------------
-- What this does NOT do
-- ---------------------------------------------------------------------------
--
-- * No joint interventions, no cross-service recipients, no shared command.
--   Two services running their own call-outs independently, and nothing else;
--   Q1-Q8 stay open and P7 is where they are answered.
-- * `submit_response`, `set_journey_progress`, `attendance_check_in` and
--   `record_vehicle_departure` read `interventions` from `security definer`
--   bodies too. Their own tables are P4c's and P4d's, and each will need the
--   same intervention-scoped check; they are deliberately untouched here.
-- * The transitional DVD default on `interventions` STAYS, and so do the three
--   P4a left on `members`, `groups` and `vehicles`. Every create now names its
--   service, so no command path depends on them - but twenty-seven direct
--   inserts across the fixtures still do, and rewriting those is a change of
--   its own with nothing to do with isolation.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Does the caller hold this authority anywhere?
-- ---------------------------------------------------------------------------
--
-- Asked before any intervention is read, so somebody who commands nothing is
-- refused without learning whether the id they passed exists - and so
-- `COMMAND_REQUIRED` keeps being the answer a firefighter gets, which
-- seventeen existing assertions depend on. The installation owner commands
-- every service (D9).

create or replace function public.is_command_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_account_is_usable() and (
    public.is_installation_owner() or exists (
      select 1
      from public.organization_memberships membership
      join public.organizations organization on organization.id = membership.organization_id
      where membership.user_id = auth.uid()
        and membership.active = true
        and organization.active = true
        and membership.role in ('ADMIN', 'COMMANDER')
    )
  )
$$;

create or replace function public.is_staff_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_account_is_usable() and (
    public.is_installation_owner() or exists (
      select 1
      from public.organization_memberships membership
      join public.organizations organization on organization.id = membership.organization_id
      where membership.user_id = auth.uid()
        and membership.active = true
        and organization.active = true
        and membership.role in ('ADMIN', 'COMMANDER', 'FIREFIGHTER')
    )
  )
$$;

comment on function public.is_command_anywhere() is
  'Command authority in at least one service. Used to refuse a caller who '
  'commands nothing before any intervention is read, so ids cannot be probed.';
comment on function public.is_staff_anywhere() is
  'Any operational role in at least one service, asked before a row is read.';

revoke all on function public.is_command_anywhere() from public, anon;
revoke all on function public.is_staff_anywhere() from public, anon;
grant execute on function public.is_command_anywhere() to authenticated, service_role;
grant execute on function public.is_staff_anywhere() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Being a recipient, asked in the call-out's own service
-- ---------------------------------------------------------------------------
--
-- Same signature: three policies and `operational_audit` are written in terms
-- of it. What changes is that the member is resolved in the INTERVENTION's
-- service rather than through the DVD shim - `current_member_id()` could only
-- ever answer for DVD, so an SZS recipient was invisible to their own call-out.

create or replace function public.is_recipient_of(target_intervention uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.intervention_recipients recipient
    join public.interventions intervention on intervention.id = recipient.intervention_id
    where recipient.intervention_id = target_intervention
      and recipient.member_id = public.current_member_id_in(intervention.organization_id)
  )
$$;

comment on function public.is_recipient_of(uuid) is
  'Whether the caller was on this call-out''s frozen recipient list, resolved '
  'in the service that ran it. A person may hold a member record in each.';

-- ---------------------------------------------------------------------------
-- 3. The read policies
-- ---------------------------------------------------------------------------
--
-- `is_command_in` answers true in every service for the installation owner,
-- who holds no membership anywhere, so the owner keeps both without one being
-- invented for them.

alter policy interventions_command_read on public.interventions
  using (public.is_command_in(organization_id));

-- Unchanged in shape; it follows `is_recipient_of` into being service-aware.
alter policy interventions_recipient_read on public.interventions
  using (status <> 'DRAFT' and public.is_recipient_of(id));

alter policy recipients_command_read on public.intervention_recipients
  using (public.is_command_in(organization_id));

alter policy recipients_self_read on public.intervention_recipients
  using (member_id = public.current_member_id_in(organization_id));

alter policy intervention_updates_read on public.intervention_updates
  using (public.is_command_in(organization_id) or public.is_recipient_of(intervention_id));

alter policy acknowledgements_read on public.intervention_acknowledgements
  using (
    public.is_command_in(organization_id)
    or member_id = public.current_member_id_in(organization_id)
  );

-- ---------------------------------------------------------------------------
-- 4. The operational audit, for the reason registry_audit moved into P4a
-- ---------------------------------------------------------------------------
--
-- `operational_audit` is listed under P4f. It already carries `organization_id`,
-- derived from the intervention by P2's trigger - but its read policy still
-- asked `is_dvd_command()`, which is harmless only while every row is DVD's.
-- P4b is what starts putting SZS rows in it, so P4b is what makes it leak:
-- `detail` carries incident locations, recipient counts and close reasons.
--
-- A boundary is closed by the phase that opens it.

alter policy operational_audit_command_read on public.operational_audit
  using (public.is_command_in(organization_id));

-- Unchanged in shape; follows `is_recipient_of`.
alter policy operational_audit_recipient_read on public.operational_audit
  using (intervention_id is not null and public.is_recipient_of(intervention_id));

-- ---------------------------------------------------------------------------
-- 5. Idempotency, which was installation-wide
-- ---------------------------------------------------------------------------
--
-- `interventions_idempotency` was unique on (created_by, idempotency_key)
-- across the whole installation - the one owning-table constraint P2 did not
-- make per-service. A commander who serves in both would have had their second
-- service's call-out silently answered with the first service's draft, because
-- the retry lookup matches on that pair. The key identifies a client's attempt
-- within one service, so that is what it is unique over.

drop index if exists public.interventions_idempotency;
create unique index if not exists interventions_idempotency
  on public.interventions (organization_id, created_by, idempotency_key);

-- ---------------------------------------------------------------------------
-- 6. Who may be sent a call-out
-- ---------------------------------------------------------------------------
--
-- Both of these asked `access_grants.role in (OWNER, ADMIN, COMMANDER,
-- FIREFIGHTER)`. That row is installation-wide and, since P3, carries DVD's
-- role only - an SZS member's grant says CITIZEN, because anything else would
-- be mirrored into an active DVD membership by `sync_dvd_membership_from_grant`.
-- So no SZS member could ever be an eligible recipient, and SZS could not have
-- published a call-out to anybody. Recipient selection is the other half of
-- publication, so it is P4b's.
--
-- The question also moves from `serves_with(member)` - "does this person share
-- a service with ME" - to the SERVICE RUNNING THE CALL-OUT. The old form is
-- true of both services for somebody who serves in both, which is the same
-- dual-service hole `publish_intervention` closes above, at its source.
--
-- For DVD the two are the same set: the mirror keeps the grant's role and the
-- DVD membership's role in step, which is what P3's equivalence gate measured
-- on real production data, and the installation owner is special-cased in both.

create or replace function public.is_eligible_recipient_in(
  target_member uuid,
  target_organization uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.members member
    join public.profiles profile on profile.user_id = member.user_id
    join public.access_grants grant_row on grant_row.user_id = member.user_id
    where member.id = target_member
      and member.organization_id = target_organization
      and member.active = true
      and member.user_id is not null
      and profile.profile_complete = true
      and grant_row.active = true
      and (
        -- The installation owner turns out to incidents like anybody else and
        -- holds no membership by design.
        grant_row.role = 'OWNER'
        or exists (
          select 1
          from public.organization_memberships membership
          join public.organizations organization
            on organization.id = membership.organization_id
          where membership.user_id = member.user_id
            and membership.organization_id = target_organization
            and membership.active = true
            and organization.active = true
            and membership.role in ('ADMIN', 'COMMANDER', 'FIREFIGHTER')
        )
      )
  )
$$;

create or replace function public.is_eligible_recipient(target_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_eligible_recipient_in(
    target_member, '00000000-0000-4000-8000-000000000001'::uuid)
$$;

create or replace function public.eligible_recipients_in(target_organization uuid)
returns table(member_id uuid, full_name text, role text, specialties text[])
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select member.id, member.full_name,
         -- The role they hold IN THIS SERVICE, not the DVD-shaped grant role,
         -- which would read CITIZEN for every SZS member.
         coalesce(owner_grant.role, membership.role) as role,
         member.specialties
  from public.members member
  left join public.organization_memberships membership
    on membership.user_id = member.user_id
   and membership.organization_id = target_organization
   and membership.active = true
  left join public.access_grants owner_grant
    on owner_grant.user_id = member.user_id
   and owner_grant.active = true
   and owner_grant.role = 'OWNER'
  where public.is_staff_in(target_organization)
    and public.is_eligible_recipient_in(member.id, target_organization)
  order by member.full_name
$$;

create or replace function public.eligible_recipients()
returns table(member_id uuid, full_name text, role text, specialties text[])
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.eligible_recipients_in('00000000-0000-4000-8000-000000000001'::uuid)
$$;

comment on function public.is_eligible_recipient_in(uuid, uuid) is
  'Whether this member may be sent a call-out BY THIS SERVICE. Asks the '
  'service running the call-out, not whoever happens to be calling.';
comment on function public.eligible_recipients_in(uuid) is
  'The people one service may send a call-out to, with the role they hold '
  'there.';

revoke all on function public.is_eligible_recipient_in(uuid, uuid) from public, anon;
revoke all on function public.eligible_recipients_in(uuid) from public, anon;
grant execute on function public.is_eligible_recipient_in(uuid, uuid) to authenticated, service_role;
grant execute on function public.eligible_recipients_in(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Creating a draft, which has to be told its service
-- ---------------------------------------------------------------------------

create or replace function public.create_intervention_draft_in(
  target_organization uuid,
  requested_kind text,
  requested_title text,
  requested_instructions text,
  requested_location text,
  requested_idempotency_key text,
  requested_other_kind_note text default null,
  requested_latitude double precision default null,
  requested_longitude double precision default null,
  requested_coordinate_source text default null,
  requested_assembly_point text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_title text := btrim(coalesce(requested_title, ''));
  clean_instructions text := btrim(coalesce(requested_instructions, ''));
  clean_location text := btrim(coalesce(requested_location, ''));
  clean_note text := nullif(btrim(coalesce(requested_other_kind_note, '')), '');
  clean_assembly text := nullif(btrim(coalesce(requested_assembly_point, '')), '');
  clean_key text := btrim(coalesce(requested_idempotency_key, ''));
  existing_id uuid;
  new_id uuid;
begin
  if target_organization is null then raise exception 'ORGANIZATION_REQUIRED'; end if;
  if not public.is_command_in(target_organization) then raise exception 'COMMAND_REQUIRED'; end if;
  if clean_key = '' then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  -- A retry returns the draft that already exists rather than a second one -
  -- within this service, matching the constraint above.
  select id into existing_id from public.interventions
  where created_by = auth.uid()
    and interventions.idempotency_key = clean_key
    and interventions.organization_id = target_organization;
  if existing_id is not null then return existing_id; end if;

  if requested_kind is null or requested_kind not in
     ('POZAR', 'SAOBRACAJNA_NEZGODA', 'TEHNICKA_POMOC', 'VJEZBA', 'TEST', 'DRUGO') then
    raise exception 'INVALID_KIND';
  end if;
  if requested_kind = 'DRUGO' and clean_note is null then
    raise exception 'KIND_NOTE_REQUIRED';
  end if;
  if char_length(clean_title) < 3 then raise exception 'TITLE_REQUIRED'; end if;
  if char_length(clean_instructions) < 3 then raise exception 'INSTRUCTIONS_REQUIRED'; end if;
  -- A typed place is always required. A bare coordinate pair is not something a
  -- crew can act on at 03:00, which is why the table demands it too.
  if char_length(clean_location) < 2 then raise exception 'LOCATION_REQUIRED'; end if;

  if (requested_latitude is null) <> (requested_longitude is null) then
    raise exception 'INVALID_COORDINATES';
  end if;
  if requested_latitude is not null and (
       requested_latitude not between -90 and 90
       or requested_longitude not between -180 and 180
       or requested_coordinate_source is null
       or requested_coordinate_source not in ('MAP_PIN', 'TYPED', 'DEVICE')) then
    raise exception 'INVALID_COORDINATES';
  end if;

  insert into public.interventions(
    kind, other_kind_note, title, instructions, incident_location,
    latitude, longitude, coordinate_source, coordinate_captured_at,
    assembly_point, status, created_by, idempotency_key, organization_id)
  values (
    requested_kind,
    case when requested_kind = 'DRUGO' then clean_note else null end,
    clean_title, clean_instructions, clean_location,
    requested_latitude, requested_longitude,
    case when requested_latitude is null then null else requested_coordinate_source end,
    -- Server time, never the caller's: a client must not be able to backdate
    -- when a coordinate was captured.
    case when requested_latitude is null then null else now() end,
    clean_assembly, 'DRAFT', auth.uid(), clean_key, target_organization)
  returning id into new_id;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (new_id, 'INTERVENTION_DRAFTED',
          jsonb_build_object('kind', requested_kind, 'has_coordinates',
                             requested_latitude is not null),
          auth.uid());

  return new_id;
end;
$$;

comment on function public.create_intervention_draft_in(
  uuid, text, text, text, text, text, text, double precision, double precision, text, text) is
  'Starts a call-out in the named service. The service is named rather than '
  'derived because there is no row yet to derive it from.';

revoke all on function public.create_intervention_draft_in(
  uuid, text, text, text, text, text, text, double precision, double precision, text, text)
  from public, anon;
grant execute on function public.create_intervention_draft_in(
  uuid, text, text, text, text, text, text, double precision, double precision, text, text)
  to authenticated, service_role;

-- The signature the client calls today, unchanged, now a DVD wrapper.
create or replace function public.create_intervention_draft(
  requested_kind text,
  requested_title text,
  requested_instructions text,
  requested_location text,
  requested_idempotency_key text,
  requested_other_kind_note text default null,
  requested_latitude double precision default null,
  requested_longitude double precision default null,
  requested_coordinate_source text default null,
  requested_assembly_point text default null
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.create_intervention_draft_in(
    '00000000-0000-4000-8000-000000000001'::uuid,
    requested_kind, requested_title, requested_instructions, requested_location,
    requested_idempotency_key, requested_other_kind_note, requested_latitude,
    requested_longitude, requested_coordinate_source, requested_assembly_point)
$$;

-- ---------------------------------------------------------------------------
-- 7. The edits, each reading its service off the intervention
-- ---------------------------------------------------------------------------

create or replace function public.update_intervention_draft(
  target_intervention uuid,
  requested_title text,
  requested_instructions text,
  requested_location text,
  expected_version integer,
  requested_latitude double precision default null,
  requested_longitude double precision default null,
  requested_coordinate_source text default null,
  requested_assembly_point text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_title text := btrim(coalesce(requested_title, ''));
  clean_instructions text := btrim(coalesce(requested_instructions, ''));
  clean_location text := btrim(coalesce(requested_location, ''));
  clean_assembly text := nullif(btrim(coalesce(requested_assembly_point, '')), '');
  current_row record;
begin
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;

  select * into current_row from public.interventions
  where id = target_intervention for update;
  if current_row is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if not public.is_command_in(current_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;
  if current_row.status <> 'DRAFT' then raise exception 'INTERVENTION_NOT_DRAFT'; end if;
  if current_row.version <> expected_version then raise exception 'VERSION_CONFLICT'; end if;

  if char_length(clean_title) < 3 then raise exception 'TITLE_REQUIRED'; end if;
  if char_length(clean_instructions) < 3 then raise exception 'INSTRUCTIONS_REQUIRED'; end if;
  if char_length(clean_location) < 2 then raise exception 'LOCATION_REQUIRED'; end if;

  if (requested_latitude is null) <> (requested_longitude is null) then
    raise exception 'INVALID_COORDINATES';
  end if;
  if requested_latitude is not null and (
       requested_latitude not between -90 and 90
       or requested_longitude not between -180 and 180
       or requested_coordinate_source is null
       or requested_coordinate_source not in ('MAP_PIN', 'TYPED', 'DEVICE')) then
    raise exception 'INVALID_COORDINATES';
  end if;

  update public.interventions
  set title = clean_title,
      instructions = clean_instructions,
      incident_location = clean_location,
      latitude = requested_latitude,
      longitude = requested_longitude,
      coordinate_source =
        case when requested_latitude is null then null else requested_coordinate_source end,
      coordinate_captured_at =
        case
          when requested_latitude is null then null
          -- Keep the original capture time when the pin has not moved.
          when current_row.latitude is not distinct from requested_latitude
           and current_row.longitude is not distinct from requested_longitude
            then current_row.coordinate_captured_at
          else now()
        end,
      assembly_point = clean_assembly,
      version = version + 1,
      updated_at = now()
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'INTERVENTION_DRAFT_UPDATED',
          jsonb_build_object('has_coordinates', requested_latitude is not null),
          auth.uid());
end;
$$;

create or replace function public.discard_intervention_draft(
  target_intervention uuid,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_reason text := btrim(coalesce(requested_reason, ''));
  current_row record;
begin
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;
  if char_length(clean_reason) < 2 then raise exception 'REASON_REQUIRED'; end if;

  select status, organization_id into current_row from public.interventions
  where id = target_intervention for update;
  if not found then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if not public.is_command_in(current_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;
  if current_row.status <> 'DRAFT' then raise exception 'INTERVENTION_NOT_DRAFT'; end if;

  update public.interventions
  set status = 'CANCELLED',
      -- The table requires published_at whenever status is not DRAFT, and
      -- requires closed_at with a reason for CANCELLED. A discarded draft was
      -- never published, so both timestamps record the same moment: the only
      -- thing that ever happened to it.
      published_at = now(),
      closed_at = now(),
      closed_by = auth.uid(),
      close_reason = clean_reason,
      version = version + 1,
      updated_at = now()
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'INTERVENTION_DRAFT_DISCARDED',
          jsonb_build_object('reason', clean_reason), auth.uid());
end;
$$;

create or replace function public.publish_intervention(
  target_intervention uuid,
  recipient_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row record;
  member_row record;
  frozen_count integer := 0;
  ineligible_count integer := 0;
begin
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;

  select status, organization_id into current_row
  from public.interventions where id = target_intervention for update;
  if not found then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if not public.is_command_in(current_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  -- Already published: this is a retry, not a second call-out.
  if current_row.status <> 'DRAFT' then
    if current_row.status in ('CLOSED', 'CANCELLED') then raise exception 'INTERVENTION_NOT_OPEN'; end if;
    return target_intervention;
  end if;

  if recipient_member_ids is null or array_length(recipient_member_ids, 1) is null then
    raise exception 'NO_RECIPIENTS';
  end if;

  -- Every recipient must serve in the service that is running this call-out.
  -- Checked BEFORE eligibility, because `is_eligible_recipient` asks whether
  -- the recipient shares a service with the CALLER - which is true of both
  -- services for somebody who serves in both, and would have let a commander
  -- of two services send one service's call-out to the other's members.
  -- The alias must NOT be `member_row`: that is a declared record variable in
  -- this function, and PL/pgSQL would resolve the qualified column against the
  -- unassigned variable rather than the joined table.
  if exists (
    select 1 from unnest(recipient_member_ids) as requested_id
    join public.members candidate on candidate.id = requested_id
    where candidate.organization_id is distinct from current_row.organization_id
  ) then raise exception 'ORGANIZATION_MISMATCH'; end if;

  -- Refuse the whole call-out rather than silently dropping somebody. A
  -- commander who selected five people and got four must be told, not left to
  -- discover it when one of them never answers. This also means a modified
  -- client that posts an ineligible id directly gets an error, not a partial
  -- publication.
  select count(*) into ineligible_count
  from unnest(recipient_member_ids) as requested(member_id)
  where not public.is_eligible_recipient_in(requested.member_id, current_row.organization_id);

  if ineligible_count > 0 then
    raise exception 'RECIPIENT_NOT_ELIGIBLE';
  end if;

  for member_row in
    select id, full_name, user_id from public.members
    where id = any(recipient_member_ids)
      and active = true
      -- Belt and braces behind the check above: the frozen list can only ever
      -- contain this service's people.
      and organization_id = current_row.organization_id
  loop
    insert into public.intervention_recipients(
      intervention_id, member_id, recipient_version, member_name_at_publication)
    values (target_intervention, member_row.id, 1, member_row.full_name)
    on conflict do nothing;

    -- The dedupe key names its channel. Rows written before that migration
    -- carry the older `<intervention>:<member>:1` form and are left alone: the
    -- function returns early for anything that is not a DRAFT, so a published
    -- intervention is never fanned out twice and the two forms never meet.
    insert into public.notification_outbox(
      intervention_id, member_id, channel, state, dedupe_key)
    values (
      target_intervention, member_row.id, 'IN_APP', 'QUEUED',
      target_intervention::text || ':' || member_row.id::text || ':IN_APP:1')
    on conflict do nothing;

    -- A Web Push row is queued ONLY for a member who has opted a device in.
    -- Everybody else still gets the in-app obligation above: the call-out is
    -- visible to them the moment they open the application, and push is an
    -- extra way of being told, never the only one.
    if exists (
      select 1 from public.web_push_subscriptions subscription
      where subscription.user_id = member_row.user_id
        and subscription.revoked_at is null
        and (subscription.expiration_time is null or subscription.expiration_time > now())
    ) then
      insert into public.notification_outbox(
        intervention_id, member_id, channel, state, dedupe_key)
      values (
        target_intervention, member_row.id, 'WEB_PUSH', 'QUEUED',
        target_intervention::text || ':' || member_row.id::text || ':WEB_PUSH:1')
      on conflict do nothing;
    end if;

    frozen_count := frozen_count + 1;
  end loop;

  if frozen_count = 0 then raise exception 'NO_ACTIVE_RECIPIENTS'; end if;

  update public.interventions
  set status = 'PUBLISHED',
      published_at = coalesce(published_at, now()),
      published_by = coalesce(published_by, auth.uid()),
      version = version + 1,
      updated_at = now()
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (
    target_intervention,
    'INTERVENTION_PUBLISHED',
    jsonb_build_object('recipient_count', frozen_count),
    auth.uid());

  return target_intervention;
end;
$$;

create or replace function public.set_intervention_status(
  target_intervention uuid,
  requested_status text,
  expected_version integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row record;
begin
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;
  if requested_status not in ('PUBLISHED', 'ASSEMBLING', 'DEPLOYED', 'CONTAINED') then
    raise exception 'STATUS_NOT_SETTABLE';
  end if;

  select status, version, organization_id into current_row
  from public.interventions where id = target_intervention for update;
  if not found then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if not public.is_command_in(current_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;
  if current_row.status in ('CLOSED', 'CANCELLED') then raise exception 'INTERVENTION_NOT_OPEN'; end if;
  if current_row.status = 'DRAFT' then raise exception 'INTERVENTION_NOT_PUBLISHED'; end if;
  if expected_version is not null and expected_version <> current_row.version then
    raise exception 'VERSION_CONFLICT';
  end if;

  update public.interventions
  set status = requested_status, updated_at = now(), version = version + 1
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'INTERVENTION_STATUS_CHANGED',
          jsonb_build_object('from', current_row.status, 'to', requested_status), auth.uid());
end;
$$;

create or replace function public.close_intervention(
  target_intervention uuid,
  requested_status text,
  requested_reason text,
  allow_open_attendance boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row record;
  open_count integer;
  normalized_reason text := trim(coalesce(requested_reason, ''));
begin
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;
  if requested_status not in ('CLOSED', 'CANCELLED') then raise exception 'STATUS_NOT_SETTABLE'; end if;
  if char_length(normalized_reason) < 2 or char_length(normalized_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;

  select status, organization_id into current_row
  from public.interventions where id = target_intervention for update;
  if not found then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if not public.is_command_in(current_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;
  if current_row.status in ('CLOSED', 'CANCELLED') then raise exception 'INTERVENTION_NOT_OPEN'; end if;

  select count(*) into open_count
  from public.attendance_intervals
  where intervention_id = target_intervention and ended_at is null;

  -- The caller must acknowledge open intervals explicitly. They are left open,
  -- and stay visible as open, rather than being closed with a made-up time.
  if open_count > 0 and not allow_open_attendance then
    raise exception 'OPEN_ATTENDANCE_INTERVALS:%', open_count;
  end if;

  update public.interventions
  set status = requested_status,
      closed_at = now(),
      closed_by = auth.uid(),
      close_reason = normalized_reason,
      updated_at = now(),
      version = version + 1
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention,
          case when requested_status = 'CLOSED' then 'INTERVENTION_CLOSED' else 'INTERVENTION_CANCELLED' end,
          jsonb_build_object('reason', normalized_reason, 'open_attendance', open_count),
          auth.uid());
end;
$$;

create or replace function public.acknowledge_intervention(target_intervention uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid;
  intervention_status text;
  intervention_organization uuid;
begin
  -- Staff first, and deliberately before the member-record check. Being a
  -- recipient is not authority: a withdrawn account whose member row is still
  -- on an old recipient list must be refused for the honest reason, and
  -- `MEMBER_RECORD_REQUIRED` would be a lie - they have one.
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select status, organization_id into intervention_status, intervention_organization
  from public.interventions where id = target_intervention;

  -- A call-out that does not exist keeps the refusal order it has always had:
  -- the checks below answer before `INTERVENTION_NOT_FOUND` is ever reached.
  if intervention_organization is not null
     and not public.is_staff_in(intervention_organization) then
    raise exception 'STAFF_REQUIRED';
  end if;

  acting_member := public.current_member_id_in(
    coalesce(intervention_organization, '00000000-0000-4000-8000-000000000001'::uuid));
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  if not public.is_recipient_of(target_intervention) then
    raise exception 'NOT_A_RECIPIENT';
  end if;

  if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if intervention_status = 'DRAFT' then raise exception 'INTERVENTION_NOT_PUBLISHED'; end if;

  -- The FIRST opening is the interesting one. Re-opening the screen must not
  -- move the timestamp, or "when did they see it" stops being answerable.
  insert into public.intervention_acknowledgements(intervention_id, member_id)
  values (target_intervention, acting_member)
  on conflict (intervention_id, member_id) do nothing;
end;
$$;
