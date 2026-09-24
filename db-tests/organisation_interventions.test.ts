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
const SCOPED_COMMANDS = 'supabase/migrations/202609250028_intervention_scoped_commands.sql';
const OUTPUTS = 'supabase/migrations/202609250029_intervention_outputs.sql';

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
// Signed up, profile complete, serving nowhere. Not in ACCOUNTS: it exists for
// the eligibility question in 202609250029, not for the table snapshots.
let citizenUser = '';

let dvd: ServiceCallout;
let szs: ServiceCallout;
let dvdVehicle = '';
let szsVehicle = '';
let dualDvdMember = '';
let dualSzsMember = '';

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

  const citizen = await createAccount(db, 'gradjanin.int@example.invalid');
  citizenUser = citizen.userId;
  await usable(citizenUser, 'Gradjanin Test', 'CITIZEN');

  // Member records, one per service per person who needs one.
  const dvdCommanderMember = await memberIn(DVD, 'Komandir DVD', dvdCommander);
  const dvdFirefighterMember = await memberIn(DVD, 'Vatrogasac DVD', dvdFirefighter);
  const szsCommanderMember = await memberIn(SZS, 'Komandir SZS', szsCommander);
  const szsFirefighterMember = await memberIn(SZS, 'Vatrogasac SZS', szsFirefighter);
  dualDvdMember = await memberIn(DVD, 'Oba Servisa', dualUser);
  dualSzsMember = await memberIn(SZS, 'Oba Servisa', dualUser);

  dvd = await buildCallout(DVD, 'DVD', dvdCommanderMember, dvdFirefighterMember, dvdCommander);
  szs = await buildCallout(SZS, 'SZS', szsCommanderMember, szsFirefighterMember, szsCommander);

  // One vehicle per service, for record_vehicle_departure.
  const { rows: dvdVehicleRow } = await db.query<{ id: string }>(
    `insert into public.vehicles(callsign, name, kind, organization_id)
     values ('V-DVD-INT', 'Vozilo DVD', 'NAVALNO', $1) returning id`,
    [DVD],
  );
  dvdVehicle = dvdVehicleRow[0]!.id;
  const { rows: szsVehicleRow } = await db.query<{ id: string }>(
    `insert into public.vehicles(callsign, name, kind, organization_id)
     values ('V-SZS-INT', 'Vozilo SZS', 'NAVALNO', $1) returning id`,
    [SZS],
  );
  szsVehicle = szsVehicleRow[0]!.id;

  // The dual-service person is a recipient of the SZS call-out through their
  // SZS member record. This is what makes the journey-progress mismatch
  // reachable: is_recipient_of resolves their SZS record while the command
  // still writes their DVD one.
  await db.query(
    `insert into public.intervention_recipients(
       intervention_id, member_id, recipient_version, member_name_at_publication)
     values ($1, $2, 1, 'Oba Servisa')`,
    [szs.interventionId, dualSzsMember],
  );

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

  it('answers a citizen false about a DVD member, as P0 decided', async () => {
    // The baseline for the regression 202609250029 repairs. P0 answered only
    // about somebody the caller served with (`serves_with`), and a citizen
    // serves with nobody. 027 dropped that bound; see the 028 block below.
    expect(await probe(citizenUser, `select public.is_eligible_recipient($1)::text`, [dvd.memberId])).toBe(
      'false',
    );
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

/*
 * P4b made SZS call-outs possible. Four commands OUTSIDE its four tables write
 * records that hang off an intervention, and each is `security definer` - so
 * none of them is reached by the policies above. Their own tables belong to
 * P4c and P4d, but the question "may you touch THIS call-out" is about
 * `interventions`, and a phase closes the boundary it opens.
 */
describe('still open at 202609250027: commands that write records linked to a call-out', () => {
  it('lets a DVD commander check a DVD member in on an SZS call-out', async () => {
    const outcome = await probe(
      dvdCommander,
      `select public.attendance_check_in($1, $2)::text`,
      [szs.interventionId, dvd.memberId],
    );
    expect(isRefusal(outcome), `attendance was recorded: ${outcome}`).toBe(false);
  });

  it('lets a dual-service member write a DVD journey row on an SZS call-out', async () => {
    // `is_recipient_of` resolves their SZS record, so the recipient check
    // passes - while `current_member_id()` still answers with the DVD one.
    await db.query('begin');
    try {
      expect(
        await act(dualUser, `select public.set_journey_progress($1, 'KRECEM')`, [
          szs.interventionId,
        ]),
      ).toBe('OK');
      const { rows } = await db.query<{ member_id: string; organization_id: string }>(
        `select member_id::text, organization_id::text from public.intervention_journey
          where intervention_id = $1`,
        [szs.interventionId],
      );
      expect(rows[0]!.member_id, 'the row names their DVD member record').toBe(dualDvdMember);
      expect(rows[0]!.organization_id, 'on a row belonging to SZS').toBe(SZS);
    } finally {
      await db.query('rollback');
    }
  });

  it('lets a DVD vehicle be sent to an SZS call-out', async () => {
    const outcome = await probe(
      dvdCommander,
      `select public.record_vehicle_departure($1, $2)::text`,
      [dvdVehicle, szs.interventionId],
    );
    expect(isRefusal(outcome), `the departure was recorded: ${outcome}`).toBe(false);
  });

  it('does NOT let submit_response cross services, and here is why', async () => {
    // Documented rather than assumed. `submit_response` looks the recipient up
    // INLINE against `acting_member` instead of calling `is_recipient_of`, so
    // the member it writes and the member it checks are always the same one.
    // That is the whole difference from `set_journey_progress` above.
    expect(
      await probe(dualUser, `select public.submit_response($1, 'DOLAZIM', null, true)`, [
        szs.interventionId,
      ]),
      'their DVD member is not on the SZS recipient list',
    ).toBe('NOT_A_RECIPIENT');
    expect(
      await probe(szsFirefighter, `select public.submit_response($1, 'DOLAZIM', null, true)`, [
        szs.interventionId,
      ]),
      // Fail-closed, and P4c's to fix: an SZS recipient cannot answer their own
      // call-out because the command resolves them through the DVD shim.
      'and an SZS recipient cannot answer at all',
    ).toBe('MEMBER_RECORD_REQUIRED');
  });
});

describe('after 202609250028: a command may only touch a call-out in its own service', () => {
  beforeAll(async () => {
    await db.query(sql(SCOPED_COMMANDS));
  }, 120_000);

  it('refuses a DVD commander checking anybody in on an SZS call-out', async () => {
    expect(
      await probe(dvdCommander, `select public.attendance_check_in($1, $2)::text`, [
        szs.interventionId,
        dvd.memberId,
      ]),
    ).toBe('STAFF_REQUIRED');
  });

  it('refuses checking in a member who does not serve in that call-out\'s service', async () => {
    // The owner IS staff in both, so the refusal here is about the member
    // rather than the caller - the two are separate questions.
    expect(
      await probe(ownerUser, `select public.attendance_check_in($1, $2)::text`, [
        szs.interventionId,
        dvd.memberId,
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
  });

  it('still lets a DVD commander check a DVD member in on a DVD call-out', async () => {
    await db.query('begin');
    try {
      const outcome = await act(dvdCommander, `select public.attendance_check_in($1, $2)::text`, [
        dvd.interventionId,
        dvd.memberId,
      ]);
      expect(isRefusal(outcome), `DVD attendance still works: ${outcome}`).toBe(false);
    } finally {
      await db.query('rollback');
    }
  });

  it('writes the journey row against the member of the call-out\'s own service', async () => {
    await db.query('begin');
    try {
      expect(
        await act(dualUser, `select public.set_journey_progress($1, 'KRECEM')`, [
          szs.interventionId,
        ]),
      ).toBe('OK');
      const { rows } = await db.query<{ member_id: string; organization_id: string }>(
        `select member_id::text, organization_id::text from public.intervention_journey
          where intervention_id = $1`,
        [szs.interventionId],
      );
      expect(rows[0]!.member_id, 'their SZS member record, not their DVD one').toBe(dualSzsMember);
      expect(rows[0]!.organization_id).toBe(SZS);
    } finally {
      await db.query('rollback');
    }
  });

  it('refuses a DVD-only member journey progress on an SZS call-out', async () => {
    expect(
      await probe(dvdFirefighter, `select public.set_journey_progress($1, 'KRECEM')`, [
        szs.interventionId,
      ]),
    ).toBe('STAFF_REQUIRED');
  });

  it('refuses a DVD vehicle being sent to an SZS call-out', async () => {
    expect(
      await probe(dvdCommander, `select public.record_vehicle_departure($1, $2)::text`, [
        dvdVehicle,
        szs.interventionId,
      ]),
    ).toBe('STAFF_REQUIRED');
    // The owner is staff in both, so for them the refusal is the one that
    // matters: a vehicle and a call-out of different services. Whether a DVD
    // vehicle may ever attend an SZS incident is P7's to decide, not P4b's.
    expect(
      await probe(ownerUser, `select public.record_vehicle_departure($1, $2)::text`, [
        dvdVehicle,
        szs.interventionId,
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
  });

  it('still records a DVD vehicle on a DVD call-out, owned by the vehicle', async () => {
    await db.query('begin');
    try {
      const movement = await act(dvdCommander, `select public.record_vehicle_departure($1, $2)::text`, [
        dvdVehicle,
        dvd.interventionId,
      ]);
      expect(isRefusal(movement), `DVD departure still works: ${movement}`).toBe(false);
      const { rows } = await db.query<{ organization_id: string }>(
        `select organization_id::text from public.vehicle_movements where id = $1`,
        [movement],
      );
      // The settled rule from 202609240022: a movement belongs to the service
      // that owns the VEHICLE. P4b does not touch that.
      expect(rows[0]!.organization_id).toBe(DVD);
    } finally {
      await db.query('rollback');
    }
  });

  it('lets an SZS member run their own service end to end', async () => {
    await db.query('begin');
    try {
      expect(
        await act(szsFirefighter, `select public.set_journey_progress($1, 'KRECEM')`, [
          szs.interventionId,
        ]),
        'journey progress on their own call-out',
      ).toBe('OK');
      const departure = await act(szsCommander, `select public.record_vehicle_departure($1, $2)::text`, [
        szsVehicle,
        szs.interventionId,
      ]);
      expect(isRefusal(departure), `SZS vehicle to an SZS call-out: ${departure}`).toBe(false);
    } finally {
      await db.query('rollback');
    }
  });

  it('leaves submit_response alone, as P4c\'s to make service-aware', async () => {
    // Unchanged by this migration, and unchanged in behaviour: it was never
    // exploitable, only DVD-blind.
    expect(
      await probe(szsFirefighter, `select public.submit_response($1, 'DOLAZIM', null, true)`, [
        szs.interventionId,
      ]),
    ).toBe('MEMBER_RECORD_REQUIRED');
  });
});

/*
 * The rest of what P4b opened, derived from the catalogue rather than listed
 * from memory - the two lists before this one were made by hand, and review
 * found each of them short.
 *
 * P4b's commands WRITE into ten tables outside its four, and every one of them
 * read DVD-wide. Two definer functions read the same data with no policy in the
 * way. And a vehicle sent out with no call-out had its audit row labelled DVD,
 * whichever service's vehicle it was.
 *
 * All ten tables already carry `organization_id` - P2 gave it to them, derived
 * from the parent row by trigger - so nothing here has to be backfilled. What
 * is missing is that the policies and the definer functions never ask.
 */
const OUTPUT_TABLES = [
  'notification_outbox',
  'notification_delivery_attempts',
  'intervention_journey',
  'intervention_journey_history',
  'attendance_intervals',
  'attendance_corrections',
  'attendance_correction_requests',
  'vehicle_movements',
  'intervention_responses',
  'intervention_response_revisions',
] as const;

/**
 * Every table reachable from `interventions` by foreign key, however deep, and
 * any table carrying an `intervention_id`. The derivation the migration header
 * describes, run against the live catalogue, so a table added later is in
 * scope without anybody remembering to list it.
 */
const REACHABLE_TABLES = `
  with recursive edge as (
    select c.conrelid::regclass as child, c.confrelid::regclass as parent
      from pg_constraint c where c.contype = 'f'
  ), reach(tbl) as (
    select 'public.interventions'::regclass
    union
    select edge.child from edge join reach on edge.parent = reach.tbl
  )
  select c.relname::text as tbl
    from reach join pg_class c on c.oid = reach.tbl
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
  union
  select c.relname::text
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and a.attname = 'intervention_id' and not a.attisdropped`;

/** A question that can only ever be answered about DVD. */
const DVD_ONLY = String.raw`is_dvd_(staff|command|admin|owner)\(\)|current_dvd_role\(\)|current_member_id\(\)`;

/** The distinct services whose rows this account can read from one table. */
async function servicesVisible(userId: string, table: string): Promise<string[]> {
  return asUser(db, userId, async (client) => {
    const { rows } = await client.query<{ organization: string }>(
      `select distinct organization_id::text as organization from public.${table} order by 1`,
    );
    return rows.map((row) => row.organization);
  });
}

let szsInterval = '';
let szsMovement = '';
let szsSpareVehicle = '';

/** The service `operational_audit` filed one vehicle event under. */
async function auditServiceOf(movement: string, event: string): Promise<string> {
  const { rows } = await db.query<{ organization_id: string }>(
    `select organization_id::text from public.operational_audit
      where event_type = $2 and detail->>'movement_id' = $1`,
    [movement, event],
  );
  return rows[0]?.organization_id ?? 'NONE';
}

/** How many audit rows about one movement this account can read directly. */
const auditRowsAbout = `select count(*)::text from public.operational_audit
  where detail->>'movement_id' = $1`;

/**
 * The queue, delivery and answer rows of one call-out, plus a correction
 * request on one of its intervals.
 *
 * Inserted directly: publication fills the outbox, but both fixture call-outs
 * were built by direct insert, so their queue rows are too. And no command can
 * reach the others for SZS yet - `submit_response` is DVD-blind (P4c's) and the
 * correction-request INSERT policy is DVD-only (P4d's). The POLICY still has
 * to be right before those rows can exist.
 */
async function plantRows(callout: ServiceCallout, interval: string, requester: string): Promise<void> {
  const { rows: outbox } = await db.query<{ id: string }>(
    `insert into public.notification_outbox(intervention_id, member_id, channel, state, dedupe_key)
     values ($1, $2, 'IN_APP', 'QUEUED', $3) returning id`,
    [callout.interventionId, callout.memberId, `outbox-${Math.random().toString(36).slice(2, 8)}`],
  );
  await db.query(
    `insert into public.notification_delivery_attempts(outbox_id, provider, provider_status)
     values ($1, 'WEB_PUSH', '201')`,
    [outbox[0]!.id],
  );
  const { rows: response } = await db.query<{ id: string }>(
    `insert into public.intervention_responses(intervention_id, member_id, answer)
     values ($1, $2, 'DOLAZIM') returning id`,
    [callout.interventionId, callout.memberId],
  );
  await db.query(
    `insert into public.intervention_response_revisions(
       response_id, revision, answer, direct_to_location)
     values ($1, 1, 'DOLAZIM', false)`,
    [response[0]!.id],
  );
  await db.query(
    `insert into public.attendance_correction_requests(interval_id, requested_by, message)
     values ($1, $2, 'Molim ispravku vremena')`,
    [interval, requester],
  );
}

/** A second vehicle in one service, free to go out whenever a test needs it. */
async function spareVehicle(organization: string, callsign: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.vehicles(callsign, name, kind, organization_id)
     values ($1, 'Rezervno vozilo', 'NAVALNO', $2) returning id`,
    [callsign, organization],
  );
  return rows[0]!.id;
}

describe('still open at 202609250028: everything P4b writes outside its own four tables', () => {
  beforeAll(async () => {
    // A real operational trail in EACH service, through the real commands
    // wherever one exists. Committed, because the reads below are separate
    // transactions. Both services, so every isolation assertion below has rows
    // on both sides to get wrong.
    szsSpareVehicle = await spareVehicle(SZS, 'V-SZS-REZ');
    const dvdSpareVehicle = await spareVehicle(DVD, 'V-DVD-REZ');

    await db.query('begin');
    const outcomes: Record<string, string> = {};
    // SZS.
    outcomes['SZS journey'] = await act(szsFirefighter, `select public.set_journey_progress($1, 'KRECEM')`, [
      szs.interventionId,
    ]);
    szsInterval = await act(szsCommander, `select public.attendance_check_in($1, $2)::text`, [
      szs.interventionId,
      szs.memberId,
    ]);
    szsMovement = await act(szsCommander, `select public.record_vehicle_departure($1, $2)::text`, [
      szsVehicle,
      szs.interventionId,
    ]);
    // A second SZS interval, corrected into the past, so an SZS correction row
    // exists. At this schema only DVD command may call `attendance_correct`;
    // the owner holds it and commands SZS too, so this is a legitimate
    // correction whose row lands in SZS.
    const szsCorrected = await act(szsCommander, `select public.attendance_check_in($1, $2)::text`, [
      szs.interventionId,
      dualSzsMember,
    ]);
    outcomes['SZS correction'] = await act(
      ownerUser,
      `select public.attendance_correct($1, now() - interval '3 hours', now() - interval '2 hours', 'Pogresno vrijeme')`,
      [szsCorrected],
    );
    // DVD, on the commander's own member record and a spare vehicle, so none
    // of it stands in the way of the DVD member and vehicle later tests use.
    outcomes['DVD journey'] = await act(dvdFirefighter, `select public.set_journey_progress($1, 'KRECEM')`, [
      dvd.interventionId,
    ]);
    const dvdCorrected = await act(dvdCommander, `select public.attendance_check_in($1)::text`, [
      dvd.interventionId,
    ]);
    outcomes['DVD correction'] = await act(
      dvdCommander,
      `select public.attendance_correct($1, now() - interval '3 hours', now() - interval '2 hours', 'Pogresno vrijeme')`,
      [dvdCorrected],
    );
    outcomes['DVD movement'] = await act(dvdCommander, `select public.record_vehicle_departure($1, $2)::text`, [
      dvdSpareVehicle,
      dvd.interventionId,
    ]);
    await db.query('commit');
    Object.assign(outcomes, {
      'SZS interval': szsInterval,
      'SZS movement': szsMovement,
      'second SZS interval': szsCorrected,
      'DVD interval': dvdCorrected,
    });
    for (const [what, outcome] of Object.entries(outcomes)) {
      expect(isRefusal(outcome), `the ${what} was recorded: ${outcome}`).toBe(false);
    }

    await plantRows(szs, szsInterval, szsFirefighter);
    await plantRows(dvd, dvdCorrected, dvdCommander);
  }, 120_000);

  it.each(OUTPUT_TABLES)('leaks SZS %s to a DVD commander', async (table) => {
    expect(await servicesVisible(dvdCommander, table)).toEqual([DVD, SZS].sort());
  });

  it('lets an SZS attendance row reference a DVD vehicle', async () => {
    // `requested_vehicle` is passed straight into the interval and nothing
    // checks it against the call-out's service.
    await db.query('begin');
    try {
      const interval = await act(
        szsCommander,
        `select public.attendance_check_in($1, $2, null, null, $3)::text`,
        [szs.interventionId, szs.commanderMemberId, dvdVehicle],
      );
      expect(isRefusal(interval), `the check-in was accepted: ${interval}`).toBe(false);
      const { rows } = await db.query<{ organization_id: string; vehicle: string }>(
        `select a.organization_id::text, v.organization_id::text as vehicle
           from public.attendance_intervals a join public.vehicles v on v.id = a.vehicle_id
          where a.id = $1`,
        [interval],
      );
      expect(rows[0]!.organization_id, 'an SZS interval').toBe(SZS);
      expect(rows[0]!.vehicle, 'pointing at a DVD vehicle').toBe(DVD);
    } finally {
      await db.query('rollback');
    }
  });

  it.each([
    ['confirm', `select public.attendance_confirm($1, null)`],
    ['reject', `select public.attendance_reject($1, 'Razlog')`],
    [
      'correct',
      `select public.attendance_correct($1, now() - interval '2 hours', now() - interval '1 hour', 'Razlog')`,
    ],
  ])('lets a DVD commander %s an SZS attendance interval', async (_verb, statement) => {
    expect(await probe(dvdCommander, statement, [szsInterval])).toBe('OK');
  });

  it('lets a DVD commander withdraw an SZS confirmation', async () => {
    await db.query('begin');
    try {
      // Confirmed by the owner, who commands SZS: a legitimate confirmation.
      expect(await act(ownerUser, `select public.attendance_confirm($1, null)`, [szsInterval])).toBe('OK');
      expect(
        await act(dvdCommander, `select public.attendance_unconfirm($1, 'Razlog')`, [szsInterval]),
      ).toBe('OK');
      const { rows } = await db.query<{ verified: boolean }>(
        `select verified from public.attendance_intervals where id = $1`,
        [szsInterval],
      );
      expect(rows[0]!.verified, 'and the SZS confirmation is gone').toBe(false);
    } finally {
      await db.query('rollback');
    }
  });

  it('lets a DVD commander confirm SZS attendance in a batch', async () => {
    expect(
      await probe(dvdCommander, `select outcome from public.attendance_confirm_many($1::uuid[], null)`, [
        [szsInterval],
      ]),
    ).toBe('CONFIRMED');
  });

  it('lets a DVD member return an SZS vehicle', async () => {
    expect(
      await probe(dvdFirefighter, `select public.record_vehicle_return($1)::text`, [szsMovement]),
    ).toBe('OK');
  });

  // --- the two definer readers, which no policy reaches ---------------------

  it('lets a DVD commander read an SZS call-out\'s chronology through intervention_audit', async () => {
    // The table itself has shown DVD nothing of SZS since 027...
    expect(
      await probe(dvdCommander, `select count(*)::text from public.operational_audit where intervention_id = $1`, [
        szs.interventionId,
      ]),
      'a direct read',
    ).toBe('0');
    // ...and the definer function reads straight past that policy.
    expect(
      await probe(
        dvdCommander,
        `select coalesce(string_agg(detail->>'location', ','), 'NONE') from public.intervention_audit($1)`,
        [szs.interventionId],
      ),
      'the same rows through intervention_audit',
    ).toBe('Lokacija SZS');
  });

  it('tells anybody whether any member of either service can be paged', async () => {
    expect(
      await probe(dvdCommander, `select public.is_eligible_recipient_in($1, $2)::text`, [szs.memberId, SZS]),
      'a DVD commander, about an SZS member',
    ).toBe('true');
    expect(
      await probe(citizenUser, `select public.is_eligible_recipient($1)::text`, [dvd.memberId]),
      'a citizen, about a DVD member - P0 answered this false (see the first block)',
    ).toBe('true');
  });

  // --- the audit row of a vehicle sent out with no call-out ----------------

  it('files an SZS vehicle sent out with no call-out under DVD', async () => {
    await db.query('begin');
    try {
      // Possible since 028: SZS may send its own vehicle out.
      const movement = await act(
        szsCommander,
        `select public.record_vehicle_departure($1, null, 'Tocenje goriva')::text`,
        [szsSpareVehicle],
      );
      expect(isRefusal(movement), `the departure was recorded: ${movement}`).toBe(false);
      expect(await auditServiceOf(movement, 'VEHICLE_DEPARTED'), 'its audit row').toBe(DVD);
      expect(await act(dvdCommander, auditRowsAbout, [movement]), 'which DVD command reads').toBe('1');
      expect(await act(szsCommander, auditRowsAbout, [movement]), 'and SZS command cannot').toBe('0');
    } finally {
      await db.query('rollback');
    }
  });
});

describe('after 202609250029: everything a call-out produces belongs to its service', () => {
  beforeAll(async () => {
    await db.query(sql(OUTPUTS));
  }, 120_000);

  it.each(OUTPUT_TABLES)('isolates %s between the two services', async (table) => {
    // Exact sets, not "does not contain": each commander still reads their own.
    expect(await servicesVisible(dvdCommander, table), 'DVD commander').toEqual([DVD]);
    expect(await servicesVisible(szsCommander, table), 'SZS commander').toEqual([SZS]);
  });

  it.each(OUTPUT_TABLES)('still shows the owner both services in %s', async (table) => {
    expect(await servicesVisible(ownerUser, table)).toEqual([DVD, SZS].sort());
  });

  it('refuses a vehicle from the other service on a check-in', async () => {
    expect(
      await probe(szsCommander, `select public.attendance_check_in($1, $2, null, null, $3)::text`, [
        szs.interventionId,
        szs.commanderMemberId,
        dvdVehicle,
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
  });

  it('still accepts a vehicle of the call-out\'s own service', async () => {
    await db.query('begin');
    try {
      const interval = await act(
        szsCommander,
        `select public.attendance_check_in($1, $2, null, null, $3)::text`,
        [szs.interventionId, szs.commanderMemberId, szsVehicle],
      );
      expect(isRefusal(interval), `SZS vehicle on an SZS call-out: ${interval}`).toBe(false);
    } finally {
      await db.query('rollback');
    }
  });

  it.each([
    ['attendance_confirm', `select public.attendance_confirm($1, null)`],
    ['attendance_reject', `select public.attendance_reject($1, 'Razlog')`],
    ['attendance_unconfirm', `select public.attendance_unconfirm($1, 'Razlog')`],
    [
      'attendance_correct',
      `select public.attendance_correct($1, now() - interval '2 hours', now() - interval '1 hour', 'Razlog')`,
    ],
  ])('refuses a DVD commander the SZS %s', async (_name, statement) => {
    expect(await probe(dvdCommander, statement, [szsInterval])).toBe('ORGANIZATION_MISMATCH');
  });

  it('reports the SZS interval as refused inside a DVD commander\'s batch', async () => {
    // The batch reports per interval rather than raising, so one refusal cannot
    // abandon the rest - and an interval of another service is now one.
    expect(
      await probe(dvdCommander, `select outcome from public.attendance_confirm_many($1::uuid[], null)`, [
        [szsInterval],
      ]),
    ).toBe('ORGANIZATION_MISMATCH');
  });

  it('refuses a DVD member returning an SZS vehicle', async () => {
    expect(
      await probe(dvdFirefighter, `select public.record_vehicle_return($1)::text`, [szsMovement]),
    ).toBe('STAFF_REQUIRED');
  });

  it('refuses a DVD commander checking an SZS member out', async () => {
    expect(
      await probe(dvdCommander, `select public.attendance_check_out($1, $2)`, [
        szs.interventionId,
        szs.memberId,
      ]),
    ).toBe('STAFF_REQUIRED');
  });

  /**
   * Every attendance and vehicle command, once, as one service's commander.
   * Exact outcomes: a check-constraint failure is not a pass just because it is
   * not STAFF_REQUIRED.
   */
  async function runLifecycle(commander: string, callout: ServiceCallout, interval: string, movement: string) {
    const step = (statement: string, params: unknown[]) => act(commander, statement, params);
    expect(await step(`select public.attendance_check_out($1, $2)`, [callout.interventionId, callout.memberId]), 'check out').toBe('OK');
    expect(await step(`select public.attendance_confirm($1, null)`, [interval]), 'confirm').toBe('OK');
    expect(await step(`select public.attendance_unconfirm($1, 'Razlog')`, [interval]), 'unconfirm').toBe('OK');
    expect(
      await step(
        `select public.attendance_correct($1, now() - interval '3 hours', now() - interval '2 hours', 'Razlog')`,
        [interval],
      ),
      'correct',
    ).toBe('OK');
    expect(await step(`select public.attendance_reject($1, 'Razlog')`, [interval]), 'reject').toBe('OK');
    expect(await step(`select public.record_vehicle_return($1)::text`, [movement]), 'return the vehicle').toBe('OK');
  }

  it('lets SZS run its own attendance lifecycle end to end', async () => {
    await db.query('begin');
    try {
      // The interval and the movement were committed earlier, so check-out and
      // return land strictly after them.
      await runLifecycle(szsCommander, szs, szsInterval, szsMovement);
    } finally {
      await db.query('rollback');
    }
  });

  it('keeps every DVD attendance and vehicle workflow working', async () => {
    await db.query('begin');
    try {
      const interval = await act(dvdCommander, `select public.attendance_check_in($1, $2)::text`, [
        dvd.interventionId,
        dvd.memberId,
      ]);
      expect(isRefusal(interval), `DVD check-in: ${interval}`).toBe(false);
      const movement = await act(dvdCommander, `select public.record_vehicle_departure($1, $2)::text`, [
        dvdVehicle,
        dvd.interventionId,
      ]);
      expect(isRefusal(movement), `DVD departure: ${movement}`).toBe(false);
      // Everything below shares this transaction's `now()`, which
      // `attendance_interval_order` and `vehicle_movement_order` (end after
      // start) rightly refuse. In the application these are separate requests.
      // Move the starts back rather than commit rows that would leak into every
      // later test.
      await db.query(
        `update public.attendance_intervals set started_at = now() - interval '1 hour' where id = $1`,
        [interval],
      );
      await db.query(
        `update public.vehicle_movements set departed_at = now() - interval '1 hour' where id = $1`,
        [movement],
      );
      await runLifecycle(dvdCommander, dvd, interval, movement);
    } finally {
      await db.query('rollback');
    }
  });

  it('keeps attendance_totals caller-rights, so two policies bound it', async () => {
    // It is NOT security definer, so the caller's own policies decide what it
    // aggregates - and it joins `members` as well as `attendance_intervals`.
    //
    // Measured, not assumed: this assertion passes even WITHOUT 202609250029,
    // because P4a's `members` policy already drops the SZS member from the
    // join. So what this proves is not "029 scopes it" but "it is bounded by
    // two independent policies". The load-bearing check is `secdef = false`:
    // making it security definer would silently remove both at once.
    const { rows } = await db.query<{ secdef: boolean }>(
      `select p.prosecdef as secdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'attendance_totals'`,
    );
    expect(rows[0]!.secdef, 'attendance_totals must stay caller-rights').toBe(false);

    const dvdSees = await asUser(db, dvdCommander, async (client) => {
      const { rows: totals } = await client.query<{ member_id: string }>(
        `select member_id::text from public.attendance_totals()`,
      );
      return totals.map((row) => row.member_id);
    });
    expect(dvdSees, 'no SZS member appears in a DVD commander\'s totals').not.toContain(szs.memberId);
  });

  // --- the two definer readers ---------------------------------------------

  it('returns from intervention_audit exactly what the table itself would show, for every account', async () => {
    // The function reads with its owner's rights; the table read is bound by
    // the caller's policies. Equal for every account and both call-outs means
    // the function adds nothing to what a direct read would give.
    const everyone: Record<string, string> = {
      owner: ownerUser,
      dvdCommander,
      dvdFirefighter,
      szsCommander,
      szsFirefighter,
      dual: dualUser,
      suspended: suspendedUser,
      incomplete: incompleteUser,
      citizen: citizenUser,
    };
    const sizes = new Map<string, number>();
    for (const [label, userId] of Object.entries(everyone)) {
      for (const [service, callout] of [
        ['DVD', dvd],
        ['SZS', szs],
      ] as const) {
        const [viaFunction, viaTable] = await asUser(db, userId, async (client): Promise<[string[], string[]]> => {
          const fn = await client.query<{ id: string }>(
            `select event_id::text as id from public.intervention_audit($1) order by 1`,
            [callout.interventionId],
          );
          const table = await client.query<{ id: string }>(
            `select id::text from public.operational_audit where intervention_id = $1 order by 1`,
            [callout.interventionId],
          );
          return [fn.rows.map((row) => row.id), table.rows.map((row) => row.id)];
        });
        expect(viaFunction, `${label} on the ${service} call-out`).toEqual(viaTable);
        sizes.set(`${label}/${service}`, viaFunction.length);
      }
    }
    // ...and the equality is not the empty one.
    expect(sizes.get('dvdCommander/SZS'), 'DVD command sees nothing of SZS').toBe(0);
    expect(sizes.get('szsCommander/DVD'), 'SZS command sees nothing of DVD').toBe(0);
    for (const seen of ['owner/DVD', 'owner/SZS', 'dvdCommander/DVD', 'szsCommander/SZS', 'szsFirefighter/SZS']) {
      expect(sizes.get(seen), `${seen} sees its trail`).toBeGreaterThan(0);
    }
  });

  it('answers eligibility only to somebody who serves in that service', async () => {
    const ask = (userId: string, statement: string, params: unknown[]) => probe(userId, statement, params);
    expect(
      await ask(dvdCommander, `select public.is_eligible_recipient_in($1, $2)::text`, [szs.memberId, SZS]),
      'a DVD commander, about an SZS member',
    ).toBe('false');
    expect(
      await ask(citizenUser, `select public.is_eligible_recipient($1)::text`, [dvd.memberId]),
      'a citizen, about a DVD member - P0\'s answer again',
    ).toBe('false');
    expect(
      await ask(citizenUser, `select public.is_eligible_recipient_in($1, $2)::text`, [szs.memberId, SZS]),
      'a citizen, about an SZS member',
    ).toBe('false');

    // Everybody who needs the answer still gets it.
    expect(
      await ask(szsCommander, `select public.is_eligible_recipient_in($1, $2)::text`, [szs.memberId, SZS]),
      'SZS command, about its own member',
    ).toBe('true');
    expect(
      await ask(dvdCommander, `select public.is_eligible_recipient($1)::text`, [dvd.memberId]),
      'DVD command, about its own member',
    ).toBe('true');
    expect(
      await ask(dvdFirefighter, `select public.is_eligible_recipient($1)::text`, [dvd.memberId]),
      'a member about themselves, as push registration asks',
    ).toBe('true');
  });

  it('still lets SZS pick its own people and publish to them', async () => {
    await db.query('begin');
    try {
      const offered = await act(
        szsCommander,
        `select string_agg(member_id::text, ',') from public.eligible_recipients_in($1)`,
        [SZS],
      );
      expect(offered.split(','), 'the SZS picker').toContain(szs.memberId);
      const draft = await act(
        szsCommander,
        `select public.create_intervention_draft_in($1, 'POZAR', 'Pozar SZS 029', 'Upute.', 'Lokacija', $2)`,
        [SZS, `szs-029-${Math.random().toString(36).slice(2, 8)}`],
      );
      expect(isRefusal(draft), `the draft was created: ${draft}`).toBe(false);
      expect(
        await act(szsCommander, `select public.publish_intervention($1, $2)`, [draft, [szs.memberId]]),
        'published through the eligibility check',
      ).toBe(draft);
    } finally {
      await db.query('rollback');
    }
  });

  it('still lets SZS page the owner, through the owner\'s SZS member record', async () => {
    // What P0's "is still callable by an SZS commander" meant. The owner holds
    // no membership anywhere; a service pages them through a member record of
    // its own, and the owner clause answers for them there.
    await db.query('begin');
    try {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.members(full_name, user_id, organization_id, active)
         values ('Vlasnik Instalacije', $1, $2, true) returning id`,
        [ownerUser, SZS],
      );
      expect(
        await act(szsCommander, `select public.is_eligible_recipient_in($1, $2)::text`, [rows[0]!.id, SZS]),
      ).toBe('true');
    } finally {
      await db.query('rollback');
    }
  });

  // --- the audit row of a vehicle sent out with no call-out ----------------

  it('files a vehicle movement with no call-out under the vehicle\'s own service', async () => {
    await db.query('begin');
    try {
      const out = await act(
        szsCommander,
        `select public.record_vehicle_departure($1, null, 'Tocenje goriva')::text`,
        [szsSpareVehicle],
      );
      expect(isRefusal(out), `the departure was recorded: ${out}`).toBe(false);
      expect(await auditServiceOf(out, 'VEHICLE_DEPARTED'), 'the departure').toBe(SZS);
      expect(await act(szsCommander, auditRowsAbout, [out]), 'SZS command reads it').toBe('1');
      expect(await act(dvdCommander, auditRowsAbout, [out]), 'DVD command does not').toBe('0');

      await db.query(`update public.vehicle_movements set departed_at = now() - interval '1 hour' where id = $1`, [
        out,
      ]);
      expect(await act(szsCommander, `select public.record_vehicle_return($1)::text`, [out])).toBe('OK');
      expect(await auditServiceOf(out, 'VEHICLE_RETURNED'), 'and the return').toBe(SZS);

      // A DVD vehicle with no call-out is filed exactly where it always was.
      const dvdOut = await act(
        dvdCommander,
        `select public.record_vehicle_departure($1, null, 'Tocenje goriva')::text`,
        [dvdVehicle],
      );
      expect(isRefusal(dvdOut), `the DVD departure was recorded: ${dvdOut}`).toBe(false);
      expect(await auditServiceOf(dvdOut, 'VEHICLE_DEPARTED'), 'a DVD vehicle').toBe(DVD);
      expect(await act(dvdCommander, auditRowsAbout, [dvdOut]), 'DVD command reads it').toBe('1');
    } finally {
      await db.query('rollback');
    }
  });

  it('still derives the service from the call-out when there is one', async () => {
    await db.query('begin');
    try {
      const out = await act(szsCommander, `select public.record_vehicle_departure($1, $2)::text`, [
        szsSpareVehicle,
        szs.interventionId,
      ]);
      expect(isRefusal(out), `the departure was recorded: ${out}`).toBe(false);
      expect(await auditServiceOf(out, 'VEHICLE_DEPARTED')).toBe(SZS);
    } finally {
      await db.query('rollback');
    }
  });

  // --- documented as a later phase's ---------------------------------------

  it('keeps the correction-request path shut for SZS, as P4d\'s to open', async () => {
    // Fails closed: the INSERT policy finds the member through the DVD shim,
    // so an SZS member cannot ask for a correction to their own attendance.
    // When P4d opens this, this assertion is the one it should change.
    const outcome = await probe(
      szsFirefighter,
      `insert into public.attendance_correction_requests(interval_id, requested_by, message)
       values ($1, auth.uid(), 'Molim ispravku vremena') returning id::text`,
      [szsInterval],
    );
    expect(outcome).toMatch(/row-level security/);
  });
});

/*
 * The guard against a fourth hand-made list coming up short. Everything above
 * names what review found; this names nothing, and asks the catalogue instead.
 * It also applies every migration that sorts after this one first, so a later
 * file that re-opens any of it fails here rather than in review.
 */
describe('after P4b and anything that sorts after it: asked of the catalogue, not a list', () => {
  beforeAll(async () => {
    for (const file of MIGRATIONS.slice(MIGRATIONS.indexOf(OUTPUTS) + 1)) {
      await db.query(sql(file));
    }
  }, 120_000);

  it('derives the fifteen tables a call-out reaches', async () => {
    // Pinned so that a sixteenth is looked at by whoever adds it: the two
    // assertions below cover it automatically, but somebody should know.
    const { rows } = await db.query<{ tbl: string }>(REACHABLE_TABLES);
    expect(rows.map((row) => row.tbl).sort()).toEqual(
      [
        'interventions',
        'intervention_recipients',
        'intervention_updates',
        'intervention_acknowledgements',
        'operational_audit',
        ...OUTPUT_TABLES,
      ].sort(),
    );
  });

  it('leaves one DVD-only policy on those tables - the correction request P4d opens', async () => {
    const { rows } = await db.query<{ policy: string }>(
      `select tablename || '.' || policyname as policy from pg_policies
        where schemaname = 'public'
          and tablename in (${REACHABLE_TABLES})
          and (coalesce(qual, '') ~ $1 or coalesce(with_check, '') ~ $1)
        order by 1`,
      [DVD_ONLY],
    );
    expect(rows.map((row) => row.policy)).toEqual([
      'attendance_correction_requests.correction_requests_self_create',
    ]);
  });

  it('leaves one DVD-only function touching them - submit_response, which P4c makes service-aware', async () => {
    // Every function whose body names one of those tables: commands, readers,
    // triggers. Both survivors fail closed; the tests above say how.
    const { rows } = await db.query<{ proname: string }>(
      `with reachable as (${REACHABLE_TABLES})
       select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc ~ ('\\m(' || (select string_agg(tbl, '|') from reachable) || ')\\M')
          and p.prosrc ~ $1
        order by 1`,
      [DVD_ONLY],
    );
    expect(rows.map((row) => row.proname)).toEqual(['submit_response']);
  });

  it('lets no client call a definer function that asks nothing about the caller', async () => {
    // What the DVD-only check above cannot see: a function asking no question
    // at all. `is_eligible_recipient_in` was one until 029, and was found by
    // reading rather than by any check. Installation-wide, because nothing
    // about that defect was specific to call-outs. The one exception is a
    // one-line DVD wrapper, and then the function it wraps must ask.
    const { rows } = await db.query<{ fn: string; body: string }>(
      `select p.proname as fn, p.prosrc as body
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'execute')
          and p.prorettype <> 'trigger'::regtype`,
    );
    const asksTheCaller =
      /auth\.uid\(\)|is_(staff|command|admin)_(in|anywhere)\(|is_dvd_(staff|command|admin|owner)\(\)|current_(member_id|role)_in\(|current_dvd_role\(\)|current_member_id\(\)|is_installation_owner\(\)|current_account_is_usable\(\)|is_recipient_of\(|serves_with\(/;
    // A single `select` whose one call is an `*_in` function, handed DVD.
    const dvdWrapperOf = (body: string): string | undefined => {
      const calls = [...body.matchAll(/public\.(\w+)\(/g)].map((match) => match[1]!);
      return /^\s*select\b/.test(body) &&
        calls.length === 1 &&
        calls[0]!.endsWith('_in') &&
        body.includes(`'${DVD}'::uuid`)
        ? calls[0]
        : undefined;
    };
    const asks = new Map(rows.map((row) => [row.fn, asksTheCaller.test(row.body)]));
    const silent = rows
      .filter((row) => {
        if (asks.get(row.fn)) return false;
        const wrapped = dvdWrapperOf(row.body);
        return !(wrapped && asks.get(wrapped));
      })
      .map((row) => row.fn)
      .sort();
    expect(silent).toEqual([]);
  });

  it('falls back to DVD on exactly one of those tables, for rows with no call-out', async () => {
    // `operational_audit` labels a row with no call-out DVD unless its writer
    // names a service. Its only writers of such rows are the two vehicle
    // commands, which now always do - asserted by behaviour above, both
    // services. Pinned so a second table with a DVD fallback is noticed.
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and pg_get_triggerdef(t.oid) ~ 'dvd-if-orphaned'
          and c.relname in (${REACHABLE_TABLES})
        order by 1`,
    );
    expect(rows.map((row) => row.relname)).toEqual(['operational_audit']);
  });
});
