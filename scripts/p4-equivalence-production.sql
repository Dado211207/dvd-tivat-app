-- ===========================================================================
-- Read-only production capture for the P4a/P4b equivalence gate
--
-- docs/MULTI_ORG_PLAN.md section 13. The P3 gate (section 12) asked one
-- question of the real installation - what `current_dvd_role()` and
-- `current_member_id()` answer. P4a and P4b rewrote the policies and commands
-- over the registry, call-outs, their outputs and their history, so this gate
-- has to ask far more: what every account can READ, table by table, and what
-- every reader function answers. What every account can DO is measured on the
-- copy, never here - commands write.
--
-- One batch, one transaction, one consistent snapshot. It returns:
--
--   read_only           must be 'on'; the gate refuses anything else
--   applied_migrations  the hosted migration history (null on a local copy)
--   schema_fingerprint  per-category md5 of functions, policies, triggers,
--                       columns, constraints, indexes and table ACLs
--   column_acls         column-level grants in public (expected 0)
--   export              the pseudonymised rows the copy is built from
--   export_digest       per-table md5 of `export`, order-insensitive
--   behaviour           per account: every public table's visible row keys
--                       and every reader function's answer, as tokens
--   behaviour_digest    per-account md5 of `behaviour`
--
-- ---------------------------------------------------------------------------
-- What it reads, and what it deliberately does not
-- ---------------------------------------------------------------------------
--
-- Every row id becomes an order-preserving token (u1, m1, i1, ...), so the
-- output carries no production identifier. Organisation ids are kept, and have
-- to be: the migrations under test hard-code the DVD uuid. Names, e-mail
-- addresses, phone numbers, dates of birth, free text, coordinates and push
-- secrets are NEVER read out - only whether each is present. Member names
-- become 'Clan NNN', dense-ranked, so anything that sorts or compares names
-- behaves the same on the copy. Audit `detail` payloads keep their keys, ids
-- (mapped), numbers, booleans and the enumerations `source`, `kind`, `from`
-- and `to`; any other string becomes 'redacted'.
--
-- The citizen-reporting tables are counted, not exported. They are empty on
-- production; the gate refuses to build a copy if they are not.
--
-- The probe impersonates each account the way PostgREST does - the JWT claims
-- setting, then `set local role authenticated` - inside this read-only
-- transaction, so every read goes through row-level security as that account.
-- Nothing is written: `set transaction read only` makes any write an error.
--
-- ---------------------------------------------------------------------------
-- How to use it
-- ---------------------------------------------------------------------------
--
--   1. Run this whole file against the hosted project over a READ-ONLY path,
--      as one batch. It needs to read the public schema, auth.users and
--      supabase_migrations.schema_migrations.
--   2. Save the single returned row as a .json object OUTSIDE the repository.
--      It is pseudonymised, but still production-derived. Name it
--      `*.production-export.json`: .gitignore covers that suffix, as a
--      backstop for saving it in the tree by accident, not as permission to.
--      `behaviour` may be omitted; `behaviour_digest` may not.
--   3. npm run gate:p4 -- <path to that file>
--
-- The gate runs this SAME file against the copy it builds and refuses to
-- compare anything until the copy reproduces the schema fingerprint, the
-- export digest and every account's behaviour digest - so a stale or partial
-- capture fails loudly rather than quietly grading an easier question.
-- ===========================================================================

set transaction read only;

do $gate$
declare k int; n int; v jsonb; applied jsonb;
begin
  -- The hosted migration history, when there is one. A local copy has no such
  -- table, and says so with null rather than an empty list.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select coalesce(jsonb_agg(name order by name collate "C"), ''[]''::jsonb) from supabase_migrations.schema_migrations'
      into applied;
  end if;
  perform set_config('gate.applied', coalesce(applied::text, 'null'), true);
  perform set_config('gate.ints', (select coalesce(string_agg(id::text, ','), '') from public.interventions), true);
  perform set_config('gate.mems', (select coalesce(string_agg(id::text, ','), '') from public.members), true);
  perform set_config('gate.users', (select coalesce(string_agg(id::text, ','), '') from auth.users), true);
  select count(*) into n from auth.users;
  perform set_config('gate.n', n::text, true);
  for k in 0 .. n - 1 loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', (select id::text from auth.users order by id offset k limit 1), 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute $measure$ select jsonb_build_object(
    'tbl|access_grants', (select coalesce(jsonb_agg(user_id::text), '[]'::jsonb) from public.access_grants),
    'tbl|account_status_audit', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.account_status_audit),
    'tbl|attendance_correction_requests', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.attendance_correction_requests),
    'tbl|attendance_corrections', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.attendance_corrections),
    'tbl|attendance_intervals', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.attendance_intervals),
    'tbl|citizen_reports', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.citizen_reports),
    'tbl|group_members', (select coalesce(jsonb_agg(group_id::text || '|' || member_id::text), '[]'::jsonb) from public.group_members),
    'tbl|groups', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.groups),
    'tbl|intervention_acknowledgements', (select coalesce(jsonb_agg(intervention_id::text || '|' || member_id::text), '[]'::jsonb) from public.intervention_acknowledgements),
    'tbl|intervention_journey', (select coalesce(jsonb_agg(intervention_id::text || '|' || member_id::text), '[]'::jsonb) from public.intervention_journey),
    'tbl|intervention_journey_history', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.intervention_journey_history),
    'tbl|intervention_recipients', (select coalesce(jsonb_agg(intervention_id::text || '|' || member_id::text), '[]'::jsonb) from public.intervention_recipients),
    'tbl|intervention_response_revisions', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.intervention_response_revisions),
    'tbl|intervention_responses', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.intervention_responses),
    'tbl|intervention_updates', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.intervention_updates),
    'tbl|interventions', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.interventions),
    'tbl|member_availability', (select coalesce(jsonb_agg(member_id::text), '[]'::jsonb) from public.member_availability),
    'tbl|member_availability_history', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.member_availability_history),
    'tbl|members', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.members),
    'tbl|notification_delivery_attempts', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.notification_delivery_attempts),
    'tbl|notification_outbox', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.notification_outbox),
    'tbl|operational_audit', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.operational_audit),
    'tbl|organization_membership_audit', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.organization_membership_audit),
    'tbl|organization_memberships', (select coalesce(jsonb_agg(organization_id::text || '|' || user_id::text), '[]'::jsonb) from public.organization_memberships),
    'tbl|organizations', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.organizations),
    'tbl|profiles', (select coalesce(jsonb_agg(user_id::text), '[]'::jsonb) from public.profiles),
    'tbl|registry_audit', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.registry_audit),
    'tbl|report_media', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.report_media),
    'tbl|report_status_audit', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.report_status_audit),
    'tbl|role_audit', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.role_audit),
    'tbl|vehicle_movements', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.vehicle_movements),
    'tbl|vehicles', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.vehicles),
    'tbl|web_push_subscriptions', (select coalesce(jsonb_agg(id::text), '[]'::jsonb) from public.web_push_subscriptions),
    'fn|current_dvd_role', jsonb_build_array((public.current_dvd_role())::text),
    'fn|current_member_id', jsonb_build_array((public.current_member_id())::text),
    'fn|is_dvd_staff', jsonb_build_array((public.is_dvd_staff())::text),
    'fn|is_dvd_command', jsonb_build_array((public.is_dvd_command())::text),
    'fn|is_dvd_admin', jsonb_build_array((public.is_dvd_admin())::text),
    'fn|is_dvd_owner', jsonb_build_array((public.is_dvd_owner())::text),
    'fn|current_account_status', jsonb_build_array((public.current_account_status())::text),
    'fn|current_organization_memberships', (select coalesce(jsonb_agg(organization_code || '|' || coalesce(membership_role, '-')), '[]'::jsonb) from public.current_organization_memberships()),
    'fn|eligible_recipients', (select coalesce(jsonb_agg(member_id::text || '|' || coalesce(role, '-')), '[]'::jsonb) from public.eligible_recipients()),
    'fn|attendance_totals', (select coalesce(jsonb_agg(member_id::text || '|' || confirmed_intervals || '|' || confirmed_seconds || '|' || unverified_intervals || '|' || unverified_seconds || '|' || open_intervals || '|' || rejected_intervals), '[]'::jsonb) from public.attendance_totals('-infinity'::timestamptz, 'infinity'::timestamptz))
  ) || jsonb_build_object(
    'per|recipient_of', (select coalesce(jsonb_object_agg(x, to_jsonb(public.is_recipient_of(x::uuid))), '{}'::jsonb) from unnest(string_to_array(nullif(current_setting('gate.ints'), ''), ',')) x),
    'per|intervention_audit', (select coalesce(jsonb_object_agg(x, (select coalesce(jsonb_agg(event_id::text || '|' || event_type || '|' || actor_is_you::text), '[]'::jsonb) from public.intervention_audit(x::uuid))), '{}'::jsonb) from unnest(string_to_array(nullif(current_setting('gate.ints'), ''), ',')) x),
    'per|is_eligible_recipient', (select coalesce(jsonb_object_agg(x, to_jsonb(public.is_eligible_recipient(x::uuid))), '{}'::jsonb) from unnest(string_to_array(nullif(current_setting('gate.mems'), ''), ',')) x),
    'per|serves_with', (select coalesce(jsonb_object_agg(x, to_jsonb(public.serves_with(x::uuid))), '{}'::jsonb) from unnest(string_to_array(nullif(current_setting('gate.users'), ''), ',')) x)
  ) $measure$ into v;
    execute 'reset role';
    perform set_config('gate.v' || k, v::text, true);
  end loop;
end
$gate$;
with
u  as (select id rid, row_number() over (order by id) n from auth.users),
m  as (select id rid, row_number() over (order by id) n from public.members),
g  as (select id rid, row_number() over (order by id) n from public.groups),
v  as (select id rid, row_number() over (order by id) n from public.vehicles),
i  as (select id rid, row_number() over (order by id) n from public.interventions),
a  as (select id rid, row_number() over (order by id) n from public.attendance_intervals),
mv as (select id rid, row_number() over (order by id) n from public.vehicle_movements),
o  as (select id rid, row_number() over (order by id) n from public.notification_outbox),
da as (select id rid, row_number() over (order by id) n from public.notification_delivery_attempts),
r  as (select id rid, row_number() over (order by id) n from public.intervention_responses),
rr as (select id rid, row_number() over (order by id) n from public.intervention_response_revisions),
jh as (select id rid, row_number() over (order by id) n from public.intervention_journey_history),
ah as (select id rid, row_number() over (order by id) n from public.member_availability_history),
oa as (select id rid, row_number() over (order by id) n from public.operational_audit),
ra as (select id rid, row_number() over (order by id) n from public.registry_audit),
rl as (select id rid, row_number() over (order by id) n from public.role_audit),
sa as (select id rid, row_number() over (order by id) n from public.account_status_audit),
w  as (select id rid, row_number() over (order by id) n from public.web_push_subscriptions),
up as (select id rid, row_number() over (order by id) n from public.intervention_updates),
ac as (select id rid, row_number() over (order by id) n from public.attendance_corrections),
cr as (select id rid, row_number() over (order by id) n from public.attendance_correction_requests),
ma as (select id rid, row_number() over (order by id) n from public.organization_membership_audit),
cre as (select id rid, row_number() over (order by id) n from public.citizen_reports),
rm as (select id rid, row_number() over (order by id) n from public.report_media),
rsa as (select id rid, row_number() over (order by id) n from public.report_status_audit),
tok(rid, t) as (
  select rid, 'u'  || n from u  union all select rid, 'm'  || n from m  union all
  select rid, 'g'  || n from g  union all select rid, 'v'  || n from v  union all
  select rid, 'i'  || n from i  union all select rid, 'a'  || n from a  union all
  select rid, 'mv' || n from mv union all select rid, 'o'  || n from o  union all
  select rid, 'da' || n from da union all select rid, 'r'  || n from r  union all
  select rid, 'rr' || n from rr union all select rid, 'jh' || n from jh union all
  select rid, 'ah' || n from ah union all select rid, 'oa' || n from oa union all
  select rid, 'ra' || n from ra union all select rid, 'rl' || n from rl union all
  select rid, 'sa' || n from sa union all select rid, 'w'  || n from w  union all
  select rid, 'up' || n from up union all select rid, 'ac' || n from ac union all
  select rid, 'cr' || n from cr union all select rid, 'ma' || n from ma union all
  select rid, 'cre' || n from cre union all select rid, 'rm' || n from rm union all
  select rid, 'rsa' || n from rsa union all
  select id, 'org:' || code from public.organizations),
mname as (select id rid, 'Clan ' || lpad(dense_rank() over (order by full_name)::text, 3, '0') nm from public.members),
spec as (select s, 'spec-' || dense_rank() over (order by s) t from (select distinct unnest(specialties) s from public.members) x),
ex as (select jsonb_build_object(
  'counts', jsonb_build_object(
     'citizen_reports', (select count(*) from public.citizen_reports),
     'report_media', (select count(*) from public.report_media),
     'report_status_audit', (select count(*) from public.report_status_audit)),
  'organizations', (select coalesce(jsonb_agg(jsonb_build_array(o2.id, o2.code, o2.display_name, o2.active, o2.created_at) order by o2.code), '[]') from public.organizations o2),
  'users', (select coalesce(jsonb_agg(jsonb_build_array(t.t, x.email_confirmed_at is not null, x.email_confirmed_at, x.created_at) order by u.n), '[]')
            from auth.users x join u on u.rid = x.id join tok t on t.rid = x.id),
  'profiles', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = p.user_id), p.full_name is not null, p.phone_e164 is not null,
                 p.date_of_birth is not null, p.profile_complete, p.created_at, p.updated_at) order by 1), '[]') from public.profiles p),
  'access_grants', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.user_id), x.role, x.active,
                 (select t from tok where rid = x.granted_by), x.granted_at)), '[]') from public.access_grants x),
  'organization_memberships', (select coalesce(jsonb_agg(jsonb_build_array(x.organization_id, (select t from tok where rid = x.user_id), x.role, x.active,
                 (select t from tok where rid = x.granted_by), x.granted_at)), '[]') from public.organization_memberships x),
  'organization_membership_audit', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), x.organization_id,
                 (select t from tok where rid = x.target_user_id), x.previous_role, x.next_role, x.previous_active, x.next_active,
                 (select t from tok where rid = x.changed_by), x.changed_at)), '[]') from public.organization_membership_audit x),
  'role_audit', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.target_user_id),
                 x.previous_role, x.next_role, (select t from tok where rid = x.changed_by), x.changed_at)), '[]') from public.role_audit x),
  'account_status_audit', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.target_user_id),
                 x.previous_active, x.next_active, (select t from tok where rid = x.changed_by), x.changed_at)), '[]') from public.account_status_audit x),
  'members', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.user_id),
                 (select nm from mname where rid = x.id),
                 (select coalesce(jsonb_agg((select t from spec where spec.s = z.s) order by z.o), '[]') from unnest(x.specialties) with ordinality z(s, o)),
                 x.active, x.created_at, x.updated_at)), '[]') from public.members x),
  'groups', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), x.active, x.created_at)), '[]') from public.groups x),
  'group_members', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.group_id), (select t from tok where rid = x.member_id))), '[]') from public.group_members x),
  'vehicles', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), x.kind, x.active, x.created_at)), '[]') from public.vehicles x),
  'member_availability', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.member_id), x.available, x.note is not null,
                 x.changed_at, (select t from tok where rid = x.changed_by))), '[]') from public.member_availability x),
  'member_availability_history', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.member_id),
                 x.previous_available, x.next_available, x.note is not null, x.changed_at, (select t from tok where rid = x.changed_by))), '[]') from public.member_availability_history x),
  'interventions', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), x.kind, x.other_kind_note is not null,
                 x.latitude is not null, x.coordinate_source, x.coordinate_captured_at, x.assembly_point is not null, x.status,
                 (select t from tok where rid = x.created_by), x.created_at, x.updated_at, x.published_at, (select t from tok where rid = x.published_by),
                 x.closed_at, (select t from tok where rid = x.closed_by), x.close_reason is not null, x.version,
                 x.keyn)), '[]')
     from (select y.*, dense_rank() over (partition by y.created_by order by y.idempotency_key) as keyn from public.interventions y) x),
  'intervention_recipients', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.intervention_id), (select t from tok where rid = x.member_id),
                 x.recipient_version, x.added_at)), '[]') from public.intervention_recipients x),
  'intervention_updates', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.intervention_id),
                 x.version, (select t from tok where rid = x.created_by), x.created_at)), '[]') from public.intervention_updates x),
  'intervention_acknowledgements', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.intervention_id), (select t from tok where rid = x.member_id),
                 x.opened_at)), '[]') from public.intervention_acknowledgements x),
  'operational_audit', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.intervention_id),
                 x.event_type,
                 coalesce((select jsonb_object_agg(e.key, case
                    when jsonb_typeof(e.value) = 'string' and exists (select 1 from tok where tok.rid::text = e.value #>> '{}')
                      then to_jsonb((select t from tok where tok.rid::text = e.value #>> '{}'))
                    when jsonb_typeof(e.value) = 'string' and e.key in ('source', 'kind', 'from', 'to') then e.value
                    when jsonb_typeof(e.value) = 'string' then to_jsonb('redacted'::text)
                    when jsonb_typeof(e.value) = 'array' then (select coalesce(jsonb_agg(case
                        when jsonb_typeof(z) = 'string' and exists (select 1 from tok where tok.rid::text = z #>> '{}')
                          then to_jsonb((select t from tok where tok.rid::text = z #>> '{}'))
                        when jsonb_typeof(z) = 'string' then to_jsonb('redacted'::text) else z end), '[]'::jsonb) from jsonb_array_elements(e.value) z)
                    when jsonb_typeof(e.value) = 'object' then to_jsonb('redacted-object'::text)
                    else e.value end) from jsonb_each(x.detail) e), '{}'::jsonb),
                 (select t from tok where rid = x.actor_user_id), x.occurred_at)), '[]') from public.operational_audit x),
  'registry_audit', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), x.entity_kind, (select t from tok where rid = x.entity_id),
                 x.event_type,
                 coalesce((select jsonb_object_agg(e.key, case
                    when jsonb_typeof(e.value) = 'string' and exists (select 1 from tok where tok.rid::text = e.value #>> '{}')
                      then to_jsonb((select t from tok where tok.rid::text = e.value #>> '{}'))
                    when jsonb_typeof(e.value) = 'string' and e.key in ('kind') then e.value
                    when jsonb_typeof(e.value) = 'string' then to_jsonb('redacted'::text)
                    when jsonb_typeof(e.value) = 'array' then (select coalesce(jsonb_agg(case
                        when jsonb_typeof(z) = 'string' and exists (select 1 from tok where tok.rid::text = z #>> '{}')
                          then to_jsonb((select t from tok where tok.rid::text = z #>> '{}'))
                        when jsonb_typeof(z) = 'string' then to_jsonb('redacted'::text) else z end), '[]'::jsonb) from jsonb_array_elements(e.value) z)
                    when jsonb_typeof(e.value) = 'object' then to_jsonb('redacted-object'::text)
                    else e.value end) from jsonb_each(x.detail) e), '{}'::jsonb),
                 x.reason is not null, (select t from tok where rid = x.changed_by), x.changed_at)), '[]') from public.registry_audit x),
  'notification_outbox', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.intervention_id),
                 (select t from tok where rid = x.member_id), x.channel, x.state, x.attempt_count,
                 (select string_agg(coalesce((select t from tok where tok.rid::text = part), part), ':' order by ord) from unnest(string_to_array(x.dedupe_key, ':')) with ordinality q(part, ord)),
                 x.created_at, x.updated_at, x.delivery_closed_at, x.delivery_close_reason)), '[]') from public.notification_outbox x),
  'notification_delivery_attempts', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.outbox_id),
                 x.attempted_at, x.provider, x.provider_status, x.provider_message is not null)), '[]') from public.notification_delivery_attempts x),
  'intervention_journey', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.intervention_id), (select t from tok where rid = x.member_id),
                 x.progress, x.updated_at, (select t from tok where rid = x.updated_by))), '[]') from public.intervention_journey x),
  'intervention_journey_history', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.intervention_id),
                 (select t from tok where rid = x.member_id), x.previous_progress, x.next_progress, x.changed_at, (select t from tok where rid = x.changed_by))), '[]') from public.intervention_journey_history x),
  'attendance_intervals', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.intervention_id),
                 (select t from tok where rid = x.member_id), x.started_at, x.ended_at, x.reported_started_at, x.reported_ended_at,
                 x.crew is not null, x.task_role is not null, (select t from tok where rid = x.vehicle_id), (select t from tok where rid = x.recorded_by), x.recorded_at,
                 x.verified, (select t from tok where rid = x.verified_by), x.verified_at, x.source, x.rejected_at, (select t from tok where rid = x.rejected_by),
                 x.rejection_reason is not null)), '[]') from public.attendance_intervals x),
  'attendance_corrections', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.interval_id),
                 x.before_value, x.after_value, (select t from tok where rid = x.corrected_by), x.corrected_at)), '[]') from public.attendance_corrections x),
  'attendance_correction_requests', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.interval_id),
                 (select t from tok where rid = x.requested_by), x.requested_at, x.state, (select t from tok where rid = x.resolved_by), x.resolved_at,
                 x.resolution_note is not null)), '[]') from public.attendance_correction_requests x),
  'vehicle_movements', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.vehicle_id),
                 (select t from tok where rid = x.intervention_id), x.purpose is not null, x.departed_at, (select t from tok where rid = x.departed_by),
                 x.returned_at, (select t from tok where rid = x.returned_by))), '[]') from public.vehicle_movements x),
  'intervention_responses', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.intervention_id),
                 (select t from tok where rid = x.member_id), x.answer, x.eta_minutes, x.direct_to_location, x.responded_at, x.updated_at, x.revision)), '[]') from public.intervention_responses x),
  'intervention_response_revisions', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.response_id),
                 x.revision, x.answer, x.eta_minutes, x.direct_to_location, x.recorded_at)), '[]') from public.intervention_response_revisions x),
  'web_push_subscriptions', (select coalesce(jsonb_agg(jsonb_build_array((select t from tok where rid = x.id), (select t from tok where rid = x.user_id),
                 x.expiration_time, x.user_agent is not null, x.created_at, x.updated_at, x.last_used_at, x.revoked_at)), '[]') from public.web_push_subscriptions x)
) as e),
fp as (select jsonb_build_object(
  'functions', (
    select jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      md5(p.prokind::text || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|'
          || coalesce(array_to_string(p.proconfig, ','), '') || '|' || pg_get_function_result(p.oid)
          || '|' || md5(p.prosrc) || '|' || coalesce(array_to_string(p.proacl, ' '), '(default)')
          || '|' || l.lanname || '|' || pg_get_userbyid(p.proowner)))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.proname <> 'rls_auto_enable'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'policies', (
    select jsonb_object_agg(tablename || '.' || policyname,
      md5(coalesce(qual, '') || '|' || coalesce(with_check, '') || '|' || cmd || '|'
          || array_to_string(roles, ',') || '|' || permissive))
    from pg_policies where schemaname = 'public'),
  'triggers', (
    select jsonb_object_agg(cl.relname || '.' || tg.tgname,
      md5(pg_get_triggerdef(tg.oid) || '|' || tg.tgenabled::text))
    from pg_trigger tg
    join pg_class cl on cl.oid = tg.tgrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname = 'public' and not tg.tgisinternal),
  'columns', (
    select jsonb_object_agg(table_name || '.' || column_name,
      md5(data_type || '|' || udt_name || '|' || is_nullable || '|' || coalesce(column_default, '')
          || '|' || coalesce(character_maximum_length::text, '') || '|' || coalesce(is_generated, '')
          || '|' || coalesce(generation_expression, '')))
    from information_schema.columns where table_schema = 'public'),
  'constraints', (
    select jsonb_object_agg(c.relname || '.' || con.conname, md5(pg_get_constraintdef(con.oid)))
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'),
  'indexes', (
    select jsonb_object_agg(indexname, md5(indexdef)) from pg_indexes where schemaname = 'public'),
  'tables', (
    select jsonb_object_agg(c.relname,
      md5(c.relkind::text || '|' || c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
          || '|' || coalesce(regexp_replace(array_to_string(c.relacl, ' '), 'm/', '/', 'g'), '(default)') || '|' || pg_get_userbyid(c.relowner)))
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'S'))
) as f),
raw as (select k, current_setting('gate.v' || k)::jsonb as v from generate_series(0, current_setting('gate.n')::int - 1) k),
norm as (
  select 'u' || (raw.k + 1) as acct, e.key as rawkey, e.value as val
  from raw, jsonb_each(raw.v) e),
facts as (select (select jsonb_object_agg(acct, obj) from (
     select acct, jsonb_object_agg(key, val order by key) as obj from (
       -- plain arrays of keys or scalars
       select acct, rawkey as key,
         (select coalesce(jsonb_agg((select string_agg(coalesce((select t from tok where tok.rid::text = part), part), '|' order by ord) from unnest(string_to_array(x, '|')) with ordinality q(part, ord)) order by (select string_agg(coalesce((select t from tok where tok.rid::text = part), part), '|' order by ord) from unnest(string_to_array(x, '|')) with ordinality q(part, ord))), '[]'::jsonb) from jsonb_array_elements_text(val) x) as val
       from norm where jsonb_typeof(val) = 'array'
       union all
       -- per-id objects: map the id in the key too
       select acct, rawkey || '|' || (select string_agg(coalesce((select t from tok where tok.rid::text = part), part), '|' order by ord) from unnest(string_to_array(pe.key, '|')) with ordinality q(part, ord)) as key,
         case when jsonb_typeof(pe.value) = 'array'
              then (select coalesce(jsonb_agg((select string_agg(coalesce((select t from tok where tok.rid::text = part), part), '|' order by ord) from unnest(string_to_array(y, '|')) with ordinality q(part, ord)) order by (select string_agg(coalesce((select t from tok where tok.rid::text = part), part), '|' order by ord) from unnest(string_to_array(y, '|')) with ordinality q(part, ord))), '[]'::jsonb) from jsonb_array_elements_text(pe.value) y)
              else pe.value end as val
       from norm, jsonb_each(norm.val) pe where jsonb_typeof(norm.val) = 'object'
     ) flat group by acct) per_account) as b)
select
  current_setting('transaction_read_only') as read_only,
  current_setting('gate.applied')::jsonb as applied_migrations,
  (select jsonb_object_agg(k, jsonb_build_object(
      'n', (select count(*) from jsonb_object_keys(v)),
      'md5', (select md5(string_agg(e.key || '=' || (e.value #>> '{}'), E'\n' order by e.key collate "C")) from jsonb_each(v) e)))
     from fp, jsonb_each(fp.f) as t(k, v)) as schema_fingerprint,
  (select count(*) from pg_attribute pa join pg_class pc on pc.oid = pa.attrelid join pg_namespace pn on pn.oid = pc.relnamespace
    where pn.nspname = 'public' and pa.attacl is not null) as column_acls,
  (select e from ex) as export,
  (select jsonb_object_agg(k, case when jsonb_typeof(v) = 'array'
      then md5(coalesce((select string_agg(x::text, E'\n' order by x::text collate "C") from jsonb_array_elements(v) x), ''))
      else md5(v::text) end) from ex, jsonb_each(ex.e) as t(k, v)) as export_digest,
  (select b from facts) as behaviour,
  (select jsonb_object_agg(a.key, (select md5(string_agg(f.key || '=' || md5(case when jsonb_typeof(f.value) = 'array'
      then coalesce((select string_agg(coalesce(x, '<null>'), E'\n' order by x collate "C") from jsonb_array_elements_text(f.value) x), '')
      else f.value::text end), E'\n' order by f.key collate "C")) from jsonb_each(a.value) f))
     from facts, jsonb_each(facts.b) a) as behaviour_digest;
