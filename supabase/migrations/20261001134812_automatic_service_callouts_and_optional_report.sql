-- Let an authorised commander alert every eligible member of the publishing
-- service at the moment of publication (NULL member array). An empty array
-- still means no own-service recipients, allowing an other-service-only call.
-- Explicit member arrays remain compatible with older clients and are still
-- validated against the commander's publishing service.
--
-- A completed intervention needs no invented reason for its normal closure.
-- The optional close_reason column holds a short report when supplied. A
-- cancellation still requires a reason. Existing history remains intact.

alter table public.interventions drop constraint intervention_close_reason;

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

  has_own := recipient_member_ids is null or array_length(recipient_member_ids, 1) is not null;
  has_other := array_length(clean_org_ids, 1) is not null;
  if not has_own and not has_other then raise exception 'NO_RECIPIENTS'; end if;

  -- A hand-picked own-service selection must all serve the publishing service
  -- and be eligible; a commander who chose five and got four must be told. The
  -- NULL means every eligible member of the publishing service at publication.
  -- Additional services are resolved wholesale below, where an ineligible member
  -- is simply not included rather than failing the whole call-out.
  if has_own and recipient_member_ids is not null then
    if exists (
      select 1 from unnest(recipient_member_ids) as requested_id
      join public.members candidate on candidate.id = requested_id
      where candidate.organization_id is distinct from publisher_org
    ) then raise exception 'ORGANIZATION_MISMATCH'; end if;

    select count(*) into ineligible_count
    from unnest(recipient_member_ids) as requested(member_id)
    where not public.recipient_is_eligible_in(requested.member_id, publisher_org);
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
          (has_own and ((recipient_member_ids is null
            and m.organization_id = publisher_org
            and public.recipient_is_eligible_in(m.id, publisher_org))
          or m.id = any(recipient_member_ids)))
          or (m.organization_id = any(clean_org_ids)
              and public.recipient_is_eligible_in(m.id, m.organization_id))
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
  'Publish a call-out to all eligible own-service members when the member array is NULL, '
  'to an explicit own-service selection when provided, and to all eligible members of '
  'each additional service. One notification per person (D16). Publisher service is '
  'interventions.organization_id.';

revoke all on function public.publish_intervention(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.publish_intervention(uuid, uuid[], uuid[]) to authenticated;

create or replace function public.close_intervention(
  target_intervention uuid,
  requested_status text,
  requested_reason text,
  allow_open_attendance boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row record;
  open_count integer;
  normalized_reason text := trim(coalesce(requested_reason, ''));
begin
  if not public.is_command_anywhere() then raise exception 'COMMAND_REQUIRED'; end if;
  if requested_status not in ('CLOSED', 'CANCELLED') then raise exception 'STATUS_NOT_SETTABLE'; end if;
  if char_length(normalized_reason) > 500 then raise exception 'REPORT_TOO_LONG'; end if;
  if requested_status = 'CANCELLED' and char_length(normalized_reason) < 2 then
    raise exception 'REASON_REQUIRED';
  end if;

  select status, organization_id into current_row
  from public.interventions where id = target_intervention for update;
  if not found then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if not public.is_command_in(current_row.organization_id) then
    raise exception 'ORGANIZATION_MISMATCH';
  end if;
  if current_row.status in ('CLOSED', 'CANCELLED') then raise exception 'INTERVENTION_NOT_OPEN'; end if;

  select count(*) into open_count
  from public.attendance_intervals
  where intervention_id = target_intervention and ended_at is null;

  -- The caller must acknowledge open intervals explicitly. They are left open,
  -- and stay visible as open, rather than being closed with a made-up time.
  if open_count > 0 and not allow_open_attendance then
    raise exception 'OPEN_ATTENDANCE_INTERVALS:%', open_count;
  end if;

  update public.interventions
  set status = requested_status,
      closed_at = now(),
      closed_by = auth.uid(),
      close_reason = nullif(normalized_reason, ''),
      updated_at = now(),
      version = version + 1
  where id = target_intervention;

  insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
  values (target_intervention,
          case when requested_status = 'CLOSED' then 'INTERVENTION_CLOSED' else 'INTERVENTION_CANCELLED' end,
          jsonb_build_object('reason', normalized_reason, 'open_attendance', open_count),
          auth.uid());
end;
$$;
