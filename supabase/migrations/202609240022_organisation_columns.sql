-- ===========================================================================
-- 202609240022 - every operational record learns which service it belongs to
--
-- P2 of docs/MULTI_ORG_PLAN.md. NO AUTHORITY CHANGE. No policy is added,
-- dropped or altered; no existing function changes; nothing reads the new
-- columns. What changes is that the schema can now EXPRESS a second service,
-- which is the precondition for P3 and everything after it.
--
-- ---------------------------------------------------------------------------
-- What it does
-- ---------------------------------------------------------------------------
--
--   1. `organization_id` on the four owning tables and on every table hanging
--      off them - twenty-one in all.
--   2. Backfills all of it, by derivation from the parent rather than by
--      blanket assignment, so the derivation itself is exercised on real rows.
--   3. `not null`, with a foreign key to `organizations`.
--   4. Swaps the three unique constraints that currently say "one service".
--   5. `attendance_intervals.credited_organization_id` (plan section 6.3).
--
-- ---------------------------------------------------------------------------
-- Two things the plan did not say, both found by measuring
-- ---------------------------------------------------------------------------
--
-- FIRST: `not null` on seventeen child tables is an OUTAGE unless something
-- supplies the value. No command passes an organisation, and none should - it
-- is a property of the parent row, not of the caller. So each child table gets
-- a trigger deriving it from its parent. Without this, P2 breaks every write in
-- the application, which is worse than the problem it solves.
--
-- SECOND: two parents are nullable, and both cases exist in production.
-- `operational_audit.intervention_id` and `vehicle_movements.intervention_id`
-- are `on delete set null`, so deleting an intervention orphans its audit rows
-- rather than refusing. Measured on the hosted project: 22 audit rows and 1
-- vehicle movement have no intervention. `vehicle_movements` recovers - its
-- `vehicle_id` is not null, so the vehicle's service answers it. An orphaned
-- audit row has no parent at all and is attributed to DVD, which is correct for
-- every row that exists today because DVD is all there has ever been.
--
-- ---------------------------------------------------------------------------
-- The DVD default is scaffolding, and P4 must remove it
-- ---------------------------------------------------------------------------
--
-- The four owning tables get `default` DVD so that `admin_create_member`,
-- `admin_create_vehicle`, `admin_create_group` and `create_intervention_draft`
-- keep working with their present signatures - changing those is P3/P4 work and
-- this phase is supposed to change no behaviour. The default is safe only while
-- SZS has no way to create records, which is true until P6.
--
-- WHEN P4 REWRITES THE CALL SITES, THESE DEFAULTS MUST GO. A default that
-- quietly files a record under DVD after SZS starts working is a silent
-- mis-attribution, which is the worst shape of bug this rewrite can produce.
-- `organisation_columns.test.ts` pins them so their removal has to be
-- deliberate.
--
-- ---------------------------------------------------------------------------
-- A hazard this phase CREATES, which P3 closes
-- ---------------------------------------------------------------------------
--
-- `members UNIQUE (user_id)` becoming `UNIQUE (organization_id, user_id)` is
-- the whole point - it is what lets one person serve in both services. It also
-- means `current_member_id()`, which reads `where user_id = auth.uid()`, can
-- match two rows and will return an arbitrary one.
--
-- Nothing can reach that state yet: no command creates an SZS member, and P6 is
-- what gives SZS a workflow. But P3 introduces `current_member_id_in(uuid)` and
-- it MUST be the phase that fixes this, not a later one.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

alter table public.members       add column organization_id uuid references public.organizations(id);
alter table public.vehicles      add column organization_id uuid references public.organizations(id);
alter table public.groups        add column organization_id uuid references public.organizations(id);
alter table public.interventions add column organization_id uuid references public.organizations(id);

alter table public.group_members                   add column organization_id uuid references public.organizations(id);
alter table public.member_availability             add column organization_id uuid references public.organizations(id);
alter table public.member_availability_history     add column organization_id uuid references public.organizations(id);
alter table public.intervention_recipients         add column organization_id uuid references public.organizations(id);
alter table public.intervention_responses          add column organization_id uuid references public.organizations(id);
alter table public.intervention_response_revisions add column organization_id uuid references public.organizations(id);
alter table public.intervention_updates            add column organization_id uuid references public.organizations(id);
alter table public.intervention_acknowledgements   add column organization_id uuid references public.organizations(id);
alter table public.intervention_journey            add column organization_id uuid references public.organizations(id);
alter table public.intervention_journey_history    add column organization_id uuid references public.organizations(id);
alter table public.attendance_intervals            add column organization_id uuid references public.organizations(id);
alter table public.attendance_corrections          add column organization_id uuid references public.organizations(id);
alter table public.attendance_correction_requests  add column organization_id uuid references public.organizations(id);
alter table public.vehicle_movements               add column organization_id uuid references public.organizations(id);
alter table public.notification_outbox             add column organization_id uuid references public.organizations(id);
alter table public.notification_delivery_attempts  add column organization_id uuid references public.organizations(id);
alter table public.operational_audit               add column organization_id uuid references public.organizations(id);

-- Which service gets the participation credited to it, as against which service
-- ran the call-out. Identical for every row that exists and for every row P2 can
-- produce; section 6.3 is what makes them diverge, and it is far cheaper to
-- carry the column from here than to rewrite attendance history later.
alter table public.attendance_intervals
  add column credited_organization_id uuid references public.organizations(id);

-- ---------------------------------------------------------------------------
-- 2. Backfill, by derivation
-- ---------------------------------------------------------------------------
--
-- The owning tables are assigned; everything else is DERIVED from its parent.
-- Deriving rather than assigning means this step exercises the same rule the
-- triggers below apply, against every row that actually exists, before anything
-- depends on it.

update public.members       set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;
update public.vehicles      set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;
update public.groups        set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;
update public.interventions set organization_id = '00000000-0000-4000-8000-000000000001' where organization_id is null;

update public.group_members child
   set organization_id = parent.organization_id
  from public.groups parent where parent.id = child.group_id;

update public.member_availability child
   set organization_id = parent.organization_id
  from public.members parent where parent.id = child.member_id;

update public.member_availability_history child
   set organization_id = parent.organization_id
  from public.members parent where parent.id = child.member_id;

update public.intervention_recipients child
   set organization_id = parent.organization_id
  from public.interventions parent where parent.id = child.intervention_id;

update public.intervention_responses child
   set organization_id = parent.organization_id
  from public.interventions parent where parent.id = child.intervention_id;

update public.intervention_updates child
   set organization_id = parent.organization_id
  from public.interventions parent where parent.id = child.intervention_id;

update public.intervention_acknowledgements child
   set organization_id = parent.organization_id
  from public.interventions parent where parent.id = child.intervention_id;

update public.intervention_journey child
   set organization_id = parent.organization_id
  from public.interventions parent where parent.id = child.intervention_id;

update public.intervention_journey_history child
   set organization_id = parent.organization_id
  from public.interventions parent where parent.id = child.intervention_id;

update public.attendance_intervals child
   set organization_id = parent.organization_id
  from public.interventions parent where parent.id = child.intervention_id;

update public.notification_outbox child
   set organization_id = parent.organization_id
  from public.interventions parent where parent.id = child.intervention_id;

-- Two hops.
update public.intervention_response_revisions child
   set organization_id = parent.organization_id
  from public.intervention_responses parent where parent.id = child.response_id;

update public.attendance_corrections child
   set organization_id = parent.organization_id
  from public.attendance_intervals parent where parent.id = child.interval_id;

update public.attendance_correction_requests child
   set organization_id = parent.organization_id
  from public.attendance_intervals parent where parent.id = child.interval_id;

update public.notification_delivery_attempts child
   set organization_id = parent.organization_id
  from public.notification_outbox parent where parent.id = child.outbox_id;

-- The intervention if there is one, otherwise the vehicle, which there always
-- is - `vehicle_movements.vehicle_id` is not null.
update public.vehicle_movements child
   set organization_id = coalesce(
     (select i.organization_id from public.interventions i where i.id = child.intervention_id),
     (select v.organization_id from public.vehicles v where v.id = child.vehicle_id));

-- The intervention if there is one. An orphan - the intervention was deleted
-- and the foreign key set this to null - has no parent to ask, so it is DVD.
update public.operational_audit child
   set organization_id = coalesce(
     (select i.organization_id from public.interventions i where i.id = child.intervention_id),
     '00000000-0000-4000-8000-000000000001');

update public.attendance_intervals
   set credited_organization_id = organization_id
 where credited_organization_id is null;

-- ---------------------------------------------------------------------------
-- 3. Not null
-- ---------------------------------------------------------------------------

alter table public.members                         alter column organization_id set not null;
alter table public.vehicles                        alter column organization_id set not null;
alter table public.groups                          alter column organization_id set not null;
alter table public.interventions                   alter column organization_id set not null;
alter table public.group_members                   alter column organization_id set not null;
alter table public.member_availability             alter column organization_id set not null;
alter table public.member_availability_history     alter column organization_id set not null;
alter table public.intervention_recipients         alter column organization_id set not null;
alter table public.intervention_responses          alter column organization_id set not null;
alter table public.intervention_response_revisions alter column organization_id set not null;
alter table public.intervention_updates            alter column organization_id set not null;
alter table public.intervention_acknowledgements   alter column organization_id set not null;
alter table public.intervention_journey            alter column organization_id set not null;
alter table public.intervention_journey_history    alter column organization_id set not null;
alter table public.attendance_intervals            alter column organization_id set not null;
alter table public.attendance_corrections          alter column organization_id set not null;
alter table public.attendance_correction_requests  alter column organization_id set not null;
alter table public.vehicle_movements               alter column organization_id set not null;
alter table public.notification_outbox             alter column organization_id set not null;
alter table public.notification_delivery_attempts  alter column organization_id set not null;
alter table public.operational_audit               alter column organization_id set not null;

alter table public.attendance_intervals alter column credited_organization_id set not null;

-- ---------------------------------------------------------------------------
-- 4. The transitional default on the owning tables - see the header
-- ---------------------------------------------------------------------------

alter table public.members       alter column organization_id set default '00000000-0000-4000-8000-000000000001';
alter table public.vehicles      alter column organization_id set default '00000000-0000-4000-8000-000000000001';
alter table public.groups        alter column organization_id set default '00000000-0000-4000-8000-000000000001';
alter table public.interventions alter column organization_id set default '00000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- 5. Deriving the value on insert
-- ---------------------------------------------------------------------------

/*
 * One function for every child table, parameterised by the trigger arguments.
 *
 * The table and column names come from `tg_argv`, which is written in this file
 * and cannot be influenced by a caller, and they go through `format('%I')`
 * regardless. An explicitly supplied value always wins, so a later phase can
 * pass the organisation without fighting the trigger.
 *
 * `tg_argv[3] = 'dvd-if-orphaned'` is only for `operational_audit`, whose parent
 * link is nullable and whose orphans have nothing else to ask.
 */
create or replace function public.derive_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_table  text := tg_argv[0];
  local_column  text := tg_argv[1];
  parent_column text := tg_argv[2];
  key_value     uuid;
  derived       uuid;
begin
  if new.organization_id is not null then
    return new;
  end if;

  key_value := (to_jsonb(new) ->> local_column)::uuid;

  if key_value is not null then
    execute format(
      'select organization_id from public.%I where %I = $1', parent_table, parent_column)
      into derived using key_value;
  end if;

  if derived is null and tg_argv[3] = 'dvd-if-orphaned' then
    derived := '00000000-0000-4000-8000-000000000001';
  end if;

  new.organization_id := derived;
  return new;
end;
$$;

create trigger derive_organization_10 before insert on public.member_availability
  for each row execute function public.derive_organization_id('members', 'member_id', 'id');
create trigger derive_organization_10 before insert on public.member_availability_history
  for each row execute function public.derive_organization_id('members', 'member_id', 'id');
create trigger derive_organization_10 before insert on public.intervention_recipients
  for each row execute function public.derive_organization_id('interventions', 'intervention_id', 'id');
create trigger derive_organization_10 before insert on public.intervention_responses
  for each row execute function public.derive_organization_id('interventions', 'intervention_id', 'id');
create trigger derive_organization_10 before insert on public.intervention_updates
  for each row execute function public.derive_organization_id('interventions', 'intervention_id', 'id');
create trigger derive_organization_10 before insert on public.intervention_acknowledgements
  for each row execute function public.derive_organization_id('interventions', 'intervention_id', 'id');
create trigger derive_organization_10 before insert on public.intervention_journey
  for each row execute function public.derive_organization_id('interventions', 'intervention_id', 'id');
create trigger derive_organization_10 before insert on public.intervention_journey_history
  for each row execute function public.derive_organization_id('interventions', 'intervention_id', 'id');
create trigger derive_organization_10 before insert on public.attendance_intervals
  for each row execute function public.derive_organization_id('interventions', 'intervention_id', 'id');
create trigger derive_organization_10 before insert on public.notification_outbox
  for each row execute function public.derive_organization_id('interventions', 'intervention_id', 'id');
create trigger derive_organization_10 before insert on public.intervention_response_revisions
  for each row execute function public.derive_organization_id('intervention_responses', 'response_id', 'id');
create trigger derive_organization_10 before insert on public.attendance_corrections
  for each row execute function public.derive_organization_id('attendance_intervals', 'interval_id', 'id');
create trigger derive_organization_10 before insert on public.attendance_correction_requests
  for each row execute function public.derive_organization_id('attendance_intervals', 'interval_id', 'id');
create trigger derive_organization_10 before insert on public.notification_delivery_attempts
  for each row execute function public.derive_organization_id('notification_outbox', 'outbox_id', 'id');

-- Two chances, in name order: the call-out it was for, then the vehicle itself.
-- The second is a no-op whenever the first found something.
create trigger derive_organization_10 before insert on public.vehicle_movements
  for each row execute function public.derive_organization_id('interventions', 'intervention_id', 'id');
create trigger derive_organization_20 before insert on public.vehicle_movements
  for each row execute function public.derive_organization_id('vehicles', 'vehicle_id', 'id');

create trigger derive_organization_10 before insert on public.operational_audit
  for each row execute function public.derive_organization_id(
    'interventions', 'intervention_id', 'id', 'dvd-if-orphaned');

/*
 * `group_members` is the one child with TWO service-scoped parents, so it is the
 * one place they can disagree. A DVD group holding an SZS member would be a
 * roster that quietly spans two services, and no later policy could tell which
 * one it belonged to. Refused here rather than reconciled later.
 */
create or replace function public.derive_group_member_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  group_organization  uuid;
  member_organization uuid;
begin
  select organization_id into group_organization  from public.groups  where id = new.group_id;
  select organization_id into member_organization from public.members where id = new.member_id;

  if group_organization is distinct from member_organization then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  new.organization_id := group_organization;
  return new;
end;
$$;

create trigger derive_organization_10 before insert on public.group_members
  for each row execute function public.derive_group_member_organization();

-- Credited to whoever ran the call-out until section 6.3 gives it its own rule.
create or replace function public.derive_credited_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.credited_organization_id is null then
    new.credited_organization_id := new.organization_id;
  end if;
  return new;
end;
$$;

-- Runs after `derive_organization_10`, which is what sets the value it copies.
create trigger derive_organization_30 before insert on public.attendance_intervals
  for each row execute function public.derive_credited_organization_id();

revoke all on function public.derive_organization_id() from public, anon, authenticated;
revoke all on function public.derive_group_member_organization() from public, anon, authenticated;
revoke all on function public.derive_credited_organization_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Uniqueness becomes per-service
-- ---------------------------------------------------------------------------
--
-- These three constraints are the ones that, as written, say "one installation,
-- one service". Each is replaced rather than dropped: a person may hold one
-- member record PER SERVICE and still not two in the same one.

alter table public.members  drop constraint members_user_id_key;
alter table public.members  add  constraint members_organization_user_key  unique (organization_id, user_id);

alter table public.vehicles drop constraint vehicles_callsign_key;
alter table public.vehicles add  constraint vehicles_organization_callsign_key unique (organization_id, callsign);

alter table public.groups   drop constraint groups_name_key;
alter table public.groups   add  constraint groups_organization_name_key   unique (organization_id, name);
