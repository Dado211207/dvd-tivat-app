-- DVD Tivat internal operations: organisational data, interventions,
-- mobilisation, honest notification states and verified attendance records.
--
-- Additive on top of 202609090001_accounts_reports.sql. That migration is left
-- untouched so a database which already applied it converges here, and a clean
-- database gets the same result by running both in order.
--
-- Product decision of 9 September 2026: this is an INTERNAL mobilisation and
-- intervention-record system for DVD Tivat. It is not a public emergency
-- reporting channel and must never be presented as a replacement for calling
-- the official fire service.
--
-- Contains no real member data. Every seedable name is fictional.

create extension if not exists btree_gist;

-- ===========================================================================
-- PART 1 - Fix the accounts foundation
-- ===========================================================================

-- 1.1 An unapproved account gets NO internal access. PENDING is the new default
-- and is the honest name for it. CITIZEN is retained only so rows written by
-- the earlier migration remain valid; both mean "no internal operational
-- access". Nothing in this schema grants either of them an operational
-- permission.
alter table public.access_grants drop constraint if exists access_grants_role_check;
alter table public.access_grants add constraint access_grants_role_check
  check (role in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER', 'PENDING', 'CITIZEN'));
alter table public.access_grants alter column role set default 'PENDING';

-- 1.2 Exactly one owner, enforced by the database rather than by convention.
-- This is what stops a second owner being created by any code path at all.
create unique index if not exists access_grants_single_owner
  on public.access_grants ((true)) where role = 'OWNER';

-- 1.3 Account status is now first class, so suspension is a real state rather
-- than a flag nobody checks.
create table if not exists public.account_status_audit (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete restrict,
  previous_active boolean not null,
  next_active boolean not null,
  reason text not null check (char_length(reason) between 2 and 500),
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);

-- 1.4 THE ROLE CONTRACT.
--
-- An account holds an internal role only when it is ACTIVE, has a COMPLETE
-- profile, and has been granted one of the four operational roles. The previous
-- version checked none of that, so a suspended or half-registered account kept
-- its privileges. Every policy below depends on this one function, so the rule
-- lives in exactly one place.
--
-- PENDING and CITIZEN deliberately resolve to NULL rather than to their own
-- name: "no internal role" must be one unambiguous value, so a policy written
-- later cannot accidentally treat an unapproved account as holding a role.
-- Read public.access_grants directly (owner-only) to display the raw grant.
create or replace function public.current_dvd_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select grant_row.role
  from public.access_grants grant_row
  join public.profiles profile on profile.user_id = grant_row.user_id
  where grant_row.user_id = auth.uid()
    and grant_row.active = true
    and profile.profile_complete = true
    and grant_row.role in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER')
$$;

-- Granular status for the interface. Never used for authorisation.
create or replace function public.current_account_status()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then 'ANONYMOUS'
    when not exists (select 1 from public.access_grants where user_id = auth.uid()) then 'UNKNOWN'
    when (select active from public.access_grants where user_id = auth.uid()) = false then 'SUSPENDED'
    when (select profile_complete from public.profiles where user_id = auth.uid()) = false
      then 'PROFILE_REQUIRED'
    else 'ACTIVE'
  end
$$;

create or replace function public.is_dvd_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_dvd_role() in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'), false)
$$;

-- Command authority: may publish, change status, close and verify attendance.
create or replace function public.is_dvd_command()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_dvd_role() in ('OWNER', 'ADMIN', 'COMMANDER'), false)
$$;

create or replace function public.is_dvd_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.current_dvd_role() = 'OWNER', false)
$$;

-- 1.5 New accounts start with no internal access.
create or replace function public.handle_new_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(user_id, email) values (new.id, lower(new.email))
    on conflict (user_id) do nothing;
  insert into public.access_grants(user_id, role, active) values (new.id, 'PENDING', true)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

-- 1.6 Owner may now suspend and restore access, with an audit entry. The
-- previous migration could grant roles but never take access away.
create or replace function public.owner_set_account_active(
  target_user uuid,
  requested_active boolean,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_active boolean;
  target_role text;
  normalized_reason text := trim(coalesce(requested_reason, ''));
begin
  if not public.is_dvd_owner() then raise exception 'OWNER_REQUIRED'; end if;
  if char_length(normalized_reason) < 2 or char_length(normalized_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;
  if target_user = auth.uid() then raise exception 'CANNOT_CHANGE_OWN_ACCESS'; end if;

  select active, role into old_active, target_role
  from public.access_grants where user_id = target_user for update;

  if old_active is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if target_role = 'OWNER' then raise exception 'OWNER_ACCOUNT_PROTECTED'; end if;
  if old_active = requested_active then return; end if;

  update public.access_grants set active = requested_active where user_id = target_user;

  insert into public.account_status_audit(
    target_user_id, previous_active, next_active, reason, changed_by)
  values (target_user, old_active, requested_active, normalized_reason, auth.uid());
end;
$$;

-- 1.7 Role assignment: same authority rule, now expressed through is_dvd_owner()
-- so the active/profile contract applies, and PENDING is assignable.
create or replace function public.owner_set_role(target_user uuid, requested_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_role text;
begin
  if not public.is_dvd_owner() then raise exception 'OWNER_REQUIRED'; end if;
  if requested_role not in ('ADMIN', 'COMMANDER', 'FIREFIGHTER', 'PENDING', 'CITIZEN') then
    raise exception 'ROLE_NOT_ASSIGNABLE';
  end if;
  if target_user = auth.uid() then raise exception 'CANNOT_CHANGE_OWN_ROLE'; end if;

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

-- 1.8 A report may only be filed by an account that is active with a complete
-- profile. The old policy accepted any authenticated user, including suspended
-- ones. (Citizen reporting itself is abandoned research; the policy is
-- tightened rather than left permissive.)
drop policy if exists reports_create_own on public.citizen_reports;
create policy reports_create_own on public.citizen_reports for insert
  with check (
    reporter_user_id = auth.uid()
    and public.current_account_status() = 'ACTIVE'
    and status = 'UNVERIFIED'
    and reviewed_at is null
    and reviewed_by is null
  );

-- 1.9 At most three images per report. The design said three; nothing enforced it.
create or replace function public.enforce_report_media_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.report_media where report_id = new.report_id) >= 3 then
    raise exception 'REPORT_MEDIA_LIMIT';
  end if;
  return new;
end;
$$;

drop trigger if exists report_media_limit on public.report_media;
create trigger report_media_limit before insert on public.report_media
for each row execute function public.enforce_report_media_limit();

alter table public.account_status_audit enable row level security;
drop policy if exists status_audit_owner_read on public.account_status_audit;
create policy status_audit_owner_read on public.account_status_audit for select
  using (public.is_dvd_owner());

-- ===========================================================================
-- PART 2 - Organisational data
-- ===========================================================================

-- A member is the operational person record. It may or may not be linked to an
-- authenticated account: DVD Tivat has 52 members and not all of them will have
-- installed anything. Authority always comes from the account, never the member
-- row.
create table public.members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null check (char_length(full_name) between 2 and 100),
  specialties text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  primary key (group_id, member_id)
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  callsign text not null unique check (char_length(callsign) between 1 and 30),
  name text not null check (char_length(name) between 1 and 100),
  kind text not null check (char_length(kind) between 1 and 50),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- The member row for the current account, if one is linked.
create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.members where user_id = auth.uid() and active = true
$$;

-- ===========================================================================
-- PART 3 - Interventions
-- ===========================================================================

create table public.interventions (
  id uuid primary key default gen_random_uuid(),

  kind text not null check (kind in (
    'POZAR', 'SAOBRACAJNA_NEZGODA', 'TEHNICKA_POMOC', 'VJEZBA', 'TEST', 'DRUGO')),
  -- 'DRUGO' is the documented extensible category and must say what it is.
  other_kind_note text check (char_length(other_kind_note) between 2 and 120),

  title text not null check (char_length(title) between 3 and 160),
  instructions text not null check (char_length(instructions) between 3 and 4000),

  -- LOCATION CONTRACT. A typed place is always required: a bare coordinate pair
  -- is not something a crew can act on at 03:00, and the earlier branch allowed
  -- the UI to submit one that the database would then reject. Coordinates are
  -- optional, carry their provenance, and never substitute for the text.
  incident_location text not null check (char_length(incident_location) between 2 and 300),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  coordinate_source text check (coordinate_source in ('MAP_PIN', 'TYPED', 'DEVICE')),
  coordinate_captured_at timestamptz,
  assembly_point text check (assembly_point is null or char_length(assembly_point) between 2 and 300),

  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'PUBLISHED', 'ASSEMBLING', 'DEPLOYED', 'CONTAINED', 'CLOSED', 'CANCELLED')),

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users(id),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  close_reason text check (close_reason is null or char_length(close_reason) between 2 and 500),

  -- Optimistic concurrency: two commanders cannot silently overwrite each other.
  version integer not null default 1 check (version > 0),
  -- Idempotency: a retried publish cannot create a second intervention.
  idempotency_key text not null,

  constraint intervention_coordinate_pair check ((latitude is null) = (longitude is null)),
  constraint intervention_coordinate_provenance check (
    latitude is null or (coordinate_source is not null and coordinate_captured_at is not null)),
  constraint intervention_other_kind_note check (kind <> 'DRUGO' or other_kind_note is not null),
  constraint intervention_published_fields check (
    (status = 'DRAFT' and published_at is null) or (status <> 'DRAFT' and published_at is not null)),
  constraint intervention_closed_fields check (
    (status in ('CLOSED', 'CANCELLED')) = (closed_at is not null)),
  constraint intervention_close_reason check (
    closed_at is null or close_reason is not null)
);

create unique index interventions_idempotency
  on public.interventions (created_by, idempotency_key);
create index interventions_status_created_idx
  on public.interventions (status, created_at desc);

-- Operationally important edits after publication become versioned updates that
-- recipients can see, instead of silently rewriting what people already acted on.
create table public.intervention_updates (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  version integer not null,
  body text not null check (char_length(body) between 2 and 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (intervention_id, version)
);

-- Frozen recipient set. Captured at publication so a later roster edit cannot
-- rewrite the record of who was actually called.
create table public.intervention_recipients (
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  recipient_version integer not null default 1,
  member_name_at_publication text not null,
  added_at timestamptz not null default now(),
  primary key (intervention_id, member_id, recipient_version)
);

-- ===========================================================================
-- PART 4 - Mobilisation: notification truth and member responses
-- ===========================================================================

-- The outbox records what OUR SERVER did. It never claims a phone rang.
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  channel text not null check (channel in ('IN_APP', 'WEB_PUSH', 'EMAIL', 'SMS')),
  state text not null default 'QUEUED' check (state in (
    'QUEUED',              -- our server accepted the request
    'SENT_TO_PROVIDER',    -- we handed it to a transport
    'PROVIDER_ACCEPTED',   -- the transport said it took it
    'PROVIDER_REJECTED',   -- the transport refused it
    'DEVICE_ACKNOWLEDGED', -- a device confirmed receipt, where that is possible
    'FAILED',
    'UNKNOWN')),
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= 10),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedupe_key)
);

create index notification_outbox_pending_idx
  on public.notification_outbox (state, created_at) where state in ('QUEUED', 'SENT_TO_PROVIDER');

create table public.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_outbox(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  provider text not null,
  provider_status text not null,
  provider_message text
);

-- A person opened the intervention. This is NOT a response and NOT attendance.
create table public.intervention_acknowledgements (
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  opened_at timestamptz not null default now(),
  primary key (intervention_id, member_id)
);

-- A person stated an intention. This is NOT attendance.
create table public.intervention_responses (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete restrict,
  answer text not null check (answer in ('DOLAZIM', 'DOLAZIM_KASNIJE', 'NE_MOGU')),
  eta_minutes integer check (eta_minutes in (15, 30, 60)),
  -- Base-first response model: members normally collect equipment at the base.
  -- Direct travel to the incident must be stated, never assumed.
  direct_to_location boolean not null default false,
  responded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (intervention_id, member_id),
  constraint response_eta_only_when_later check (
    (answer = 'DOLAZIM_KASNIJE') = (eta_minutes is not null)),
  constraint response_direct_not_when_declined check (
    answer <> 'NE_MOGU' or direct_to_location = false)
);

-- Every revision is retained; a changed answer never erases the earlier one.
create table public.intervention_response_revisions (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.intervention_responses(id) on delete cascade,
  revision integer not null,
  answer text not null,
  eta_minutes integer,
  direct_to_location boolean not null,
  recorded_at timestamptz not null default now(),
  unique (response_id, revision)
);

-- ===========================================================================
-- PART 5 - Verified attendance (the primary new capability)
-- ===========================================================================

-- One member may have SEVERAL intervals on one intervention: people leave and
-- come back. Duration is never stored and never derived from display text - it
-- is the sum of closed intervals, computed from trusted server timestamps.
create table public.attendance_intervals (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid not null references public.interventions(id) on delete restrict,
  member_id uuid not null references public.members(id) on delete restrict,

  -- Trusted server time. Written by the check-in/check-out functions.
  started_at timestamptz not null,
  ended_at timestamptz,

  -- Optional, and deliberately SEPARATE: what a person said afterwards when
  -- self-service was impossible. Never used to compute duration.
  reported_started_at timestamptz,
  reported_ended_at timestamptz,

  -- Optional deployment detail; may change over time.
  crew text check (crew is null or char_length(crew) between 1 and 80),
  task_role text check (task_role is null or char_length(task_role) between 1 and 80),
  vehicle_id uuid references public.vehicles(id) on delete set null,

  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  verified boolean not null default false,
  verified_by uuid references auth.users(id),
  verified_at timestamptz,

  constraint attendance_interval_order check (ended_at is null or ended_at > started_at),
  constraint attendance_reported_order check (
    reported_ended_at is null or reported_started_at is null
    or reported_ended_at > reported_started_at),
  constraint attendance_verified_fields check (verified = (verified_at is not null)),

  -- A person cannot be in two places at once. Overlap is refused by the
  -- database, ACROSS interventions, so participation hours cannot be
  -- double-counted. An open interval runs to 'infinity' for this purpose.
  constraint attendance_no_overlap exclude using gist (
    member_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz)) with &&
  )
);

create index attendance_intervention_idx on public.attendance_intervals (intervention_id, started_at);
create index attendance_member_idx on public.attendance_intervals (member_id, started_at desc);
create index attendance_open_idx on public.attendance_intervals (intervention_id) where ended_at is null;

-- Immutable correction record: before, after, who and why.
create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  interval_id uuid not null references public.attendance_intervals(id) on delete restrict,
  before_value jsonb not null,
  after_value jsonb not null,
  reason text not null check (char_length(reason) between 2 and 500),
  corrected_by uuid not null references auth.users(id) on delete restrict,
  corrected_at timestamptz not null default now()
);

-- A firefighter asks for their own record to be fixed; command decides.
create table public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  interval_id uuid not null references public.attendance_intervals(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  message text not null check (char_length(message) between 2 and 500),
  state text not null default 'OPEN' check (state in ('OPEN', 'ACCEPTED', 'REJECTED')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  resolution_note text
);

-- Duration is derived, never stored. Open intervals are reported separately
-- rather than being silently given an end time.
create or replace function public.attendance_totals(
  from_ts timestamptz default '-infinity',
  to_ts timestamptz default 'infinity'
)
returns table (
  member_id uuid,
  full_name text,
  closed_intervals bigint,
  open_intervals bigint,
  total_seconds numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    m.id,
    m.full_name,
    count(*) filter (where a.ended_at is not null),
    count(*) filter (where a.ended_at is null),
    coalesce(sum(extract(epoch from (a.ended_at - a.started_at)))
             filter (where a.ended_at is not null), 0)
  from public.members m
  join public.attendance_intervals a on a.member_id = m.id
  where a.started_at >= from_ts and a.started_at <= to_ts
  group by m.id, m.full_name
$$;

-- ===========================================================================
-- PART 6 - Vehicle movements
-- ===========================================================================

-- Explicit and independent. A member response never moves a vehicle, and a
-- vehicle departure never checks anybody in.
create table public.vehicle_movements (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  intervention_id uuid references public.interventions(id) on delete set null,
  purpose text check (purpose is null or char_length(purpose) between 1 and 200),
  departed_at timestamptz not null default now(),
  departed_by uuid not null references auth.users(id) on delete restrict,
  returned_at timestamptz,
  returned_by uuid references auth.users(id),
  constraint vehicle_movement_order check (returned_at is null or returned_at > departed_at),
  constraint vehicle_movement_return_actor check ((returned_at is null) = (returned_by is null)),
  -- One vehicle cannot be out twice at the same time.
  constraint vehicle_movement_no_overlap exclude using gist (
    vehicle_id with =,
    tstzrange(departed_at, coalesce(returned_at, 'infinity'::timestamptz)) with &&
  )
);

create index vehicle_movements_open_idx on public.vehicle_movements (vehicle_id) where returned_at is null;

-- ===========================================================================
-- PART 7 - Operational audit
-- ===========================================================================

create table public.operational_audit (
  id uuid primary key default gen_random_uuid(),
  intervention_id uuid references public.interventions(id) on delete set null,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index operational_audit_intervention_idx
  on public.operational_audit (intervention_id, occurred_at desc);

-- ===========================================================================
-- PART 8 - Transactional server commands
--
-- Every operational fact is created by one of these. The client asks; the
-- server decides, using the authenticated identity. Client-side checks are for
-- usability only and carry no authority.
-- ===========================================================================

-- 8.1 Publish. Idempotent: a retry returns the same intervention instead of
-- alerting the society twice. Recipients are frozen here, and the notification
-- outbox is filled with QUEUED rows only - nothing claims a phone rang.
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
  current_status text;
  member_row record;
  frozen_count integer := 0;
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;

  select status into current_status
  from public.interventions where id = target_intervention for update;
  if current_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;

  -- Already published: this is a retry, not a second call-out.
  if current_status <> 'DRAFT' then
    if current_status in ('CLOSED', 'CANCELLED') then raise exception 'INTERVENTION_NOT_OPEN'; end if;
    return target_intervention;
  end if;

  if recipient_member_ids is null or array_length(recipient_member_ids, 1) is null then
    raise exception 'NO_RECIPIENTS';
  end if;

  for member_row in
    select id, full_name from public.members
    where id = any(recipient_member_ids) and active = true
  loop
    insert into public.intervention_recipients(
      intervention_id, member_id, recipient_version, member_name_at_publication)
    values (target_intervention, member_row.id, 1, member_row.full_name)
    on conflict do nothing;

    insert into public.notification_outbox(
      intervention_id, member_id, channel, state, dedupe_key)
    values (
      target_intervention, member_row.id, 'IN_APP', 'QUEUED',
      target_intervention::text || ':' || member_row.id::text || ':1')
    on conflict (dedupe_key) do nothing;

    frozen_count := frozen_count + 1;
  end loop;

  if frozen_count = 0 then raise exception 'NO_ACTIVE_RECIPIENTS'; end if;

  update public.interventions
  set status = 'PUBLISHED',
      published_at = now(),
      published_by = auth.uid(),
      updated_at = now(),
      version = version + 1
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'INTERVENTION_PUBLISHED',
          jsonb_build_object('recipients', frozen_count), auth.uid());

  return target_intervention;
end;
$$;

-- 8.2 Status change, with the lifecycle enforced server-side. CLOSED and
-- CANCELLED are not reachable here: they are separate, reasoned commands.
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
  current_status text;
  current_version integer;
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;
  if requested_status not in ('PUBLISHED', 'ASSEMBLING', 'DEPLOYED', 'CONTAINED') then
    raise exception 'STATUS_NOT_SETTABLE';
  end if;

  select status, version into current_status, current_version
  from public.interventions where id = target_intervention for update;
  if current_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if current_status in ('CLOSED', 'CANCELLED') then raise exception 'INTERVENTION_NOT_OPEN'; end if;
  if current_status = 'DRAFT' then raise exception 'INTERVENTION_NOT_PUBLISHED'; end if;
  if expected_version is not null and expected_version <> current_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  update public.interventions
  set status = requested_status, updated_at = now(), version = version + 1
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'INTERVENTION_STATUS_CHANGED',
          jsonb_build_object('from', current_status, 'to', requested_status), auth.uid());
end;
$$;

-- 8.3 Close or cancel. Open attendance intervals are refused rather than
-- silently given an invented checkout time.
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
  current_status text;
  open_count integer;
  normalized_reason text := trim(coalesce(requested_reason, ''));
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;
  if requested_status not in ('CLOSED', 'CANCELLED') then raise exception 'STATUS_NOT_SETTABLE'; end if;
  if char_length(normalized_reason) < 2 or char_length(normalized_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;

  select status into current_status
  from public.interventions where id = target_intervention for update;
  if current_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if current_status in ('CLOSED', 'CANCELLED') then raise exception 'INTERVENTION_NOT_OPEN'; end if;

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

-- 8.4 A member states an intention. Recorded against the authenticated
-- identity, with every revision retained. Creates NO attendance.
create or replace function public.submit_response(
  target_intervention uuid,
  requested_answer text,
  requested_eta integer,
  requested_direct boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid := public.current_member_id();
  intervention_status text;
  existing record;
  effective_eta integer;
  effective_direct boolean;
  new_id uuid;
begin
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  if requested_answer not in ('DOLAZIM', 'DOLAZIM_KASNIJE', 'NE_MOGU') then
    raise exception 'INVALID_ANSWER';
  end if;

  select status into intervention_status
  from public.interventions where id = target_intervention;
  if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if intervention_status in ('DRAFT', 'CLOSED', 'CANCELLED') then
    raise exception 'INTERVENTION_NOT_OPEN';
  end if;

  if not exists (
    select 1 from public.intervention_recipients
    where intervention_id = target_intervention and member_id = acting_member
  ) then
    raise exception 'NOT_A_RECIPIENT';
  end if;

  effective_eta := case when requested_answer = 'DOLAZIM_KASNIJE' then requested_eta else null end;
  -- `x not in (...)` is NULL when x is NULL, so the null case must be tested
  -- explicitly. Without it a missing arrival band fell through to the table
  -- constraint and the caller got an opaque error instead of a clear reason.
  if requested_answer = 'DOLAZIM_KASNIJE'
     and (effective_eta is null or effective_eta not in (15, 30, 60)) then
    raise exception 'ETA_REQUIRED';
  end if;
  effective_direct := case when requested_answer = 'NE_MOGU' then false
                           else coalesce(requested_direct, false) end;

  select * into existing from public.intervention_responses
  where intervention_id = target_intervention and member_id = acting_member for update;

  if existing.id is null then
    insert into public.intervention_responses(
      intervention_id, member_id, answer, eta_minutes, direct_to_location)
    values (target_intervention, acting_member, requested_answer, effective_eta, effective_direct)
    returning id into new_id;

    insert into public.intervention_response_revisions(
      response_id, revision, answer, eta_minutes, direct_to_location)
    values (new_id, 1, requested_answer, effective_eta, effective_direct);
    return;
  end if;

  -- Re-sending an unchanged answer is not a change and writes no revision.
  if existing.answer = requested_answer
     and existing.eta_minutes is not distinct from effective_eta
     and existing.direct_to_location = effective_direct then
    return;
  end if;

  update public.intervention_responses
  set answer = requested_answer,
      eta_minutes = effective_eta,
      direct_to_location = effective_direct,
      updated_at = now(),
      revision = revision + 1
  where id = existing.id;

  insert into public.intervention_response_revisions(
    response_id, revision, answer, eta_minutes, direct_to_location)
  values (existing.id, existing.revision + 1, requested_answer, effective_eta, effective_direct);
end;
$$;

-- 8.5 Check in. Trusted server time. A response is NOT a precondition and
-- NEVER creates one of these by itself.
create or replace function public.attendance_check_in(
  target_intervention uuid,
  target_member uuid default null,
  requested_crew text default null,
  requested_task_role text default null,
  requested_vehicle uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid := coalesce(target_member, public.current_member_id());
  intervention_status text;
  new_interval uuid;
begin
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;

  -- Checking somebody else in is a command action.
  if target_member is not null and target_member is distinct from public.current_member_id()
     and not public.is_dvd_command() then
    raise exception 'COMMAND_REQUIRED';
  end if;
  if target_member is null and not public.is_dvd_staff() then
    raise exception 'STAFF_REQUIRED';
  end if;

  select status into intervention_status
  from public.interventions where id = target_intervention;
  if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if intervention_status in ('DRAFT', 'CLOSED', 'CANCELLED') then
    raise exception 'INTERVENTION_NOT_OPEN';
  end if;

  -- The exclusion constraint refuses an overlap; translate it into a clear error.
  begin
    insert into public.attendance_intervals(
      intervention_id, member_id, started_at, crew, task_role, vehicle_id, recorded_by)
    values (target_intervention, acting_member, now(),
            requested_crew, requested_task_role, requested_vehicle, auth.uid())
    returning id into new_interval;
  exception when exclusion_violation then
    raise exception 'ALREADY_CHECKED_IN';
  end;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'ATTENDANCE_CHECK_IN',
          jsonb_build_object('member_id', acting_member), auth.uid());

  return new_interval;
end;
$$;

-- 8.6 Check out.
create or replace function public.attendance_check_out(
  target_intervention uuid,
  target_member uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid := coalesce(target_member, public.current_member_id());
  open_interval uuid;
begin
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  if target_member is not null and target_member is distinct from public.current_member_id()
     and not public.is_dvd_command() then
    raise exception 'COMMAND_REQUIRED';
  end if;

  select id into open_interval
  from public.attendance_intervals
  where intervention_id = target_intervention and member_id = acting_member and ended_at is null
  order by started_at desc limit 1
  for update;

  if open_interval is null then raise exception 'NOT_CHECKED_IN'; end if;

  update public.attendance_intervals set ended_at = now() where id = open_interval;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention, 'ATTENDANCE_CHECK_OUT',
          jsonb_build_object('member_id', acting_member), auth.uid());
end;
$$;

-- 8.7 Correct an attendance record. Command only, reason mandatory, before and
-- after preserved immutably.
create or replace function public.attendance_correct(
  target_interval uuid,
  new_started_at timestamptz,
  new_ended_at timestamptz,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_row public.attendance_intervals;
  after_row public.attendance_intervals;
  normalized_reason text := trim(coalesce(requested_reason, ''));
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;
  if char_length(normalized_reason) < 2 or char_length(normalized_reason) > 500 then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into before_row from public.attendance_intervals where id = target_interval for update;
  if before_row.id is null then raise exception 'INTERVAL_NOT_FOUND'; end if;

  if new_ended_at is not null and new_started_at is not null and new_ended_at <= new_started_at then
    raise exception 'INVALID_INTERVAL';
  end if;

  begin
    update public.attendance_intervals
    set started_at = coalesce(new_started_at, started_at),
        ended_at = new_ended_at,
        verified = true,
        verified_by = auth.uid(),
        verified_at = now()
    where id = target_interval
    returning * into after_row;
  exception when exclusion_violation then
    raise exception 'CORRECTION_WOULD_OVERLAP';
  end;

  insert into public.attendance_corrections(
    interval_id, before_value, after_value, reason, corrected_by)
  values (
    target_interval,
    jsonb_build_object('started_at', before_row.started_at, 'ended_at', before_row.ended_at),
    jsonb_build_object('started_at', after_row.started_at, 'ended_at', after_row.ended_at),
    normalized_reason, auth.uid());

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (before_row.intervention_id, 'ATTENDANCE_CORRECTED',
          jsonb_build_object('interval_id', target_interval, 'reason', normalized_reason), auth.uid());
end;
$$;

-- ===========================================================================
-- PART 9 - Row level security
--
-- Shape of the model: RLS grants READS only. Every write goes through the
-- security-definer commands in Part 8, so there is no direct insert or update
-- path a client could use to forge an operational fact.
-- ===========================================================================

create or replace function public.is_recipient_of(target_intervention uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.intervention_recipients recipient
    where recipient.intervention_id = target_intervention
      and recipient.member_id = public.current_member_id()
  )
$$;

alter table public.members enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.vehicles enable row level security;
alter table public.interventions enable row level security;
alter table public.intervention_updates enable row level security;
alter table public.intervention_recipients enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_delivery_attempts enable row level security;
alter table public.intervention_acknowledgements enable row level security;
alter table public.intervention_responses enable row level security;
alter table public.intervention_response_revisions enable row level security;
alter table public.attendance_intervals enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.attendance_correction_requests enable row level security;
alter table public.vehicle_movements enable row level security;
alter table public.operational_audit enable row level security;

-- Organisational data: readable by approved staff only. An unapproved account
-- must never be able to enumerate the society's roster.
create policy members_staff_read on public.members for select using (public.is_dvd_staff());
create policy groups_staff_read on public.groups for select using (public.is_dvd_staff());
create policy group_members_staff_read on public.group_members for select using (public.is_dvd_staff());
create policy vehicles_staff_read on public.vehicles for select using (public.is_dvd_staff());

-- Interventions. A draft is command-only: it is not yet a call-out. A published
-- one is visible to command and to the members it was actually addressed to -
-- never to an unapproved account, which is what keeps incident locations private.
create policy interventions_command_read on public.interventions for select
  using (public.is_dvd_command());
create policy interventions_recipient_read on public.interventions for select
  using (status <> 'DRAFT' and public.is_recipient_of(id));

create policy intervention_updates_read on public.intervention_updates for select
  using (public.is_dvd_command() or public.is_recipient_of(intervention_id));

create policy recipients_command_read on public.intervention_recipients for select
  using (public.is_dvd_command());
create policy recipients_self_read on public.intervention_recipients for select
  using (member_id = public.current_member_id());

-- Notification truth. Command sees the whole outbox; a member sees only the
-- rows addressed to them, so nobody mistakes a queued row for a delivered one.
create policy outbox_command_read on public.notification_outbox for select
  using (public.is_dvd_command());
create policy outbox_self_read on public.notification_outbox for select
  using (member_id = public.current_member_id());
create policy delivery_attempts_command_read on public.notification_delivery_attempts for select
  using (public.is_dvd_command());

create policy acknowledgements_read on public.intervention_acknowledgements for select
  using (public.is_dvd_command() or member_id = public.current_member_id());

-- Responses: everyone called to the same intervention can see who is coming.
-- That is how a crew coordinates; it is a product decision, recorded in
-- docs/ACCESS_MODEL.md rather than left implicit.
create policy responses_command_read on public.intervention_responses for select
  using (public.is_dvd_command());
create policy responses_recipient_read on public.intervention_responses for select
  using (public.is_recipient_of(intervention_id));
create policy response_revisions_command_read on public.intervention_response_revisions for select
  using (public.is_dvd_command());

-- Attendance: command sees all, a member sees their own record and the board of
-- the intervention they were called to.
create policy attendance_command_read on public.attendance_intervals for select
  using (public.is_dvd_command());
create policy attendance_recipient_read on public.attendance_intervals for select
  using (public.is_recipient_of(intervention_id));
create policy attendance_self_read on public.attendance_intervals for select
  using (member_id = public.current_member_id());

create policy corrections_command_read on public.attendance_corrections for select
  using (public.is_dvd_command());

create policy correction_requests_command_read on public.attendance_correction_requests for select
  using (public.is_dvd_command());
create policy correction_requests_self_read on public.attendance_correction_requests for select
  using (requested_by = auth.uid());
-- The one direct write a member is allowed: asking for their OWN record to be
-- corrected. It changes no operational fact by itself.
create policy correction_requests_self_create on public.attendance_correction_requests for insert
  with check (
    requested_by = auth.uid()
    and state = 'OPEN'
    and exists (
      select 1 from public.attendance_intervals interval_row
      where interval_row.id = interval_id
        and interval_row.member_id = public.current_member_id()
    )
  );

create policy vehicle_movements_staff_read on public.vehicle_movements for select
  using (public.is_dvd_staff());

create policy operational_audit_command_read on public.operational_audit for select
  using (public.is_dvd_command());

-- ===========================================================================
-- PART 10 - Least privilege
-- ===========================================================================

-- The anonymous role gets nothing at all in the operational schema.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- Authenticated clients may read (RLS then decides which rows) but may not
-- write directly: writes are the commands in Part 8.
grant select on
  public.members, public.groups, public.group_members, public.vehicles,
  public.interventions, public.intervention_updates, public.intervention_recipients,
  public.notification_outbox, public.notification_delivery_attempts,
  public.intervention_acknowledgements, public.intervention_responses,
  public.intervention_response_revisions, public.attendance_intervals,
  public.attendance_corrections, public.attendance_correction_requests,
  public.vehicle_movements, public.operational_audit, public.account_status_audit
to authenticated;

grant insert on public.attendance_correction_requests to authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.publish_intervention(uuid, uuid[])',
    'public.set_intervention_status(uuid, text, integer)',
    'public.close_intervention(uuid, text, text, boolean)',
    'public.submit_response(uuid, text, integer, boolean)',
    'public.attendance_check_in(uuid, uuid, text, text, uuid)',
    'public.attendance_check_out(uuid, uuid)',
    'public.attendance_correct(uuid, timestamptz, timestamptz, text)',
    'public.owner_set_account_active(uuid, boolean, text)',
    'public.attendance_totals(timestamptz, timestamptz)',
    'public.current_account_status()'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
