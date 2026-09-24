-- ===========================================================================
-- 202609240025 - the registry's audit trail belongs to a service too
--
-- Still P4a. `202609240024` isolated the six registry tables and gave SZS its
-- own writers; this closes the hole that opened the moment those writers
-- existed.
--
-- ---------------------------------------------------------------------------
-- The hole, measured rather than argued
-- ---------------------------------------------------------------------------
--
-- `registry_audit` records every registry change, and `detail` carries the
-- member's name. Its only policy was:
--
--   registry_audit_admin_read   using (is_dvd_admin())
--
-- No `organization_id`, no filter, one question: "are you a DVD administrator".
-- With SZS writers in place that reads, on a schema at `202609240024`:
--
--   SZS ADMIN creates a member       -> 'Tajni Clan SZS'
--   DVD ADMIN reads registry_audit   -> {"entity_kind":"MEMBER",
--                                        "event_type":"MEMBER_CREATED",
--                                        "name":"Tajni Clan SZS"}
--   SZS ADMIN reads registry_audit   -> 0 rows
--
-- Both halves are wrong and they are the same bug. The six tables were
-- isolated; their history was not, so the names went out the side door. And the
-- administrator who wrote the row could not read it back, which makes the trail
-- useless to the only service it belongs to.
--
-- This is why it lands in P4a rather than P4f, where `registry_audit` was
-- listed: P4f is where the table would have been reached in the original
-- sequence, but P4a is what makes it leak. A boundary is closed by the phase
-- that opens it.
--
-- ---------------------------------------------------------------------------
-- Where the service comes from
-- ---------------------------------------------------------------------------
--
-- From the entity the row is ABOUT, never from whoever is writing it. The
-- writers are `security definer` and RLS does not apply to them, so a column
-- they filled in themselves would be a claim, not a fact. `entity_kind` is
-- already constrained to MEMBER, GROUP or VEHICLE, and each of those tables
-- carries `organization_id` since P2 - so the trigger below can always look it
-- up, and refuses rather than guessing when it cannot.
--
-- Existing rows are attributed the same way, by looking at the entity. Every
-- one of them predates the SZS writers this phase introduces, so any row whose
-- entity has since gone is DVD's by construction; that is the only place a
-- constant appears, and it is the correct one rather than a convenient one.
-- No row is removed and no existing column changes type, nullability or value.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The column, and who each existing row belongs to
-- ---------------------------------------------------------------------------

alter table public.registry_audit
  add column if not exists organization_id uuid;

update public.registry_audit audit
   set organization_id = coalesce(
     case audit.entity_kind
       when 'MEMBER'  then (select organization_id from public.members  where id = audit.entity_id)
       when 'GROUP'   then (select organization_id from public.groups   where id = audit.entity_id)
       when 'VEHICLE' then (select organization_id from public.vehicles where id = audit.entity_id)
     end,
     -- An entity that no longer exists. Every row here predates the SZS
     -- writers, so DVD is what it was, not a fallback chosen for tidiness.
     '00000000-0000-4000-8000-000000000001'::uuid)
 where audit.organization_id is null;

alter table public.registry_audit
  alter column organization_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'registry_audit_organization_id_fkey'
  ) then
    alter table public.registry_audit
      add constraint registry_audit_organization_id_fkey
      foreign key (organization_id) references public.organizations(id);
  end if;
end $$;

-- The policy below filters on this column on every read, and the table only
-- ever grows. The existing index is on (entity_kind, entity_id, changed_at) and
-- does not answer that question.
create index if not exists registry_audit_organization_idx
  on public.registry_audit (organization_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- 2. Every future row, attributed from the entity
-- ---------------------------------------------------------------------------

create or replace function public.enforce_registry_audit_organization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  derived uuid;
begin
  select case new.entity_kind
    when 'MEMBER'  then (select organization_id from public.members  where id = new.entity_id)
    when 'GROUP'   then (select organization_id from public.groups   where id = new.entity_id)
    when 'VEHICLE' then (select organization_id from public.vehicles where id = new.entity_id)
  end into derived;

  -- Refuse rather than guess. Every writer inserts its audit row while the
  -- entity exists, so this cannot fire from the commands; if it ever does, a
  -- missing trail is a smaller problem than one filed under the wrong service.
  if derived is null then
    raise exception 'ORGANIZATION_UNKNOWN';
  end if;

  if new.organization_id is null then
    new.organization_id := derived;
  elsif new.organization_id is distinct from derived then
    -- A caller naming a service the entity does not belong to is stating
    -- something false about a record that is meant to be evidence.
    raise exception 'ORGANIZATION_MISMATCH';
  end if;

  return new;
end;
$$;

comment on function public.enforce_registry_audit_organization() is
  'Attributes an audit row to the service of the member, group or vehicle it is '
  'about. The writers are security definer, so a service they supplied would be '
  'a claim rather than a fact.';

-- A trigger function needs no EXECUTE grant to fire - the trigger machinery
-- calls it as the table's owner. What it would otherwise keep is PostgreSQL's
-- default PUBLIC grant, which a Supabase project turns into a callable
-- /rest/v1/rpc endpoint. Same revoke the five trigger functions 202609240022
-- added carry, and the reason `access.test.ts` asserts the end state.
revoke all on function public.enforce_registry_audit_organization()
  from public, anon, authenticated;

drop trigger if exists enforce_organization on public.registry_audit;
create trigger enforce_organization
  before insert on public.registry_audit
  for each row execute function public.enforce_registry_audit_organization();

-- An audit row is evidence: which service it belongs to is settled when it is
-- written. The same guard the four owning tables carry since P2.
drop trigger if exists refuse_organization_change on public.registry_audit;
create trigger refuse_organization_change
  before update on public.registry_audit
  for each row when (old.organization_id is distinct from new.organization_id)
  execute function public.refuse_organization_change();

-- ---------------------------------------------------------------------------
-- 3. The read
-- ---------------------------------------------------------------------------
--
-- Same policy, same name, same command. `is_admin_in` answers true in every
-- service for the installation owner, so the owner keeps the whole trail while
-- each administrator sees only their own service's.

alter policy registry_audit_admin_read on public.registry_audit
  using (public.is_admin_in(organization_id));

comment on column public.registry_audit.organization_id is
  'The service of the member, group or vehicle this row is about. Derived by '
  'enforce_registry_audit_organization(), never supplied by the writer.';
