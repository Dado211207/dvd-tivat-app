-- ===========================================================================
-- 202609250032 - a device belongs to the account; an alert is judged in the
-- service of the call-out it is about
--
-- P4e of docs/MULTI_ORG_PLAN.md: notification_outbox,
-- notification_delivery_attempts, web_push_subscriptions' own policy, and the
-- `send-web-push` Edge Function.
--
-- P4b already scoped every READ of the outbox and of the delivery attempts
-- (029), and `publish_intervention` queues an alert only for a member of the
-- call-out's own service (027). None of that reaches the push worker: it holds
-- the SERVICE ROLE key, which bypasses row-level security, so the service
-- boundary on its side exists only in its own queries.
--
-- ---------------------------------------------------------------------------
-- What was left, measured on a schema at 202609250031
-- ---------------------------------------------------------------------------
--
-- 1. Registering a device. `register_web_push_subscription` asked
--    `current_dvd_role()` and then the DVD member shim, so an SZS-only member
--    who may be called out was refused (OPERATIONAL_ACCESS_REQUIRED) and could
--    never be alerted. The self-read policy on `web_push_subscriptions` asked
--    `current_dvd_role()` too, so the same member could not see their own
--    device list.
--
-- 2. Deciding who is still eligible. The worker re-checked five facts about
--    the ACCOUNT - member active and linked, profile complete, grant active,
--    grant role operational - and never the service of the call-out. The grant
--    carries DVD's role (P3's mirror), so: an SZS-only member (grant CITIZEN)
--    was refused every alert; a member withdrawn from SZS but still in DVD was
--    alerted for SZS call-outs; and a queued row naming another service's
--    member was sent like any other.
--
-- 3. Waking delivery. The immediate path asked `current_dvd_role()` and never
--    looked at the call-out it was asked to wake: a DVD commander could set off
--    an SZS call-out's delivery, an SZS commander not their own. That is in
--    supabase/functions/send-web-push; the schema half is below.
--
-- 4. What a queued alert is. An UPDATE could move an outbox row onto another
--    member, call-out (with a matching label), channel or dedupe key, and a
--    delivery attempt onto another alert. Nothing does; the plan's rule since
--    P4a is that what a row is about is settled when it is written, as a
--    database rule rather than by the absence of a writer.
--
-- Review of the first draft of this file (3ac2717) found three more, each
-- measured by a test that failed against it (5-7), and review of the second
-- a fourth (8):
--
-- 5. Being sent the call-out. The verdict asked that the alert, its call-out
--    and its member share a service, never that the member was on the
--    call-out's frozen recipient list. `notification_outbox` has one foreign
--    key to the call-out and another to the member; nothing ties the pair to
--    `intervention_recipients`. An alert naming an eligible member of the right
--    service who was never sent the call-out - which no command writes, and
--    the service role or a superuser can - was DELIVERed.
--
-- 6. The call-out still running. The verdict never read the call-out's status,
--    and `close_intervention` changes the call-out and nothing queued under it.
--    An alert still waiting - a first attempt whose wake-up failed, or the
--    repeat ninety seconds later - went out for a call-out already closed or
--    cancelled, on the scheduler and on a commander's wake-up alike.
--
-- 7. The sweep. The worker reads the fifty oldest open alerts. One whose stored
--    service contradicts its call-out can never be written again (P2's
--    trigger), so the worker could neither send it nor set it aside, and
--    counted it as failed on every run. Fifty of them at the front of the
--    queue, and no valid alert behind them was ever reached.
--
-- 8. The sweep, again (found at 9bd7fac). Whether an alert was due - an accepted one waits ninety
--    seconds for its repeat, a claimed one thirty before another worker may
--    take it - was asked only of the fifty rows already read. Fifty accepted
--    alerts waiting for their repeat were the whole sweep: an alert queued
--    behind them went out two scheduler runs late (nothing at the first run,
--    the fifty repeats at the second, the alert at the third), and a
--    commander's wake-up of a call-out with fifty of its own waiting sent
--    nothing at all.
--
-- ---------------------------------------------------------------------------
-- The change
-- ---------------------------------------------------------------------------
--
-- 1. `register_web_push_subscription` - same signature, grants and every
--    other check - asks for operational standing in ANY service, then for a
--    member record the caller may be called out as, in that record's own
--    service (`is_eligible_recipient_in`). A device belongs to the account:
--    somebody serving in both services registers once and is reached as each
--    member. DVD's answers are unchanged: for an account in DVD alone, "staff
--    anywhere" is `current_dvd_role() is not null` and its eligible record is
--    its DVD one.
--
-- 2. `web_push_subscriptions_self_read` asks `is_staff_anywhere()`.
--
-- 3. `push_delivery_verdict(outbox)` - for the service role only - answers the
--    worker's question from the STORED rows, first answer wins:
--
--      SERVICE_MISMATCH  the alert, its call-out and its member are not all in
--                        one service
--      NOT_A_RECIPIENT   the member is not on the call-out's recipient list in
--                        that service. `publish_intervention` writes the
--                        recipient and the alert together; an alert without
--                        one was written by something else
--      OPENED            the member has opened the call-out, so is not alarmed
--                        again - whatever became of the call-out since, as
--                        before
--      CALLOUT_NOT_OPEN  the call-out is not running: closed, cancelled, or
--                        never published. Running is PUBLISHED, ASSEMBLING,
--                        DEPLOYED or CONTAINED - what `set_intervention_status`
--                        may set and the client's `isOpenStatus` answers. A
--                        list of what may be sent, so a status added later
--                        sends nothing until somebody adds it here
--      DELIVER           the member is still somebody that service may call
--                        out, with the account whose devices to use and when
--                        the call-out went out
--      INELIGIBLE        anything else
--
--    Nothing the worker is sent decides any of it: a wake-up names a call-out
--    to look at, and the stored rows answer.
--
--    The eligibility conditions are `is_eligible_recipient_in`'s, repeated:
--    that function answers only a caller who is staff in the service, and the
--    service role has no user. db-tests/push_service.test.ts asserts the two
--    agree on every member, service and state it builds.
--
--    It is caller-rights: were it ever granted to a signed-in role, it could
--    read no more than that role already can.
--
-- 4. An alert that must not be sent is set aside - `delivery_closed_at` and a
--    reason, with no attempt recorded because none was made: MEMBER_OPENED as
--    before; SERVICE_MISMATCH and NOT_A_RECIPIENT for rows no command writes;
--    CALLOUT_NOT_OPEN for a call-out that ended before its alert went out,
--    including the repeat. INELIGIBLE is still an attempt refused
--    (ACCESS_REVOKED), as it always was. Nothing is deleted.
--
-- 5. Identity settled at insert:
--
--      notification_outbox             intervention_id, member_id, channel,
--                                      dedupe_key and created_at never change
--                                      (OUTBOX_IDENTITY_FIXED); organization_id
--                                      follows the call-out through P2's
--                                      trigger. State, attempts, timestamps
--                                      and closing still move - every write
--                                      the worker makes.
--      notification_delivery_attempts  never updated (DELIVERY_HISTORY_APPEND_
--                                      ONLY). Deleting stays possible, so a
--                                      call-out that is removed still takes its
--                                      alerts and their history with it.
--
-- 6. `push_delivery_queue(accepted_before, claimed_before)` is what the worker
--    sweeps: every open Web Push alert that is DUE and whose stored service
--    agrees with its call-out's. The worker filters it by attempts, orders it
--    oldest first and limits it to fifty exactly as it did the table - but
--    both exclusions come first, so nothing that cannot be acted on now can
--    hold a place in the sweep.
--
--    Due is policy.ts's rule, unchanged: queued or refused, at once; accepted,
--    once its repeat is due; claimed, once its worker is presumed dead. The
--    worker passes the two instants - its own `now` less each wait - so the
--    database never consults a clock of its own, and a test that sets the
--    worker's clock sets the cutoff too. The stored time is compared truncated
--    to the millisecond, as `Date.parse` reads it: the worker's own
--    `holdForNow`, still asked of every row it is handed, agrees with the
--    sweep on every row, to the millisecond.
--
--    An alert whose label contradicts its call-out is not handed out: nobody
--    but a superuser with the triggers off can write it, so the worker could
--    never send it, close it or get past it - handing it out only let it hold
--    a place at the front of every sweep. It stays where it is, unchanged and
--    unsent, and `push_delivery_mislabelled(call-out)` counts such alerts, for
--    one call-out or all, so the worker reports them on every run until
--    somebody repairs them. P2's rule is exactly as strict as it was; nothing
--    reads a broken row as a valid one.
--
-- ---------------------------------------------------------------------------
-- What this does NOT decide
-- ---------------------------------------------------------------------------
--
-- One alert per PERSON on a joint call-out, and delivering one service's
-- call-out to another service's member at all, are P7's (Q1-Q5): until then a
-- member of another service on a call-out is a mismatch. Two call-outs, one in
-- each service, are two alerts. The `dvd-` topic prefix is P8's.
--
-- The verdict is asked immediately before an alert is claimed. A call-out
-- closed in the instant between the two can still be alerted once, exactly as
-- a member who opens it in that instant always could be.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Registering a device
-- ---------------------------------------------------------------------------

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
  subscription_id uuid;
begin
  if auth.uid() is null or not public.is_staff_anywhere() then
    raise exception 'OPERATIONAL_ACCESS_REQUIRED';
  end if;
  -- A member record this account may be called out as, asked in that record's
  -- own service. The device is the account's; which service's alerts reach it
  -- is decided per alert, when it is delivered.
  if not exists (
    select 1 from public.members member_row
    where member_row.user_id = auth.uid()
      and public.is_eligible_recipient_in(member_row.id, member_row.organization_id)
  ) then
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

drop policy if exists web_push_subscriptions_self_read on public.web_push_subscriptions;
create policy web_push_subscriptions_self_read
  on public.web_push_subscriptions for select
  using (user_id = auth.uid() and public.is_staff_anywhere());

comment on policy web_push_subscriptions_self_read on public.web_push_subscriptions is
  'An account with operational standing in any service reads its own devices, '
  'and only its own. A device serves every member record of the account.';

-- ---------------------------------------------------------------------------
-- 2. The verdict the worker acts on
-- ---------------------------------------------------------------------------

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
        -- One service, read from the stored rows, or nothing is sent.
        when queued.callout_service is null
          or queued.member_service is null
          or queued.callout_service is distinct from queued.service
          or queued.member_service is distinct from queued.service
          then 'SERVICE_MISMATCH'
        -- Somebody the call-out was published to, in its service. The outbox
        -- row's two foreign keys do not say so; the frozen list does.
        when not exists (
          select 1 from public.intervention_recipients recipient
          where recipient.intervention_id = queued.intervention_id
            and recipient.member_id = queued.member_id
            and recipient.organization_id = queued.service
        ) then 'NOT_A_RECIPIENT'
        when exists (
          select 1 from public.intervention_acknowledgements acknowledgement
          where acknowledgement.intervention_id = queued.intervention_id
            and acknowledgement.member_id = queued.member_id
        ) then 'OPENED'
        -- Only while the call-out runs. What may be sent is listed; anything
        -- else - closed, cancelled, a draft, a status not yet invented - is not.
        when queued.callout_status is null
          or queued.callout_status not in ('PUBLISHED', 'ASSEMBLING', 'DEPLOYED', 'CONTAINED')
          then 'CALLOUT_NOT_OPEN'
        -- `is_eligible_recipient_in`'s conditions, for the call-out's service.
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
                    and membership.organization_id = queued.service
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
  'The push worker''s one question about a queued Web Push alert, answered from '
  'the stored alert, call-out, recipient list and member: SERVICE_MISMATCH, '
  'NOT_A_RECIPIENT, OPENED, CALLOUT_NOT_OPEN, INELIGIBLE, or DELIVER with the '
  'account whose devices to use. For the service role only.';

revoke all on function public.push_delivery_verdict(uuid) from public, anon, authenticated;
grant execute on function public.push_delivery_verdict(uuid) to service_role;

-- Why an alert was set aside unsent. Every value is one the worker writes.
alter table public.notification_outbox
  drop constraint if exists notification_outbox_delivery_close_reason_check;
alter table public.notification_outbox
  add constraint notification_outbox_delivery_close_reason_check
  check (delivery_close_reason is null or delivery_close_reason in (
    'MEMBER_OPENED', 'SERVICE_MISMATCH', 'NOT_A_RECIPIENT', 'CALLOUT_NOT_OPEN'));

-- ---------------------------------------------------------------------------
-- 3. The worker's sweep, and what it cannot sweep
-- ---------------------------------------------------------------------------

-- The first draft of this file (5bf35e1) defined the sweep without arguments,
-- handing out alerts that were not yet due. It was never applied outside test
-- databases; dropped so that no copy of it can stand beside this one.
drop function if exists public.push_delivery_queue();

create or replace function public.push_delivery_queue(accepted_before timestamptz, claimed_before timestamptz)
returns table (
  id uuid,
  intervention_id uuid,
  member_id uuid,
  state text,
  attempt_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  -- The label P2's trigger checks on every write: the call-out's service. An
  -- alert that disagrees cannot be written, so it is not handed out.
  select outbox_row.id, outbox_row.intervention_id, outbox_row.member_id, outbox_row.state,
         outbox_row.attempt_count, outbox_row.created_at, outbox_row.updated_at
    from public.notification_outbox outbox_row
    join public.interventions callout
      on callout.id = outbox_row.intervention_id
     and callout.organization_id = outbox_row.organization_id
   where outbox_row.channel = 'WEB_PUSH'
     and outbox_row.delivery_closed_at is null
     -- Due now, by the WORKER's clock, before the worker's limit: a first
     -- attempt or a refused one at once, an accepted alert once its repeat is
     -- due, a claimed one once its worker is presumed dead. The two instants
     -- are the worker's `now` less policy.ts's two waits; the stored time is
     -- read to the millisecond, as the worker reads it, so this and the
     -- worker's own `holdForNow` agree on every row.
     and (
       outbox_row.state in ('QUEUED', 'PROVIDER_REJECTED')
       or (outbox_row.state = 'PROVIDER_ACCEPTED'
           and date_trunc('milliseconds', outbox_row.updated_at) <= accepted_before)
       or (outbox_row.state = 'SENT_TO_PROVIDER'
           and date_trunc('milliseconds', outbox_row.updated_at) <= claimed_before)
     )
$$;

comment on function public.push_delivery_queue(timestamptz, timestamptz) is
  'Every open Web Push alert that is due - queued or refused; accepted at or '
  'before accepted_before; claimed at or before claimed_before - and whose stored '
  'service agrees with its call-out''s: what the push worker sweeps, ordered and '
  'limited by the worker. The worker passes both instants from its own clock. '
  'For the service role only.';

create or replace function public.push_delivery_mislabelled(target_intervention uuid default null)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select count(*)::integer
    from public.notification_outbox outbox_row
    left join public.interventions callout on callout.id = outbox_row.intervention_id
   where outbox_row.channel = 'WEB_PUSH'
     and outbox_row.delivery_closed_at is null
     and callout.organization_id is distinct from outbox_row.organization_id
     and (target_intervention is null or outbox_row.intervention_id = target_intervention)
$$;

comment on function public.push_delivery_mislabelled(uuid) is
  'How many open Web Push alerts - of one call-out, or all - carry a service that '
  'contradicts their call-out''s: never handed to the worker, never sent, never '
  'changed, and reported by it on every run. For the service role only.';

revoke all on function public.push_delivery_queue(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.push_delivery_mislabelled(uuid) from public, anon, authenticated;
grant execute on function public.push_delivery_queue(timestamptz, timestamptz) to service_role;
grant execute on function public.push_delivery_mislabelled(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Identity settled at insert
-- ---------------------------------------------------------------------------

create or replace function public.refuse_outbox_rebinding()
returns trigger
language plpgsql
as $$
begin
  if new.intervention_id is distinct from old.intervention_id
     or new.member_id is distinct from old.member_id
     or new.channel is distinct from old.channel
     or new.dedupe_key is distinct from old.dedupe_key
     or new.created_at is distinct from old.created_at then
    raise exception 'OUTBOX_IDENTITY_FIXED';
  end if;
  return new;
end;
$$;

comment on function public.refuse_outbox_rebinding() is
  'Which call-out an alert is about, whom it is for, by which channel, its '
  'dedupe key and when it was queued are settled when it is written. Delivery '
  'moves its state, attempts and timestamps; nothing moves it to somebody else.';

create or replace function public.refuse_delivery_attempt_change()
returns trigger
language plpgsql
as $$
begin
  -- No detail about which column: nothing legitimate updates this table.
  raise exception 'DELIVERY_HISTORY_APPEND_ONLY';
end;
$$;

comment on function public.refuse_delivery_attempt_change() is
  'A delivery attempt records what was tried, when, and how the push service '
  'answered. It is written once and never changed - including the alert it '
  'belongs to, which decides the service it is filed under.';

revoke all on function public.refuse_outbox_rebinding() from public, anon, authenticated;
revoke all on function public.refuse_delivery_attempt_change() from public, anon, authenticated;

drop trigger if exists refuse_rebinding on public.notification_outbox;
create trigger refuse_rebinding
  before update on public.notification_outbox
  for each row execute function public.refuse_outbox_rebinding();

drop trigger if exists refuse_change on public.notification_delivery_attempts;
create trigger refuse_change
  before update on public.notification_delivery_attempts
  for each row execute function public.refuse_delivery_attempt_change();
