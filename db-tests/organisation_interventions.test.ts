/**
 * A call-out belongs to the service that ran it.
 *
 * P4b of docs/MULTI_ORG_PLAN.md: the six read policies over `interventions`,
 * `intervention_recipients`, `intervention_updates` and
 * `intervention_acknowledgements`, and the eight `security definer` commands
 * that drive them - draft, update, discard, publish, status, close,
 * acknowledge, and the `is_recipient_of` predicate three of those policies are
 * written in terms of.
 *
 * ---------------------------------------------------------------------------
 * The two shapes of the defect
 * ---------------------------------------------------------------------------
 *
 * Every policy and every command asks `is_dvd_command()` or `is_dvd_staff()`,
 * and after P2 there are two services. That produces a leak in one direction
 * and a wall in the other, and they are the same bug seen from two sides:
 *
 *   a DVD commander    reads and can act on SZS call-outs, because nothing
 *                      asks which service the intervention belongs to
 *   an SZS commander   can do nothing at all, not even run their own service's
 *                      call-out, because the only question asked is about DVD
 *
 * The first is a leak of operational data - where a fire is, who was sent, who
 * has seen the message. The second is why P4b exists at all.
 *
 * ---------------------------------------------------------------------------
 * Why the policies are again only half of it
 * ---------------------------------------------------------------------------
 *
 * All four tables are `enable row level security` WITHOUT `force`, and all
 * eight commands are `security definer` owned by `postgres`, which bypasses
 * those policies. This is the same division P4a found in the registry, and the
 * same answer: an EDIT reads its service from the stored intervention and takes
 * no service parameter, so there is nothing to forge; a CREATE has no row yet,
 * so it is told, through a separate `*_in` command with the original kept as a
 * DVD wrapper.
 *
 * The signatures matter more here than they did in P4a.
 * `202609130006a_restore_exact_repository_function_text.sql` re-creates
 * `create_intervention_draft`, `update_intervention_draft`,
 * `discard_intervention_draft` and `acknowledge_intervention` at their old
 * text. A changed signature would leave two definitions coexisting as an
 * ambiguous overload the moment that file replays out of order, and the older
 * of the two would be the insecure one.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, asUser, connect, createAccount } from './harness';

const INTERVENTIONS = 'supabase/migrations/202609250027_organisation_interventions.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

/**
 * The four tables this phase owns, plus the audit its writers fill.
 *
 * `operational_audit` is listed under P4f, and is here for the reason
 * `registry_audit` ended up in P4a: P4b is what starts putting SZS rows in it,
 * so P4b is what makes it leak.
 */
const TABLES = [
  { table: 'interventions', id: 'id::text', read: 'command' },
  { table: 'intervention_recipients', id: `intervention_id::text || ':' || member_id::text`, read: 'command' },
  { table: 'intervention_updates', id: 'id::text', read: 'command' },
  { table: 'intervention_acknowledgements', id: `intervention_id::text || ':' || member_id::text`, read: 'command' },
  { table: 'operational_audit', id: 'id::text', read: 'command' },
] as const;

interface Row {
  id: string;
  organization: string;
}

interface ServiceCallout {
  interventionId: string;
  memberId: string;
  commanderMemberId: string;
}

let db: Client;

let ownerUser = '';
let dvdCommander = '';
let dvdFirefighter = '';
let szsCommander = '';
let szsFirefighter = '';
let dualUser = '';
let suspendedUser = '';
let incompleteUser = '';

let dvd: ServiceCallout;
let szs: ServiceCallout;

const visibleBefore = new Map<string, Row[]>();
const commandsBefore = new Map<string, string>();

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });
const isRefusal = (value: string) => /^[A-Z][A-Z_]{4,}/.test(value);

/**
 * Runs one statement as `userId` INSIDE the caller's open transaction.
 *
 * Savepoints rather than a nested transaction, for the two reasons P4a's file
 * records: a nested `begin` is a no-op whose `rollback` discards the caller's
 * work, and a refusal aborts the transaction so every later probe would report
 * "current transaction is aborted" instead of its own answer.
 */
async function act(userId: string, statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint act');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(userId)]);
    await db.query('set local role authenticated');
    const { rows } = await db.query(statement, params);
    await db.query('reset role');
    await db.query('release savepoint act');
    // A `returns void` command comes back as an empty string here, not null, so
    // a query whose own result may legitimately be empty needs a sentinel.
    const value = rows.length === 1 ? Object.values(rows[0] as object)[0] : null;
    return value === null || value === undefined || value === '' ? 'OK' : String(value);
  } catch (error) {
    await db.query('rollback to savepoint act');
    await db.query('reset role');
    return (error as Error).message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
  }
}

/** As `act`, but in a transaction of its own that is always rolled back. */
async function probe(userId: string, statement: string, params: unknown[] = []): Promise<string> {
  await db.query('begin');
  try {
    return await act(userId, statement, params);
  } finally {
    await db.query('rollback');
  }
}

async function visible(userId: string, table: string, idExpression: string): Promise<Row[]> {
  return asUser(db, userId, async (client) => {
    const { rows } = await client.query<{ id: string; organization: string }>(
      `select ${idExpression} as id, organization_id::text as organization
         from public.${table} order by 1`,
    );
    return rows;
  });
}

const ACCOUNTS = [
  { label: 'owner', commandIn: [DVD, SZS], staffIn: [DVD, SZS] },
  { label: 'dvdCommander', commandIn: [DVD], staffIn: [DVD] },
  { label: 'dvdFirefighter', commandIn: [], staffIn: [DVD] },
  { label: 'szsCommander', commandIn: [SZS], staffIn: [SZS] },
  { label: 'szsFirefighter', commandIn: [], staffIn: [SZS] },
  // Firefighter in DVD through the mirrored grant, commander in SZS.
  { label: 'dual', commandIn: [SZS], staffIn: [DVD, SZS] },
  { label: 'suspended', commandIn: [], staffIn: [] },
  { label: 'incomplete', commandIn: [], staffIn: [] },
] as const;

async function snapshotVisible(into: Map<string, Row[]>): Promise<void> {
  const users: Record<string, string> = {
    owner: ownerUser,
    dvdCommander,
    dvdFirefighter,
    szsCommander,
    szsFirefighter,
    dual: dualUser,
    suspended: suspendedUser,
    incomplete: incompleteUser,
  };
  for (const { label } of ACCOUNTS) {
    for (const { table, id } of TABLES) {
      into.set(`${label}/${table}`, await visible(users[label]!, table, id));
    }
  }
}

function servicesSeen(from: Map<string, Row[]>, label: string, table: string): string[] {
  return [...new Set((from.get(`${label}/${table}`) ?? []).map((row) => row.organization))].sort();
}

function idsSeen(from: Map<string, Row[]>, label: string, table: string, service: string): string[] {
  return (from.get(`${label}/${table}`) ?? [])
    .filter((row) => row.organization === service)
    .map((row) => row.id)
    .sort();
}

async function usable(userId: string, name: string, role: string): Promise<void> {
  await db.query(
    `update public.profiles
        set full_name = $2, phone_e164 = '+38267123456',
            date_of_birth = date '1990-01-01', profile_complete = true
      where user_id = $1`,
    [userId, name],
  );
  await db.query(`update public.access_grants set role = $2 where user_id = $1`, [userId, role]);
}

/**
 * An account serving in SZS and nowhere else.
 *
 * The grant role stays CITIZEN because `sync_dvd_membership_from_grant` mirrors
 * the operational roles into an ACTIVE DVD membership - giving this account the
 * role it holds in SZS would quietly make it DVD staff too, and the isolation
 * fixture would be testing nothing.
 */
async function szsOnly(email: string, name: string, role: string): Promise<string> {
  const account = await createAccount(db, email);
  await usable(account.userId, name, 'CITIZEN');
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, active)
     values ($1, $2, $3, true)`,
    [SZS, account.userId, role],
  );
  return account.userId;
}

/** A member record in one service, linked to an account. */
async function memberIn(organization: string, name: string, userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.members(full_name, user_id, organization_id, active)
     values ($1, $2, $3, true) returning id`,
    [name, userId, organization],
  );
  return rows[0]!.id;
}

/**
 * A published call-out in one service, with a recipient, an update and an
 * acknowledgement.
 *
 * Built by direct insert rather than through the commands, because before this
 * phase the commands can only ever produce a DVD one - which is the defect, and
 * would make the SZS half of every assertion below impossible to set up.
 */
async function buildCallout(
  organization: string,
  suffix: string,
  commanderMemberId: string,
  recipientMemberId: string,
  commanderUser: string,
): Promise<ServiceCallout> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.interventions(
       kind, title, instructions, incident_location, status, created_by,
       published_at, published_by, idempotency_key, organization_id)
     values ('POZAR', $1, 'Okupljanje u bazi.', $2, 'PUBLISHED', $3, now(), $3, $4, $5)
     returning id`,
    [`Pozar ${suffix}`, `Lokacija ${suffix}`, commanderUser, `key-${suffix}`, organization],
  );
  const interventionId = rows[0]!.id;

  // organization_id on all three is derived from the intervention by P2's
  // trigger, so these inserts deliberately do not supply it.
  await db.query(
    `insert into public.intervention_recipients(
       intervention_id, member_id, recipient_version, member_name_at_publication)
     values ($1, $2, 1, $3)`,
    [interventionId, recipientMemberId, `Primalac ${suffix}`],
  );
  await db.query(
    `insert into public.intervention_updates(intervention_id, version, body, created_by)
     values ($1, 1, $2, $3)`,
    [interventionId, `Dopuna ${suffix}`, commanderUser],
  );
  await db.query(
    `insert into public.intervention_acknowledgements(intervention_id, member_id)
     values ($1, $2)`,
    [interventionId, recipientMemberId],
  );
  await db.query(
    `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
     values ($1, 'INTERVENTION_PUBLISHED', $2, $3)`,
    [interventionId, JSON.stringify({ location: `Lokacija ${suffix}` }), commanderUser],
  );

  return { interventionId, memberId: recipientMemberId, commanderMemberId };
}

/**
 * Every command a DVD commander runs today, through the signatures the client
 * uses, recorded before and after. Anything that changes is a workflow lost.
 */
async function snapshotCommands(into: Map<string, string>): Promise<void> {
  const unique = Math.random().toString(36).slice(2, 8);
  const record = async (name: string, statement: string, params: unknown[] = []) => {
    const result = await act(dvdCommander, statement, params);
    into.set(name, isRefusal(result) ? result : 'OK');
    return result;
  };

  await db.query('begin');
  try {
    const draft = await record(
      'create_intervention_draft',
      `select public.create_intervention_draft('POZAR', $1, 'Okupljanje u bazi.', 'Poligon', $2)`,
      [`Vjezba ${unique}`, `key-${unique}`],
    );
    await record(
      'update_intervention_draft',
      `select public.update_intervention_draft($1, $2, 'Izmijenjene upute.', 'Poligon', 1)`,
      [draft, `Vjezba izmijenjena ${unique}`],
    );
    await record('publish_intervention', `select public.publish_intervention($1, $2)`, [
      draft,
      [dvd.memberId],
    ]);
    // Version 3: created at 1, the draft update took it to 2, publication to 3.
    await record('set_intervention_status', `select public.set_intervention_status($1, 'ASSEMBLING', 3)`, [
      draft,
    ]);
    await record('close_intervention', `select public.close_intervention($1, 'CLOSED', 'Zavrseno', true)`, [
      draft,
    ]);

    const second = await record(
      'create_intervention_draft (second)',
      `select public.create_intervention_draft('VJEZBA', $1, 'Okupljanje u bazi.', 'Poligon', $2)`,
      [`Za odbacivanje ${unique}`, `key2-${unique}`],
    );
    await record('discard_intervention_draft', `select public.discard_intervention_draft($1, 'Greska')`, [
      second,
    ]);

    // The recipient's own acknowledgement, through the member's account.
    const acknowledged = await act(
      dvdFirefighter,
      `select public.acknowledge_intervention($1)`,
      [dvd.interventionId],
    );
    into.set(
      'acknowledge_intervention',
      isRefusal(acknowledged) ? acknowledged : 'OK',
    );
  } finally {
    await db.query('rollback');
  }
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
  const index = MIGRATIONS.indexOf(INTERVENTIONS);
  expect(index, 'the migration must be in the harness list').toBeGreaterThan(-1);
  for (const file of MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  const owner = await createAccount(db, 'vlasnik.intervencije@example.invalid');
  ownerUser = owner.userId;
  await usable(ownerUser, 'Vlasnik Instalacije', 'OWNER');
  // No membership anywhere: the live installation owner holds none.

  const commander = await createAccount(db, 'komandir.dvd.int@example.invalid');
  dvdCommander = commander.userId;
  await usable(dvdCommander, 'Komandir DVD', 'COMMANDER');

  const firefighter = await createAccount(db, 'vatrogasac.dvd.int@example.invalid');
  dvdFirefighter = firefighter.userId;
  await usable(dvdFirefighter, 'Vatrogasac DVD', 'FIREFIGHTER');

  szsCommander = await szsOnly('komandir.szs.int@example.invalid', 'Komandir SZS', 'COMMANDER');
  szsFirefighter = await szsOnly('vatrogasac.szs.int@example.invalid', 'Vatrogasac SZS', 'FIREFIGHTER');

  const dual = await createAccount(db, 'oba.servisa.int@example.invalid');
  dualUser = dual.userId;
  await usable(dualUser, 'Oba Servisa', 'FIREFIGHTER');
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, active)
     values ($1, $2, 'COMMANDER', true)`,
    [SZS, dualUser],
  );

  const suspended = await createAccount(db, 'suspendovan.int@example.invalid');
  suspendedUser = suspended.userId;
  await usable(suspendedUser, 'Suspendovan Clan', 'COMMANDER');
  await db.query(`update public.access_grants set active = false where user_id = $1`, [suspendedUser]);

  const incomplete = await createAccount(db, 'nepotpun.int@example.invalid');
  incompleteUser = incomplete.userId;
  await usable(incompleteUser, 'Nepotpun Profil', 'COMMANDER');
  await db.query(`update public.profiles set profile_complete = false where user_id = $1`, [
    incompleteUser,
  ]);

  // Member records, one per service per person who needs one.
  const dvdCommanderMember = await memberIn(DVD, 'Komandir DVD', dvdCommander);
  const dvdFirefighterMember = await memberIn(DVD, 'Vatrogasac DVD', dvdFirefighter);
  const szsCommanderMember = await memberIn(SZS, 'Komandir SZS', szsCommander);
  const szsFirefighterMember = await memberIn(SZS, 'Vatrogasac SZS', szsFirefighter);
  await memberIn(DVD, 'Oba Servisa', dualUser);
  await memberIn(SZS, 'Oba Servisa', dualUser);

  dvd = await buildCallout(DVD, 'DVD', dvdCommanderMember, dvdFirefighterMember, dvdCommander);
  szs = await buildCallout(SZS, 'SZS', szsCommanderMember, szsFirefighterMember, szsCommander);

  await snapshotVisible(visibleBefore);
  await snapshotCommands(commandsBefore);
}, 180_000);

afterAll(async () => {
  await db?.end();
});

describe('before P4b: a call-out does not know which service ran it', () => {
  it.each(TABLES)('leaks SZS $table to a DVD commander', ({ table }) => {
    expect(servicesSeen(visibleBefore, 'dvdCommander', table)).toEqual([DVD, SZS].sort());
  });

  it('shows an SZS commander nothing, not even their own call-out', () => {
    for (const { table } of TABLES) {
      expect(visibleBefore.get(`szsCommander/${table}`), table).toEqual([]);
    }
  });

  it('lets a DVD commander drive an SZS call-out through the commands', async () => {
    expect(
      await probe(dvdCommander, `select public.set_intervention_status($1, 'ASSEMBLING', 1)`, [
        szs.interventionId,
      ]),
      'status of somebody else\'s call-out',
    ).toBe('OK');
    expect(
      await probe(dvdCommander, `select public.close_intervention($1, 'CLOSED', 'Zatvoreno', true)`, [
        szs.interventionId,
      ]),
      'and closing it',
    ).toBe('OK');
  });

  it('refuses an SZS commander every intervention command', async () => {
    // Fails closed rather than open, and is still wrong: an SZS COMMANDER
    // cannot run an SZS call-out, which is the whole point of the phase.
    expect(
      await probe(szsCommander, `select public.create_intervention_draft('POZAR', 'Naslov', 'Upute', 'Mjesto', 'k1')`),
    ).toBe('COMMAND_REQUIRED');
    expect(
      await probe(szsCommander, `select public.set_intervention_status($1, 'ASSEMBLING', 1)`, [
        szs.interventionId,
      ]),
    ).toBe('COMMAND_REQUIRED');
  });

  it('cannot resolve an SZS recipient, so is_recipient_of is blind there', async () => {
    const seen = await probe(
      szsFirefighter,
      `select public.is_recipient_of($1)::text`,
      [szs.interventionId],
    );
    expect(seen, 'their own call-out does not recognise them').toBe('false');
  });
});

describe('after P4b: a call-out belongs to the service that ran it', () => {
  const visibleAfter = new Map<string, Row[]>();
  const commandsAfter = new Map<string, string>();

  beforeAll(async () => {
    await db.query(sql(INTERVENTIONS));
    await snapshotVisible(visibleAfter);
    await snapshotCommands(commandsAfter);
  }, 180_000);

  // --- reads --------------------------------------------------------------

  it.each(TABLES)('leaves every DVD row id in $table unchanged', ({ table }) => {
    for (const label of ['owner', 'dvdCommander']) {
      expect(
        idsSeen(visibleAfter, label, table, DVD),
        `${label} must see exactly the DVD ${table} it saw before`,
      ).toEqual(idsSeen(visibleBefore, label, table, DVD));
    }
  });

  it.each(TABLES)('isolates $table between the two services', ({ table }) => {
    expect(servicesSeen(visibleAfter, 'dvdCommander', table), 'DVD commander').toEqual([DVD]);
    expect(servicesSeen(visibleAfter, 'szsCommander', table), 'SZS commander').toEqual([SZS]);
  });

  it('gives the installation owner both services without a membership anywhere', async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.organization_memberships where user_id = $1`,
      [ownerUser],
    );
    expect(rows[0]!.n, 'the owner holds no membership').toBe('0');
    for (const { table } of TABLES) {
      expect(servicesSeen(visibleAfter, 'owner', table), table).toEqual([DVD, SZS].sort());
    }
  });

  it('gives a dual-service account each service at the authority it holds there', () => {
    // Commander in SZS, firefighter in DVD. Command-level reads are SZS only;
    // what they see of DVD comes from being a recipient, not from command.
    for (const { table } of TABLES) {
      expect(servicesSeen(visibleAfter, 'dual', table), table).not.toContain(DVD);
      expect(servicesSeen(visibleAfter, 'dual', table), table).toEqual([SZS]);
    }
  });

  it('shows suspended and unfinished-profile accounts nothing', () => {
    for (const { table } of TABLES) {
      expect(visibleAfter.get(`suspended/${table}`), `suspended/${table}`).toEqual([]);
      expect(visibleAfter.get(`incomplete/${table}`), `incomplete/${table}`).toEqual([]);
    }
  });

  it('resolves a recipient in their own service', async () => {
    expect(
      await probe(szsFirefighter, `select public.is_recipient_of($1)::text`, [szs.interventionId]),
      'the SZS recipient is now recognised',
    ).toBe('true');
    expect(
      await probe(dvdFirefighter, `select public.is_recipient_of($1)::text`, [dvd.interventionId]),
      'and the DVD one still is',
    ).toBe('true');
    expect(
      await probe(dvdFirefighter, `select public.is_recipient_of($1)::text`, [szs.interventionId]),
      'across services, nobody is',
    ).toBe('false');
  });

  // --- commands -----------------------------------------------------------

  it('keeps every command a DVD commander runs today', () => {
    expect(commandsAfter).toEqual(commandsBefore);
    // Named rather than counted, so a failure says WHICH command regressed.
    const refused = [...commandsBefore.entries()].filter(([, outcome]) => outcome !== 'OK');
    expect(refused, 'every command succeeds for a DVD commander before the phase').toEqual([]);
    expect(commandsBefore.size, 'seven commands plus a second draft').toBe(8);
  });

  it.each([
    ['set_intervention_status', `select public.set_intervention_status($1, 'ASSEMBLING', 1)`],
    ['close_intervention', `select public.close_intervention($1, 'CLOSED', 'Zatvoreno', true)`],
    ['update_intervention_draft', `select public.update_intervention_draft($1, 'Naslov', 'Upute', 'Mjesto', 1)`],
    ['discard_intervention_draft', `select public.discard_intervention_draft($1, 'Greska')`],
    ['publish_intervention', `select public.publish_intervention($1, '{}'::uuid[])`],
  ])('refuses a DVD commander the SZS %s', async (_name, statement) => {
    expect(await probe(dvdCommander, statement, [szs.interventionId])).toBe('ORGANIZATION_MISMATCH');
  });

  it('refuses an SZS commander every DVD intervention', async () => {
    expect(
      await probe(szsCommander, `select public.set_intervention_status($1, 'ASSEMBLING', 1)`, [
        dvd.interventionId,
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
    expect(
      await probe(szsCommander, `select public.close_intervention($1, 'CLOSED', 'Zatvoreno', true)`, [
        dvd.interventionId,
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
  });

  it('still refuses a firefighter for lacking command, not for the service', async () => {
    // The distinction has to survive: somebody who commands nothing gets
    // COMMAND_REQUIRED, and gets it before any row is read so ids cannot be
    // probed. Only somebody who DOES command elsewhere gets the service answer.
    expect(
      await probe(dvdFirefighter, `select public.set_intervention_status($1, 'ASSEMBLING', 1)`, [
        dvd.interventionId,
      ]),
    ).toBe('COMMAND_REQUIRED');
    expect(
      await probe(dvdFirefighter, `select public.close_intervention($1, 'CLOSED', 'X', true)`, [
        '00000000-0000-0000-0000-000000000000',
      ]),
      'and for an intervention that does not exist',
    ).toBe('COMMAND_REQUIRED');
  });

  it('lets an SZS commander run an SZS call-out end to end', async () => {
    await db.query('begin');
    try {
      const draft = await act(
        szsCommander,
        `select public.create_intervention_draft_in($1, 'POZAR', 'Pozar SZS', 'Upute su ovdje.', 'Lokacija', $2)`,
        [SZS, `szs-${Math.random().toString(36).slice(2, 8)}`],
      );
      expect(isRefusal(draft), `the draft was created: ${draft}`).toBe(false);

      const { rows } = await db.query<{ organization_id: string }>(
        `select organization_id::text from public.interventions where id = $1`,
        [draft],
      );
      expect(rows[0]!.organization_id, 'and belongs to SZS').toBe(SZS);

      // publish_intervention returns the intervention id, not void.
      expect(
        await act(szsCommander, `select public.publish_intervention($1, $2)`, [draft, [szs.memberId]]),
        'published to its own service',
      ).toBe(draft);
      expect(
        await act(szsCommander, `select public.set_intervention_status($1, 'ASSEMBLING', 2)`, [draft]),
      ).toBe('OK');
      expect(
        await act(szsCommander, `select public.close_intervention($1, 'CLOSED', 'Zavrseno', true)`, [
          draft,
        ]),
      ).toBe('OK');
    } finally {
      await db.query('rollback');
    }
  });

  it('refuses a forged service on a create', async () => {
    expect(
      await probe(
        dvdCommander,
        `select public.create_intervention_draft_in($1, 'POZAR', 'Podmetnuto', 'Upute su ovdje.', 'Lokacija', 'forge1')`,
        [SZS],
      ),
      'a DVD commander naming SZS',
    ).toBe('COMMAND_REQUIRED');
    expect(
      await probe(
        szsCommander,
        `select public.create_intervention_draft_in($1, 'POZAR', 'Podmetnuto', 'Upute su ovdje.', 'Lokacija', 'forge2')`,
        [DVD],
      ),
      'and an SZS commander naming DVD',
    ).toBe('COMMAND_REQUIRED');
  });

  it('refuses a recipient from the other service at publication', async () => {
    await db.query('begin');
    try {
      const draft = await act(
        dvdCommander,
        `select public.create_intervention_draft('POZAR', 'Mjesoviti', 'Upute su ovdje.', 'Lokacija', $1)`,
        [`mix-${Math.random().toString(36).slice(2, 8)}`],
      );
      expect(
        await act(dvdCommander, `select public.publish_intervention($1, $2)`, [
          draft,
          [dvd.memberId, szs.memberId],
        ]),
        'a DVD call-out cannot be sent to an SZS member',
      ).toBe('ORGANIZATION_MISMATCH');

      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.intervention_recipients where intervention_id = $1`,
        [draft],
      );
      expect(rows[0]!.n, 'and nobody was frozen onto the list').toBe('0');
    } finally {
      await db.query('rollback');
    }
  });

  it('refuses a dual-service commander their other service\'s members', async () => {
    // The hazard `serves_with` cannot see: this person genuinely serves in both,
    // so "shares a service with me" is true for members of either. The
    // intervention's own service is what decides.
    await db.query('begin');
    try {
      const draft = await act(
        dualUser,
        `select public.create_intervention_draft_in($1, 'POZAR', 'Dvostruki', 'Upute su ovdje.', 'Lokacija', $2)`,
        [SZS, `dual-${Math.random().toString(36).slice(2, 8)}`],
      );
      expect(isRefusal(draft), `SZS draft by the dual commander: ${draft}`).toBe(false);
      expect(
        await act(dualUser, `select public.publish_intervention($1, $2)`, [draft, [dvd.memberId]]),
        'an SZS call-out cannot reach a DVD member',
      ).toBe('ORGANIZATION_MISMATCH');
    } finally {
      await db.query('rollback');
    }
  });

  it('refuses an acknowledgement across services', async () => {
    expect(
      await probe(dvdFirefighter, `select public.acknowledge_intervention($1)`, [szs.interventionId]),
    ).not.toBe('OK');
    expect(
      await probe(szsFirefighter, `select public.acknowledge_intervention($1)`, [dvd.interventionId]),
    ).not.toBe('OK');
  });

  it('lets an SZS recipient acknowledge their own call-out', async () => {
    await db.query('begin');
    try {
      await db.query(`delete from public.intervention_acknowledgements where intervention_id = $1`, [
        szs.interventionId,
      ]);
      expect(
        await act(szsFirefighter, `select public.acknowledge_intervention($1)`, [szs.interventionId]),
      ).toBe('OK');
      const { rows } = await db.query<{ organization_id: string }>(
        `select organization_id::text from public.intervention_acknowledgements
          where intervention_id = $1 and member_id = $2`,
        [szs.interventionId, szs.memberId],
      );
      expect(rows[0]!.organization_id, 'recorded against SZS').toBe(SZS);
    } finally {
      await db.query('rollback');
    }
  });

  // --- the audit the writers fill -----------------------------------------

  it('does not leak the operational audit across services', async () => {
    // The registry_audit lesson from P4a: P4b is what starts putting SZS rows
    // in this table, so P4b is what makes it leak.
    expect(servicesSeen(visibleAfter, 'dvdCommander', 'operational_audit')).toEqual([DVD]);
    expect(servicesSeen(visibleAfter, 'szsCommander', 'operational_audit')).toEqual([SZS]);

    const location = await probe(
      dvdCommander,
      `select coalesce(string_agg(detail->>'location', ','), 'NONE') from public.operational_audit
        where detail->>'location' = $1`,
      ['Lokacija SZS'],
    );
    expect(location, 'the SZS incident location is nowhere in what DVD can read').toBe('NONE');
  });

  it('keeps organization ownership consistent on insert and update', async () => {
    await db.query('begin');
    try {
      // A child row may not claim a service its intervention does not have.
      const mismatched = await db
        .query(
          `insert into public.intervention_updates(
             intervention_id, version, body, created_by, organization_id)
           values ($1, 9, 'Podmetnuto', $2, $3)`,
          [dvd.interventionId, dvdCommander, SZS],
        )
        .then(() => 'OK')
        .catch((error: Error) => error.message);
      expect(String(mismatched)).toContain('ORGANIZATION_MISMATCH');
    } finally {
      await db.query('rollback');
    }

    await db.query('begin');
    try {
      const moved = await db
        .query(`update public.interventions set organization_id = $1 where id = $2`, [
          SZS,
          dvd.interventionId,
        ])
        .then(() => 'OK')
        .catch((error: Error) => error.message);
      expect(String(moved), 'and an intervention cannot change service').toContain(
        'ORGANIZATION_IMMUTABLE',
      );
    } finally {
      await db.query('rollback');
    }
  });

  it('leaves no is_dvd_* guard in the tables and commands this phase owns', async () => {
    const { rows } = await db.query<{ policyname: string; qual: string }>(
      `select policyname, coalesce(qual, '') as qual from pg_policies
        where schemaname = 'public'
          and tablename in ('interventions','intervention_recipients','intervention_updates',
                            'intervention_acknowledgements','operational_audit')`,
    );
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.qual, row.policyname).not.toMatch(/is_dvd_(staff|command|admin)/);
    }

    const { rows: functions } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('create_intervention_draft','create_intervention_draft_in',
                            'update_intervention_draft','discard_intervention_draft',
                            'publish_intervention','set_intervention_status',
                            'close_intervention','acknowledge_intervention','is_recipient_of')
          and p.prosrc ~ 'is_dvd_(staff|command|admin)'
        order by 1`,
    );
    expect(functions.map((row) => row.proname)).toEqual([]);
  });

  it('is not undone by any migration that sorts after it', async () => {
    // 202609130006a re-creates four of these commands at their old, DVD-only
    // text. It sits before this file, so ordering saves us - but only while
    // nothing later re-creates them. Asserted rather than inspected once.
    const index = MIGRATIONS.indexOf(INTERVENTIONS);
    const later = MIGRATIONS.slice(index + 1);
    const guarded = [
      'create_intervention_draft',
      'update_intervention_draft',
      'discard_intervention_draft',
      'publish_intervention',
      'set_intervention_status',
      'close_intervention',
      'acknowledge_intervention',
      'is_recipient_of',
    ];
    for (const file of later) {
      const body = sql(file);
      for (const name of guarded) {
        expect(
          new RegExp(`function\\s+public\\.${name}\\s*\\(`, 'i').test(body),
          `${file} re-creates ${name} after P4b secured it`,
        ).toBe(false);
      }
    }
  });
});
