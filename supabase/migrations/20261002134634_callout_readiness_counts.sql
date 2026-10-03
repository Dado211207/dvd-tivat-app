-- A commander-only aggregate of the people a call-out would address NOW.
-- publish_intervention remains the authority and resolves recipients again
-- under its own lock at publication; this is only a momentary preflight.
-- Do not return another service's roster or any push endpoint/key.

create function public.callout_readiness(
  publisher_organization uuid,
  include_own boolean,
  recipient_organization_ids uuid[] default '{}'
)
returns table(eligible_count integer, push_ready_count integer, checked_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  clean_org_ids uuid[];
begin
  if auth.uid() is null or not public.is_command_in(publisher_organization) then
    raise exception 'COMMAND_REQUIRED';
  end if;

  select coalesce(array_agg(distinct oid), '{}') into clean_org_ids
  from unnest(coalesce(recipient_organization_ids, '{}')) as oid
  where oid <> publisher_organization;

  if exists (
    select 1 from unnest(clean_org_ids) as oid
    where not exists (
      select 1 from public.organizations org where org.id = oid and org.active
    )
  ) then
    raise exception 'RECIPIENT_ORGANIZATION_NOT_FOUND';
  end if;

  if not coalesce(include_own, false) and cardinality(clean_org_ids) = 0 then
    raise exception 'NO_RECIPIENTS';
  end if;

  return query
  with candidates as (
    select distinct member.user_id
    from public.members member
    where member.active and member.user_id is not null
      and (
        (coalesce(include_own, false)
          and member.organization_id = publisher_organization
          and public.recipient_is_eligible_in(member.id, publisher_organization))
        or (member.organization_id = any(clean_org_ids)
          and public.recipient_is_eligible_in(member.id, member.organization_id))
      )
  )
  select count(*)::integer,
    count(*) filter (where exists (
      select 1 from public.web_push_subscriptions subscription
      where subscription.user_id = candidates.user_id
        and subscription.revoked_at is null
        and (subscription.expiration_time is null or subscription.expiration_time > now())
    ))::integer,
    now()
  from candidates;
end;
$$;

comment on function public.callout_readiness(uuid, boolean, uuid[]) is
  'Current unique eligible accounts and accounts with an active push subscription '
  'for the selected call-out services. Command of the publisher is required; '
  'publication resolves the audience again. Provider acceptance is not delivery.';

revoke all on function public.callout_readiness(uuid, boolean, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.callout_readiness(uuid, boolean, uuid[])
  to authenticated;
