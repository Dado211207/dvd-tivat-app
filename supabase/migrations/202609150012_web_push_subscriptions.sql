-- DVD Tivat: device-bound Web Push subscriptions.
--
-- This migration only creates the protected subscription registry and queues a
-- WEB_PUSH delivery when a published recipient has at least one active device.
-- Sending is performed by the server-side Edge Function in
-- `supabase/functions/send-web-push`; no browser secret is introduced here.

create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (
    char_length(endpoint) between 20 and 2048 and endpoint ~ '^https://'),
  p256dh text not null check (
    char_length(p256dh) between 40 and 200 and p256dh ~ '^[A-Za-z0-9_-]+$'),
  auth_secret text not null check (
    char_length(auth_secret) between 8 and 100 and auth_secret ~ '^[A-Za-z0-9_-]+$'),
  expiration_time timestamptz,
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.notification_outbox
  add column delivery_closed_at timestamptz,
  add column delivery_close_reason text
    check (delivery_close_reason is null or delivery_close_reason in ('MEMBER_OPENED')),
  add constraint notification_outbox_delivery_close_pair check (
    (delivery_closed_at is null) = (delivery_close_reason is null));

create index web_push_subscriptions_active_user_idx
  on public.web_push_subscriptions(user_id)
  where revoked_at is null;

create index notification_outbox_web_push_delivery_idx
  on public.notification_outbox(state, updated_at, created_at)
  where channel = 'WEB_PUSH'
    and delivery_closed_at is null
    and state in ('QUEUED', 'SENT_TO_PROVIDER', 'PROVIDER_ACCEPTED', 'PROVIDER_REJECTED');

alter table public.web_push_subscriptions enable row level security;

-- A signed-in operational account may inspect only its own device list. All
-- writes go through the two functions below so a client cannot attach a device
-- to another account or reactivate a suspended account.
create policy web_push_subscriptions_self_read
  on public.web_push_subscriptions for select
  using (
    user_id = auth.uid()
    and public.current_dvd_role() in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'));

create or replace function public.register_web_push_subscription(
  requested_endpoint text,
  requested_p256dh text,
  requested_auth_secret text,
  requested_expiration_time timestamptz default null,
  requested_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_owner uuid;
  member_id uuid;
  subscription_id uuid;
begin
  if auth.uid() is null or public.current_dvd_role() is null then
    raise exception 'OPERATIONAL_ACCESS_REQUIRED';
  end if;
  member_id := public.current_member_id();
  if member_id is null or not public.is_eligible_recipient(member_id) then
    raise exception 'ELIGIBLE_MEMBER_REQUIRED';
  end if;
  if requested_endpoint is null
     or char_length(requested_endpoint) not between 20 and 2048
     or requested_endpoint !~ '^https://' then
    raise exception 'PUSH_ENDPOINT_INVALID';
  end if;
  if requested_p256dh is null
     or char_length(requested_p256dh) not between 40 and 200
     or requested_p256dh !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'PUSH_KEY_INVALID';
  end if;
  if requested_auth_secret is null
     or char_length(requested_auth_secret) not between 8 and 100
     or requested_auth_secret !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'PUSH_AUTH_INVALID';
  end if;
  if requested_user_agent is not null and char_length(requested_user_agent) > 300 then
    raise exception 'PUSH_USER_AGENT_INVALID';
  end if;

  select user_id into existing_owner
  from public.web_push_subscriptions
  where endpoint = requested_endpoint
  for update;

  if existing_owner is not null and existing_owner <> auth.uid() then
    raise exception 'PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT';
  end if;

  insert into public.web_push_subscriptions(
    user_id, endpoint, p256dh, auth_secret, expiration_time, user_agent)
  values (
    auth.uid(), requested_endpoint, requested_p256dh, requested_auth_secret,
    requested_expiration_time, nullif(requested_user_agent, ''))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        expiration_time = excluded.expiration_time,
        user_agent = excluded.user_agent,
        updated_at = now(),
        revoked_at = null
    where web_push_subscriptions.user_id = auth.uid()
  returning id into subscription_id;

  -- The preflight SELECT and INSERT can race when two accounts present the
  -- same endpoint at once. The conflict UPDATE above is owner-scoped, so the
  -- losing account changes nothing and reaches this explicit refusal.
  if subscription_id is null then
    raise exception 'PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT';
  end if;

  return subscription_id;
end;
$$;

create or replace function public.revoke_web_push_subscription(requested_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  update public.web_push_subscriptions
  set revoked_at = coalesce(revoked_at, now()), updated_at = now()
  where user_id = auth.uid() and endpoint = requested_endpoint and revoked_at is null;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

-- Preserve the exact public signature while extending the outbox fan-out.
create or replace function public.publish_intervention(
  target_intervention uuid,
  recipient_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
  member_row record;
  frozen_count integer := 0;
  ineligible_count integer := 0;
begin
  if not public.is_dvd_command() then raise exception 'COMMAND_REQUIRED'; end if;

  select status into current_status
  from public.interventions where id = target_intervention for update;
  if current_status is null then raise exception 'INTERVENTION_NOT_FOUND'; end if;

  -- Already published: this is a retry, not a second call-out.
  if current_status <> 'DRAFT' then
    if current_status in ('CLOSED', 'CANCELLED') then raise exception 'INTERVENTION_NOT_OPEN'; end if;
    return target_intervention;
  end if;

  if recipient_member_ids is null or array_length(recipient_member_ids, 1) is null then
    raise exception 'NO_RECIPIENTS';
  end if;

  -- Refuse the whole call-out rather than silently dropping somebody. A
  -- commander who selected five people and got four must be told, not left to
  -- discover it when one of them never answers. This also means a modified
  -- client that posts an ineligible id directly gets an error, not a partial
  -- publication.
  select count(*) into ineligible_count
  from unnest(recipient_member_ids) as requested(member_id)
  where not public.is_eligible_recipient(requested.member_id);

  if ineligible_count > 0 then
    raise exception 'RECIPIENT_NOT_ELIGIBLE';
  end if;

  for member_row in
    select id, full_name, user_id from public.members
    where id = any(recipient_member_ids) and active = true
  loop
    insert into public.intervention_recipients(
      intervention_id, member_id, recipient_version, member_name_at_publication)
    values (target_intervention, member_row.id, 1, member_row.full_name)
    on conflict do nothing;

    -- The dedupe key now names its channel. Rows written before this migration
    -- carry the older `<intervention>:<member>:1` form and are left alone: the
    -- function returns early for anything that is not a DRAFT, so a published
    -- intervention is never fanned out twice and the two forms never meet.
    insert into public.notification_outbox(
      intervention_id, member_id, channel, state, dedupe_key)
    values (
      target_intervention, member_row.id, 'IN_APP', 'QUEUED',
      target_intervention::text || ':' || member_row.id::text || ':IN_APP:1')
    on conflict do nothing;

    -- A Web Push row is queued ONLY for a member who has opted a device in.
    -- Everybody else still gets the in-app obligation above: the call-out is
    -- visible to them the moment they open the application, and push is an
    -- extra way of being told, never the only one.
    if exists (
      select 1 from public.web_push_subscriptions subscription
      where subscription.user_id = member_row.user_id
        and subscription.revoked_at is null
        and (subscription.expiration_time is null or subscription.expiration_time > now())
    ) then
      insert into public.notification_outbox(
        intervention_id, member_id, channel, state, dedupe_key)
      values (
        target_intervention, member_row.id, 'WEB_PUSH', 'QUEUED',
        target_intervention::text || ':' || member_row.id::text || ':WEB_PUSH:1')
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
    jsonb_build_object('recipient_count', frozen_count),
    auth.uid());

  return target_intervention;
end;
$$;

revoke all on table public.web_push_subscriptions from public, anon, authenticated;
grant select on table public.web_push_subscriptions to authenticated;

revoke all on function public.register_web_push_subscription(text, text, text, timestamptz, text)
  from public, anon;
grant execute on function public.register_web_push_subscription(text, text, text, timestamptz, text)
  to authenticated;

revoke all on function public.revoke_web_push_subscription(text) from public, anon;
grant execute on function public.revoke_web_push_subscription(text) to authenticated;

revoke all on function public.publish_intervention(uuid, uuid[]) from public, anon;
grant execute on function public.publish_intervention(uuid, uuid[]) to authenticated;
