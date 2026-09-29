-- P7: delivery and acknowledgement of a joint call-out. The outbox's service
-- label still belongs to the publishing call-out: push_delivery_queue and the
-- worker's wake scope depend on that invariant. The recipient's member service
-- is checked independently. A commander's read of delivery metadata follows
-- the MEMBER rather than the publisher, to preserve D21's scoped visibility.

create or replace function public.push_delivery_verdict(target_outbox uuid)
returns table (verdict text, user_id uuid, published_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  with queued as (
    select outbox_row.intervention_id,
           outbox_row.member_id,
           outbox_row.organization_id as service,
           callout.organization_id as callout_service,
           callout.status as callout_status,
           callout.published_at as callout_published_at,
           member_row.organization_id as member_service,
           member_row.user_id as account,
           member_row.active as member_active
      from public.notification_outbox outbox_row
      left join public.interventions callout on callout.id = outbox_row.intervention_id
      left join public.members member_row on member_row.id = outbox_row.member_id
     where outbox_row.id = target_outbox
       and outbox_row.channel = 'WEB_PUSH'
  ), judged as (
    select queued.*,
      case
        -- The outbox label must still match its publishing intervention. The
        -- member may belong to the publisher OR an explicitly targeted service.
        when queued.callout_service is null
          or queued.member_service is null
          or queued.callout_service is distinct from queued.service
          or (queued.member_service is distinct from queued.service
              and not exists (
                select 1 from public.intervention_recipient_organizations target
                where target.intervention_id = queued.intervention_id
                  and target.organization_id = queued.member_service
              ))
          then 'SERVICE_MISMATCH'
        -- A targeted service alone is insufficient: the exact member must have
        -- been frozen on the recipient list, in the MEMBER'S own service.
        when not exists (
          select 1 from public.intervention_recipients recipient
          where recipient.intervention_id = queued.intervention_id
            and recipient.member_id = queued.member_id
            and recipient.organization_id = queued.member_service
        ) then 'NOT_A_RECIPIENT'
        when exists (
          select 1 from public.intervention_acknowledgements acknowledgement
          where acknowledgement.intervention_id = queued.intervention_id
            and acknowledgement.member_id = queued.member_id
        ) then 'OPENED'
        when queued.callout_status is null
          or queued.callout_status not in ('PUBLISHED', 'ASSEMBLING', 'DEPLOYED', 'CONTAINED')
          then 'CALLOUT_NOT_OPEN'
        when queued.member_active = true
          and queued.account is not null
          and exists (
            select 1
            from public.profiles profile
            join public.access_grants grant_row on grant_row.user_id = profile.user_id
            where profile.user_id = queued.account
              and profile.profile_complete = true
              and grant_row.active = true
              and (
                grant_row.role = 'OWNER'
                or exists (
                  select 1
                  from public.organization_memberships membership
                  join public.organizations organization
                    on organization.id = membership.organization_id
                  where membership.user_id = queued.account
                    and membership.organization_id = queued.member_service
                    and membership.active = true
                    and organization.active = true
                    and membership.role in ('ADMIN', 'COMMANDER', 'FIREFIGHTER')
                )
              )
          ) then 'DELIVER'
        else 'INELIGIBLE'
      end as answer
    from queued
  )
  select judged.answer,
         case when judged.answer = 'DELIVER' then judged.account end,
         case when judged.answer = 'DELIVER' then judged.callout_published_at end
  from judged
$$;

-- A commander's view of delivery truth follows their members, including when
-- another service published the call-out. The worker's service-role read and
-- the outbox's publisher-service label remain unchanged.
alter policy outbox_command_read on public.notification_outbox
  using (exists (
    select 1 from public.members member
    where member.id = member_id and public.is_command_in(member.organization_id)
  ));
alter policy outbox_self_read on public.notification_outbox
  using (exists (
    select 1 from public.members member
    where member.id = member_id
      and member.id = public.current_member_id_in(member.organization_id)
  ));
alter policy delivery_attempts_command_read on public.notification_delivery_attempts
  using (exists (
    select 1 from public.notification_outbox outbox_row
    join public.members member on member.id = outbox_row.member_id
    where outbox_row.id = outbox_id
      and public.is_command_in(member.organization_id)
  ));

-- The acknowledgement is a participant fact. Its organisation is the member's
-- service; on existing single-service rows that is the call-out service too.
drop trigger enforce_organization on public.intervention_acknowledgements;
create trigger enforce_organization before insert or update on public.intervention_acknowledgements
  for each row execute function public.enforce_organization_from_parent('members', 'member_id', 'id');

create or replace function public.acknowledge_intervention(target_intervention uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  acting_member uuid;
  acting_service uuid;
  intervention_status text;
  intervention_organization uuid;
begin
  if not public.is_staff_anywhere() then raise exception 'STAFF_REQUIRED'; end if;

  select status, organization_id into intervention_status, intervention_organization
  from public.interventions where id = target_intervention;

  -- Use precisely the recipient row that was issued to this account. A DVD
  -- recipient on an SZS incident acts as the DVD member, never an SZS stand-in.
  select recipient.member_id, recipient.organization_id
    into acting_member, acting_service
  from public.intervention_recipients recipient
  where recipient.intervention_id = target_intervention
    and recipient.member_id = public.current_member_id_in(recipient.organization_id)
  order by (recipient.organization_id = intervention_organization) desc
  limit 1;

  if acting_member is null then
    -- Preserve the old refusal order for a non-recipient, including an unknown
    -- intervention: do not expose its existence to someone without standing.
    if intervention_organization is not null
       and not public.is_staff_in(intervention_organization) then
      raise exception 'STAFF_REQUIRED';
    end if;
    acting_service := coalesce(intervention_organization,
      '00000000-0000-4000-8000-000000000001'::uuid);
    acting_member := public.current_member_id_in(acting_service);
  end if;
  if acting_member is null then raise exception 'MEMBER_RECORD_REQUIRED'; end if;
  if not public.is_staff_in(acting_service) then raise exception 'STAFF_REQUIRED'; end if;
  if not public.is_recipient_of(target_intervention) then raise exception 'NOT_A_RECIPIENT'; end if;

  if intervention_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;
  if intervention_status = 'DRAFT' then raise exception 'INTERVENTION_NOT_PUBLISHED'; end if;

  insert into public.intervention_acknowledgements(intervention_id, member_id)
  values (target_intervention, acting_member)
  on conflict (intervention_id, member_id) do nothing;
end;
$$;
