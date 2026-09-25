/**
 * Registering a device, and being alerted, in the service that called you out.
 *
 * P4e of docs/MULTI_ORG_PLAN.md. P4b already scoped every READ of the outbox
 * and the delivery attempts (202609250029). What was left is the half no
 * policy can reach:
 *
 *   `register_web_push_subscription`   asked `current_dvd_role()` and the DVD
 *                                      member shim, so an SZS-only member who
 *                                      may be called out could never register
 *                                      a device - and the self-read policy on
 *                                      `web_push_subscriptions` hid their own
 *                                      device list for the same reason
 *   the push worker                    holds the SERVICE ROLE key, which
 *                                      bypasses row-level security. It decided
 *                                      "still eligible" from the account's
 *                                      grant - DVD's role - and never asked the
 *                                      service of the call-out: an SZS member
 *                                      was never alerted, a member withdrawn
 *                                      from SZS still was for SZS, and a
 *                                      queued row naming another service's
 *                                      member was sent like any other
 *   the immediate wake-up              asked `current_dvd_role()`: a DVD
 *                                      commander could set off any call-out's
 *                                      delivery, an SZS commander not their own
 *   what a queued alert is             its call-out, member and channel, and
 *                                      the delivery history under it, could be
 *                                      rewritten by an UPDATE
 *
 * and three more found by review of the first draft (3ac2717), each a test
 * below that failed against it:
 *
 *   the recipient list                 an alert for an eligible member of the
 *                                      right service who was never sent the
 *                                      call-out was delivered
 *   the call-out's status              an alert still queued when its call-out
 *                                      was closed or cancelled went out - the
 *                                      repeat too
 *   the sweep                          fifty alerts nobody can write, at the
 *                                      front of the queue, stopped every valid
 *                                      alert behind them
 *
 * and, in review of the next draft (9bd7fac), one more:
 *
 *   what the sweep counts as due       fifty alerts waiting out their repeat
 *                                      filled the sweep, because whether an
 *                                      alert was due was asked after the limit:
 *                                      a call-out queued behind them went out
 *                                      two scheduler runs late
 *
 * The worker's queries are exercised as written, through db-tests/postgrest.ts,
 * as the service role, against the rows built here. Nothing is sent: the push
 * service is a recording fake.
 *
 * Deliberately NOT here: one alert per PERSON across services (P7 - a joint
 * call-out does not exist yet, so two call-outs are two alerts), and the topic
 * prefix `dvd-` (P8's rename).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authoriseWake, deliverQueued, type PushOptions, type PushTarget } from '../supabase/functions/send-web-push/deliver';
import { MIGRATIONS, connect, createAccount } from './harness';
import { postgrest, type Rest } from './postgrest';

const PUSH = 'supabase/migrations/202609250032_push_service.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
const UNKNOWN = '00000000-0000-4000-8fff-000000000001';

const P256DH = 'A'.repeat(65);
const AUTH = 'B'.repeat(24);

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });
const endpointOf = (label: string) => `https://push.example.test/p4e/${label}`;

let db: Client;

type Label =
  | 'owner'
  | 'dvdCommander'
  | 'dvdFirefighter'
  | 'dvdOther'
  | 'dvdSuspended'
  | 'szsCommander'
  | 'szsFirefighter'
  | 'szsOther'
  | 'szsSuspended'
  | 'szsNoMember'
  | 'dual'
  | 'dualSzsWithdrawn'
  | 'citizen';
interface Person {
  user: string;
  dvd?: string;
  szs?: string;
}
const people = {} as Record<Label, Person>;

/** Everybody with a device, and so a queued Web Push alert on each call-out they were sent. */
const WITH_DEVICE = [
  'dvdFirefighter', 'dvdOther', 'dvdSuspended',
  'szsFirefighter', 'szsOther', 'szsSuspended',
  'dual', 'dualSzsWithdrawn',
] as const satisfies readonly Label[];

let dvdCallout = '';
let szsCallout = '';
/** A row naming a DVD member on the SZS call-out, which nothing sent them. */
let forgedMember = '';
/** A row labelled DVD on the SZS call-out, written with the triggers off. */
let forgedLabel = '';

/**
 * One statement as `userId`, inside the caller's open transaction, answered as
 * 'OK', the refusal code, or 'RLS' / 'DENIED' for a policy or privilege
 * refusal. Savepoints, for the reason the P4a file records.
 */
async function act(userId: string, statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint act');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(userId)]);
    await db.query('set local role authenticated');
    await db.query(statement, params);
    await db.query('reset role');
    await db.query('release savepoint act');
    return 'OK';
  } catch (error) {
    await db.query('rollback to savepoint act');
    await db.query('reset role');
    const message = (error as Error).message;
    if (/row-level security/.test(message)) return 'RLS';
    if (/permission denied/.test(message)) return 'DENIED';
    return message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
  }
}

/** Rows of one statement as `userId` (or the service role), inside the caller's open transaction. */
async function rowsAs<T extends object>(userId: string | 'service_role', statement: string, params: unknown[] = []): Promise<T[]> {
  await db.query('savepoint rows_as');
  try {
    if (userId === 'service_role') {
      // Built, not written out: the repository's secret scan treats a literal
      // service-role claim as a leaked key, and it is right to.
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
      await db.query('set local role service_role');
    } else {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(userId)]);
      await db.query('set local role authenticated');
    }
    const { rows } = await db.query<T & Record<string, unknown>>(statement, params);
    await db.query('reset role');
    await db.query('release savepoint rows_as');
    return rows;
  } catch (error) {
    await db.query('rollback to savepoint rows_as');
    await db.query('reset role');
    throw error;
  }
}

/** As postgres - the role the worker's writes stand in for - inside a savepoint. */
async function raw(statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint raw');
  try {
    await db.query(statement, params);
    await db.query('release savepoint raw');
    return 'OK';
  } catch (error) {
    await db.query('rollback to savepoint raw');
    return (error as Error).message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
  }
}

async function isolated<T>(work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await work();
  } finally {
    await db.query('rollback');
  }
}

/** Registration as `who`, with only what a client sends. */
const register = (who: Label, endpoint = endpointOf(`${who}-new`)) =>
  act(people[who].user, `select public.register_web_push_subscription($1, $2, $3, null, 'P4e test')`, [endpoint, P256DH, AUTH]);

/**
 * What every account is answered, and can read, about its own devices - the
 * same questions before and after, so the two can be compared entry by entry.
 */
async function deviceMatrix(): Promise<Record<string, string>> {
  return isolated(async () => {
    const out: Record<string, string> = {};
    for (const who of Object.keys(people) as Label[]) {
      out[`register|${who}`] = await register(who);
      out[`reads|${who}`] = String(
        (await rowsAs(people[who].user, 'select 1 from public.web_push_subscriptions where endpoint not like $1', ['%-new'])).length,
      );
    }
    return out;
  });
}

/** The worker's decision on every queued alert, by what the alert is. */
const decisionBefore = new Map<string, string>();
let devicesBefore: Record<string, string> = {};

async function alertLabels(): Promise<Map<string, string>> {
  const labels = new Map<string, string>([[forgedMember, 'forged member'], [forgedLabel, 'forged label']]);
  for (const who of Object.keys(people) as Label[]) {
    for (const [callout, service] of [[dvdCallout, 'DVD'], [szsCallout, 'SZS']] as const) {
      const member = service === 'DVD' ? people[who].dvd : people[who].szs;
      const { rows } = await db.query<{ id: string }>(
        `select id::text from public.notification_outbox
          where intervention_id = $1 and member_id = $2 and channel = 'WEB_PUSH' and dedupe_key not like 'p4e-forged%'`,
        [callout, member ?? UNKNOWN],
      );
      for (const row of rows) labels.set(row.id, `${who}@${service}`);
    }
  }
  return labels;
}

async function account(label: string, grantRole: string): Promise<string> {
  const created = await createAccount(db, `${label.toLowerCase()}.p4e@example.invalid`);
  await db.query(
    `update public.profiles
        set full_name = $2, phone_e164 = '+38267123456', date_of_birth = date '1990-01-01', profile_complete = true
      where user_id = $1`,
    [created.userId, `${label} Test`],
  );
  await db.query(`update public.access_grants set role = $2 where user_id = $1`, [created.userId, grantRole]);
  return created.userId;
}

async function membership(user: string, organization: string, role: string): Promise<void> {
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, active)
     values ($1, $2, $3, true)
     on conflict (organization_id, user_id) do update set role = excluded.role, active = true`,
    [organization, user, role],
  );
}

async function memberIn(organization: string, name: string, user: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.members(full_name, user_id, organization_id, active) values ($1, $2, $3, true) returning id`,
    [name, user, organization],
  );
  return rows[0]!.id;
}

/** One command as `user`, COMMITTED: fixture building through the real commands. */
async function committed(user: string, statement: string, params: unknown[] = []): Promise<string> {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(user)]);
    await db.query('set local role authenticated');
    const { rows } = await db.query(statement, params);
    await db.query('commit');
    return String(Object.values((rows[0] ?? {}) as object)[0] ?? '');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

/** The queued Web Push alert for `who` on `callout`. */
async function alertOf(who: Label, callout: string): Promise<string> {
  const member = callout === dvdCallout ? people[who].dvd : people[who].szs;
  const { rows } = await db.query<{ id: string }>(
    `select id from public.notification_outbox where intervention_id = $1 and member_id = $2 and channel = 'WEB_PUSH'`,
    [callout, member],
  );
  if (rows.length !== 1) throw new Error(`expected one alert for ${who}, found ${rows.length}`);
  return rows[0]!.id;
}

beforeAll(async () => {
  db = await connect();
  await db.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    create schema public;
    grant all on schema public to postgres;
  `);
  // Everything before P4e. Until the migration exists this is every migration
  // there is, and the second half of this file fails - which is the point.
  const index = MIGRATIONS.indexOf(PUSH);
  for (const file of index === -1 ? MIGRATIONS : MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  // The installation owner holds no membership and no member record.
  people.owner = { user: await account('Vlasnik', 'OWNER') };

  for (const [label, role] of [
    ['dvdCommander', 'COMMANDER'],
    ['dvdFirefighter', 'FIREFIGHTER'],
    ['dvdOther', 'FIREFIGHTER'],
    ['dvdSuspended', 'FIREFIGHTER'],
  ] as const) {
    const user = await account(label, role);
    people[label] = { user, dvd: await memberIn(DVD, `${label} Clan`, user) };
  }
  // SZS-only people hold CITIZEN on the grant: an operational grant role would
  // be mirrored into an active DVD membership.
  for (const [label, role] of [
    ['szsCommander', 'COMMANDER'],
    ['szsFirefighter', 'FIREFIGHTER'],
    ['szsOther', 'FIREFIGHTER'],
    ['szsSuspended', 'FIREFIGHTER'],
  ] as const) {
    const user = await account(label, 'CITIZEN');
    await membership(user, SZS, role);
    people[label] = { user, szs: await memberIn(SZS, `${label} Clan`, user) };
  }
  // Serves in SZS, but nobody has made them a member record yet.
  people.szsNoMember = { user: await account('szsNoMember', 'CITIZEN') };
  await membership(people.szsNoMember.user, SZS, 'FIREFIGHTER');
  // Two people serving in both, each with a member record in each service.
  for (const label of ['dual', 'dualSzsWithdrawn'] as const) {
    const user = await account(label, 'FIREFIGHTER');
    await membership(user, SZS, 'FIREFIGHTER');
    people[label] = {
      user,
      dvd: await memberIn(DVD, `${label} DVD`, user),
      szs: await memberIn(SZS, `${label} SZS`, user),
    };
  }
  people.citizen = { user: await account('Gradjanin', 'CITIZEN') };

  // One device each, written directly: registration is what is under test, and
  // it differs before and after. A device belongs to the ACCOUNT, so somebody
  // serving in both has one device for both.
  for (const who of WITH_DEVICE) {
    await db.query(
      `insert into public.web_push_subscriptions(user_id, endpoint, p256dh, auth_secret) values ($1, $2, $3, $4)`,
      [people[who].user, endpointOf(who), P256DH, AUTH],
    );
  }

  // One call-out per service, through the real commands, each to its own
  // service's members only. Publication queues a Web Push alert for everybody
  // with a device.
  dvdCallout = await committed(
    people.dvdCommander.user,
    `select public.create_intervention_draft('POZAR', 'DVD poziv', 'Okupljanje u bazi.', 'Poligon DVD', 'p4e-dvd')`,
  );
  await committed(people.dvdCommander.user, 'select public.publish_intervention($1, $2)', [
    dvdCallout,
    (['dvdFirefighter', 'dvdOther', 'dvdSuspended', 'dual', 'dualSzsWithdrawn'] as const).map((who) => people[who].dvd),
  ]);
  szsCallout = await committed(
    people.szsCommander.user,
    `select public.create_intervention_draft_in($1, 'POZAR', 'SZS poziv', 'Okupljanje kod doma.', 'Poligon SZS', 'p4e-szs')`,
    [SZS],
  );
  await committed(people.szsCommander.user, 'select public.publish_intervention($1, $2)', [
    szsCallout,
    (['szsFirefighter', 'szsOther', 'szsSuspended', 'dual', 'dualSzsWithdrawn'] as const).map((who) => people[who].szs),
  ]);

  // One recipient in each service has already opened their call-out.
  await committed(people.dvdOther.user, 'select public.acknowledge_intervention($1)', [dvdCallout]);
  await committed(people.szsOther.user, 'select public.acknowledge_intervention($1)', [szsCallout]);

  // Two rows no command writes. Only the service role or a superuser can: this
  // is what a bug, a hand-run repair or an import would leave behind.
  const { rows: forged } = await db.query<{ id: string }>(
    `insert into public.notification_outbox(intervention_id, member_id, channel, dedupe_key)
     values ($1, $2, 'WEB_PUSH', 'p4e-forged-member') returning id`,
    [szsCallout, people.dvdFirefighter.dvd],
  );
  forgedMember = forged[0]!.id;
  // With the triggers off, as only a superuser can: P2's trigger refuses this
  // label on insert and refuses ANY later update of the row, so not even the
  // worker can close it.
  await db.query('begin');
  await db.query('set local session_replication_role = replica');
  const { rows: mislabelled } = await db.query<{ id: string }>(
    `insert into public.notification_outbox(intervention_id, member_id, channel, dedupe_key, organization_id)
     values ($1, $2, 'WEB_PUSH', 'p4e-forged-label', $3) returning id`,
    [szsCallout, people.szsCommander.szs, DVD],
  );
  await db.query('commit');
  forgedLabel = mislabelled[0]!.id;

  // Only now does each of these lose standing: the alert was queued while they
  // could still be called out, and waits for a worker.
  for (const who of ['dvdSuspended', 'szsSuspended'] as const) {
    await db.query(`update public.access_grants set active = false where user_id = $1`, [people[who].user]);
  }
  await db.query(`update public.organization_memberships set active = false where user_id = $1 and organization_id = $2`, [
    people.dualSzsWithdrawn.user,
    SZS,
  ]);
}, 120_000);

afterAll(async () => {
  await db?.end();
});

describe('before P4e: push asks DVD, whichever service called you out', () => {
  it('refuses an SZS-only member a device, however eligible they are', async () => {
    await isolated(async () => {
      expect(await register('szsFirefighter')).toBe('OPERATIONAL_ACCESS_REQUIRED');
      expect(await register('szsCommander')).toBe('OPERATIONAL_ACCESS_REQUIRED');
      expect(await register('dvdFirefighter')).toBe('OK');
      expect(await register('dual')).toBe('OK');
    });
  });

  it('hides an SZS-only member their own device list', async () => {
    await isolated(async () => {
      const own = 'select endpoint from public.web_push_subscriptions';
      expect(await rowsAs(people.szsFirefighter.user, own)).toHaveLength(0);
      expect(await rowsAs(people.dvdFirefighter.user, own)).toHaveLength(1);
    });
  });

  it('decides "still eligible" from the DVD grant, not the call-out\'s service', async () => {
    // What supabase/functions/send-web-push/index.ts asked at 58e2776, as SQL:
    // the acknowledgement, then members.user_id/active, profiles.profile_complete
    // and access_grants.active/role through policy.ts `stillEligible` - five
    // questions about the account, none about the service of the call-out.
    const { rows } = await db.query<{ id: string; opened: boolean; eligible: boolean }>(
      `select o.id::text,
              exists (select 1 from public.intervention_acknowledgements a
                       where a.intervention_id = o.intervention_id and a.member_id = o.member_id) as opened,
              coalesce(m.user_id is not null and m.active and p.profile_complete and g.active
                       and g.role in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'), false) as eligible
         from public.notification_outbox o
         join public.members m on m.id = o.member_id
         left join public.profiles p on p.user_id = m.user_id
         left join public.access_grants g on g.user_id = m.user_id
        where o.channel = 'WEB_PUSH'`,
    );
    // In the verdict's words, so the two can be compared after: an eligible
    // member was sent to, anybody else was refused (ACCESS_REVOKED).
    for (const row of rows) {
      decisionBefore.set(row.id, row.opened ? 'OPENED' : row.eligible ? 'DELIVER' : 'INELIGIBLE');
    }

    // An SZS member who may be called out is never alerted: their grant reads CITIZEN.
    expect(decisionBefore.get(await alertOf('szsFirefighter', szsCallout))).toBe('INELIGIBLE');
    // Somebody withdrawn from SZS is still alerted for SZS: their DVD grant answers.
    expect(decisionBefore.get(await alertOf('dualSzsWithdrawn', szsCallout))).toBe('DELIVER');
    // A DVD member is alerted about an SZS call-out nobody sent them.
    expect(decisionBefore.get(forgedMember)).toBe('DELIVER');
    // DVD itself, the reference.
    expect(decisionBefore.get(await alertOf('dvdFirefighter', dvdCallout))).toBe('DELIVER');
  });

  it('records what every account is told, and can read, about its devices', async () => {
    devicesBefore = await deviceMatrix();
    expect(devicesBefore['register|dvdFirefighter']).toBe('OK');
    expect(devicesBefore['register|szsFirefighter']).toBe('OPERATIONAL_ACCESS_REQUIRED');
  });

  it('lets the immediate wake-up be asked for by DVD command alone', async () => {
    // index.ts at 58e2776: `caller.rpc('current_dvd_role')` must be OWNER, ADMIN
    // or COMMANDER, and the call-out named in the request is never looked at.
    await isolated(async () => {
      const role = async (who: Label) =>
        (await rowsAs<{ role: string | null }>(people[who].user, 'select public.current_dvd_role() as role'))[0]!.role;
      expect(await role('dvdCommander'), 'so a DVD commander may wake the SZS call-out').toBe('COMMANDER');
      expect(await role('szsCommander'), 'and an SZS commander may not wake their own').toBeNull();
    });
  });

  it('lets an UPDATE move a queued alert, or its delivery history, to somebody else', async () => {
    await isolated(async () => {
      const alert = await alertOf('dvdFirefighter', dvdCallout);
      expect(await raw(`update public.notification_outbox set member_id = $2 where id = $1`, [alert, people.dvdCommander.dvd])).toBe('OK');
      await db.query(`insert into public.notification_delivery_attempts(outbox_id, provider, provider_status) values ($1, 'WEB_PUSH', 'ACCEPTED_IMMEDIATE')`, [alert]);
      expect(
        await raw(`update public.notification_delivery_attempts set outbox_id = $2 where outbox_id = $1`, [
          alert,
          await alertOf('dual', dvdCallout),
        ]),
      ).toBe('OK');
    });
  });

  it('has no way to record why a mismatched alert was set aside', async () => {
    await isolated(async () => {
      expect(
        await raw(`update public.notification_outbox set delivery_closed_at = now(), delivery_close_reason = 'SERVICE_MISMATCH' where id = $1`, [
          forgedMember,
        ]),
      ).toMatch(/check constraint|violates/);
    });
  });
});

describe('after P4e: a device is the account\'s, an alert is the call-out\'s service\'s', () => {
  let service: Rest;
  const callers = new Map<Label, Rest>();
  const callerFor = (who: Label) => {
    if (!callers.has(who)) callers.set(who, postgrest({ role: 'authenticated', userId: people[who].user }, 1));
    return callers.get(who)!;
  };

  interface Sent {
    endpoint: string;
    payload: Record<string, unknown>;
    options: PushOptions;
  }
  /** A push service that records and never sends. `failing` answers with that HTTP status. */
  const fakePush = (failing: Record<string, number> = {}) => {
    const sent: Sent[] = [];
    const send = async (target: PushTarget, payload: string, options: PushOptions) => {
      await new Promise((settle) => setTimeout(settle, 5));
      if (failing[target.endpoint]) throw Object.assign(new Error('refused'), { statusCode: failing[target.endpoint] });
      sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) as Record<string, unknown>, options });
    };
    return { sent, send };
  };

  /**
   * Every Web Push alert back to QUEUED, unsent, with every device live. A row
   * whose stored service contradicts its call-out is left alone: nothing can
   * update it, which is the point of several tests below.
   */
  async function resetQueue(): Promise<void> {
    await db.query(`delete from public.notification_delivery_attempts`);
    await db.query(
      `update public.notification_outbox o
          set state = 'QUEUED', attempt_count = 0, delivery_closed_at = null,
              delivery_close_reason = null, updated_at = now()
        where o.channel = 'WEB_PUSH'
          and o.organization_id = (select c.organization_id from public.interventions c where c.id = o.intervention_id)`,
    );
    await db.query(`update public.web_push_subscriptions set revoked_at = null, last_used_at = null where endpoint like $1`, [
      `${endpointOf('')}%`,
    ]);
  }

  async function stateOf(id: string) {
    const { rows } = await db.query<{ state: string; attempt_count: number; delivery_close_reason: string | null; attempts: string }>(
      `select state, attempt_count, delivery_close_reason,
              coalesce((select string_agg(provider_status, ',' order by provider_status)
                          from public.notification_delivery_attempts a where a.outbox_id = o.id), '') as attempts
         from public.notification_outbox o where id = $1`,
      [id],
    );
    return rows[0]!;
  }

  /** Who was alerted about what, as `<device's account>@<call-out>`, sorted. */
  const sentTo = (sent: readonly Sent[], callouts: ReadonlyMap<string, string> = new Map()) =>
    sent
      .map((s) => {
        const callout = String(s.payload.interventionId);
        const label = callout === dvdCallout ? 'DVD' : callout === szsCallout ? 'SZS' : (callouts.get(callout) ?? callout);
        return `${s.endpoint.replace(endpointOf(''), '')}@${label}`;
      })
      .sort();
  /** Everybody the two fixture call-outs may alert. */
  const FIXTURE_ALERTED = ['dvdFirefighter@DVD', 'dual@DVD', 'dualSzsWithdrawn@DVD', 'szsFirefighter@SZS', 'dual@SZS'];

  beforeAll(async () => {
    if (MIGRATIONS.includes(PUSH)) await db.query(sql(PUSH));
    service = postgrest({ role: 'service_role' });
  }, 60_000);

  afterAll(async () => {
    await service?.end();
    for (const caller of callers.values()) await caller.end();
  });

  // --- what did not change --------------------------------------------------

  it('answers every account exactly as before, except those P4e is for', async () => {
    const after = await deviceMatrix();
    const changed = Object.keys(after)
      .filter((key) => after[key] !== devicesBefore[key])
      .map((key) => `${key}: ${devicesBefore[key]} -> ${after[key]}`)
      .sort();
    expect(changed).toEqual(
      [
        // SZS-only members who may be called out: a device, and their own list.
        'register|szsCommander: OPERATIONAL_ACCESS_REQUIRED -> OK',
        'register|szsFirefighter: OPERATIONAL_ACCESS_REQUIRED -> OK',
        'register|szsOther: OPERATIONAL_ACCESS_REQUIRED -> OK',
        'reads|szsFirefighter: 0 -> 1',
        'reads|szsOther: 0 -> 1',
        // Serves in SZS, has no record to be called out as: told so.
        'register|szsNoMember: OPERATIONAL_ACCESS_REQUIRED -> ELIGIBLE_MEMBER_REQUIRED',
      ].sort(),
    );
  });

  it('decides every DVD alert as the old worker did, and SZS ones by SZS', async () => {
    const verdicts = await isolated(() =>
      rowsAs<{ id: string; verdict: string }>(
        'service_role',
        `select o.id::text, v.verdict from public.notification_outbox o, public.push_delivery_verdict(o.id) v
          where o.channel = 'WEB_PUSH'`,
      ),
    );
    const labels = await alertLabels();
    expect(verdicts).toHaveLength(decisionBefore.size);
    const changed = verdicts
      .filter((row) => decisionBefore.get(row.id) !== row.verdict)
      .map((row) => `${labels.get(row.id)}: ${decisionBefore.get(row.id)} -> ${row.verdict}`)
      .sort();
    expect(changed).toEqual(
      [
        'szsFirefighter@SZS: INELIGIBLE -> DELIVER',
        'dualSzsWithdrawn@SZS: DELIVER -> INELIGIBLE',
        'forged member: DELIVER -> SERVICE_MISMATCH',
        'forged label: INELIGIBLE -> SERVICE_MISMATCH',
      ].sort(),
    );
  });

  it('keeps every grant on the three tables and the two device commands', async () => {
    const { rows } = await db.query<{ what: string; acl: string }>(
      `select c.relname::text as what, array_to_string(c.relacl, ' ') as acl from pg_class c
        where c.relnamespace = 'public'::regnamespace
          and c.relname in ('web_push_subscriptions', 'notification_outbox', 'notification_delivery_attempts')
       union all
       select p.oid::regprocedure::text, array_to_string(p.proacl, ' ') from pg_proc p
        where p.oid in ('public.register_web_push_subscription(text,text,text,timestamptz,text)'::regprocedure,
                        'public.revoke_web_push_subscription(text)'::regprocedure)
       order by 1`,
    );
    expect(Object.fromEntries(rows.map((row) => [row.what, row.acl]))).toEqual({
      notification_delivery_attempts: 'postgres=arwdDxt/postgres service_role=arwdDxt/postgres authenticated=r/postgres',
      notification_outbox: 'postgres=arwdDxt/postgres service_role=arwdDxt/postgres authenticated=r/postgres',
      'register_web_push_subscription(text,text,text,timestamp with time zone,text)':
        'postgres=X/postgres authenticated=X/postgres service_role=X/postgres',
      'revoke_web_push_subscription(text)': 'postgres=X/postgres authenticated=X/postgres service_role=X/postgres',
      web_push_subscriptions: 'postgres=arwdDxt/postgres service_role=arwdDxt/postgres authenticated=r/postgres',
    });
    // No client runs the two triggers' functions, and no overload was added.
    const { rows: functions } = await db.query<{ fn: string; client: boolean }>(
      `select p.oid::regprocedure::text as fn,
              has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') as client
         from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.proname in ('register_web_push_subscription', 'push_delivery_verdict', 'push_delivery_queue',
                            'push_delivery_mislabelled', 'refuse_outbox_rebinding', 'refuse_delivery_attempt_change')
        order by 1`,
    );
    expect(functions).toEqual([
      { fn: 'push_delivery_mislabelled(uuid)', client: false },
      { fn: 'push_delivery_queue(timestamp with time zone,timestamp with time zone)', client: false },
      { fn: 'push_delivery_verdict(uuid)', client: false },
      { fn: 'refuse_delivery_attempt_change()', client: false },
      { fn: 'refuse_outbox_rebinding()', client: false },
      { fn: 'register_web_push_subscription(text,text,text,timestamp with time zone,text)', client: true },
    ]);
  });

  it('is a no-op to apply twice', async () => {
    const shape = async () =>
      (await db.query<{ h: string }>(
        `select md5(coalesce((select string_agg(x, '|' order by x) from (
                                select tablename || policyname || coalesce(qual, '') || coalesce(with_check, '') as x
                                  from pg_policies where schemaname = 'public') p), '')
                    || coalesce((select string_agg(x, '|' order by x) from (
                                  select tgname || pg_get_triggerdef(oid) as x from pg_trigger where not tgisinternal) t), '')
                    || coalesce((select string_agg(x, '|' order by x) from (
                                  select proname || md5(prosrc) || coalesce(array_to_string(proacl, ' '), '') as x from pg_proc
                                   where pronamespace = 'public'::regnamespace) f), '')
                    || coalesce((select string_agg(x, '|' order by x) from (
                                  select conname || pg_get_constraintdef(oid) as x from pg_constraint
                                   where connamespace = 'public'::regnamespace) c), '')) as h`,
      )).rows[0]!.h;
    const before = await shape();
    await isolated(async () => {
      await db.query(sql(PUSH));
      expect(await shape()).toBe(before);
    });
  });

  // --- registering a device ------------------------------------------------

  it('lets every member who may be called out register a device, in either service', async () => {
    await isolated(async () => {
      for (const who of ['dvdCommander', 'dvdFirefighter', 'szsCommander', 'szsFirefighter', 'dual'] as const) {
        expect(await register(who), who).toBe('OK');
      }
      // Withdrawn from SZS, still a DVD member: the device is the account's.
      expect(await register('dualSzsWithdrawn')).toBe('OK');

      const { rows } = await db.query<{ user_id: string }>(
        `select user_id::text from public.web_push_subscriptions where endpoint like '%-new'`,
      );
      expect(rows.map((row) => row.user_id).sort()).toEqual(
        (['dvdCommander', 'dvdFirefighter', 'szsCommander', 'szsFirefighter', 'dual', 'dualSzsWithdrawn'] as const)
          .map((who) => people[who].user)
          .sort(),
      );
    });
  });

  it('still refuses anybody who could not be called out, and stores nothing for them', async () => {
    await isolated(async () => {
      // Standing somewhere, but no member record to be called out as.
      expect(await register('owner')).toBe('ELIGIBLE_MEMBER_REQUIRED');
      expect(await register('szsNoMember')).toBe('ELIGIBLE_MEMBER_REQUIRED');
      // No standing anywhere.
      expect(await register('dvdSuspended')).toBe('OPERATIONAL_ACCESS_REQUIRED');
      expect(await register('szsSuspended')).toBe('OPERATIONAL_ACCESS_REQUIRED');
      expect(await register('citizen')).toBe('OPERATIONAL_ACCESS_REQUIRED');
      // A member record the service has stood down.
      await db.query(`update public.members set active = false where id = $1`, [people.szsFirefighter.szs]);
      expect(await register('szsFirefighter')).toBe('ELIGIBLE_MEMBER_REQUIRED');

      const { rows } = await db.query(`select 1 from public.web_push_subscriptions where endpoint like '%-new'`);
      expect(rows).toHaveLength(0);
    });
  });

  it('lets the owner register once linked in either service, and not before', async () => {
    // CHANGED: before P4e only a DVD member record counted. Ownership alone
    // still invents nothing: no record, no device.
    await isolated(async () => {
      expect(await register('owner')).toBe('ELIGIBLE_MEMBER_REQUIRED');
      await memberIn(SZS, 'Vlasnik SZS', people.owner.user);
      expect(await register('owner')).toBe('OK');
    });
  });

  it('keeps a device with the account that registered it', async () => {
    await isolated(async () => {
      expect(await register('szsFirefighter', endpointOf('dvdFirefighter'))).toBe('PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT');
      const { rows } = await db.query<{ user_id: string }>(
        `select user_id::text from public.web_push_subscriptions where endpoint = $1`,
        [endpointOf('dvdFirefighter')],
      );
      expect(rows.map((row) => row.user_id)).toEqual([people.dvdFirefighter.user]);
    });
  });

  it('shows each account its own devices and nobody else\'s', async () => {
    await isolated(async () => {
      const own = 'select user_id::text from public.web_push_subscriptions';
      for (const who of ['dvdFirefighter', 'szsFirefighter', 'dual', 'dualSzsWithdrawn'] as const) {
        const rows = await rowsAs<{ user_id: string }>(people[who].user, own);
        expect(rows.map((row) => row.user_id), who).toEqual([people[who].user]);
      }
      // No standing, no list - as before.
      for (const who of ['dvdSuspended', 'szsSuspended', 'citizen', 'owner'] as const) {
        expect(await rowsAs(people[who].user, own), who).toHaveLength(0);
      }
    });
  });

  it('lets an SZS-only member revoke their own device and nobody else\'s', async () => {
    await isolated(async () => {
      const revoke = (who: Label, endpoint: string) =>
        rowsAs<{ changed: boolean }>(people[who].user, 'select public.revoke_web_push_subscription($1) as changed', [endpoint]);
      expect((await revoke('szsFirefighter', endpointOf('dvdFirefighter')))[0]!.changed).toBe(false);
      expect((await revoke('szsFirefighter', endpointOf('szsFirefighter')))[0]!.changed).toBe(true);
    });
  });

  // --- the verdict the worker acts on --------------------------------------

  it('answers only the service role, with the caller\'s own privileges', async () => {
    // The verdict, the sweep and the count of what the sweep leaves out.
    for (const fn of ['push_delivery_verdict(uuid)', 'push_delivery_queue(timestamptz,timestamptz)', 'push_delivery_mislabelled(uuid)']) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean; definer: boolean; config: string[] | null; volatility: string }>(
        `select has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
                has_function_privilege('service_role', p.oid, 'execute') as service,
                p.prosecdef as definer, p.proconfig as config, p.provolatile::text as volatility
           from pg_proc p where p.oid = $1::regprocedure`,
        [`public.${fn}`],
      );
      expect(rows[0], fn).toMatchObject({ anon: false, authenticated: false, service: true, definer: false, volatility: 's' });
      expect(rows[0]!.config, fn).toContain('search_path=public, pg_temp');
    }
    await isolated(async () => {
      expect(await act(people.dvdCommander.user, 'select * from public.push_delivery_verdict($1)', [forgedMember])).toBe('DENIED');
      expect(await act(people.dvdCommander.user, 'select * from public.push_delivery_queue(now(), now())')).toBe('DENIED');
      expect(await act(people.dvdCommander.user, 'select public.push_delivery_mislabelled(null)')).toBe('DENIED');
    });
  });

  it('judges every queued alert in the service of its own call-out', async () => {
    await isolated(async () => {
      const verdicts = await rowsAs<{ id: string; verdict: string; user_id: string | null; published_at: string | null }>(
        'service_role',
        `select o.id::text, v.verdict, v.user_id::text, v.published_at::text
           from public.notification_outbox o, public.push_delivery_verdict(o.id) v
          where o.channel = 'WEB_PUSH'`,
      );
      const verdict = new Map(verdicts.map((row) => [row.id, row.verdict]));
      const expected: [Label, string, string][] = [
        ['dvdFirefighter', dvdCallout, 'DELIVER'],
        ['dvdOther', dvdCallout, 'OPENED'],
        ['dvdSuspended', dvdCallout, 'INELIGIBLE'],
        ['dual', dvdCallout, 'DELIVER'],
        ['dualSzsWithdrawn', dvdCallout, 'DELIVER'],
        ['szsFirefighter', szsCallout, 'DELIVER'],
        ['szsOther', szsCallout, 'OPENED'],
        ['szsSuspended', szsCallout, 'INELIGIBLE'],
        ['dual', szsCallout, 'DELIVER'],
        ['dualSzsWithdrawn', szsCallout, 'INELIGIBLE'],
      ];
      for (const [who, callout, answer] of expected) {
        expect(verdict.get(await alertOf(who, callout)), `${who} on the ${callout === dvdCallout ? 'DVD' : 'SZS'} call-out`).toBe(answer);
      }
      expect(verdict.get(forgedMember), 'a DVD member on an SZS call-out').toBe('SERVICE_MISMATCH');
      expect(verdict.get(forgedLabel), 'an SZS call-out filed under DVD').toBe('SERVICE_MISMATCH');
      expect(verdicts).toHaveLength(expected.length + 2);

      // Only a deliverable alert says whose devices to use, and when it was sent.
      for (const row of verdicts) {
        if (row.verdict === 'DELIVER') expect(row.user_id).not.toBeNull();
        else expect([row.user_id, row.published_at], row.verdict).toEqual([null, null]);
      }
      const { rows: published } = await db.query<{ at: string }>(
        `select published_at::text as at from public.interventions where id = $1`,
        [szsCallout],
      );
      const szsAlert = await alertOf('szsFirefighter', szsCallout);
      expect(verdicts.find((row) => row.id === szsAlert)).toMatchObject({
        user_id: people.szsFirefighter.user,
        published_at: published[0]!.at,
      });
    });
  });

  it('answers nothing about a row that is not a queued Web Push alert', async () => {
    await isolated(async () => {
      const { rows: inApp } = await db.query<{ id: string }>(
        `select id::text from public.notification_outbox where channel = 'IN_APP' and member_id = $1`,
        [people.szsFirefighter.szs],
      );
      expect(await rowsAs('service_role', 'select * from public.push_delivery_verdict($1)', [inApp[0]!.id])).toHaveLength(0);
      expect(await rowsAs('service_role', 'select * from public.push_delivery_verdict($1)', [UNKNOWN])).toHaveLength(0);
    });
  });

  it('agrees with is_eligible_recipient_in() for every member and service, in every state', async () => {
    // The verdict repeats that function's conditions because the service role
    // has no user to satisfy its caller bound. They must not drift apart: asked
    // here as the owner, who may ask about either service.
    const compare = async (label: string) => {
      const rows = await rowsAs<{ id: string; verdict: string; member_id: string; organization_id: string }>(
        'service_role',
        `select o.id::text, v.verdict, o.member_id::text, o.organization_id::text
           from public.notification_outbox o, public.push_delivery_verdict(o.id) v
          where o.channel = 'WEB_PUSH' and v.verdict in ('DELIVER', 'INELIGIBLE')`,
      );
      expect(rows.length, label).toBeGreaterThan(5);
      for (const row of rows) {
        const asked = await rowsAs<{ eligible: boolean }>(
          people.owner.user,
          'select public.is_eligible_recipient_in($1, $2) as eligible',
          [row.member_id, row.organization_id],
        );
        expect(row.verdict === 'DELIVER', `${label}: ${row.id}`).toBe(asked[0]!.eligible);
      }
    };
    await isolated(async () => {
      await compare('as built');
      await db.query(`update public.profiles set profile_complete = false where user_id = $1`, [people.szsFirefighter.user]);
      await db.query(`update public.members set active = false where id = $1`, [people.dual.dvd]);
      await db.query(`update public.members set user_id = null where id = $1`, [people.dvdFirefighter.dvd]);
      await compare('profile, member and link withdrawn');
    });
    await isolated(async () => {
      await db.query(`update public.organizations set active = false where id = $1`, [SZS]);
      await compare('SZS itself stood down');
    });
  });

  it('delivers to the owner through a member record, never through ownership', async () => {
    await isolated(async () => {
      // No record: the owner is never a recipient, so nothing is queued for them.
      const { rows: none } = await db.query(
        `select 1 from public.notification_outbox o join public.members m on m.id = o.member_id where m.user_id = $1`,
        [people.owner.user],
      );
      expect(none).toHaveLength(0);

      // With an SZS record the owner is called out, and alerted, like anybody.
      const record = await memberIn(SZS, 'Vlasnik SZS', people.owner.user);
      await db.query(`insert into public.web_push_subscriptions(user_id, endpoint, p256dh, auth_secret) values ($1, $2, $3, $4)`, [
        people.owner.user, endpointOf('owner'), P256DH, AUTH,
      ]);
      const draft = (await rowsAs<{ id: string }>(
        people.szsCommander.user,
        `select public.create_intervention_draft_in($1, 'POZAR', 'SZS vlasnik', 'Upute.', 'Mjesto', 'p4e-owner') as id`,
        [SZS],
      ))[0]!.id;
      await rowsAs(people.szsCommander.user, 'select public.publish_intervention($1, $2)', [draft, [record]]);
      const verdicts = await rowsAs<{ verdict: string; user_id: string }>(
        'service_role',
        `select v.verdict, v.user_id::text from public.notification_outbox o, public.push_delivery_verdict(o.id) v
          where o.intervention_id = $1 and o.channel = 'WEB_PUSH'`,
        [draft],
      );
      expect(verdicts).toEqual([{ verdict: 'DELIVER', user_id: people.owner.user }]);
    });
  });

  // --- what a queued alert is -----------------------------------------------

  it('settles what a queued alert is about when it is written', async () => {
    await isolated(async () => {
      const alert = await alertOf('dvdFirefighter', dvdCallout);
      expect(await raw(`update public.notification_outbox set member_id = $2 where id = $1`, [alert, people.dvdCommander.dvd])).toBe('OUTBOX_IDENTITY_FIXED');
      expect(await raw(`update public.notification_outbox set intervention_id = $2, organization_id = $3 where id = $1`, [alert, szsCallout, SZS])).toBe('OUTBOX_IDENTITY_FIXED');
      expect(await raw(`update public.notification_outbox set channel = 'IN_APP' where id = $1`, [alert])).toBe('OUTBOX_IDENTITY_FIXED');
      expect(await raw(`update public.notification_outbox set dedupe_key = 'p4e-other' where id = $1`, [alert])).toBe('OUTBOX_IDENTITY_FIXED');
      expect(await raw(`update public.notification_outbox set created_at = now() - interval '1 day' where id = $1`, [alert])).toBe('OUTBOX_IDENTITY_FIXED');

      // Its delivery still moves - every write the worker makes.
      expect(await raw(`update public.notification_outbox set state = 'SENT_TO_PROVIDER', attempt_count = 1, updated_at = now() where id = $1`, [alert])).toBe('OK');
      expect(await raw(`update public.notification_outbox set state = 'PROVIDER_ACCEPTED', updated_at = now() where id = $1`, [alert])).toBe('OK');
      expect(await raw(`update public.notification_outbox set delivery_closed_at = now(), delivery_close_reason = 'MEMBER_OPENED' where id = $1`, [alert])).toBe('OK');
      for (const reason of ['SERVICE_MISMATCH', 'NOT_A_RECIPIENT', 'CALLOUT_NOT_OPEN']) {
        expect(await raw(`update public.notification_outbox set delivery_close_reason = $2 where id = $1`, [alert, reason]), reason).toBe('OK');
      }
      expect(await raw(`update public.notification_outbox set delivery_close_reason = 'BECAUSE_I_SAID_SO' where id = $1`, [alert])).toMatch(/check constraint|violates/);
    });
  });

  it('keeps the delivery history as it was written, labelled by its alert', async () => {
    await isolated(async () => {
      const alert = await alertOf('szsFirefighter', szsCallout);
      const { rows } = await db.query<{ id: string; organization_id: string }>(
        `insert into public.notification_delivery_attempts(outbox_id, provider, provider_status)
         values ($1, 'WEB_PUSH', 'ACCEPTED_IMMEDIATE') returning id, organization_id::text`,
        [alert],
      );
      expect(rows[0]!.organization_id).toBe(SZS);
      const attempt = rows[0]!.id;
      expect(await raw(`update public.notification_delivery_attempts set outbox_id = $2 where id = $1`, [attempt, await alertOf('dual', szsCallout)])).toBe('DELIVERY_HISTORY_APPEND_ONLY');
      expect(await raw(`update public.notification_delivery_attempts set provider_status = 'HTTP_410' where id = $1`, [attempt])).toBe('DELIVERY_HISTORY_APPEND_ONLY');
      // Removing a call-out still takes its alerts and their history with it.
      expect(await raw(`delete from public.interventions where id = $1`, [szsCallout])).toBe('OK');
      const { rows: left } = await db.query(`select 1 from public.notification_delivery_attempts where id = $1`, [attempt]);
      expect(left).toHaveLength(0);
    });
  });

  // --- the worker, as the service role -------------------------------------

  it('alerts each member in the service that called them out, and sets the rest aside', async () => {
    await resetQueue();
    const push = fakePush();
    const tally = await deliverQueued({ service, send: push.send, scheduler: true });

    const alerted = push.sent.map((s) => `${s.endpoint.replace(endpointOf(''), '')}@${s.payload.interventionId === dvdCallout ? 'DVD' : 'SZS'}`).sort();
    expect(alerted).toEqual(
      ['dvdFirefighter@DVD', 'dual@DVD', 'dualSzsWithdrawn@DVD', 'szsFirefighter@SZS', 'dual@SZS'].sort(),
    );
    // Five sent; three refused; two already opened and one set aside. The row
    // that can be neither sent nor set aside is not handed to the worker at all
    // - see "behind rows nobody can close" below - and is counted instead.
    expect(tally).toEqual({ accepted: 5, rejected: 3, skipped: 3, failed: 0, mislabelled: 1 });

    expect(await stateOf(await alertOf('szsFirefighter', szsCallout))).toEqual({
      state: 'PROVIDER_ACCEPTED', attempt_count: 1, delivery_close_reason: null, attempts: 'ACCEPTED_SCHEDULED',
    });
    for (const [who, callout] of [['dvdSuspended', dvdCallout], ['szsSuspended', szsCallout], ['dualSzsWithdrawn', szsCallout]] as const) {
      expect(await stateOf(await alertOf(who, callout)), who).toEqual({
        state: 'FAILED', attempt_count: 1, delivery_close_reason: null, attempts: 'ACCESS_REVOKED',
      });
    }
    for (const [who, callout] of [['dvdOther', dvdCallout], ['szsOther', szsCallout]] as const) {
      expect(await stateOf(await alertOf(who, callout)), who).toEqual({
        state: 'QUEUED', attempt_count: 0, delivery_close_reason: 'MEMBER_OPENED', attempts: '',
      });
    }
    // Set aside without an attempt: nothing was tried, and nothing counts against it.
    expect(await stateOf(forgedMember)).toEqual({ state: 'QUEUED', attempt_count: 0, delivery_close_reason: 'SERVICE_MISMATCH', attempts: '' });
    // P2's trigger refuses every update of a row whose label contradicts its
    // call-out, the worker's close included. It stays exactly as it was: unsent,
    // and counted on every run so whoever reads the worker's answer sees it.
    expect(await stateOf(forgedLabel)).toEqual({ state: 'QUEUED', attempt_count: 0, delivery_close_reason: null, attempts: '' });
    const again = fakePush();
    expect(await deliverQueued({ service, send: again.send, scheduler: true })).toMatchObject({ failed: 0, mislabelled: 1 });
    expect(again.sent).toHaveLength(0);
  });

  it('sends a locked screen nothing but which call-out, when, and whether it is the repeat', async () => {
    await resetQueue();
    const push = fakePush();
    await deliverQueued({ service, send: push.send, scheduler: false });
    const { rows } = await db.query<{ id: string; at: string }>(
      // Milliseconds, truncated as Date.parse truncates the microseconds.
      `select id::text, floor(extract(epoch from published_at) * 1000)::bigint::text as at
         from public.interventions where id in ($1, $2)`,
      [dvdCallout, szsCallout],
    );
    const publishedAt = new Map(rows.map((row) => [row.id, Number(row.at)]));
    expect(push.sent.length).toBeGreaterThan(0);
    for (const sent of push.sent) {
      expect(Object.keys(sent.payload).sort()).toEqual(['interventionId', 'publishedAt', 'repeat']);
      expect(sent.payload.repeat).toBe(false);
      expect(sent.payload.publishedAt).toBe(publishedAt.get(String(sent.payload.interventionId)));
      expect(sent.options).toEqual({ TTL: 180, urgency: 'high', topic: `dvd-${String(sent.payload.interventionId).slice(0, 20)}` });
    }
  });

  it('repeats an unanswered alert once, after ninety seconds, and never again', async () => {
    await resetQueue();
    const start = Date.now();
    const at = (seconds: number) => () => start + seconds * 1000;

    const first = fakePush();
    await deliverQueued({ service, send: first.send, scheduler: false, now: at(0) });
    expect(first.sent).toHaveLength(5);

    const early = fakePush();
    await deliverQueued({ service, send: early.send, scheduler: true, now: at(1) });
    expect(early.sent, 'nothing is repeated a second later').toHaveLength(0);

    const repeat = fakePush();
    await deliverQueued({ service, send: repeat.send, scheduler: true, now: at(91) });
    expect(repeat.sent.map((s) => s.endpoint).sort()).toEqual(first.sent.map((s) => s.endpoint).sort());
    expect(repeat.sent.every((s) => s.payload.repeat === true)).toBe(true);
    expect(await stateOf(await alertOf('szsFirefighter', szsCallout))).toEqual({
      state: 'PROVIDER_ACCEPTED', attempt_count: 2, delivery_close_reason: null, attempts: 'ACCEPTED_IMMEDIATE,ACCEPTED_SCHEDULED',
    });

    const third = fakePush();
    await deliverQueued({ service, send: third.send, scheduler: true, now: at(182) });
    expect(third.sent, 'the initial alert and one repeat, never a third').toHaveLength(0);
  });

  it('sends each alert once when two workers race for the same queue', async () => {
    await resetQueue();
    const other = postgrest({ role: 'service_role' });
    try {
      const push = fakePush();
      const now = Date.now();
      await Promise.all([
        deliverQueued({ service, send: push.send, scheduler: true, now: () => now }),
        deliverQueued({ service: other, send: push.send, scheduler: false, now: () => now }),
      ]);
      const perAlert = push.sent.map((s) => `${s.endpoint}@${String(s.payload.interventionId)}`);
      expect(perAlert).toHaveLength(5);
      expect(new Set(perAlert).size).toBe(5);
    } finally {
      await other.end();
    }
  });

  it('forgets a device the push service says is gone, and records only a status', async () => {
    await resetQueue();
    const push = fakePush({ [endpointOf('szsFirefighter')]: 410 });
    await deliverQueued({ service, send: push.send, scheduler: true });
    expect(await stateOf(await alertOf('szsFirefighter', szsCallout))).toEqual({
      state: 'PROVIDER_REJECTED', attempt_count: 1, delivery_close_reason: null, attempts: 'HTTP_410',
    });
    const { rows } = await db.query<{ revoked: boolean }>(
      `select revoked_at is not null as revoked from public.web_push_subscriptions where endpoint = $1`,
      [endpointOf('szsFirefighter')],
    );
    expect(rows[0]!.revoked).toBe(true);
  });

  // --- only somebody the call-out was published to --------------------------

  describe('an alert for a member the call-out was never published to', () => {
    /**
     * A commander in each service: in the call-out's service, somebody that
     * service may call out, holding a device - and not on the call-out's
     * frozen recipient list. `notification_outbox` has one foreign key to the
     * call-out and another to the member; nothing ties the pair to a recipient.
     * No command writes such a row. The service role or a superuser can: a bug,
     * a hand-run repair, an import.
     */
    const strays = new Map<string, Label>();
    const STRAYS = [['dvdCommander', DVD], ['szsCommander', SZS]] as const;

    beforeAll(async () => {
      for (const [who, inService] of STRAYS) {
        await db.query(
          `insert into public.web_push_subscriptions(user_id, endpoint, p256dh, auth_secret) values ($1, $2, $3, $4)`,
          [people[who].user, endpointOf(who), P256DH, AUTH],
        );
        const { rows } = await db.query<{ id: string }>(
          `insert into public.notification_outbox(intervention_id, member_id, channel, dedupe_key)
           values ($1, $2, 'WEB_PUSH', $3) returning id::text`,
          [inService === DVD ? dvdCallout : szsCallout, inService === DVD ? people[who].dvd : people[who].szs, `p4e-stray-${who}`],
        );
        strays.set(rows[0]!.id, who);
      }
    });

    afterAll(async () => {
      await db.query(`delete from public.notification_outbox where id = any($1::uuid[])`, [[...strays.keys()]]);
      await db.query(`delete from public.web_push_subscriptions where endpoint = any($1)`, [STRAYS.map(([who]) => endpointOf(who))]);
    });

    it('is about somebody eligible, in the call-out\'s service, with a device - only the recipient row is missing', async () => {
      await isolated(async () => {
        for (const [who, inService] of STRAYS) {
          const member = inService === DVD ? people[who].dvd : people[who].szs;
          const callout = inService === DVD ? dvdCallout : szsCallout;
          const eligible = await rowsAs<{ answer: boolean }>(people.owner.user, 'select public.is_eligible_recipient_in($1, $2) as answer', [member, inService]);
          const { rows: recipient } = await db.query(
            `select 1 from public.intervention_recipients where intervention_id = $1 and member_id = $2`,
            [callout, member],
          );
          const { rows: label } = await db.query<{ same: boolean }>(
            `select o.organization_id = c.organization_id and o.organization_id = m.organization_id as same
               from public.notification_outbox o
               join public.interventions c on c.id = o.intervention_id
               join public.members m on m.id = o.member_id
              where o.dedupe_key = $1`,
            [`p4e-stray-${who}`],
          );
          expect({ eligible: eligible[0]!.answer, recipients: recipient.length, oneService: label[0]!.same }, who).toEqual({
            eligible: true, recipients: 0, oneService: true,
          });
        }
      });
    });

    it('is NOT_A_RECIPIENT to the worker, read from the stored recipient list', async () => {
      const verdicts = await isolated(() =>
        rowsAs<{ id: string; verdict: string; user_id: string | null }>(
          'service_role',
          `select s.id::text, v.verdict, v.user_id::text from unnest($1::uuid[]) as s(id), public.push_delivery_verdict(s.id) v`,
          [[...strays.keys()]],
        ));
      expect(verdicts.map((row) => `${strays.get(row.id)}: ${row.verdict} ${row.user_id === null ? 'no account' : 'an account'}`).sort()).toEqual([
        'dvdCommander: NOT_A_RECIPIENT no account',
        'szsCommander: NOT_A_RECIPIENT no account',
      ]);
    });

    it('is not made a recipient by a list entry filed under another service', async () => {
      await isolated(async () => {
        // Only with the triggers off: P2 files a recipient under its call-out's service.
        await db.query('set local session_replication_role = replica');
        await db.query(
          `insert into public.intervention_recipients(intervention_id, member_id, recipient_version, member_name_at_publication, organization_id)
           values ($1, $2, 1, 'dvdCommander Clan', $3)`,
          [dvdCallout, people.dvdCommander.dvd, SZS],
        );
        await db.query('set local session_replication_role = origin');
        const stray = [...strays].find(([, who]) => who === 'dvdCommander')![0];
        expect(await rowsAs('service_role', 'select verdict from public.push_delivery_verdict($1)', [stray])).toEqual([{ verdict: 'NOT_A_RECIPIENT' }]);
        // Filed where it belongs, the same entry does make them one.
        await db.query(`update public.intervention_recipients set organization_id = $3 where intervention_id = $1 and member_id = $2`, [
          dvdCallout, people.dvdCommander.dvd, DVD,
        ]);
        expect(await rowsAs('service_role', 'select verdict from public.push_delivery_verdict($1)', [stray])).toEqual([{ verdict: 'DELIVER' }]);
      });
    });

    it('reaches none of their devices, and is set aside, while the call-out\'s recipients are alerted as before', async () => {
      await resetQueue();
      const push = fakePush();
      await deliverQueued({ service, send: push.send, scheduler: true });
      expect(sentTo(push.sent)).toEqual([...FIXTURE_ALERTED].sort());
      for (const [id, who] of strays) {
        // Closed without an attempt: nothing was tried. Its own reason, so
        // whoever finds it knows the row was never a recipient's.
        expect(await stateOf(id), who).toEqual({ state: 'QUEUED', attempt_count: 0, delivery_close_reason: 'NOT_A_RECIPIENT', attempts: '' });
      }
    });
  });

  // --- only while the call-out is running ------------------------------------

  describe('an alert whose call-out is no longer running', () => {
    /**
     * Published through the real commands to one member of its own service,
     * then - before any worker reaches its alert - closed or cancelled through
     * `close_intervention`, which changes the call-out and nothing queued under
     * it. Two call-outs are left running, in a status other than PUBLISHED.
     */
    const made = new Map<string, string>();
    const CASES = [
      ['DVD', 'dvdFirefighter', 'CLOSED'],
      ['DVD', 'dual', 'CANCELLED'],
      ['SZS', 'szsFirefighter', 'CANCELLED'],
      ['SZS', 'dual', 'CLOSED'],
      ['DVD', 'dvdFirefighter', 'ASSEMBLING'],
      ['SZS', 'szsFirefighter', 'CONTAINED'],
    ] as const;
    const commanderOf = (inService: 'DVD' | 'SZS') => people[inService === 'DVD' ? 'dvdCommander' : 'szsCommander'].user;

    async function publishedTo(inService: 'DVD' | 'SZS', who: Label, key: string): Promise<string> {
      const callout = await committed(
        commanderOf(inService),
        `select public.create_intervention_draft_in($1, 'POZAR', 'P4e poziv', 'Okupljanje.', 'Poligon', $2)`,
        [inService === 'DVD' ? DVD : SZS, key],
      );
      await committed(commanderOf(inService), 'select public.publish_intervention($1, $2)', [
        callout,
        [inService === 'DVD' ? people[who].dvd : people[who].szs],
      ]);
      return callout;
    }
    const endCallout = (inService: 'DVD' | 'SZS', callout: string, status: 'CLOSED' | 'CANCELLED') =>
      committed(commanderOf(inService), `select public.close_intervention($1, $2, 'P4e: zavrseno prije slanja')`, [callout, status]);
    const alertOn = async (callout: string) =>
      (await db.query<{ id: string }>(`select id::text from public.notification_outbox where intervention_id = $1 and channel = 'WEB_PUSH'`, [callout])).rows[0]!.id;

    beforeAll(async () => {
      // Publication queues a Web Push alert only for a live device.
      await resetQueue();
      for (const [inService, who, status] of CASES) {
        const callout = await publishedTo(inService, who, `p4e-${inService}-${status}`.toLowerCase());
        made.set(callout, `${inService}-${status}`);
        if (status === 'CLOSED' || status === 'CANCELLED') await endCallout(inService, callout, status);
        else await committed(commanderOf(inService), 'select public.set_intervention_status($1, $2, null)', [callout, status]);
      }
    }, 60_000);

    afterAll(async () => {
      await db.query(`delete from public.interventions where id = any($1::uuid[])`, [[...made.keys()]]);
    });

    it('was published, queued and then ended, with the alert still waiting', async () => {
      const { rows } = await db.query<{ callout: string; status: string; recipients: number; waiting: number }>(
        `select c.id::text as callout, c.status,
                (select count(*)::int from public.intervention_recipients r where r.intervention_id = c.id) as recipients,
                (select count(*)::int from public.notification_outbox o
                  where o.intervention_id = c.id and o.channel = 'WEB_PUSH' and o.state = 'QUEUED' and o.delivery_closed_at is null) as waiting
           from public.interventions c where c.id = any($1::uuid[])`,
        [[...made.keys()]],
      );
      expect(rows.map((row) => `${made.get(row.callout)}: ${row.status} ${row.recipients} ${row.waiting}`).sort()).toEqual([
        'DVD-ASSEMBLING: ASSEMBLING 1 1',
        'DVD-CANCELLED: CANCELLED 1 1',
        'DVD-CLOSED: CLOSED 1 1',
        'SZS-CANCELLED: CANCELLED 1 1',
        'SZS-CLOSED: CLOSED 1 1',
        'SZS-CONTAINED: CONTAINED 1 1',
      ]);
    });

    it('is CALLOUT_NOT_OPEN to the worker once closed or cancelled, and DELIVER while it runs', async () => {
      const verdicts = await isolated(() =>
        rowsAs<{ callout: string; verdict: string }>(
          'service_role',
          `select o.intervention_id::text as callout, v.verdict
             from public.notification_outbox o, public.push_delivery_verdict(o.id) v
            where o.intervention_id = any($1::uuid[]) and o.channel = 'WEB_PUSH'`,
          [[...made.keys()]],
        ));
      expect(verdicts.map((row) => `${made.get(row.callout)}: ${row.verdict}`).sort()).toEqual([
        'DVD-ASSEMBLING: DELIVER',
        'DVD-CANCELLED: CALLOUT_NOT_OPEN',
        'DVD-CLOSED: CALLOUT_NOT_OPEN',
        'SZS-CANCELLED: CALLOUT_NOT_OPEN',
        'SZS-CLOSED: CALLOUT_NOT_OPEN',
        'SZS-CONTAINED: DELIVER',
      ]);
    });

    it('sends nothing for it - on a commander\'s wake-up or on the scheduler - and still alerts for running ones', async () => {
      await resetQueue();
      // The wake-up names the call-out; the stored call-out decides.
      const woken = fakePush();
      for (const [callout, label] of made) {
        if (/CLOSED|CANCELLED/.test(label)) await deliverQueued({ service, send: woken.send, scheduler: false }, callout);
      }
      expect(sentTo(woken.sent, made), 'woken').toEqual([]);

      const push = fakePush();
      await deliverQueued({ service, send: push.send, scheduler: true });
      expect(sentTo(push.sent, made), 'scheduled').toEqual(
        [...FIXTURE_ALERTED, 'dvdFirefighter@DVD-ASSEMBLING', 'szsFirefighter@SZS-CONTAINED'].sort(),
      );
      for (const [callout, label] of made) {
        if (!/CLOSED|CANCELLED/.test(label)) continue;
        // Set aside without an attempt, with its own reason.
        expect(await stateOf(await alertOn(callout)), label).toEqual({
          state: 'QUEUED', attempt_count: 0, delivery_close_reason: 'CALLOUT_NOT_OPEN', attempts: '',
        });
      }
    });

    it('sends no repeat once the call-out it alerted about has ended', async () => {
      await resetQueue();
      const start = Date.now();
      const at = (seconds: number) => () => start + seconds * 1000;
      for (const status of ['CLOSED', 'CANCELLED'] as const) {
        const callout = await publishedTo('DVD', 'dvdFirefighter', `p4e-repeat-${status}`.toLowerCase());
        made.set(callout, `DVD-${status}-AFTER-ALERT`);
        const first = fakePush();
        await deliverQueued({ service, send: first.send, scheduler: false, now: at(0) }, callout);
        expect(sentTo(first.sent, made), status).toEqual([`dvdFirefighter@DVD-${status}-AFTER-ALERT`]);

        await endCallout('DVD', callout, status);
        const later = fakePush();
        await deliverQueued({ service, send: later.send, scheduler: true, now: at(91) });
        expect(sentTo(later.sent, made).filter((entry) => entry.endsWith('-AFTER-ALERT')), status).toEqual([]);
        // The alert that did go out stays on record; the repeat is closed, unsent.
        expect(await stateOf(await alertOn(callout)), status).toEqual({
          state: 'PROVIDER_ACCEPTED', attempt_count: 1, delivery_close_reason: 'CALLOUT_NOT_OPEN', attempts: 'ACCEPTED_IMMEDIATE',
        });
      }
    });
  });

  // --- behind rows nobody can close -----------------------------------------

  describe('behind fifty alerts nobody can close', () => {
    /**
     * Fifty alerts labelled DVD on the SZS call-out, older than every real one,
     * written with the triggers off - as only a superuser can. P2's trigger
     * refuses any later update of such a row, so the worker can neither send
     * nor set one aside. The worker's sweep is the fifty oldest open alerts:
     * with these at the front, that is all it ever sees.
     */
    const BROKEN = 50;
    let broken: string[] = [];

    beforeAll(async () => {
      await db.query('begin');
      await db.query('set local session_replication_role = replica');
      const { rows } = await db.query<{ id: string }>(
        `insert into public.notification_outbox(intervention_id, member_id, channel, dedupe_key, organization_id, created_at, updated_at)
         select $1, $2, 'WEB_PUSH', 'p4e-broken-' || n, $3, now() - interval '1 day' + n * interval '1 second', now() - interval '1 day'
           from generate_series(1, ${BROKEN}) as n
         returning id::text`,
        [szsCallout, people.szsCommander.szs, DVD],
      );
      await db.query('commit');
      broken = rows.map((row) => row.id);
    });

    afterAll(async () => {
      await db.query(`delete from public.notification_outbox where id = any($1::uuid[])`, [broken]);
    });

    it('still reaches every valid alert, run after run', async () => {
      await resetQueue();
      const start = Date.now();
      const runs: { sent: string[]; tally: Record<string, unknown> }[] = [];
      for (const minute of [0, 1, 2]) {
        const push = fakePush();
        const tally = await deliverQueued({ service, send: push.send, scheduler: true, now: () => start + minute * 60_000 });
        runs.push({ sent: sentTo(push.sent), tally: { ...tally } });
      }
      // The first alerts, nothing while they are held, then the one repeat.
      expect(runs.map((run) => run.sent), JSON.stringify(runs.map((run) => run.tally))).toEqual([
        [...FIXTURE_ALERTED].sort(), [], [...FIXTURE_ALERTED].sort(),
      ]);
    });

    it('still reaches a call-out\'s alerts when its commander wakes it', async () => {
      await resetQueue();
      const push = fakePush();
      const tally = await deliverQueued({ service, send: push.send, scheduler: false }, szsCallout);
      expect(sentTo(push.sent), JSON.stringify(tally)).toEqual(['dual@SZS', 'szsFirefighter@SZS']);
    });

    it('leaves them exactly as they are, never judges them deliverable, and counts them on every run', async () => {
      await resetQueue();
      const counted = [
        await deliverQueued({ service, send: fakePush().send, scheduler: true }),
        await deliverQueued({ service, send: fakePush().send, scheduler: false }, szsCallout),
        await deliverQueued({ service, send: fakePush().send, scheduler: false }, dvdCallout),
      ].map((tally) => tally.mislabelled);
      // Every such row, the fixture's own included; for a call-out, only its own -
      // a DVD commander's wake-up says nothing about the SZS call-out's rows.
      expect(counted).toEqual([BROKEN + 1, BROKEN + 1, 0]);

      const { rows } = await db.query<{ untouched: number }>(
        `select count(*)::int as untouched
           from public.notification_outbox o join public.interventions c on c.id = o.intervention_id
          where o.id = any($1::uuid[]) and o.organization_id = $2 and c.organization_id = $3
            and o.state = 'QUEUED' and o.attempt_count = 0 and o.delivery_closed_at is null
            and not exists (select 1 from public.notification_delivery_attempts a where a.outbox_id = o.id)`,
        [broken, DVD, SZS],
      );
      expect(rows[0]!.untouched).toBe(BROKEN);

      await isolated(async () => {
        const verdicts = await rowsAs<{ verdict: string }>(
          'service_role',
          `select v.verdict from unnest($1::uuid[]) as s(id), public.push_delivery_verdict(s.id) v`,
          [broken],
        );
        expect(new Set(verdicts.map((row) => row.verdict))).toEqual(new Set(['SERVICE_MISMATCH']));
        // The organisation rule is exactly as strict as it was: nobody but a
        // superuser with the triggers off can touch these rows.
        expect(
          await raw(
            `update public.notification_outbox set delivery_closed_at = now(), delivery_close_reason = 'SERVICE_MISMATCH' where id = $1`,
            [broken[0]],
          ),
        ).toBe('ORGANIZATION_MISMATCH');
      });
    });
  });

  // --- behind alerts that are not due yet -------------------------------------

  describe('behind fifty alerts waiting out their repeat', () => {
    /**
     * Fifty alerts on the DVD call-out, all to one of its recipients, older than
     * anything the fixture queued: the push service accepted each thirty
     * seconds ago, so each waits another minute for its one repeat. The sweep
     * is the fifty oldest open alerts - and whether an alert is due was asked
     * only after the fifty had been read.
     */
    const HELD = 50;
    let held: string[] = [];

    /** `ids` accepted by the push service at `at`, plus `micros` microseconds the worker's clock cannot see. */
    async function acceptedAt(ids: readonly string[], at: number, micros = 0): Promise<void> {
      await db.query(
        `update public.notification_outbox
            set state = 'PROVIDER_ACCEPTED', attempt_count = 1, delivery_closed_at = null, delivery_close_reason = null,
                updated_at = $2::timestamptz + make_interval(secs => $3::double precision / 1000000)
          where id = any($1::uuid[])`,
        [ids, new Date(at).toISOString(), micros],
      );
    }

    /** How many of `ids` are exactly as `acceptedAt` left them: not repeated, not claimed, no attempt. */
    const untouched = async (ids: readonly string[], at: number) =>
      (await db.query<{ n: number }>(
        `select count(*)::int as n from public.notification_outbox o
          where o.id = any($1::uuid[]) and o.state = 'PROVIDER_ACCEPTED' and o.attempt_count = 1
            and o.updated_at = $2::timestamptz and o.delivery_closed_at is null
            and not exists (select 1 from public.notification_delivery_attempts a where a.outbox_id = o.id)`,
        [ids, new Date(at).toISOString()],
      )).rows[0]!.n;

    beforeAll(async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.notification_outbox(intervention_id, member_id, channel, dedupe_key, created_at)
         select $1, $2, 'WEB_PUSH', 'p4e-held-' || n, now() - interval '1 day' + n * interval '1 second'
           from generate_series(1, ${HELD}) as n
         returning id::text`,
        [dvdCallout, people.dvdFirefighter.dvd],
      );
      held = rows.map((row) => row.id);
    });

    afterAll(async () => {
      await db.query(`delete from public.notification_outbox where id = any($1::uuid[])`, [held]);
    });

    it('sends newly queued alerts at once on the scheduler, and leaves the fifty to their hold', async () => {
      await resetQueue();
      const now = Date.now();
      await acceptedAt(held, now - 30_000);
      const push = fakePush();
      const tally = await deliverQueued({ service, send: push.send, scheduler: true, now: () => now });
      expect(sentTo(push.sent), JSON.stringify(tally)).toEqual([...FIXTURE_ALERTED].sort());
      // Exactly the run there would be without them: they are not in the sweep at all.
      expect(tally).toEqual({ accepted: 5, rejected: 3, skipped: 3, failed: 0, mislabelled: 1 });
      expect(await untouched(held, now - 30_000), 'none repeated early').toBe(HELD);
    });

    it('sends a call-out\'s newly queued alerts at once when its commander wakes it, behind fifty of its own', async () => {
      await resetQueue();
      const now = Date.now();
      await acceptedAt(held, now - 30_000);
      const push = fakePush();
      const tally = await deliverQueued({ service, send: push.send, scheduler: false, now: () => now }, dvdCallout);
      expect(sentTo(push.sent), JSON.stringify(tally)).toEqual(['dual@DVD', 'dualSzsWithdrawn@DVD', 'dvdFirefighter@DVD']);
      expect(await untouched(held, now - 30_000), 'none repeated early').toBe(HELD);
    });

    it('ends both holds on the worker\'s own clock, to the millisecond, as it always has', async () => {
      await resetQueue();
      const now = Date.now();
      // Ten waiting for their repeat, accepted at `now - 30 s` and 999 microseconds:
      // the worker reads a stored time to the millisecond, so their hold ends at
      // `now + 60 s` exactly. The other forty are out of the way.
      const waiting = held.slice(0, 10);
      await acceptedAt(waiting, now - 30_000, 999);
      await db.query(`update public.notification_outbox set state = 'FAILED' where id = any($1::uuid[])`, [held.slice(10)]);
      // And one alert a worker claimed and never finished, at `now + 30 s` and 999
      // microseconds: presumed dead, and taken over, at `now + 60 s` exactly too.
      await db.query(
        `update public.notification_outbox
            set state = 'SENT_TO_PROVIDER', attempt_count = 1, updated_at = $2::timestamptz + interval '999 microseconds'
          where id = $1`,
        [await alertOf('szsFirefighter', szsCallout), new Date(now + 30_000).toISOString()],
      );
      const edge = now + 60_000;

      const early = fakePush();
      await deliverQueued({ service, send: early.send, scheduler: true, now: () => edge - 1 });
      const onTime = fakePush();
      await deliverQueued({ service, send: onTime.send, scheduler: true, now: () => edge });

      const count = (sent: readonly Sent[]) => ({
        repeats: sent.filter((s) => s.payload.repeat === true).length,
        takenOver: sent.filter((s) => s.endpoint === endpointOf('szsFirefighter')).length,
      });
      expect(count(early.sent), 'a millisecond before').toEqual({ repeats: 0, takenOver: 0 });
      expect(count(onTime.sent), 'on the millisecond').toEqual({ repeats: waiting.length, takenOver: 1 });
    });
  });

  // --- the immediate wake-up -----------------------------------------------

  it('lets a commander wake the delivery of their own service\'s call-out and no other', async () => {
    const wake = (who: Label, id: string | undefined) => authoriseWake(service, callerFor(who), id);

    expect(await wake('dvdCommander', dvdCallout)).toBe('ALLOWED');
    expect(await wake('dvdCommander', szsCallout)).toBe('COMMAND_REQUIRED');
    expect(await wake('szsCommander', szsCallout)).toBe('ALLOWED');
    expect(await wake('szsCommander', dvdCallout)).toBe('COMMAND_REQUIRED');
    // The owner commands both services.
    expect(await wake('owner', dvdCallout)).toBe('ALLOWED');
    expect(await wake('owner', szsCallout)).toBe('ALLOWED');
    // An id that is nobody's reads exactly like one that is not yours.
    expect(await wake('dvdCommander', UNKNOWN)).toBe('COMMAND_REQUIRED');
    // A commander must still name the call-out; anybody else is refused first.
    expect(await wake('szsCommander', undefined)).toBe('INTERVENTION_ID_REQUIRED');
    expect(await wake('dvdCommander', undefined)).toBe('INTERVENTION_ID_REQUIRED');
    for (const who of ['dual', 'dvdFirefighter', 'szsFirefighter', 'citizen', 'szsSuspended'] as const) {
      expect(await wake(who, szsCallout), who).toBe('COMMAND_REQUIRED');
      expect(await wake(who, undefined), who).toBe('COMMAND_REQUIRED');
    }
  });

  it('wakes only the call-out it was asked about', async () => {
    await resetQueue();
    const push = fakePush();
    await deliverQueued({ service, send: push.send, scheduler: false }, szsCallout);
    expect(push.sent.map((s) => String(s.payload.interventionId))).toEqual([szsCallout, szsCallout]);
    expect(await stateOf(await alertOf('dvdFirefighter', dvdCallout))).toMatchObject({ state: 'QUEUED', attempt_count: 0 });
  });

  // --- asked of the catalogue ----------------------------------------------

  it('leaves no DVD-only question on devices, their policy or their writers', async () => {
    const DVD_ONLY = String.raw`is_dvd_(staff|command|admin|owner)\(\)|current_dvd_role\(\)|current_member_id\(\)|is_eligible_recipient\(`;
    const { rows: functions } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosrc ~ '\\mweb_push_subscriptions\\M' and p.prosrc ~ $1 order by 1`,
      [DVD_ONLY],
    );
    expect(functions.map((row) => row.proname)).toEqual([]);
    const { rows: policies } = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public' and tablename in ('web_push_subscriptions', 'notification_outbox', 'notification_delivery_attempts')
          and (coalesce(qual, '') ~ $1 or coalesce(with_check, '') ~ $1)`,
      [DVD_ONLY],
    );
    expect(policies.map((row) => row.policyname)).toEqual([]);
  });
});
