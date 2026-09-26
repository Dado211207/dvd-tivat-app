-- ===========================================================================
-- 202609250037 - only the owner changes the guards and constraints on the
--                audit, history and current-row tables
--
-- A follow-up to 202609250033 (audit history), 202609250034 (history
-- retention), 202609250035 (current-row identity) and 202609250036
-- (current-row grants), none of which it changes.
--
-- ---------------------------------------------------------------------------
-- What was left, measured on a schema at 202609250036
-- (db-tests/service_role_trigger_grants.test.ts, first describe)
-- ---------------------------------------------------------------------------
--
-- 033 made the seven audit tables append-only, 034 the three history tables,
-- and 035 froze the identity of an answer, a journey step and an availability.
-- Each rule is a trigger owned by postgres: refuse_audit_change /
-- refuse_audit_truncate, refuse_response_rebinding / refuse_response_delete,
-- refuse_journey_rebinding, refuse_availability_rebinding and the retention
-- guards on interventions. 036 then took INSERT, UPDATE, DELETE and TRUNCATE
-- on the three current-row tables away from the service role.
--
-- What none of that removed: the service role still held TRIGGER and
-- REFERENCES on all thirteen tables (Supabase grants a Data-API role every
-- privilege on a public table by default, and 033/034/036 revoked only the
-- write privileges). TRIGGER is enough to defeat the guards those migrations
-- installed. `create or replace trigger` needs the TRIGGER privilege on the
-- table, not ownership of it, so the service role could re-point a table's
-- append-only or identity guard at some other, permissive trigger function
-- that already exists and that it may execute - after which the row change the
-- guard was there to refuse would be accepted, with no revision, no history
-- and no audit row to explain it. The write revoke of 033/034/036 is only as
-- firm as the trigger it leans on; while the service role may replace that
-- trigger, the revoke is not firm.
--
-- REFERENCES is the privilege to name a table's columns in a foreign key. On
-- its own it changes nothing: defining a foreign key also requires ownership
-- of the table the constraint is added to, and the service role owns no table
-- (verified: zero relations, functions, schemas or types). A row written or
-- deleted at run time is checked by the constraint as the table's owner, never
-- by the writer's REFERENCES privilege, so nothing the application or the
-- worker does needs it. It is removed here because it is unused, not because
-- it is presently dangerous.
--
-- ---------------------------------------------------------------------------
-- Why nothing needs TRIGGER or REFERENCES here (inspected before changing them)
-- ---------------------------------------------------------------------------
--
--   - The application creates no triggers and defines no constraints at run
--     time; it reads these tables as the signed-in account and writes only
--     through the security-definer commands, which fire the existing triggers
--     regardless of the caller's privileges. TRIGGER controls who may CREATE,
--     ALTER or DROP a trigger, not whether one fires, so the commands are
--     unaffected.
--   - send-web-push, the only Edge Function and the only service-role caller,
--     writes notification_outbox, notification_delivery_attempts and
--     web_push_subscriptions and calls read-only functions. It touches none of
--     these thirteen tables and creates nothing.
--   - The scheduled worker (pg_cron `send-web-push-every-minute`) runs as
--     postgres, not the service role, and only issues an HTTP call; it runs no
--     DDL.
--   - Realtime reads the write-ahead log through the `supabase_realtime`
--     publication; it does not install a service-role-owned trigger on these
--     tables. The only triggers on public tables in production are the four the
--     application defines (its audit and membership-sync triggers and the
--     report-media limit), all owned by postgres.
--   - The referential actions into these tables - a deleted call-out taking its
--     answers, a deleted account or call-out clearing an audit link - run as
--     the table's owner and are defined by migrations that already exist. None
--     is added or altered at run time.
--
-- ---------------------------------------------------------------------------
-- The change
-- ---------------------------------------------------------------------------
--
-- The service role loses TRIGGER and REFERENCES on the seven audit tables, the
-- three history tables and the three current-row tables. It keeps SELECT (and,
-- on PostgreSQL 17, MAINTAIN - the privilege to VACUUM, ANALYZE, REINDEX,
-- CLUSTER, REFRESH or LOCK the table, which cannot change a row's content or
-- replace a trigger and is left as the platform's default). After this, only
-- the owner - a superuser or postgres session, outside the application - can
-- add, alter or drop a trigger or constraint on these tables. That the guards
-- of 033-035 are the owner's alone to change is the point: it makes the
-- append-only, retention and identity rules firm rather than conditional on a
-- privilege the service role never needed.
--
-- Not changed: the commands, their callers and what they write; the triggers,
-- rules and foreign keys of 033-036; the reads every role already had. MAINTAIN
-- is not revoked - it does not exist on PostgreSQL 16, where the suite and CI
-- run, so a `revoke maintain` would fail there, and it is harmless besides.
--
-- On the hosted project (PostgreSQL 17), check after applying that
-- has_table_privilege('service_role', <table>, 'TRIGGER') and
-- has_table_privilege('service_role', <table>, 'REFERENCES') are both false for
-- all thirteen tables, and that 'SELECT' remains true. A privilege granted
-- through another role would survive a revoke.
-- ===========================================================================

revoke trigger, references on public.role_audit from service_role;
revoke trigger, references on public.account_status_audit from service_role;
revoke trigger, references on public.organization_membership_audit from service_role;
revoke trigger, references on public.report_status_audit from service_role;
revoke trigger, references on public.operational_audit from service_role;
revoke trigger, references on public.registry_audit from service_role;
revoke trigger, references on public.attendance_corrections from service_role;

revoke trigger, references on public.member_availability_history from service_role;
revoke trigger, references on public.intervention_journey_history from service_role;
revoke trigger, references on public.intervention_response_revisions from service_role;

revoke trigger, references on public.intervention_responses from service_role;
revoke trigger, references on public.intervention_journey from service_role;
revoke trigger, references on public.member_availability from service_role;
