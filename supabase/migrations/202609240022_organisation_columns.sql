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
-- The column has to be a fact, not a field
-- ---------------------------------------------------------------------------
--
-- P4 will read `organization_id` off the row rather than joining to the parent,
-- which makes it an authorisation boundary. A boundary that can be written to
-- is not one. The first draft of this migration derived the value only when the
-- caller supplied none, and only on INSERT, which left three ways to make a
-- child disagree with its parent: supply a different service on insert, rewrite
-- the column afterwards, or re-parent the row. All three are now refused with
-- ORGANIZATION_MISMATCH, on INSERT and on UPDATE.
--
-- DETACHMENT IS THE EXCEPTION, and it is load-bearing rather than defensive.
-- With the rule applied blindly to the UPDATE that `on delete set null`
-- performs, deleting an intervention does not mis-attribute its vehicle
-- movements - it FAILS, because the vehicle's service and the deleted call-out's
-- service need not agree. Measured by removing the exception and watching the
-- delete raise ORGANIZATION_MISMATCH. A row whose parent is being taken away
-- keeps the answer it already carries.
--
-- The four owning tables go further: their `organization_id` is IMMUTABLE
-- (ORGANIZATION_IMMUTABLE). The alternative is cascading a change across
-- seventeen child tables, silently rewriting the attribution of things that
-- already happened, attendance credit included. Whose call-out it was is not an
-- editable field, and by D13 a person serving in both services holds two member
-- records rather than moving one between them. A real transfer, if one is ever
-- needed, wants a deliberate command with its own audit trail.
--
-- ---------------------------------------------------------------------------
-- A gap this phase CANNOT close, which P4 must
-- ---------------------------------------------------------------------------
--
-- `operational_audit` is the one table whose parent is optional from the start.
-- A row with no `intervention_id` has nothing to be checked against, so it may
-- STATE ITS OWN SERVICE and the trigger has no way to contradict it. Everything
-- else in this schema derives its service from a parent that already has one;
-- this is the single place a caller can assert one outright.
--
-- Nothing today can exploit it - no client role holds a table privilege, so the
-- only writers are the `security definer` commands and the service role - and
-- closing it properly is an authority question about WHO MAY WRITE AN AUDIT ROW
-- AT ALL, which is P4's, not this phase's. P2 must not grow into an authority
-- rewrite to fix it.
--
-- P4 MUST RESTRICT WHO MAY CREATE A PARENTLESS AUDIT ROW. Until it does, the
-- column on that table is a claim rather than a fact, and it is the only one.
-- `organisation_columns.test.ts` pins the behaviour so the gap cannot be closed
-- or widened without the change being deliberate.
--
-- ---------------------------------------------------------------------------
-- A vehicle movement belongs to the service that owns the vehicle
-- ---------------------------------------------------------------------------
--
-- Settled by the installation owner on 2026-09-24. `vehicle_movements` has two
-- parents; THE VEHICLE OWNS THE ROW, always, never the service that published
-- the call-out.
--
-- So a DVD engine sent to an SZS incident produces a DVD movement row. DVD
-- keeps sight of its own fleet, which is the thing a service cannot be asked to
-- give up. SZS seeing that movement during a joint incident is P7's job, granted
-- explicitly by a joint-intervention policy - NOT achieved by changing whose
-- movement it is. Ownership and visibility are different questions and this
-- migration answers only the first.
--
-- The rule is total, which is why the trigger for this table is shorter than the
-- generic one rather than longer: `vehicle_id` is not nullable, so there is
-- always an answer, and a call-out that is deleted, re-linked or never there at
-- all cannot change it. The detach exception the generic rule needs does not
-- exist here because there is nothing for it to protect.
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

-- The vehicle owns the movement, whoever published the call-out. `vehicle_id`
-- is not null, so every row has an answer.
update public.vehicle_movements child
   set organization_id = parent.organization_id
  from public.vehicles parent where parent.id = child.vehicle_id;

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
-- 5. Keeping the column honest
-- ---------------------------------------------------------------------------

/*
 * `organization_id` on a child row is not a field. It is a copy of its parent's
 * answer, denormalised so that P4's policies can read it off the row instead of
 * joining on every read of every table during a call-out.
 *
 * A copy is only worth having if it cannot disagree with the original. Three
 * ways it could, all of which an earlier draft of this migration allowed:
 *
 *   - an INSERT supplying a service the parent does not have;
 *   - an UPDATE rewriting the column afterwards;
 *   - an UPDATE re-parenting the row to the other service.
 *
 * So the rule is enforced on INSERT and on UPDATE, and a disagreement is
 * refused rather than corrected: silently rewriting somebody's write is how a
 * boundary becomes untrustworthy in the other direction.
 *
 * DETACHMENT IS THE EXCEPTION. `operational_audit.intervention_id` and
 * `vehicle_movements.intervention_id` are `on delete set null`, so deleting an
 * intervention UPDATES its children. Re-deriving there would rewrite the
 * service of a historical record at the moment its call-out was deleted - and
 * for `vehicle_movements` it would also make the delete FAIL, because the
 * vehicle's service and the deleted call-out's service need not agree. A row
 * whose parent is being taken away keeps what it already said.
 */
create or replace function public.enforce_organization_from_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_table   text := tg_argv[0];
  local_column   text := tg_argv[1];
  parent_column  text := tg_argv[2];
  orphan_default boolean := coalesce(tg_argv[3] = 'dvd-if-orphaned', false);
  key_value      uuid;
  derived        uuid;
begin
  key_value := (to_jsonb(new) ->> local_column)::uuid;

  if key_value is null then
    -- No parent to ask: either this row never had one, or one was just taken
    -- away. Either way nothing may change the answer it already carries.
    if tg_op = 'UPDATE' then
      if new.organization_id is distinct from old.organization_id then
        raise exception 'ORGANIZATION_MISMATCH';
      end if;
      return new;
    end if;

    if new.organization_id is null then
      if orphan_default then
        new.organization_id := '00000000-0000-4000-8000-000000000001';
      else
        raise exception 'ORGANIZATION_PARENT_MISSING';
      end if;
    end if;
    return new;
  end if;

  execute format(
    'select organization_id from public.%I where %I = $1', parent_table, parent_column)
    into derived using key_value;

  if derived is null then
    -- The parent row does not exist. The foreign key is about to say so far
    -- more clearly than this trigger could, so it is left to do it.
    return new;
  end if;

  if new.organization_id is null then
    new.organization_id := derived;
  elsif new.organization_id is distinct from derived then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  return new;
end;
$$;

create trigger enforce_organization before insert or update on public.member_availability
  for each row execute function public.enforce_organization_from_parent('members', 'member_id', 'id');
create trigger enforce_organization before insert or update on public.member_availability_history
  for each row execute function public.enforce_organization_from_parent('members', 'member_id', 'id');
create trigger enforce_organization before insert or update on public.intervention_recipients
  for each row execute function public.enforce_organization_from_parent('interventions', 'intervention_id', 'id');
create trigger enforce_organization before insert or update on public.intervention_responses
  for each row execute function public.enforce_organization_from_parent('interventions', 'intervention_id', 'id');
create trigger enforce_organization before insert or update on public.intervention_updates
  for each row execute function public.enforce_organization_from_parent('interventions', 'intervention_id', 'id');
create trigger enforce_organization before insert or update on public.intervention_acknowledgements
  for each row execute function public.enforce_organization_from_parent('interventions', 'intervention_id', 'id');
create trigger enforce_organization before insert or update on public.intervention_journey
  for each row execute function public.enforce_organization_from_parent('interventions', 'intervention_id', 'id');
create trigger enforce_organization before insert or update on public.intervention_journey_history
  for each row execute function public.enforce_organization_from_parent('interventions', 'intervention_id', 'id');
create trigger enforce_organization before insert or update on public.attendance_intervals
  for each row execute function public.enforce_organization_from_parent('interventions', 'intervention_id', 'id');
create trigger enforce_organization before insert or update on public.notification_outbox
  for each row execute function public.enforce_organization_from_parent('interventions', 'intervention_id', 'id');

-- Two hops from the call-out: these know only their immediate parent, which is
-- the right one to follow - it is already kept honest by its own trigger.
create trigger enforce_organization before insert or update on public.intervention_response_revisions
  for each row execute function public.enforce_organization_from_parent('intervention_responses', 'response_id', 'id');
create trigger enforce_organization before insert or update on public.attendance_corrections
  for each row execute function public.enforce_organization_from_parent('attendance_intervals', 'interval_id', 'id');
create trigger enforce_organization before insert or update on public.attendance_correction_requests
  for each row execute function public.enforce_organization_from_parent('attendance_intervals', 'interval_id', 'id');
create trigger enforce_organization before insert or update on public.notification_delivery_attempts
  for each row execute function public.enforce_organization_from_parent('notification_outbox', 'outbox_id', 'id');

-- The only table whose parent is optional from the start. An audit row with no
-- intervention has nothing to check against, so it is DVD by default and may
-- state a service explicitly; who is allowed to write one at all is P4's
-- question, not this trigger's.
create trigger enforce_organization before insert or update on public.operational_audit
  for each row execute function public.enforce_organization_from_parent(
    'interventions', 'intervention_id', 'id', 'dvd-if-orphaned');

/*
 * `vehicle_movements` has two parents, and only one of them owns it.
 *
 * THE VEHICLE DOES, ALWAYS. Never the service that published the call-out.
 * A DVD engine sent to an SZS incident produces a DVD movement row: DVD keeps
 * sight of its own fleet, which is the thing a service cannot be asked to give
 * up. SZS sees that movement during a joint incident because P7 grants it
 * explicitly, not because the row changed hands.
 *
 * This also makes the invariant total, which is why this function is shorter
 * than the generic one rather than longer. `vehicle_id` is not nullable, so
 * there is always an answer; and because the call-out was never the source, a
 * call-out that is deleted, re-linked or never there at all cannot change the
 * answer. The detach exception the generic rule needs does not exist here - not
 * because it was waived, but because there is nothing for it to protect.
 *
 * Two things are therefore refused, and the second is the less obvious one:
 * rewriting `organization_id`, and moving the row onto another service's
 * vehicle - including moving both together so that the row looks
 * self-consistent afterwards. A movement changing hands is not an edit.
 */
create or replace function public.enforce_vehicle_movement_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  derived uuid;
begin
  -- Whose movement this is was settled when it was recorded.
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  select organization_id into derived from public.vehicles where id = new.vehicle_id;

  if derived is null then
    return new;  -- a missing vehicle is the foreign key's to report
  end if;

  if new.organization_id is null then
    new.organization_id := derived;
  elsif new.organization_id is distinct from derived then
    -- Either an insert claiming a service the vehicle does not belong to, or an
    -- update re-pointing the row at another service's vehicle.
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  return new;
end;
$$;

create trigger enforce_organization before insert or update on public.vehicle_movements
  for each row execute function public.enforce_vehicle_movement_organization();

/*
 * `group_members` also has two parents, and both are required to agree. A DVD
 * group holding an SZS member would be a roster quietly spanning two services,
 * and no later policy could say which one it belonged to.
 */
create or replace function public.enforce_group_member_organization()
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

  if group_organization is null or member_organization is null then
    return new;  -- a missing parent is the foreign key's to report
  end if;

  if group_organization is distinct from member_organization then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  if new.organization_id is null then
    new.organization_id := group_organization;
  elsif new.organization_id is distinct from group_organization then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  return new;
end;
$$;

create trigger enforce_organization before insert or update on public.group_members
  for each row execute function public.enforce_group_member_organization();

/*
 * The owning tables: the service is fixed at creation.
 *
 * The alternative to refusing is cascading the change across up to seventeen
 * child tables, silently rewriting the attribution of things that already
 * happened - including who gets the attendance credited. Whose call-out it was
 * is not an editable field, and by D13 a person serving in both services holds
 * two member records rather than moving one between them.
 *
 * If a real transfer is ever needed it wants a deliberate command with its own
 * audit trail, not an UPDATE that reaches seventeen tables. The trigger fires
 * only when the column actually changes, so ordinary edits are untouched.
 */
create or replace function public.refuse_organization_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'ORGANIZATION_IMMUTABLE';
end;
$$;

create trigger refuse_organization_change before update on public.members
  for each row when (old.organization_id is distinct from new.organization_id)
  execute function public.refuse_organization_change();
create trigger refuse_organization_change before update on public.vehicles
  for each row when (old.organization_id is distinct from new.organization_id)
  execute function public.refuse_organization_change();
create trigger refuse_organization_change before update on public.groups
  for each row when (old.organization_id is distinct from new.organization_id)
  execute function public.refuse_organization_change();
create trigger refuse_organization_change before update on public.interventions
  for each row when (old.organization_id is distinct from new.organization_id)
  execute function public.refuse_organization_change();

-- Credited to whoever ran the call-out until section 6.3 gives it its own rule.
-- Deliberately insert-only and deliberately not tied to `organization_id`:
-- section 6.3 exists precisely so the two CAN differ, once something decides
-- how. Until then nothing writes it but this.
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

-- Fires after `enforce_organization`, which is what sets the value it copies:
-- PostgreSQL runs BEFORE triggers in name order, and `enforce_` sorts first.
create trigger zz_derive_credited_organization before insert on public.attendance_intervals
  for each row execute function public.derive_credited_organization_id();

revoke all on function public.enforce_organization_from_parent() from public, anon, authenticated;
revoke all on function public.enforce_vehicle_movement_organization() from public, anon, authenticated;
revoke all on function public.enforce_group_member_organization() from public, anon, authenticated;
revoke all on function public.refuse_organization_change() from public, anon, authenticated;
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
