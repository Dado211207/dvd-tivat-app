-- ===========================================================================
-- GENERAL AVAILABILITY AND JOURNEY PROGRESS
--
-- Two more facts that must not be inferred from each other, or from anything
-- that already exists. The schema's whole discipline is that each fact is its
-- own record, written by its own command, and this migration adds the two the
-- member-facing screen needs.
--
--   GENERAL AVAILABILITY  "am I reachable at all this week"
--     Not about any intervention. A member is generally available or not, and
--     that state persists between call-outs. A commander looking at who to send
--     a call-out to wants this BEFORE there is an intervention to respond to.
--
--   JOURNEY PROGRESS      "where am I right now, for THIS call-out"
--     Not a response, and not attendance. Saying `DOLAZIM` is a promise;
--     `U_PUTU` is a position; being checked in is a record of presence that
--     command stands behind. Collapsing them is how "he said he was coming" and
--     "he was there" become the same row, which is the defect 202609130006
--     exists to fix and this migration must not reintroduce.
--
-- NOTHING HERE EVER WRITES ATTENDANCE. `NA_LICU_MJESTA` records that a member
-- says they have arrived. It does NOT create an attendance interval, verified
-- or otherwise. The member still checks in as a separate deliberate act, and a
-- commander still confirms it as another. The earlier sketch for this slice had
-- `ON_SCENE` create an unverified interval; that is deliberately NOT done,
-- because "each action writes only its own fact" is the simpler and safer rule
-- and it is the one the owner restated.
--
-- Additive: two new tables, two history tables, four functions, no existing
-- object is dropped or altered. Safe to apply after 202609130006.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. General availability
--
-- One row per member, replaced in place, with every change kept in a history
-- table. The current row answers "are they available"; the history answers
-- "since when, and what did it say before" without a scan of an event log.
-- ---------------------------------------------------------------------------

create table if not exists public.member_availability (
  member_id uuid primary key references public.members(id) on delete restrict,
  available boolean not null,
  -- Optional and short. "Na godisnjem do 20.09." is useful; an essay is not.
  note text check (note is null or char_length(note) between 1 and 200),
  changed_at timestamptz not null default now(),
  changed_by uuid not null references auth.users(id) on delete restrict
);

create table if not exists public.member_availability_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  previous_available boolean,
  next_available boolean not null,
  note text,
  changed_at timestamptz not null default now(),
  changed_by uuid not null references auth.users(id) on delete restrict
);

create index if not exists member_availability_history_member_idx
  on public.member_availability_history (member_id, changed_at desc);

alter table public.member_availability enable row level security;
alter table public.member_availability_history enable row level security;

-- Every approved member may see who is generally available: that is how a crew
-- knows whether there is anybody to call before a call-out exists. It is not
-- sensitive in the way a location is.
create policy member_availability_staff_read on public.member_availability for select
  using (public.is_dvd_staff());
create policy member_availability_history_command_read on public.member_availability_history for select
  using (public.is_dvd_command());
create policy member_availability_history_self_read on public.member_availability_history for select
  using (member_id = public.current_member_id());

-- ---------------------------------------------------------------------------
-- 2. Journey progress
--
-- Per intervention, per member. `ODUSTAJEM` is kept as a progress value rather
-- than forcing the member back to the response screen to change `DOLAZIM` to
-- `NE_MOGU`: somebody who set off and had to turn back did answer truthfully at
-- the time, and rewriting their answer would erase that.
-- ---------------------------------------------------------------------------

create table if not exists public.intervention_journey (
  intervention_id uuid not null references public.interventions(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete restrict,
  progress text not null check (progress in ('KRECEM', 'U_PUTU', 'NA_LICU_MJESTA', 'ODUSTAJEM')),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  primary key (intervention_id, member_id)
);

create table if not exists public.intervention_journey_history (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete restrict,
  previous_progress text,
  next_progress text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid not null references auth.users(id) on delete restrict
);

create index if not exists intervention_journey_history_idx
  on public.intervention_journey_history (intervention_id, member_id, changed_at desc);

alter table public.intervention_journey enable row level security;
alter table public.intervention_journey_history enable row level security;

-- Command sees the whole picture. A recipient sees the whole picture for the
-- intervention they were called to, which is the owner's recorded decision
-- (blocker B5): a crew coordinates by seeing each other.
create policy intervention_journey_command_read on public.intervention_journey for select
  using (public.is_dvd_command());
create policy intervention_journey_recipient_read on public.intervention_journey for select
  using (public.is_recipient_of(intervention_id));
create policy intervention_journey_history_command_read on public.intervention_journey_history for select
  using (public.is_dvd_command());
create policy intervention_journey_history_self_read on public.intervention_journey_history for select
  using (member_id = public.current_member_id());

-- ---------------------------------------------------------------------------
-- 3. Commands
--
-- Same shape as everything else: security definer, fixed search_path, the
-- authority check first, no client role holding a direct write privilege.
-- ---------------------------------------------------------------------------

-- A member sets their OWN general availability. There is no "set somebody
-- else's availability": that is a statement about a person's own life, and a
-- commander recording it for them would be a guess wearing a record's clothes.
create or replace function public.set_own_availability(
  requested_available boolean,
  requested_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid := public.current_member_id();
  clean_note text := nullif(btrim(coalesce(requested_note, '')), '');
  previous boolean;
begin
  if not public.is_dvd_staff() then raise exception 'STAFF_REQUIRED'; end if;
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  if requested_available is null then raise exception 'AVAILABILITY_REQUIRED'; end if;
  if clean_note is not null and char_length(clean_note) > 200 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  select available into previous
  from public.member_availability where member_id = acting_member for update;

  insert into public.member_availability(member_id, available, note, changed_at, changed_by)
  values (acting_member, requested_available, clean_note, now(), auth.uid())
  on conflict (member_id) do update
    set available = excluded.available,
        note = excluded.note,
        changed_at = excluded.changed_at,
        changed_by = excluded.changed_by;

  -- Re-stating the same availability is not a change and writes no history row.
  -- Otherwise a screen that saves on every render would bury the real changes.
  if previous is distinct from requested_available then
    insert into public.member_availability_history(
      member_id, previous_available, next_available, note, changed_by)
    values (acting_member, previous, requested_available, clean_note, auth.uid());
  end if;
end;
$$;

comment on function public.set_own_availability(boolean, text) is
  'General availability, which is NOT a response to any intervention.';

-- Journey progress for one intervention, by the member themselves.
create or replace function public.set_journey_progress(
  target_intervention uuid,
  requested_progress text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid := public.current_member_id();
  intervention_status text;
  previous text;
begin
  if not public.is_dvd_staff() then raise exception 'STAFF_REQUIRED'; end if;
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  if requested_progress is null or requested_progress not in
     ('KRECEM', 'U_PUTU', 'NA_LICU_MJESTA', 'ODUSTAJEM') then
    raise exception 'INVALID_PROGRESS';
  end if;

  select status into intervention_status
  from public.interventions where id = target_intervention;
  if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if intervention_status in ('DRAFT', 'CLOSED', 'CANCELLED') then
    raise exception 'INTERVENTION_NOT_OPEN';
  end if;

  if not public.is_recipient_of(target_intervention) then
    raise exception 'NOT_A_RECIPIENT';
  end if;

  select progress into previous
  from public.intervention_journey
  where intervention_id = target_intervention and member_id = acting_member
  for update;

  insert into public.intervention_journey(
    intervention_id, member_id, progress, updated_at, updated_by)
  values (target_intervention, acting_member, requested_progress, now(), auth.uid())
  on conflict (intervention_id, member_id) do update
    set progress = excluded.progress,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  if previous is distinct from requested_progress then
    insert into public.intervention_journey_history(
      intervention_id, member_id, previous_progress, next_progress, changed_by)
    values (target_intervention, acting_member, previous, requested_progress, auth.uid());

    insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
    values (target_intervention, 'JOURNEY_PROGRESS_SET',
            jsonb_build_object('member_id', acting_member,
                               'from', previous, 'to', requested_progress),
            auth.uid());
  end if;
end;
$$;

comment on function public.set_journey_progress(uuid, text) is
  'Where a member is for one call-out. Never writes attendance: NA_LICU_MJESTA '
  'is a claim about position, not a record of participation.';

-- ---------------------------------------------------------------------------
-- 4. Batch confirmation
--
-- The owner's binding requirement for the attendance board: a commander facing
-- thirty intervals after a call-out must be able to confirm them in ONE action,
-- and confirmation must not demand a note. Doing that with thirty round trips
-- would be slow on a phone at the station and would produce thirty audit rows
-- with the same timestamp anyway.
--
-- This is a convenience over `attendance_confirm`, not a second rule: it calls
-- the same command per interval, so every check, every audit row and every
-- refusal behaves identically. An interval that cannot be confirmed (already
-- rejected) is reported rather than silently skipped.
-- ---------------------------------------------------------------------------

create or replace function public.attendance_confirm_many(
  target_intervals uuid[],
  requested_note text default null
)
returns table (interval_id uuid, outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate uuid;
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;
  if target_intervals is null or array_length(target_intervals, 1) is null then
    raise exception 'NO_INTERVALS';
  end if;
  -- A cap, because an unbounded array from a client is an unbounded statement.
  if array_length(target_intervals, 1) > 200 then raise exception 'TOO_MANY_INTERVALS'; end if;

  foreach candidate in array target_intervals loop
    begin
      perform public.attendance_confirm(candidate, requested_note);
      interval_id := candidate; outcome := 'CONFIRMED';
    exception when others then
      -- One unconfirmable interval must not abandon the other twenty-nine.
      interval_id := candidate; outcome := SQLERRM;
    end;
    return next;
  end loop;
end;
$$;

comment on function public.attendance_confirm_many(uuid[], text) is
  'Confirms many intervals in one action. Same rules as attendance_confirm, '
  'applied per interval; a failure is reported per interval, not fatal.';

-- ---------------------------------------------------------------------------
-- 5. Privileges
--
-- Four new tables, so Supabase's default-privileges trap DOES apply here:
-- every one of them arrives holding INSERT, UPDATE, DELETE and TRUNCATE for
-- `anon` and `authenticated`. Revoke first, then grant back only the SELECT the
-- policies above are written for. Adding a grant without the revoke changes
-- nothing, which is the mistake `202609110003` exists to correct.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'public.member_availability',
    'public.member_availability_history',
    'public.intervention_journey',
    'public.intervention_journey_history'
  ] loop
    execute format('revoke all on %s from anon', t);
    execute format('revoke all on %s from authenticated', t);
    execute format('grant select on %s to authenticated', t);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.set_own_availability(boolean, text)',
    'public.set_journey_progress(uuid, text)',
    'public.attendance_confirm_many(uuid[], text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
