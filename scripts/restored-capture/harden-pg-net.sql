-- ===========================================================================
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
