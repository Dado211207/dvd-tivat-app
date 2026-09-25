/**
 * The push worker's decision, before and after P4e, for the people who exist.
 *
 * Until 202609250032 the worker decided "may this member still be alerted" in
 * TypeScript, from five facts about the ACCOUNT (supabase/functions/send-web-push
 * at 58e2776): member active and linked, profile complete, grant active, grant
 * role operational - after closing any alert the member had already opened.
 * Since then the database answers it, in the service of the call-out:
 * `push_delivery_verdict()`. Production holds DVD members only, so for every one
 * of them the two must agree.
 *
 * Both are asked on the same copy, as postgres: the old rule has no schema of
 * its own to compare against, and the verdict is caller-rights, so postgres
 * reads what the service role reads. Every real queued alert is asked about,
 * and - in a transaction that is rolled back - one new alert per member of the
 * copy on a fresh DVD call-out, so a member with no alert today is measured too.
 */

import { DVD } from './database.mjs';

export const P4E = 'supabase/migrations/202609250032_push_service.sql';

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

const VERDICT = `
  select o.id::text as id, v.verdict as decision
    from public.notification_outbox o, public.push_delivery_verdict(o.id) v
   where o.channel = 'WEB_PUSH'`;

async function compareOn(client) {
  const [{ rows: before }, { rows: after }] = [await client.query(OLD_RULE), await client.query(VERDICT)];
  const now = new Map(after.map((row) => [row.id, row.decision]));
  const differing = before
    .filter((row) => now.get(row.id) !== row.decision)
    .map((row) => ({ alert: row.id, before: row.decision, after: now.get(row.id) ?? '(no verdict)' }));
  const tally = {};
  for (const row of after) tally[row.decision] = (tally[row.decision] ?? 0) + 1;
  return { compared: before.length, answered: after.length, differing, tally };
}

/**
 * Old rule against verdict on `client` (a migrated copy): first every alert
 * already queued, then one new alert per member on a new DVD call-out.
 */
export async function pushDecisions(client) {
  const existing = await compareOn(client);
  await client.query('begin');
  try {
    const { rows: owner } = await client.query(`select user_id from public.access_grants where role = 'OWNER' order by user_id limit 1`);
    const { rows: callout } = await client.query(
      `insert into public.interventions(kind, title, instructions, incident_location, created_by, idempotency_key, organization_id)
       values ('POZAR', 'Gate push', 'Gate upute', 'Gate mjesto', $1, 'gate-push-decisions', $2) returning id`,
      [owner[0]?.user_id ?? null, DVD],
    );
    await client.query(
      `insert into public.notification_outbox(intervention_id, member_id, channel, dedupe_key)
       select $1, m.id, 'WEB_PUSH', 'gate-push:' || m.id from public.members m where m.organization_id = $2`,
      [callout[0].id, DVD],
    );
    const everyMember = await compareOn(client);
    return { existing, everyMember };
  } finally {
    await client.query('rollback');
  }
}
