-- ===========================================================================
-- 202609250033 - audit history is written once, by the commands that write it
--
-- P4f of docs/MULTI_ORG_PLAN.md: role_audit, account_status_audit,
-- organization_membership_audit, organization_memberships, organizations,
-- access_grants, profiles, citizen_reports, report_media, report_status_audit -
-- and operational_audit, the one audit table whose rows may have no parent.
--
-- ---------------------------------------------------------------------------
-- What the catalogue at 202609250032 showed
-- ---------------------------------------------------------------------------
--
-- READS need nothing. Every account-table policy that is not "your own row"
-- asks `is_dvd_owner()` or `current_dvd_role() = 'OWNER'`, and both ARE the
-- installation owner: `current_role_in()` answers OWNER for the owner in every
-- service and for nobody else. An ADMIN of either service reads their own grant,
-- profile and memberships, and nothing else - today and after (D9: the ADMIN's
-- powers are the registry's, scoped by P4a). db-tests/audit_history.test.ts
-- asserts the equivalence in every account state and that every account reads
-- exactly what it read before.
--
-- CITIZEN REPORTS are left alone. `citizen_reports`, `report_media`,
-- `report_status_audit` and `review_report()` answer DVD staff and DVD command.
-- The rows carry no service, and which service reviews a citizen report - if
-- any - is an open owner decision (docs/PRODUCTION_ARCHITECTURE.md, "whether
-- citizen reports are wanted at all, and who reviews them"). Scoping them would
-- be answering it.
--
-- HISTORY was append-only by privilege only. Measured:
--
--   1. As the session the Supabase dashboard runs as, any row of the four
--      account/report audits and of operational_audit could be rewritten -
--      who changed a role, why an account was suspended, which call-out an
--      event was about - or deleted.
--   2. The service role, which holds every privilege on most of them, could do
--      the same without any superuser, and could write a row with no call-out
--      claiming either service: the gap organisation_columns.test.ts pinned for
--      P4 to close ("who may write an audit row at all").
--   3. TRUNCATE fires no row trigger, so the append-only rules of P4a
--      (registry_audit) and P4d (attendance_corrections) never covered it - as
--      202609240026 said in so many words - and the service role holds it.
--   4. A parentless operational_audit row could be hung on a call-out, and any
--      row moved to another call-out with a matching label.
--
-- ---------------------------------------------------------------------------
-- The change
-- ---------------------------------------------------------------------------
--
-- 1. role_audit, account_status_audit, organization_membership_audit and
--    report_status_audit refuse UPDATE and DELETE (AUDIT_APPEND_ONLY), as
--    registry_audit has since 202609240026. Their foreign keys all RESTRICT,
--    so no referential action ever needs to touch them.
--
-- 2. operational_audit refuses UPDATE and DELETE too, with the one exception
--    its own foreign keys require: when a call-out or an account is deleted,
--    ON DELETE SET NULL clears the link. That arrives nested inside the
--    referential trigger - never as a statement - and changes columns to NULL
--    and nothing else; only that is let through. The row keeps its service,
--    its wording, its time. Clearing a link by hand is refused.
--
-- 3. None of those, nor registry_audit or attendance_corrections, can be
--    truncated (a statement trigger; AUDIT_APPEND_ONLY).
--
-- 4. The service role keeps SELECT on all of them and loses every write.
--    Nothing it runs writes history: the push worker writes its outbox and its
--    delivery attempts, neither of them here. Audit rows are written by the
--    `security definer` commands, owned by postgres - unchanged. This is the
--    same step 202609220017 took for role_audit and
--    organization_membership_audit, which left them TRUNCATE.
--
-- As 202609220017 says of itself: none of this binds the superuser, which can
-- disable a trigger. It turns a quiet rewrite of history into a deliberate act.
--
-- ---------------------------------------------------------------------------
-- Replay
-- ---------------------------------------------------------------------------
--
-- 202609240022's backfill UPDATEs operational_audit and attendance_corrections
-- unconditionally; it runs long before these rules exist and is never re-run.
-- A later migration that genuinely must rewrite history drops the trigger and
-- puts it back, which is the point.
-- ===========================================================================

create or replace function public.refuse_audit_change()
returns trigger
language plpgsql
as $$
begin
  -- `set-null`: a row whose foreign keys clear themselves when what they point
  -- at is deleted. The referential action runs nested inside its own trigger,
  -- so it is recognised by depth and by what it changes: only NULLs.
  if tg_op = 'UPDATE' and tg_argv[0] = 'set-null' and pg_trigger_depth() > 1
     and not exists (
       select 1 from jsonb_each(to_jsonb(new)) as changed
       where changed.value is distinct from to_jsonb(old) -> changed.key
         and changed.value <> 'null'::jsonb
     ) then
    return new;
  end if;
  -- No detail about which column: nothing legitimate updates or deletes here.
  raise exception 'AUDIT_APPEND_ONLY';
end;
$$;

comment on function public.refuse_audit_change() is
  'An audit row is evidence: written once, never changed or removed. With the '
  'argument set-null, the table''s own ON DELETE SET NULL may still clear a link '
  'to a row that was deleted - and nothing else.';

create or replace function public.refuse_audit_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'AUDIT_APPEND_ONLY';
end;
$$;

comment on function public.refuse_audit_truncate() is
  'TRUNCATE fires no row trigger, so an append-only rule that stops at UPDATE '
  'and DELETE does not stop it. This does.';

revoke all on function public.refuse_audit_change() from public, anon, authenticated;
revoke all on function public.refuse_audit_truncate() from public, anon, authenticated;

-- 1. The account and report audits.
drop trigger if exists refuse_change on public.role_audit;
create trigger refuse_change
  before update or delete on public.role_audit
  for each row execute function public.refuse_audit_change();

drop trigger if exists refuse_change on public.account_status_audit;
create trigger refuse_change
  before update or delete on public.account_status_audit
  for each row execute function public.refuse_audit_change();

drop trigger if exists refuse_change on public.organization_membership_audit;
create trigger refuse_change
  before update or delete on public.organization_membership_audit
  for each row execute function public.refuse_audit_change();

drop trigger if exists refuse_change on public.report_status_audit;
create trigger refuse_change
  before update or delete on public.report_status_audit
  for each row execute function public.refuse_audit_change();

-- 2. The call-out audit, whose links clear when what they name is deleted.
drop trigger if exists refuse_change on public.operational_audit;
create trigger refuse_change
  before update or delete on public.operational_audit
  for each row execute function public.refuse_audit_change('set-null');

-- 3. No history table may be truncated.
drop trigger if exists refuse_truncate on public.role_audit;
create trigger refuse_truncate before truncate on public.role_audit
  for each statement execute function public.refuse_audit_truncate();
drop trigger if exists refuse_truncate on public.account_status_audit;
create trigger refuse_truncate before truncate on public.account_status_audit
  for each statement execute function public.refuse_audit_truncate();
drop trigger if exists refuse_truncate on public.organization_membership_audit;
create trigger refuse_truncate before truncate on public.organization_membership_audit
  for each statement execute function public.refuse_audit_truncate();
drop trigger if exists refuse_truncate on public.report_status_audit;
create trigger refuse_truncate before truncate on public.report_status_audit
  for each statement execute function public.refuse_audit_truncate();
drop trigger if exists refuse_truncate on public.operational_audit;
create trigger refuse_truncate before truncate on public.operational_audit
  for each statement execute function public.refuse_audit_truncate();
drop trigger if exists refuse_truncate on public.registry_audit;
create trigger refuse_truncate before truncate on public.registry_audit
  for each statement execute function public.refuse_audit_truncate();
drop trigger if exists refuse_truncate on public.attendance_corrections;
create trigger refuse_truncate before truncate on public.attendance_corrections
  for each statement execute function public.refuse_audit_truncate();

-- 4. History is written by the commands; the service role only reads it.
revoke insert, update, delete, truncate on public.role_audit from service_role;
revoke insert, update, delete, truncate on public.account_status_audit from service_role;
revoke insert, update, delete, truncate on public.organization_membership_audit from service_role;
revoke insert, update, delete, truncate on public.report_status_audit from service_role;
revoke insert, update, delete, truncate on public.operational_audit from service_role;
revoke insert, update, delete, truncate on public.registry_audit from service_role;
revoke insert, update, delete, truncate on public.attendance_corrections from service_role;

comment on table public.role_audit is
  'Every change of an account''s grant role, written by trigger. Append-only by '
  'rule (refuse_audit_change), not only by privilege.';
comment on table public.account_status_audit is
  'Every suspension and reinstatement, written by owner_set_account_active(). '
  'Append-only by rule (refuse_audit_change).';
comment on table public.organization_membership_audit is
  'Every change of a service membership, written by trigger. Append-only by rule '
  '(refuse_audit_change).';
comment on table public.report_status_audit is
  'Every citizen-report review, written by review_report(). Append-only by rule '
  '(refuse_audit_change).';
comment on table public.operational_audit is
  'Every event of a call-out, and of a vehicle out on none. Append-only by rule '
  '(refuse_audit_change): only a deleted call-out or account may clear the link '
  'that named it, through the foreign key.';
