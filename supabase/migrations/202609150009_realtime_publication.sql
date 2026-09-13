-- ===========================================================================
-- 202609150009 - let the operational tables announce that they changed
--
-- PURELY ADDITIVE, and a no-op on any database that is not a Supabase project.
-- It adds existing tables to an existing publication. It creates nothing,
-- drops nothing, alters no column and changes no policy.
--
-- ---------------------------------------------------------------------------
-- What this is for
-- ---------------------------------------------------------------------------
--
-- During an incident the commander's console sits on a desk and nobody is
-- looking after it. A firefighter answers, starts moving, arrives. The screen
-- has to show that without somebody remembering to press a button.
--
-- Supabase Realtime sends a change notice for tables in the `supabase_realtime`
-- publication. The client (`src/auth/live.ts`) treats that notice as one thing
-- only: "something you care about may have moved". It never reads the payload.
-- The response is always to re-read through the ordinary queries, which row
-- level security governs exactly as before - so being told about a change can
-- never show anybody a row they could not already read.
--
-- ---------------------------------------------------------------------------
-- Why the whole thing is wrapped in a guard
-- ---------------------------------------------------------------------------
--
-- Two databases run these migrations and only one of them has this publication.
--
--   * The hosted project has `supabase_realtime`, created and owned by the
--     platform.
--   * The local PostgreSQL used by `db-tests/` is plain PostgreSQL. There is no
--     such publication and no Realtime server to read it.
--
-- A bare `alter publication` would therefore fail every database test, so the
-- block below does nothing when the publication is absent. It also swallows
-- `insufficient_privilege`, because the role applying migrations on a hosted
-- project may not own a platform-managed publication.
--
-- Either way the application still works: `useLiveOperations` falls back to
-- polling in the foreground when no change notice ever arrives. That fallback
-- is not a consolation prize, it is the designed second path - the screen
-- behaves the same, only the delay differs, and it says which one is in use
-- rather than implying a liveness it does not have.
--
-- REPLICA IDENTITY is deliberately left alone. `replica identity full` would be
-- needed to receive the OLD row on an update or delete, and the client has no
-- use for it: it reads no payload at all. Nothing in this schema deletes an
-- operational row - the whole design is append-and-correct - so the one case
-- that would need it does not arise.
-- ===========================================================================

do $$
declare
  target text;
  watched text[] := array[
    'interventions',
    'intervention_recipients',
    'intervention_acknowledgements',
    'intervention_responses',
    'intervention_journey',
    'attendance_intervals',
    'vehicle_movements',
    'member_availability'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice
      'No supabase_realtime publication here (plain PostgreSQL). Live updates will poll instead.';
    return;
  end if;

  foreach target in array watched loop
    -- Skip a table already published: adding it twice is an error, and this
    -- migration has to be safe to re-run.
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
      raise notice 'Added public.% to supabase_realtime.', target;
    end if;
  end loop;

exception
  when insufficient_privilege then
    raise notice
      'Not permitted to alter supabase_realtime. Live updates will poll instead.';
end $$;
