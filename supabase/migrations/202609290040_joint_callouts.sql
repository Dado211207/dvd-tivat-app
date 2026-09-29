-- 202609290040_joint_callouts.sql
--
-- P7 / joint cross-service call-outs — recipient resolution (D18, D19, D16, §6.1,
-- §6.2). This is the first P7 slice: a call-out published by one service may also
-- target other services, and every eligible member of a targeted service is paged.
-- Command (D20), the recipient-service response/attendance flows, and the scoped
-- archive (D21) follow in later migrations.
--
-- Additive and a no-op for everything that exists today: with no recipient
-- organisations `publish_intervention` behaves exactly as before, and re-deriving
-- a recipient row's service from its member changes no existing row, because a
-- member's service equals its call-out's service until a joint call-out exists
-- (proven by the production-derived equivalence gate, which must pass through this
-- migration before release).

-- ===========================================================================
-- 1. The services a call-out targets beyond its own (§6.1)
-- ===========================================================================

create table public.intervention_recipient_organizations (
  intervention_id uuid not null references public.interventions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  added_by_user_id uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (intervention_id, organization_id)
);

comment on table public.intervention_recipient_organizations is
  'P7: the additional services a call-out targets, beyond its own publishing '
  'service (interventions.organization_id, which is never listed here). Written '
  'only by publish_intervention (a security-definer function); no client role may '
  'write it directly. D18 symmetric, D19 whole-service.';

alter table public.intervention_recipient_organizations enable row level security;

-- Command staff of the publishing service, and command staff of a targeted
-- service, may see that a service was targeted. This is the signal the client
-- uses to label a joint call-out and to surface it in the targeted service's
-- archive (D21). It reveals only which services were included, never any roster.
create policy recipient_orgs_command_read
  on public.intervention_recipient_organizations for select
  using (
    public.is_command_in(organization_id)
    or exists (
      select 1 from public.interventions i
      where i.id = intervention_id and public.is_command_in(i.organization_id)
    )
  );

-- A person actually paged for a non-draft call-out may see which services it
-- went to, so a dual-service member understands a joint mobilisation.
create policy recipient_orgs_recipient_read
  on public.intervention_recipient_organizations for select
  using (public.is_recipient_of(intervention_id));

revoke all on public.intervention_recipient_organizations from public, anon, authenticated, service_role;
grant select on public.intervention_recipient_organizations to authenticated;
-- No insert/update/delete grant to any client role: the only writer is
-- publish_intervention, which runs as the table owner and so bypasses this.

-- ===========================================================================
-- 2. Deduplicate the outbox by the human, not the member record (D16, §6.2)
-- ===========================================================================
--
-- A person who serves in both the publishing service and a targeted service has
-- two member records; without this they would be paged twice for one incident.
-- publish_intervention already keeps a single recipient row per person (below),
-- so this column and index are the enforcement point: a resolver bug cannot page
-- one human twice.

alter table public.notification_outbox
  add column user_id uuid references auth.users(id);

update public.notification_outbox o
   set user_id = m.user_id
  from public.members m
 where m.id = o.member_id
   and o.user_id is null;

alter table public.notification_outbox
  alter column user_id set not null;

-- At most one live outbox row per (call-out, person, channel). A closed delivery
-- (delivery_closed_at set, e.g. MEMBER_OPENED) does not block a later re-queue,
-- matching the existing per-member delivery lifecycle.
create unique index notification_outbox_person_channel_idx
  on public.notification_outbox (intervention_id, user_id, channel)
  where delivery_closed_at is null;

-- ===========================================================================
-- 3. A recipient row is scoped to the MEMBER'S service, not the call-out's
-- ===========================================================================
--
-- `intervention_recipients.organization_id` is denormalised so P4's policies can
-- scope reads without a join. Until now it was derived from the parent
-- INTERVENTION and equalled the member's service trivially (a call-out only ever
-- reached its own service). On a joint call-out the two diverge: a DVD member
-- paged by an SZS call-out must appear as a DVD participant — so a DVD commander
-- sees them and (D20) confirms their attendance, and a DVD-only member can read
-- their own recipient row (`recipients_self_read` asks current_member_id_in of
-- the ROW's service). So re-derive the recipient row's service from its member.
--
-- This is a no-op for every existing row (member service = call-out service
-- today). attendance_intervals is untouched: it already carries both
-- organization_id (the call-out's) and credited_organization_id (the member's,
-- migration 039) per §6.3.

drop trigger enforce_organization on public.intervention_recipients;
create trigger enforce_organization before insert or update on public.intervention_recipients
  for each row execute function public.enforce_organization_from_parent('members', 'member_id', 'id');

-- ===========================================================================
-- 4. publish_intervention resolves additional recipient services
-- ===========================================================================
--
-- The 2-argument form is replaced by a 3-argument one whose new parameter
-- defaults to the empty set, so existing single-service calls are unchanged. The
-- resolved recipients are the union of the commander's own hand-picked selection
-- (their own service, still strictly validated) and every eligible member of each
-- additional service (D19). One row per human (D16, §6.2), preferring the
-- publishing-service member record so a dual-service person answers and is
-- credited (D15) there.

drop function if exists public.publish_intervention(uuid, uuid[]);

create or replace function public.publish_intervention(
  target_intervention uuid,
  recipient_member_ids uuid[],
  recipient_organization_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row record;
  person record;
  publisher_org uuid;
  frozen_count integer := 0;
  ineligible_count integer := 0;
  clean_org_ids uuid[];
  has_own boolean;
  has_other boolean;
begin
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;

  select status, organization_id into current_row
  from public.interventions where id = target_intervention for update;
  if not found then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  publisher_org := current_row.organization_id;
  if not public.is_command_in(publisher_org) then raise exception 'ORGANIZATION_MISMATCH'; end if;

  -- Already published: a retry, not a second call-out.
  if current_row.status <> 'DRAFT' then
    if current_row.status in ('CLOSED', 'CANCELLED') then raise exception 'INTERVENTION_NOT_OPEN'; end if;
    return target_intervention;
  end if;

  -- Normalise the additional services: distinct, real, active, and never the
  -- publisher itself (that is the own-selection path). D18 lets a commander of
  -- the publishing service add any OTHER service; there is no per-target gate.
  select coalesce(array_agg(distinct oid), '{}')
    into clean_org_ids
  from unnest(coalesce(recipient_organization_ids, '{}')) as oid
  where oid <> publisher_org;

  if exists (
    select 1 from unnest(clean_org_ids) as oid
    where not exists (select 1 from public.organizations o where o.id = oid and o.active)
  ) then raise exception 'RECIPIENT_ORGANIZATION_NOT_FOUND'; end if;

  has_own := recipient_member_ids is not null and array_length(recipient_member_ids, 1) is not null;
  has_other := array_length(clean_org_ids, 1) is not null;
  if not has_own and not has_other then raise exception 'NO_RECIPIENTS'; end if;

  -- The hand-picked own-service selection must all serve the publishing service
  -- and be eligible; a commander who chose five and got four must be told. The
  -- additional services are resolved wholesale below, where an ineligible member
  -- is simply not included rather than failing the whole call-out.
  if has_own then
    if exists (
      select 1 from unnest(recipient_member_ids) as requested_id
      join public.members candidate on candidate.id = requested_id
      where candidate.organization_id is distinct from publisher_org
    ) then raise exception 'ORGANIZATION_MISMATCH'; end if;

    select count(*) into ineligible_count
    from unnest(recipient_member_ids) as requested(member_id)
    where not public.is_eligible_recipient_in(requested.member_id, publisher_org);
    if ineligible_count > 0 then raise exception 'RECIPIENT_NOT_ELIGIBLE'; end if;
  end if;

  -- Record the additional services, for the client's joint label and the archive.
  insert into public.intervention_recipient_organizations(intervention_id, organization_id, added_by_user_id)
  select target_intervention, oid, auth.uid()
  from unnest(clean_org_ids) as oid
  on conflict do nothing;

  -- One row per HUMAN. A person who serves in both the publishing service and a
  -- targeted service appears once, under their publishing-service member record
  -- (§6.2), so their response and attendance credit sit with that service (D15).
  for person in
    with candidates as (
      select m.id as member_id, m.user_id, m.organization_id, m.full_name
      from public.members m
      where m.active
        and m.user_id is not null
        and (
          (has_own and m.id = any(recipient_member_ids))
          or (m.organization_id = any(clean_org_ids)
              and public.is_eligible_recipient_in(m.id, m.organization_id))
        )
    ),
    ranked as (
      select member_id, user_id, organization_id, full_name,
             row_number() over (
               partition by user_id
               order by (organization_id = publisher_org) desc, organization_id
             ) as rn
      from candidates
    )
    select member_id, user_id, organization_id, full_name from ranked where rn = 1
  loop
    insert into public.intervention_recipients(
      intervention_id, member_id, recipient_version, member_name_at_publication)
    values (target_intervention, person.member_id, 1, person.full_name)
    on conflict do nothing;

    -- dedupe_key stays member-based; because there is one member per person here
    -- it is already one row per person, and the partial unique index on
    -- (intervention, user_id, channel) is the belt-and-braces behind it.
    insert into public.notification_outbox(
      intervention_id, member_id, user_id, channel, state, dedupe_key)
    values (
      target_intervention, person.member_id, person.user_id, 'IN_APP', 'QUEUED',
      target_intervention::text || ':' || person.member_id::text || ':IN_APP:1')
    on conflict do nothing;

    if exists (
      select 1 from public.web_push_subscriptions subscription
      where subscription.user_id = person.user_id
        and subscription.revoked_at is null
        and (subscription.expiration_time is null or subscription.expiration_time > now())
    ) then
      insert into public.notification_outbox(
        intervention_id, member_id, user_id, channel, state, dedupe_key)
      values (
        target_intervention, person.member_id, person.user_id, 'WEB_PUSH', 'QUEUED',
        target_intervention::text || ':' || person.member_id::text || ':WEB_PUSH:1')
      on conflict do nothing;
    end if;

    frozen_count := frozen_count + 1;
  end loop;

  if frozen_count = 0 then raise exception 'NO_ACTIVE_RECIPIENTS'; end if;

  update public.interventions
  set status = 'PUBLISHED',
      published_at = coalesce(published_at, now()),
      published_by = coalesce(published_by, auth.uid()),
      version = version + 1,
      updated_at = now()
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (
    target_intervention,
    'INTERVENTION_PUBLISHED',
    jsonb_build_object(
      'recipient_count', frozen_count,
      'recipient_organizations', to_jsonb(clean_org_ids)),
    auth.uid());

  return target_intervention;
end;
$$;

comment on function public.publish_intervention(uuid, uuid[], uuid[]) is
  'Publish a call-out to the commander''s own hand-picked recipients and, for a '
  'joint call-out (P7, D18/D19), to every eligible member of each additional '
  'service. One notification per person (D16). The publishing service is always '
  'interventions.organization_id.';

revoke all on function public.publish_intervention(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.publish_intervention(uuid, uuid[], uuid[]) to authenticated;
