/**
 * The push worker's decision, before and after P4e, for the people who exist.
 *
 * Until 202609250032 the worker decided "may this member still be alerted" in
 * TypeScript, from five facts about the ACCOUNT (supabase/functions/send-web-push
 * at 58e2776): member active and linked, profile complete, grant active, grant
 * role operational - after closing any alert the member had already opened.
 * Since then the database answers it, in the service of the call-out:
 * `push_delivery_verdict()`. Production holds DVD members only, so for every one
 * of them the two must agree - with the one exception P4e makes on purpose:
 *
 *   E5  an alert the member has not opened, on a call-out that is no longer
 *       running (closed, cancelled, or never published), is CALLOUT_NOT_OPEN.
 *       The old worker judged it as if the call-out were still running, and
 *       sent it - first alert or repeat - to anybody still eligible.
 *
 * Nothing else may differ. In particular NOT_A_RECIPIENT is never expected:
 * every alert production holds was written by `publish_intervention`, which
 * writes the recipient with it. Each E5 difference is still listed, with the
 * call-out's status and whether the worker would really have picked the alert
 * up again: still open, in a delivery state, with an attempt left.
 *
 * Both are asked on the same copy, as postgres: the old rule has no schema of
 * its own to compare against, and the verdict is caller-rights, so postgres
 * reads what the service role reads. Every real queued alert is asked about,
 * and - in a transaction that is rolled back - one new alert per member of the
 * copy on a fresh DVD call-out that is running, and one on a fresh DVD call-out
 * closed before any worker reached it, so a member with no alert today is
 * measured too.
 */

import { DVD } from './database.mjs';

export const P4E = 'supabase/migrations/202609250032_push_service.sql';

/** What `set_intervention_status` may set, and the only statuses an alert goes out for. */
export const RUNNING = ['PUBLISHED', 'ASSEMBLING', 'DEPLOYED', 'CONTAINED'];

export const PUSH_EXPECTED = {
  id: 'E5',
  migration: P4E,
  what: 'An alert the member has not opened, on a call-out that is no longer running, is closed unsent '
    + '(CALLOUT_NOT_OPEN). Before, the worker judged it as if the call-out were running: DELIVER sent it, '
    + 'INELIGIBLE recorded an ACCESS_REVOKED attempt. close_intervention() touches nothing queued.',
  matches: ({ before, after, callout }) => after === 'CALLOUT_NOT_OPEN'
    && ['DELIVER', 'INELIGIBLE'].includes(before) && !RUNNING.includes(callout),
};

/** What index.ts at 58e2776 decided, as SQL over the stored rows. */
const OLD_RULE = `
  select o.id::text as id,
         case
           when exists (select 1 from public.intervention_acknowledgements a
                         where a.intervention_id = o.intervention_id and a.member_id = o.member_id) then 'OPENED'
           when coalesce(m.user_id is not null and m.active and p.profile_complete and g.active
                         and g.role in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'), false) then 'DELIVER'
           else 'INELIGIBLE'
         end as decision
    from public.notification_outbox o
    join public.members m on m.id = o.member_id
    left join public.profiles p on p.user_id = m.user_id
    left join public.access_grants g on g.user_id = m.user_id
   where o.channel = 'WEB_PUSH'`;

/** The verdict, with what E5 needs to know about the call-out and whether the worker would still take the alert. */
const VERDICT = `
  select o.id::text as id, v.verdict as decision, c.status as callout,
         (o.delivery_closed_at is null
          and o.state in ('QUEUED', 'SENT_TO_PROVIDER', 'PROVIDER_ACCEPTED', 'PROVIDER_REJECTED')
          and o.attempt_count < 2) as due
    from public.notification_outbox o
    join public.interventions c on c.id = o.intervention_id,
         public.push_delivery_verdict(o.id) v
   where o.channel = 'WEB_PUSH'`;

async function compareOn(client, only = null) {
  const scope = only ? ' and o.intervention_id = $1' : '';
  const params = only ? [only] : [];
  const [{ rows: before }, { rows: after }] = [
    await client.query(OLD_RULE + scope, params),
    await client.query(VERDICT + scope, params),
  ];
  const now = new Map(after.map((row) => [row.id, row]));
  const differing = [];
  const expected = [];
  for (const row of before) {
    const verdict = now.get(row.id);
    if (verdict?.decision === row.decision) continue;
    const entry = { alert: row.id, before: row.decision, after: verdict?.decision ?? '(no verdict)', callout: verdict?.callout ?? null, due: verdict?.due ?? null };
    if (verdict && PUSH_EXPECTED.matches(entry)) expected.push({ ...entry, rule: PUSH_EXPECTED.id });
    else differing.push(entry);
  }
  const tally = {};
  for (const row of after) tally[row.decision] = (tally[row.decision] ?? 0) + 1;
  return { compared: before.length, answered: after.length, differing, expected, tally };
}

/** A DVD call-out as `publish_intervention` leaves it, to every DVD member of the copy, then optionally closed. */
async function everyMemberOn(client, owner, key, ended) {
  const { rows: callout } = await client.query(
    `insert into public.interventions(kind, title, instructions, incident_location, created_by, idempotency_key,
                                      organization_id, status, published_at, published_by)
     values ('POZAR', 'Gate push', 'Gate upute', 'Gate mjesto', $1, $2, $3, 'PUBLISHED', now(), $1) returning id`,
    [owner, key, DVD],
  );
  const id = callout[0].id;
  await client.query(
    `insert into public.intervention_recipients(intervention_id, member_id, recipient_version, member_name_at_publication)
     select $1, m.id, 1, m.full_name from public.members m where m.organization_id = $2`,
    [id, DVD],
  );
  await client.query(
    `insert into public.notification_outbox(intervention_id, member_id, channel, dedupe_key)
     select $1, m.id, 'WEB_PUSH', $3 || ':' || m.id from public.members m where m.organization_id = $2`,
    [id, DVD, key],
  );
  if (ended) {
    // What close_intervention() writes - and nothing under the call-out.
    await client.query(
      `update public.interventions set status = 'CLOSED', closed_at = now(), closed_by = $2, close_reason = 'Gate: zavrseno'
        where id = $1`,
      [id, owner],
    );
  }
  return compareOn(client, id);
}

/**
 * Old rule against verdict on `client` (a migrated copy): first every alert
 * already queued, then one new alert per member on a running DVD call-out,
 * then the same on one that was closed before any worker reached it.
 */
export async function pushDecisions(client) {
  const existing = await compareOn(client);
  await client.query('begin');
  try {
    const { rows: owner } = await client.query(`select user_id from public.access_grants where role = 'OWNER' order by user_id limit 1`);
    const everyMember = await everyMemberOn(client, owner[0]?.user_id ?? null, 'gate-push-decisions', false);
    const everyMemberEnded = await everyMemberOn(client, owner[0]?.user_id ?? null, 'gate-push-ended', true);
    return { existing, everyMember, everyMemberEnded };
  } finally {
    await client.query('rollback');
  }
}
