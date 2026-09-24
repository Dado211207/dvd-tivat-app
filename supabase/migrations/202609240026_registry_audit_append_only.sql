-- ===========================================================================
-- 202609240026 - the registry audit becomes append-only in the database
--
-- Still P4a. `202609240025` gave every audit row a service, derived from the
-- entity it is about. It derived it BEFORE INSERT, and guarded only
-- `organization_id` on UPDATE - which left the other half of the same
-- invariant open.
--
-- ---------------------------------------------------------------------------
-- What was still possible, measured rather than argued
-- ---------------------------------------------------------------------------
--
-- On a schema at `202609240025`, a DVD audit row written by the real command,
-- then repointed at an SZS member while leaving `organization_id` alone:
--
--   UPDATE of entity_id                  ACCEPTED
--   audit.organization_id                DVD
--   entity it now points at              SZS / 'Tajni Clan SZS'
--   mismatched                           true
--
-- `refuse_organization_change` watches `organization_id` and nothing else, so
-- nothing fired. The row still reads as DVD's - a DVD administrator can see it -
-- while `entity_id` resolves into SZS. Anything that joins an audit row to the
-- member it is about would carry SZS data out through a DVD-labelled row.
--
-- No client can do this: `authenticated` holds SELECT on this table and nothing
-- else, and none of the twelve writers ever updates it. It is open at the
-- DATABASE level, which is where every other invariant in this schema is
-- settled, and any later phase that adds an update path would inherit it
-- silently.
--
-- ---------------------------------------------------------------------------
-- Why append-only rather than two more immutable columns
-- ---------------------------------------------------------------------------
--
-- Freezing `entity_kind` and `entity_id` would close exactly this hole and
-- leave its neighbours: `detail` still rewritable, so the recorded name could
-- be changed after the fact; `changed_by` still rewritable, so a change could
-- be attributed to somebody who did not make it. Those are worse than a
-- mislabelled service, and they are the same mistake - guarding the columns
-- somebody happened to think of.
--
-- The table has said what it is since it was created: "Append-only record of
-- every change to the society's registry". It was append-only by PRIVILEGE -
-- `authenticated` cannot write it - and never by rule. This makes the rule the
-- database's, which is what the comment always claimed.
--
-- ---------------------------------------------------------------------------
-- Ordering and replay
-- ---------------------------------------------------------------------------
--
-- `202609240025`'s backfill is an UPDATE of this table, and it runs in the
-- migration before this one, so it is already finished when the guard appears.
-- On replay its `where organization_id is null` matches nothing, no UPDATE is
-- executed, and no row trigger fires - so replaying either file in either order
-- stays a no-op. A later migration that genuinely has to rewrite history must
-- drop this trigger deliberately and put it back, which is the point.
--
-- TRUNCATE is unaffected: it fires statement-level TRUNCATE triggers only, and
-- this is a row trigger. The test harness rebuilds by dropping the schema.
-- ===========================================================================

create or replace function public.refuse_registry_audit_change()
returns trigger
language plpgsql
as $$
begin
  -- Deliberately no detail about which column was touched. There is no
  -- legitimate caller to help here: every writer inserts and nothing updates.
  raise exception 'AUDIT_APPEND_ONLY';
end;
$$;

comment on function public.refuse_registry_audit_change() is
  'An entry in the registry audit is evidence. It is written once and never '
  'changed or removed - including its entity_kind and entity_id, which decide '
  'which service the row belongs to.';

-- PostgreSQL's default PUBLIC grant would otherwise make this callable over
-- /rest/v1/rpc. A trigger function needs no grant to fire.
revoke all on function public.refuse_registry_audit_change() from public, anon, authenticated;

-- Superseded: this watched `organization_id` alone, which is the gap above.
drop trigger if exists refuse_organization_change on public.registry_audit;

drop trigger if exists refuse_change on public.registry_audit;
create trigger refuse_change
  before update or delete on public.registry_audit
  for each row execute function public.refuse_registry_audit_change();

comment on table public.registry_audit is
  'Append-only record of every change to the society''s registry: members, groups and vehicles. Named for the Evidencija screen it serves. Append-only is enforced by refuse_registry_audit_change(), not only by privilege. Not to be confused with organization_memberships, which is about which SERVICE somebody belongs to.';
