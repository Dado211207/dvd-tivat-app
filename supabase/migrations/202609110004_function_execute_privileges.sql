-- DVD Tivat: stop `anon` executing the authority helpers.
--
-- WHY THIS EXISTS.
--
-- 202609090002 ended with
--
--   revoke all on all functions in schema public from anon;
--
-- which reads like "the anonymous role holds nothing", and docs/ACCESS_MODEL.md
-- said exactly that. It is not what the statement does. PostgreSQL grants
-- EXECUTE on a new function to the pseudo-role PUBLIC, and revoking from `anon`
-- does not touch a PUBLIC grant - `anon` keeps the privilege through PUBLIC.
-- Supabase's own database linter reports the consequence: eight `security
-- definer` functions were callable without signing in, over `/rest/v1/rpc/...`.
--
-- Nothing leaked. Every one of them is keyed on `auth.uid()`, which is NULL for
-- an anonymous caller, so they return NULL or false; the two trigger functions
-- cannot be invoked directly at all because of their return type. But "it
-- happens to return nothing useful" is not the guarantee the access model
-- claims, and it is one refactor away from being wrong.
--
-- So: revoke the PUBLIC grant, and grant EXECUTE explicitly to `authenticated`.
-- The explicit grant is required, not cosmetic - a row level security policy is
-- evaluated with the privileges of the caller, and every policy in this schema
-- calls one of these predicates.

do $$
declare fn text;
begin
  foreach fn in array array[
    -- The authority predicates. Every policy calls one of them, so
    -- `authenticated` must keep EXECUTE.
    'public.current_dvd_role()',
    'public.current_member_id()',
    'public.is_dvd_staff()',
    'public.is_dvd_command()',
    'public.is_dvd_owner()',
    'public.is_recipient_of(uuid)',
    -- Trigger functions. Their return type means they can only ever run from
    -- the trigger they are attached to; a direct call raises. EXECUTE is checked
    -- when the trigger is created, not on every statement, but the grant is kept
    -- for `authenticated` so nothing depends on that detail.
    'public.handle_new_account()',
    'public.enforce_report_media_limit()'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- After this migration no function in `public` that this project defines is
-- executable by `anon`, by a PUBLIC grant or otherwise. The test suite asserts
-- it, so a function added later without its own revoke fails CI.
