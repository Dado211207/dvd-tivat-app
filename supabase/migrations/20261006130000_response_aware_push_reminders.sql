-- A call-out opening is a read receipt, not an answer. Suppress the
-- single scheduled reminder only after the recipient submits a response.
--
-- Keep the legacy MEMBER_OPENED close reason accepted for existing rows, while
-- new closures record MEMBER_RESPONDED.
alter table public.notification_outbox
  drop constraint notification_outbox_delivery_close_reason_check;
alter table public.notification_outbox
  add constraint notification_outbox_delivery_close_reason_check
  check (
    delivery_close_reason is null
    or delivery_close_reason = any (
      array[
        'MEMBER_OPENED',
        'MEMBER_RESPONDED',
        'SERVICE_MISMATCH',
        'NOT_A_RECIPIENT',
        'CALLOUT_NOT_OPEN'
      ]::text[]
    )
  );

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
          select 1 from public.intervention_responses response
          where response.intervention_id = queued.intervention_id
            and response.member_id = queued.member_id
        ) then 'RESPONDED'
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

comment on function public.push_delivery_verdict(uuid) is
  'Decides whether a queued push may be delivered; opening alone does not suppress a reminder, but an intervention response does.';
