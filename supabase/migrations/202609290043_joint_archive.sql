-- P7 / D21: the targeted service retains a scoped archive of a joint call-out.
-- Its commander may read the shared incident record and status changes. The
-- participant tables remain bounded by the participant's own service (041/042).
-- The targeted service receives no new write authority over the incident.

create or replace function public.is_joint_target_command(target_intervention uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.intervention_recipient_organizations target
    join public.interventions intervention on intervention.id = target.intervention_id
    where target.intervention_id = target_intervention
      and intervention.status <> 'DRAFT'
      and public.is_command_in(target.organization_id)
  )
$$;

comment on function public.is_joint_target_command(uuid) is
  'A commander in a service frozen on this published joint call-out may read '
  'shared incident facts. Participant rows remain scoped to their own service.';
revoke all on function public.is_joint_target_command(uuid) from public, anon;
grant execute on function public.is_joint_target_command(uuid) to authenticated;

-- The helper runs with the table owner's privileges. This avoids a policy on
-- interventions querying the targeted-services table whose own read policy
-- queries interventions (an RLS recursion).
create policy interventions_joint_target_command_read on public.interventions
  for select using (public.is_joint_target_command(id));

alter policy intervention_updates_read on public.intervention_updates
  using (
    public.is_command_in(organization_id)
    or public.is_recipient_of(intervention_id)
    or public.is_joint_target_command(intervention_id)
  );

-- This security-definer reader deliberately exposes only lifecycle events to
-- the OTHER service's commander. The publisher/own-recipient branches keep
-- their existing history, while actor names and raw member-linked detail never
-- cross the service boundary. Publication's recipient_count is not exposed.
-- A close/cancel event's open_attendance count covers all services, so the
-- targeted service receives the shared reason/status without that count.
create or replace function public.intervention_audit(target_intervention uuid)
returns table(event_id uuid, occurred_at timestamptz, event_type text, detail jsonb, actor_name text, actor_is_you boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    entry.id,
    entry.occurred_at,
    entry.event_type,
    case
      when public.is_joint_target_command(target_intervention)
        and not (
          public.is_command_in(entry.organization_id)
          or public.is_recipient_in(target_intervention, entry.organization_id)
        )
      then entry.detail - 'open_attendance'
      else entry.detail
    end,
    case when public.is_command_in(entry.organization_id)
                or public.is_recipient_in(target_intervention, entry.organization_id)
      then actor.full_name else null end,
    case when public.is_command_in(entry.organization_id)
                or public.is_recipient_in(target_intervention, entry.organization_id)
      then entry.actor_user_id = auth.uid() else false end
  from public.operational_audit entry
  left join public.profiles actor on actor.user_id = entry.actor_user_id
  where entry.intervention_id = target_intervention
    and (
      public.is_command_in(entry.organization_id)
      or public.is_recipient_in(target_intervention, entry.organization_id)
      or (public.is_joint_target_command(target_intervention)
          and entry.event_type in (
            'INTERVENTION_STATUS_CHANGED', 'INTERVENTION_CLOSED', 'INTERVENTION_CANCELLED'
          ))
    )
  order by entry.occurred_at, entry.id
$$;
