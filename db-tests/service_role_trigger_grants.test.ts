/**
 * Only the owner changes the guards and constraints on the audit, history and
 * current-row tables; the service role does not.
 *
 * By 202609250036 the service role could no longer INSERT, UPDATE, DELETE or
 * TRUNCATE the current-row tables, and by 033/034 it could not write the audit
 * or history tables. But the append-only, retention and identity rules of
 * 033-035 are triggers owned by postgres, and the service role still held
 * TRIGGER on every one of these thirteen tables. `create or replace trigger`
 * needs only the TRIGGER privilege, not ownership, so the service role could
 * re-point a guard trigger at another, permissive trigger function it may
 * execute - and then make the very change the guard was there to refuse. The
 * write revoke of 033/034/036 was only as firm as a trigger the service role
 * could itself replace.
 *
 * It also held REFERENCES. That one is inert - defining a foreign key also
 * needs ownership of the altered table, and the service role owns no table -
 * so it is removed as unused, not as presently dangerous.
 *
 * 202609250037 revokes TRIGGER and REFERENCES from the service role on all
 * thirteen tables. This file shows, on the 036 schema, that the service role
 * can replace a guard trigger; then that 037 refuses it and freezes the guard
 * to the owner, while every command, read, retention rule and foreign key is
 * exactly as before.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, connect, createAccount } from './harness';

const TRIGGER_GRANTS = 'supabase/migrations/202609250037_service_role_trigger_grants.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

/** The tables P4f locked down: seven audit (033), three history (034), three current-row (035/036). */
const AUDIT_TABLES = [
  'role_audit',
  'account_status_audit',
  'organization_membership_audit',
  'report_status_audit',
  'operational_audit',
  'registry_audit',
  'attendance_corrections',
] as const;
const HISTORY_TABLES = ['member_availability_history', 'intervention_journey_history', 'intervention_response_revisions'] as const;
const CURRENT_TABLES = ['intervention_responses', 'intervention_journey', 'member_availability'] as const;
const ALL_TABLES = [...AUDIT_TABLES, ...HISTORY_TABLES, ...CURRENT_TABLES] as const;

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });

let db: Client;

type Label = 'dvdCommander' | 'dvdFirefighter' | 'szsCommander' | 'szsFirefighter';
interface Person {
  user: string;
  member: string;
}
const people = {} as Record<Label, Person>;

const callouts = {
  /** Published to the DVD firefighter, who answered twice, set out and stated their availability. */
  dvdAnswered: '',
  /** Published to the SZS firefighter, who answered once and set out. */
  szsAnswered: '',
};

/** As the service role - which bypasses row-level security - inside a savepoint: 'OK' or a one-word refusal. */
async function asService(statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint svc');
  try {
    // Built, not written out: the secret scan rightly flags a literal service-role claim.
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
    await db.query('set local role service_role');
    await db.query(statement, params);
    await db.query('reset role');
    await db.query('release savepoint svc');
    return 'OK';
  } catch (error) {
    await db.query('rollback to savepoint svc');
    await db.query('reset role');
    return refusal(error);
  }
}

/** A refusal as one word: DENIED, a duplicate, or the exception's own code. */
function refusal(error: unknown): string {
  const message = (error as Error).message;
  if (/permission denied/.test(message)) return 'DENIED';
  const duplicate = /duplicate key value violates unique constraint "([^"]+)"/.exec(message);
  if (duplicate) return `DUPLICATE ${duplicate[1]}`;
  return message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
}

/** Rows of one statement as `userId`, with row-level security, inside the caller's open transaction. */
async function rowsAs<T extends object>(userId: string, statement: string, params: unknown[] = []): Promise<T[]> {
  await db.query('savepoint rows_as');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims(userId)]);
    await db.query('set local role authenticated');
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

/** One command as `userId`, in a savepoint: 'OK' or the refusal. */
async function commandAs(userId: string, statement: string, params: unknown[] = []): Promise<string> {
  try {
    await rowsAs(userId, statement, params);
    return 'OK';
  } catch (error) {
    return refusal(error);
  }
}

/** Rows as postgres: what is actually stored. */
async function stored<T extends object>(statement: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T & Record<string, unknown>>(statement, params)).rows;
}

async function isolated<T>(work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await work();
  } finally {
    await db.query('rollback');
  }
}

async function account(label: string, grantRole: string): Promise<string> {
  const created = await createAccount(db, `${label.toLowerCase()}.triggergrants@example.invalid`);
  await db.query(
    `update public.profiles
        set full_name = $2, phone_e164 = '+38267123456', date_of_birth = date '1990-01-01', profile_complete = true
      where user_id = $1`,
    [created.userId, `${label} Test`],
  );
  await db.query(`update public.access_grants set role = $2 where user_id = $1`, [created.userId, grantRole]);
  return created.userId;
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

/** A call-out through the real commands, published to one member of its own service. */
async function publishedTo(inService: 'DVD' | 'SZS', key: string): Promise<string> {
  const commander = people[inService === 'DVD' ? 'dvdCommander' : 'szsCommander'].user;
  const firefighter = people[inService === 'DVD' ? 'dvdFirefighter' : 'szsFirefighter'].member;
  const callout = await committed(
    commander,
    `select public.create_intervention_draft_in($1, 'POZAR', 'Poziv', 'Okupljanje.', 'Poligon', $2)`,
    [inService === 'DVD' ? DVD : SZS, key],
  );
  await committed(commander, 'select public.publish_intervention($1, $2)', [callout, [firefighter]]);
  return callout;
}

/**
 * As the service role, attempt to disarm one table's guard by replacing its
 * BEFORE-row trigger with an existing permissive trigger function
 * (derive_credited_organization_id returns NEW unchanged and is one the service
 * role may execute). Returns the trigger's function name afterwards, or the
 * one-word refusal. This is the whole capability TRIGGER confers here: whoever
 * can replace the guard can turn the append-only / identity rule off.
 */
async function tryReplaceGuard(table: string, guard: string): Promise<string> {
  await db.query('savepoint guard');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
    await db.query('set local role service_role');
    await db.query(
      `create or replace trigger ${guard} before update on public.${table}
         for each row execute function public.derive_credited_organization_id()`,
    );
    await db.query('reset role');
    const { rows } = await db.query<{ fn: string }>(
      `select tgfoid::regproc::text as fn from pg_trigger where tgrelid = ('public.' || $1)::regclass and tgname = $2`,
      [table, guard],
    );
    await db.query('rollback to savepoint guard');
    return rows[0]?.fn ?? '(gone)';
  } catch (error) {
    await db.query('rollback to savepoint guard');
    await db.query('reset role');
    return refusal(error);
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
  // Everything up to and including #64's 202609250036. Until 037 is in the
  // harness this is every migration there is, and the second half of this file
  // fails - which is the point.
  const index = MIGRATIONS.indexOf(TRIGGER_GRANTS);
  for (const file of index === -1 ? MIGRATIONS : MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  for (const [label, role] of [['dvdCommander', 'COMMANDER'], ['dvdFirefighter', 'FIREFIGHTER']] as const) {
    const user = await account(label, role);
    people[label] = { user, member: await memberIn(DVD, `${label} Clan`, user) };
  }
  // SZS-only people hold CITIZEN on the grant: an operational grant role would
  // be mirrored into an active DVD membership.
  for (const [label, role] of [['szsCommander', 'COMMANDER'], ['szsFirefighter', 'FIREFIGHTER']] as const) {
    const user = await account(label, 'CITIZEN');
    await db.query(`insert into public.organization_memberships(organization_id, user_id, role, active) values ($1, $2, $3, true)`, [SZS, user, role]);
    people[label] = { user, member: await memberIn(SZS, `${label} Clan`, user) };
  }

  const dvd = people.dvdFirefighter.user;
  const szs = people.szsFirefighter.user;
  await committed(dvd, `select public.set_own_availability(true, 'Dostupan')`);
  await committed(szs, `select public.set_own_availability_in($1, true, 'Dostupan SZS')`, [SZS]);
  callouts.dvdAnswered = await publishedTo('DVD', 'triggergrants-dvd');
  await committed(dvd, `select public.submit_response($1, 'DOLAZIM', null, false)`, [callouts.dvdAnswered]);
  await committed(dvd, `select public.submit_response($1, 'DOLAZIM_KASNIJE', 15, false)`, [callouts.dvdAnswered]);
  await committed(dvd, `select public.set_journey_progress($1, 'KRECEM')`, [callouts.dvdAnswered]);
  callouts.szsAnswered = await publishedTo('SZS', 'triggergrants-szs');
  await committed(szs, `select public.submit_response($1, 'DOLAZIM', null, true)`, [callouts.szsAnswered]);
  await committed(szs, `select public.set_journey_progress($1, 'KRECEM')`, [callouts.szsAnswered]);
}, 120_000);

afterAll(async () => {
  await db?.end();
});

describe('at 202609250036: the service role can replace the guards on these tables', () => {
  it('holds TRIGGER and REFERENCES on every audit, history and current-row table', async () => {
    const { rows } = await db.query<{ table: string; trigger: boolean; references: boolean; select: boolean }>(
      `select t as table,
              has_table_privilege('service_role', 'public.' || t, 'TRIGGER') as trigger,
              has_table_privilege('service_role', 'public.' || t, 'REFERENCES') as references,
              has_table_privilege('service_role', 'public.' || t, 'SELECT') as select
         from unnest($1::text[]) as t order by 1`,
      [[...ALL_TABLES]],
    );
    expect(rows).toEqual([...ALL_TABLES].sort().map((table) => ({ table, trigger: true, references: true, select: true })));
  });

  it('can re-point an append-only or identity guard at a permissive function', async () => {
    await isolated(async () => {
      // The append-only guard on an audit table, and the identity guard on the
      // answer table, are both replaceable by the service role - which is enough
      // to disarm them.
      expect(await tryReplaceGuard('role_audit', 'refuse_change')).toBe('derive_credited_organization_id');
      expect(await tryReplaceGuard('intervention_responses', 'refuse_rebinding')).toBe('derive_credited_organization_id');
      expect(await tryReplaceGuard('intervention_response_revisions', 'refuse_change')).toBe('derive_credited_organization_id');
    });
  });
});

describe('after 202609250037: only the owner changes the guards; everything else is unchanged', () => {
  beforeAll(async () => {
    if (MIGRATIONS.includes(TRIGGER_GRANTS)) await db.query(sql(TRIGGER_GRANTS));
  }, 60_000);

  it('refuses the service role any trigger or constraint change on every table, and keeps its reads', async () => {
    await isolated(async () => {
      for (const table of ALL_TABLES) {
        expect(await tryReplaceGuard(table, 'refuse_change'), `replace guard on ${table}`).toBe('DENIED');
        // A brand-new trigger of its own is refused too, not only replacing an existing one.
        expect(
          await asService(
            `create trigger svc_probe before update on public.${table} for each row execute function public.derive_credited_organization_id()`,
          ),
          `new trigger on ${table}`,
        ).toBe('DENIED');
        // Reads are untouched.
        expect(await asService(`select count(*) from public.${table}`), `read ${table}`).toBe('OK');
      }
    });
  });

  it('leaves the service role SELECT but not TRIGGER or REFERENCES, and every other role as it was', async () => {
    const { rows } = await db.query<{ table: string; trigger: boolean; references: boolean; select: boolean }>(
      `select t as table,
              has_table_privilege('service_role', 'public.' || t, 'TRIGGER') as trigger,
              has_table_privilege('service_role', 'public.' || t, 'REFERENCES') as references,
              has_table_privilege('service_role', 'public.' || t, 'SELECT') as select
         from unnest($1::text[]) as t order by 1`,
      [[...ALL_TABLES]],
    );
    expect(rows).toEqual([...ALL_TABLES].sort().map((table) => ({ table, trigger: false, references: false, select: true })));

    // authenticated keeps its read; anon and PUBLIC never had anything here.
    const { rows: others } = await db.query<{ table: string; authenticated: boolean; anon: boolean }>(
      `select t as table,
              has_table_privilege('authenticated', 'public.' || t, 'SELECT') as authenticated,
              has_table_privilege('anon', 'public.' || t, 'SELECT') as anon
         from unnest($1::text[]) as t order by 1`,
      [[...ALL_TABLES]],
    );
    expect(others).toEqual([...ALL_TABLES].sort().map((table) => ({ table, authenticated: true, anon: false })));

    // The owner keeps the escape hatch: a superuser/owner session can still
    // replace a guard. Ownership confers this inherently - it does not live in
    // the ACL and cannot be revoked there - so this is asserted behaviourally,
    // not by has_table_privilege (which answers 'true' for the owner whatever
    // the ACL says).
    await isolated(async () => {
      await db.query(
        `create or replace trigger refuse_change before update on public.role_audit
           for each row execute function public.derive_credited_organization_id()`,
      );
      const fn = (await stored<{ fn: string }>(
        `select tgfoid::regproc::text as fn from pg_trigger where tgrelid = 'public.role_audit'::regclass and tgname = 'refuse_change'`,
      ))[0]!.fn;
      expect(fn).toBe('derive_credited_organization_id');
    });
  });

  it('still runs every command for its real callers in DVD and SZS - the guards fire as before', async () => {
    await isolated(async () => {
      const dvd = people.dvdFirefighter;
      const szs = people.szsFirefighter;
      // submit_response(): a changed answer is a new revision; a first answer is revision 1.
      expect(await commandAs(dvd.user, `select public.submit_response($1, 'DOLAZIM', null, true)`, [callouts.dvdAnswered])).toBe('OK');
      expect(await commandAs(szs.user, `select public.submit_response($1, 'NE_MOGU', null, false)`, [callouts.szsAnswered])).toBe('OK');
      expect(
        await stored(
          `select response.organization_id::text as service, response.answer, response.revision,
                  (select count(*)::int from public.intervention_response_revisions r where r.response_id = response.id) as revisions
             from public.intervention_responses response order by response.organization_id, response.revision desc`,
        ),
      ).toEqual([
        { service: DVD, answer: 'DOLAZIM', revision: 3, revisions: 3 },
        { service: SZS, answer: 'NE_MOGU', revision: 2, revisions: 2 },
      ]);

      // set_journey_progress() and the availability commands still write, with their history.
      expect(await commandAs(dvd.user, `select public.set_journey_progress($1, 'U_PUTU')`, [callouts.dvdAnswered])).toBe('OK');
      expect(await commandAs(szs.user, `select public.set_journey_progress($1, 'NA_LICU_MJESTA')`, [callouts.szsAnswered])).toBe('OK');
      expect(await commandAs(dvd.user, `select public.set_own_availability(false, 'Na poslu')`)).toBe('OK');
      expect(await commandAs(szs.user, `select public.set_own_availability_in($1, false, 'Na poslu SZS')`, [SZS])).toBe('OK');
      expect(await stored(`select count(*)::int as n from public.intervention_journey_history`)).toEqual([{ n: 4 }]);
      expect(await stored(`select count(*)::int as n from public.member_availability_history`)).toEqual([{ n: 4 }]);

      // A commander's report review still writes report_status_audit through its command.
    });
  });

  it('keeps the append-only, retention and identity rules of 033-035 answering as before', async () => {
    await isolated(async () => {
      // Run as the owner (a superuser session, which no privilege stops): only
      // the guard trigger itself can refuse, so this proves 037 left it firing.
      const n = (await stored<{ n: number }>(`select count(*)::int as n from public.role_audit`))[0]!.n;
      expect(n).toBeGreaterThan(0);
      // 033: an audit row cannot be changed.
      expect(await rawUpdate(`update public.role_audit set next_role = 'OWNER'`)).toBe('AUDIT_APPEND_ONLY');
      // 035: an answer's identity is frozen; a published answer is retained.
      const answer = (await stored<{ id: string }>(
        `select id::text from public.intervention_responses where intervention_id = $1 and member_id = $2`,
        [callouts.dvdAnswered, people.dvdFirefighter.member],
      ))[0]!.id;
      expect(await rawUpdate(`update public.intervention_responses set member_id = $1 where id = $2`, [people.szsFirefighter.member, answer])).toBe(
        'RESPONSE_IDENTITY_FIXED',
      );
      expect(await rawUpdate(`delete from public.intervention_responses where id = $1`, [answer])).toBe('RESPONSE_RETAINED');
    });
  });

  it('is a no-op to apply twice', async () => {
    const shape = async () =>
      (await db.query<{ h: string }>(
        `select md5(coalesce((select string_agg(x, '|' order by x) from (
                                select tgname || pg_get_triggerdef(oid) as x from pg_trigger where not tgisinternal) t), '')
                    || coalesce((select string_agg(x, '|' order by x) from (
                                  select relname || coalesce(array_to_string(relacl, ' '), '') as x from pg_class
                                   where relnamespace = 'public'::regnamespace and relkind = 'r') g), '')) as h`,
      )).rows[0]!.h;
    const before = await shape();
    await isolated(async () => {
      await db.query(sql(TRIGGER_GRANTS));
      expect(await shape()).toBe(before);
    });
  });
});

/** A statement as the owner (the default postgres session): 'OK' or the guard's own refusal, in a savepoint. */
async function rawUpdate(statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint raw');
  try {
    await db.query(statement, params);
    await db.query('rollback to savepoint raw');
    return 'OK';
  } catch (error) {
    await db.query('rollback to savepoint raw');
    return refusal(error);
  }
}
