-- ===========================================================================
-- MUST RUN AS supabase_admin / a superuser - NOT the project owner.
--
-- Verified 2026-10-04 on the isolated project: net.http_request_queue and
-- net._http_response are owned by `supabase_admin`, and the project owner
-- login `postgres` is NOT a superuser and cannot SET ROLE supabase_admin, so
-- `REVOKE ... FROM PUBLIC` run as `postgres` (the dashboard SQL editor's role)
-- silently no-ops - PUBLIC keeps every privilege. Removing PUBLIC's grants on
-- pg_net therefore requires supabase_admin, which Supabase does not expose to
-- customers: it is a Supabase SUPPORT action, or must be accepted as a
-- documented residual (see docs/RESTORED_CAPTURE_REHEARSAL.md). The dump
-- workflow's verify-role refuses while PUBLIC still holds these, so run this
-- (or accept the residual) before creating the dump role.
--
-- PREREQUISITE before ANY new login role exists on the project, the dump role
-- included. Review before running; it is a production change.
--
-- pg_net leaves ALL privileges on its request queue and response table with
-- PUBLIC (measured on the isolated project and, read-only, on production,
-- 2026-10-04). Every login role therefore has, through PUBLIC alone:
--
--   TRIGGER     attach a trigger to net.http_request_queue. The push cron
--               enqueues there as `postgres` every minute, so the trigger runs
--               with `postgres`'s privileges - a function defined in the
--               role's own temporary schema is enough. Demonstrated on the
--               loopback stand-in: a role that could write nothing promoted
--               every firefighter to ADMIN within one cron tick.
--   SELECT      read the queued push request, x-push-worker-secret included.
--   UPDATE      redirect that request, secret and all, to another URL.
--   DELETE, TRUNCATE, MAINTAIN (LOCK)
--               drop or block push-worker invocations.
--   INSERT      send arbitrary HTTP requests from the database.
--
-- After this, PUBLIC keeps nothing on them and `postgres` keeps what the
-- cron's net.http_post() (SECURITY INVOKER) needs, plus reads for the owner.
-- pg_net's background worker runs as the extension owner and is unaffected.
--
-- Check afterwards, on the isolated project first: the next cron tick still
-- enqueues and send-web-push still runs (net._http_response gains a row).
-- An extension upgrade may restore the PUBLIC grants: verify-role checks
-- before every dump and refuses if they are back.
-- ===========================================================================
begin;
revoke all on table net.http_request_queue, net._http_response from public;
revoke all on sequence net.http_request_queue_id_seq from public;
grant select, insert on table net.http_request_queue to postgres;
grant select on table net._http_response to postgres;
grant usage, select on sequence net.http_request_queue_id_seq to postgres;
commit;
