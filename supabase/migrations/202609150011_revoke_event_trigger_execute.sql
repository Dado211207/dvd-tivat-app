-- ===========================================================================
-- 202609150011 - take away a grant that was never meant to exist
--
-- Found by the hosted security advisor after applying this slice's migrations,
-- so it is recorded here rather than left as a dashboard-only change: the two
-- must stay in step or the next person to rebuild the schema reintroduces it.
--
-- `public.rls_auto_enable()` is an EVENT TRIGGER function. It was created
-- without an explicit privilege statement, and PostgreSQL grants EXECUTE to
-- PUBLIC by default on a new function - so `anon` held EXECUTE on a
-- `security definer` function, and Supabase exposes it at
-- `/rest/v1/rpc/rls_auto_enable`.
--
-- HOW MUCH THIS MATTERED, honestly: very little. A function returning
-- `event_trigger` cannot be invoked as an ordinary function at all -
-- PostgreSQL refuses with "trigger functions can only be called as triggers" -
-- so the endpoint could not have done anything. This is tidying an
-- unintended grant, not closing an exploited hole, and it is described that
-- way rather than dressed up.
--
-- It also CANNOT break the trigger. PostgreSQL invokes an event trigger
-- function as part of DDL processing and does not consult EXECUTE privileges
-- to do it; the grant was only ever about calling it by name.
--
-- Everything else the advisor reports on this project is either pre-existing
-- and unrelated (`btree_gist` living in `public`) or the architecture working
-- as designed: every command in this schema is `security definer`, granted to
-- `authenticated`, and checks authority itself in its first statement. That is
-- the whole point - no client role holds a table privilege, so a command is the
-- only way in, and each one refuses the caller it should.
-- ===========================================================================

-- Guarded, because this function belongs to the hosted platform and does not
-- exist in the plain PostgreSQL the database suite runs against. A bare revoke
-- would fail every one of those tests - which is how this guard came to be
-- written rather than assumed.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
    raise notice 'Revoked EXECUTE on public.rls_auto_enable().';
  else
    raise notice 'public.rls_auto_enable() is not present here; nothing to revoke.';
  end if;
end $$;
