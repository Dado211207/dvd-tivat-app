/**
 * Accounts and audit: who may read them, and whether what they record stays true.
 *
 * P4f of docs/MULTI_ORG_PLAN.md - the last P4 group: `role_audit`,
 * `account_status_audit`, `organization_membership_audit`,
 * `organization_memberships`, `organizations`, `access_grants`, `profiles` and
 * the citizen-report tables, plus the one audit table whose rows may have no
 * parent at all, `operational_audit`.
 *
 * Catalogued at 202609250032 before anything here was written:
 *
 *   reads      Every account-table policy that is not "your own row" asks
 *              `is_dvd_owner()` or `current_dvd_role() = 'OWNER'`. Both are the
 *              installation owner by definition - `current_role_in()` answers
 *              OWNER for the owner in every service - so they are not a DVD
 *              question, and an ADMIN of either service reads nothing but their
 *              own rows, today and after. Asserted, not changed.
 *   citizen    `citizen_reports`, `report_media`, `report_status_audit` and
 *   reports    `review_report()` answer DVD staff and DVD command only. The rows
 *              carry no service, and which service reviews a citizen report is
 *              an unanswered owner decision ("whether citizen reports are wanted
 *              at all, and who reviews them", docs/PRODUCTION_ARCHITECTURE.md).
 *              Pinned, not changed.
 *   history    None of the four account/report audit tables, nor
 *              `operational_audit`, was append-only as a database rule - only by
 *              the absence of a client privilege. The service role could
 *              rewrite who did what, delete it, or truncate the lot; P4a's,
 *              P4d's and P4e's append-only rules all stop at TRUNCATE; and a row
 *              with no call-out could be written claiming any service
 *              (organisation_columns.test.ts pinned that for P4 to close).
 *
 * The migration makes history append-only for everyone below the superuser, and
 * leaves writing it to the commands that already do.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, connect, createAccount } from './harness';

const AUDIT = 'supabase/migrations/202609250033_audit_history.sql';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const claims = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });

/** The audit tables P4f is about, and the two older append-only ones whose rule stopped at TRUNCATE. */
const AUDITS = ['role_audit', 'account_status_audit', 'organization_membership_audit', 'report_status_audit', 'operational_audit'] as const;
const OLDER = ['registry_audit', 'attendance_corrections'] as const;

let db: Client;

type Label =
  | 'owner'
  | 'dvdAdmin'
  | 'szsAdmin'
  | 'dvdCommander'
  | 'szsCommander'
  | 'dvdFirefighter'
  | 'dual'
  | 'citizen'
  | 'suspended';
interface Person {
  user: string;
  dvd?: string;
  szs?: string;
}
const people = {} as Record<Label, Person>;

let dvdCallout = '';
let szsCallout = '';
let szsVehicle = '';
let report = '';
/** The SZS vehicle's open movement, on no call-out. */
let movement = '';
/** The parentless audit row its departure wrote. */
let parentless = '';

/** As postgres, inside a savepoint: 'OK' or the refusal code / message. */
async function raw(statement: string, params: unknown[] = []): Promise<string> {
  await db.query('savepoint raw');
  try {
    await db.query(statement, params);
    await db.query('release savepoint raw');
    return 'OK';
  } catch (error) {
    await db.query('rollback to savepoint raw');
    const message = (error as Error).message;
    if (/permission denied/.test(message)) return 'DENIED';
    return message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
  }
}

/** As the service role - which bypasses row-level security - inside a savepoint. */
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
    const message = (error as Error).message;
    if (/permission denied/.test(message)) return 'DENIED';
    return message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1');
  }
}

/** Rows of one statement as `userId`, inside the caller's open transaction. */
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

async function isolated<T>(work: () => Promise<T>): Promise<T> {
  await db.query('begin');
  try {
    return await work();
  } finally {
    await db.query('rollback');
  }
}

async function account(label: string, grantRole: string): Promise<string> {
  const created = await createAccount(db, `${label.toLowerCase()}.p4f@example.invalid`);
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

/** One row of `table`, by the column that says what it is about. */
async function oneRowOf(table: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`select id::text from public.${table} order by id limit 1`);
  if (!rows.length) throw new Error(`${table} is empty - the fixture did not write it`);
  return rows[0]!.id;
}

/**
 * What every account can read from each P4f table: how many rows, and of which
 * service where the table has one. Asked the same way before and after.
 */
const READ_TABLES = [
  'role_audit', 'account_status_audit', 'organization_membership_audit', 'organization_memberships',
  'organizations', 'access_grants', 'profiles', 'citizen_reports', 'report_media', 'report_status_audit',
  'operational_audit',
] as const;

async function readGrid(): Promise<Record<string, string>> {
  return isolated(async () => {
    const out: Record<string, string> = {};
    for (const who of Object.keys(people) as Label[]) {
      for (const table of READ_TABLES) {
        const rows = await rowsAs<{ n: string }>(people[who].user, `select count(*)::text as n from public.${table}`);
        out[`${who}|${table}`] = rows[0]!.n;
      }
    }
    return out;
  });
}

let gridBefore: Record<string, string> = {};

beforeAll(async () => {
  db = await connect();
  await db.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    create schema public;
    grant all on schema public to postgres;
  `);
  // Everything before P4f. Until the migration exists this is every migration
  // there is, and the second half of this file fails - which is the point.
  const index = MIGRATIONS.indexOf(AUDIT);
  for (const file of index === -1 ? MIGRATIONS : MIGRATIONS.slice(0, index)) {
    await db.query(sql(file));
  }

  // The installation owner holds no membership and no member record.
  people.owner = { user: await account('Vlasnik', 'OWNER') };
  for (const [label, role] of [['dvdAdmin', 'ADMIN'], ['dvdCommander', 'COMMANDER'], ['dvdFirefighter', 'FIREFIGHTER'], ['suspended', 'FIREFIGHTER']] as const) {
    const user = await account(label, role);
    people[label] = { user, dvd: await memberIn(DVD, `${label} Clan`, user) };
  }
  // SZS-only people hold CITIZEN on the grant: an operational grant role would
  // be mirrored into an active DVD membership.
  for (const [label, role] of [['szsAdmin', 'ADMIN'], ['szsCommander', 'COMMANDER']] as const) {
    const user = await account(label, 'CITIZEN');
    await membership(user, SZS, role);
    people[label] = { user, szs: await memberIn(SZS, `${label} Clan`, user) };
  }
  const dual = await account('dual', 'FIREFIGHTER');
  await membership(dual, SZS, 'FIREFIGHTER');
  people.dual = { user: dual, dvd: await memberIn(DVD, 'dual DVD', dual), szs: await memberIn(SZS, 'dual SZS', dual) };
  people.citizen = { user: await account('Gradjanin', 'CITIZEN') };

  // Audit rows, written by the commands that write them. role_audit and
  // organization_membership_audit are already full: every grant and membership
  // above wrote one through its trigger.
  await committed(people.owner.user, `select public.owner_set_account_active($1, false, 'P4f suspenzija')`, [people.suspended.user]);
  await committed(people.owner.user, `select public.owner_set_organization_membership($1, 'SZS', 'FIREFIGHTER')`, [people.dvdFirefighter.user]);
  await committed(people.owner.user, `select public.owner_set_organization_membership($1, 'SZS', 'NONE')`, [people.dvdFirefighter.user]);

  report = await committed(
    people.citizen.user,
    `insert into public.citizen_reports(reporter_user_id, kind, description, incident_location)
     values (auth.uid(), 'DRUGO', 'Dim iza stare skole, P4f test.', 'Tivat') returning id`,
  );
  await committed(people.dvdCommander.user, `select public.review_report($1, 'UNDER_REVIEW', 'Provjera')`, [report]);

  dvdCallout = await committed(
    people.dvdCommander.user,
    `select public.create_intervention_draft('POZAR', 'DVD poziv', 'Okupljanje u bazi.', 'Poligon DVD', 'p4f-dvd')`,
  );
  szsCallout = await committed(
    people.szsCommander.user,
    `select public.create_intervention_draft_in($1, 'POZAR', 'SZS poziv', 'Okupljanje kod doma.', 'Poligon SZS', 'p4f-szs')`,
    [SZS],
  );
  szsVehicle = await committed(people.owner.user, `select public.admin_create_vehicle_in($1, 'P4F-SZS', 'Vozilo SZS', 'Tehnicko')`, [SZS]);
  // A vehicle out on no call-out: an audit row with no parent, filed by the
  // command under the vehicle's service.
  movement = await committed(people.szsCommander.user, `select public.record_vehicle_departure($1, null, 'Tocenje goriva')`, [szsVehicle]);
  const { rows: detached } = await db.query<{ id: string }>(
    `select id::text from public.operational_audit where intervention_id is null and detail ->> 'movement_id' = $1`,
    [movement],
  );
  parentless = detached[0]?.id ?? '';
}, 120_000);

afterAll(async () => {
  await db?.end();
});

describe('before P4f: audit history is append-only by privilege, not by rule', () => {
  it('writes every audit table through its command, and files the parentless row under the vehicle', async () => {
    for (const table of AUDITS) await oneRowOf(table);
    expect(parentless, 'the departure wrote a row with no call-out').not.toBe('');
    const { rows } = await db.query<{ organization_id: string }>(`select organization_id::text from public.operational_audit where id = $1`, [parentless]);
    expect(rows[0]!.organization_id).toBe(SZS);
  });

  it('lets a superuser session rewrite, remove and truncate any of them', async () => {
    await isolated(async () => {
      expect(await raw(`update public.role_audit set changed_by = $2 where id = $1`, [await oneRowOf('role_audit'), people.dvdAdmin.user])).toBe('OK');
      expect(await raw(`update public.account_status_audit set reason = 'Prepravljeno' where id = $1`, [await oneRowOf('account_status_audit')])).toBe('OK');
      expect(await raw(`delete from public.organization_membership_audit where id = $1`, [await oneRowOf('organization_membership_audit')])).toBe('OK');
      expect(await raw(`update public.report_status_audit set next_status = 'CONFIRMED' where id = $1`, [await oneRowOf('report_status_audit')])).toBe('OK');
      expect(await raw(`update public.operational_audit set actor_user_id = $2 where id = $1`, [parentless, people.dvdAdmin.user])).toBe('OK');
      for (const table of [...AUDITS, ...OLDER]) {
        expect(await raw(`truncate public.${table}`), table).toBe('OK');
      }
    });
  });

  it('lets the service role write, rewrite and truncate history, and claim a service for a parentless row', async () => {
    await isolated(async () => {
      expect(
        await asService(
          `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id, organization_id)
           values (null, 'IZMISLJENO', '{}'::jsonb, $1, $2)`,
          [people.dvdAdmin.user, SZS],
        ),
      ).toBe('OK');
      expect(await asService(`update public.operational_audit set detail = '{"x":1}' where id = $1`, [parentless])).toBe('OK');
      expect(await asService(`delete from public.account_status_audit`)).toBe('OK');
      expect(await asService(`truncate public.role_audit`)).toBe('OK');
      expect(await asService(`truncate public.registry_audit`)).toBe('OK');
    });
  });

  it('lets an UPDATE hang a parentless row on a call-out, or move a row to another', async () => {
    await isolated(async () => {
      expect(await raw(`update public.operational_audit set intervention_id = $2 where id = $1`, [parentless, szsCallout])).toBe('OK');
      const { rows } = await db.query<{ id: string }>(`select id::text from public.operational_audit where intervention_id = $1 limit 1`, [dvdCallout]);
      expect(
        await raw(`update public.operational_audit set intervention_id = $2, organization_id = $3 where id = $1`, [rows[0]!.id, szsCallout, SZS]),
      ).toBe('OK');
    });
  });

  it('records what every account can read of the account and audit tables', async () => {
    gridBefore = await readGrid();
    expect(Object.keys(gridBefore)).toHaveLength(Object.keys(people).length * READ_TABLES.length);
  });
});

describe('after P4f: history is written once, by the commands that write it', () => {
  beforeAll(async () => {
    if (MIGRATIONS.includes(AUDIT)) await db.query(sql(AUDIT));
  }, 60_000);

  // --- who reads what: unchanged -------------------------------------------

  it('lets every account read exactly what it read before', async () => {
    const after = await readGrid();
    const changed = Object.keys(after).filter((key) => after[key] !== gridBefore[key]);
    expect(changed).toEqual([]);
  });

  it('shows account history to the owner alone - an ADMIN of either service reads only their own rows', async () => {
    await isolated(async () => {
      const count = async (who: Label, table: string) =>
        Number((await rowsAs<{ n: string }>(people[who].user, `select count(*)::text as n from public.${table}`))[0]!.n);
      for (const table of ['role_audit', 'account_status_audit', 'organization_membership_audit']) {
        const total = Number((await db.query<{ n: string }>(`select count(*)::text as n from public.${table}`)).rows[0]!.n);
        expect(await count('owner', table), `owner reads all of ${table}`).toBe(total);
        for (const who of ['dvdAdmin', 'szsAdmin', 'dvdCommander', 'szsCommander', 'dual', 'citizen'] as const) {
          expect(await count(who, table), `${who} reads none of ${table}`).toBe(0);
        }
      }
      // Grants, profiles and memberships: your own, and the owner everybody's.
      for (const who of ['dvdAdmin', 'szsAdmin', 'dual', 'citizen'] as const) {
        const own = await rowsAs<{ user_id: string }>(people[who].user, 'select user_id::text from public.access_grants');
        expect(own.map((row) => row.user_id), who).toEqual([people[who].user]);
      }
    });
  });

  it('decides the owner exactly as it decides the installation owner, in every state', async () => {
    // Why the owner-read policies and owner_set_* commands are not a DVD
    // question: `is_dvd_owner()` and `current_dvd_role() = 'OWNER'` are the
    // installation owner under another name.
    const compare = async (label: string) => {
      for (const who of Object.keys(people) as Label[]) {
        const [row] = await rowsAs<{ dvd_owner: boolean; dvd_role_owner: boolean; installation_owner: boolean }>(
          people[who].user,
          `select public.is_dvd_owner() as dvd_owner,
                  coalesce(public.current_dvd_role() = 'OWNER', false) as dvd_role_owner,
                  public.is_installation_owner() as installation_owner`,
        );
        expect([row!.dvd_owner, row!.dvd_role_owner], `${label}: ${who}`).toEqual([row!.installation_owner, row!.installation_owner]);
      }
    };
    await isolated(async () => {
      await compare('as built');
      await db.query(`update public.access_grants set active = false where user_id = $1`, [people.owner.user]);
      await compare('owner suspended');
    });
    await isolated(async () => {
      await db.query(`update public.profiles set profile_complete = false where user_id = $1`, [people.owner.user]);
      await compare('owner half-registered');
    });
    await isolated(async () => {
      await db.query(`update public.organizations set active = false where id = $1`, [DVD]);
      await compare('DVD stood down');
    });
  });

  it('leaves citizen reports with DVD, as before, until somebody decides who reviews them', async () => {
    await isolated(async () => {
      const seen = async (who: Label) =>
        (await rowsAs<{ id: string }>(people[who].user, 'select id::text from public.citizen_reports')).map((row) => row.id);
      expect(await seen('citizen'), 'the reporter').toEqual([report]);
      expect(await seen('dvdFirefighter'), 'DVD staff').toEqual([report]);
      expect(await seen('szsCommander'), 'SZS command, unchanged').toEqual([]);
      expect(await seen('szsAdmin'), 'SZS admin, unchanged').toEqual([]);
    });
  });

  // --- history stays as written ---------------------------------------------

  it('refuses rewriting or removing any audit row, even as a superuser session', async () => {
    await isolated(async () => {
      expect(await raw(`update public.role_audit set changed_by = $2 where id = $1`, [await oneRowOf('role_audit'), people.dvdAdmin.user])).toBe('AUDIT_APPEND_ONLY');
      expect(await raw(`update public.account_status_audit set reason = 'Prepravljeno' where id = $1`, [await oneRowOf('account_status_audit')])).toBe('AUDIT_APPEND_ONLY');
      expect(await raw(`delete from public.organization_membership_audit where id = $1`, [await oneRowOf('organization_membership_audit')])).toBe('AUDIT_APPEND_ONLY');
      expect(await raw(`update public.report_status_audit set next_status = 'CONFIRMED' where id = $1`, [await oneRowOf('report_status_audit')])).toBe('AUDIT_APPEND_ONLY');
      expect(await raw(`update public.operational_audit set actor_user_id = $2 where id = $1`, [parentless, people.dvdAdmin.user])).toBe('AUDIT_APPEND_ONLY');
      expect(await raw(`update public.operational_audit set detail = '{"x":1}' where id = $1`, [parentless])).toBe('AUDIT_APPEND_ONLY');
      expect(await raw(`delete from public.operational_audit where id = $1`, [parentless])).toBe('AUDIT_APPEND_ONLY');
    });
  });

  it('refuses truncating any history table - the hole every earlier append-only rule left', async () => {
    await isolated(async () => {
      for (const table of [...AUDITS, ...OLDER]) {
        expect(await raw(`truncate public.${table}`), table).toBe('AUDIT_APPEND_ONLY');
      }
      // A cascade into operational_audit is a truncate of it too.
      expect(await raw(`truncate public.interventions cascade`)).toBe('AUDIT_APPEND_ONLY');
    });
  });

  it('refuses hanging a parentless row on a call-out, moving a row, or detaching one by hand', async () => {
    await isolated(async () => {
      expect(await raw(`update public.operational_audit set intervention_id = $2 where id = $1`, [parentless, szsCallout])).toBe('AUDIT_APPEND_ONLY');
      const { rows } = await db.query<{ id: string }>(`select id::text from public.operational_audit where intervention_id = $1 limit 1`, [dvdCallout]);
      const parented = rows[0]!.id;
      expect(
        await raw(`update public.operational_audit set intervention_id = $2, organization_id = $3 where id = $1`, [parented, szsCallout, SZS]),
      ).toBe('AUDIT_APPEND_ONLY');
      expect(await raw(`update public.operational_audit set intervention_id = null where id = $1`, [parented])).toBe('AUDIT_APPEND_ONLY');
    });
  });

  it('still lets a deleted call-out, or a deleted account, detach the rows that named it', async () => {
    await isolated(async () => {
      // The foreign keys' own ON DELETE SET NULL. The row keeps its service,
      // its wording and its time - it only stops pointing at what is gone.
      const { rows: before } = await db.query<{ id: string; organization_id: string; detail: string }>(
        `select id::text, organization_id::text, detail::text from public.operational_audit where intervention_id = $1 order by id`,
        [szsCallout],
      );
      expect(before.length).toBeGreaterThan(0);
      expect(await raw(`delete from public.interventions where id = $1`, [szsCallout])).toBe('OK');
      const { rows: after } = await db.query<{ id: string; organization_id: string; detail: string; intervention_id: string | null }>(
        `select id::text, organization_id::text, detail::text, intervention_id from public.operational_audit where id = any($1::uuid[]) order by id`,
        [before.map((row) => row.id)],
      );
      expect(after.map((row) => [row.id, row.organization_id, row.detail, row.intervention_id])).toEqual(
        before.map((row) => [row.id, row.organization_id, row.detail, null]),
      );

      // An account that was never granted anything - the only kind no other
      // audit table keeps alive - loses its name from the rows it acted in.
      await db.query('set local session_replication_role = replica');
      const { rows: ghost } = await db.query<{ id: string }>(
        `insert into auth.users(email, email_confirmed_at) values ('ghost.p4f@example.invalid', now()) returning id::text`,
      );
      await db.query('set local session_replication_role = origin');
      const { rows: acted } = await db.query<{ id: string }>(
        `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
         values ($1, 'P4F_GHOST', '{}'::jsonb, $2) returning id::text`,
        [dvdCallout, ghost[0]!.id],
      );
      expect(await raw(`delete from auth.users where id = $1`, [ghost[0]!.id])).toBe('OK');
      const { rows: kept } = await db.query<{ actor: string | null; intervention: string }>(
        `select actor_user_id::text as actor, intervention_id::text as intervention from public.operational_audit where id = $1`,
        [acted[0]!.id],
      );
      expect(kept[0]).toEqual({ actor: null, intervention: dvdCallout });
    });
  });

  it('leaves writing history to the commands - the service role writes none of it', async () => {
    await isolated(async () => {
      // The gap organisation_columns.test.ts pinned for P4: a parentless row
      // claiming a service on its own say-so.
      expect(
        await asService(
          `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id, organization_id)
           values (null, 'IZMISLJENO', '{}'::jsonb, $1, $2)`,
          [people.dvdAdmin.user, SZS],
        ),
      ).toBe('DENIED');
      for (const table of [...AUDITS, ...OLDER]) {
        expect(await asService(`delete from public.${table}`), `delete ${table}`).toBe('DENIED');
        expect(await asService(`truncate public.${table}`), `truncate ${table}`).toBe('DENIED');
      }
      // Reading stays.
      expect(await asService(`select count(*) from public.operational_audit`)).toBe('OK');
    });
  });

  it('still writes every audit row through the commands, attributed to whoever acted', async () => {
    await isolated(async () => {
      const count = async (table: string) => Number((await db.query<{ n: string }>(`select count(*)::text as n from public.${table}`)).rows[0]!.n);
      const before = Object.fromEntries(await Promise.all(AUDITS.map(async (table) => [table, await count(table)] as const)));
      const act = (user: string, statement: string, params: unknown[] = []) => rowsAs(user, statement, params);

      await act(people.owner.user, `select public.owner_set_role($1, 'FIREFIGHTER')`, [people.citizen.user]);
      await act(people.owner.user, `select public.owner_set_account_active($1, true, 'Vraceno')`, [people.suspended.user]);
      await act(people.owner.user, `select public.owner_set_organization_membership($1, 'SZS', 'COMMANDER')`, [people.dual.user]);
      await act(people.dvdCommander.user, `select public.review_report($1, 'CONFIRMED', 'Potvrdjeno')`, [report]);
      await act(people.szsCommander.user, `select public.record_vehicle_return($1)`, [movement]);

      for (const table of AUDITS) expect(await count(table), table).toBeGreaterThan(before[table]!);
      const { rows } = await db.query<{ changed_by: string }>(
        `select changed_by::text from public.account_status_audit where target_user_id = $1 order by changed_at desc limit 1`,
        [people.suspended.user],
      );
      expect(rows[0]!.changed_by).toBe(people.owner.user);
      // The return is parentless too, and filed by the command under the
      // vehicle's service, attributed to whoever returned it.
      const { rows: returned } = await db.query<{ organization_id: string; actor_user_id: string }>(
        `select organization_id::text, actor_user_id::text from public.operational_audit
          where intervention_id is null and event_type = 'VEHICLE_RETURNED' and detail ->> 'movement_id' = $1`,
        [movement],
      );
      expect(returned).toEqual([{ organization_id: SZS, actor_user_id: people.szsCommander.user }]);
    });
  });

  // --- asked of the catalogue -------------------------------------------------

  it('makes every audit and correction history append-only, truncate included', async () => {
    const { rows } = await db.query<{ table: string; row_rule: boolean; truncate_rule: boolean }>(
      `select c.relname::text as table,
              exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal
                        and pg_get_triggerdef(t.oid) ~ 'BEFORE (DELETE OR UPDATE|UPDATE OR DELETE)') as row_rule,
              exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal
                        and pg_get_triggerdef(t.oid) ~ 'BEFORE TRUNCATE') as truncate_rule
         from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and (c.relname ~ '_audit$' or c.relname = 'attendance_corrections')
        order by 1`,
    );
    expect(rows).toEqual(
      ['account_status_audit', 'attendance_corrections', 'operational_audit', 'organization_membership_audit', 'registry_audit', 'report_status_audit', 'role_audit']
        .map((table) => ({ table, row_rule: true, truncate_rule: true })),
    );
  });

  it('pins the DVD-only questions that remain, and why each may', async () => {
    // Every function body and policy that still asks DVD by name. Each is one
    // of three kinds; a fourth appearing here is a regression to look at.
    const DVD_ONLY = String.raw`is_dvd_(staff|command|admin|owner)\(\)|current_dvd_role\(\)|current_member_id\(\)|is_eligible_recipient\(`;
    const { rows: functions } = await db.query<{ fn: string }>(
      `select p.proname as fn from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ $1 order by 1`,
      [DVD_ONLY],
    );
    const { rows: policies } = await db.query<{ policy: string }>(
      `select tablename || '.' || policyname as policy from pg_policies
        where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~ $1 order by 1`,
      [DVD_ONLY],
    );
    expect({ functions: functions.map((row) => row.fn), policies: policies.map((row) => row.policy) }).toEqual({
      functions: [
        // The shims themselves (P3), defined in terms of current_dvd_role().
        'is_dvd_admin', 'is_dvd_command', 'is_dvd_owner', 'is_dvd_staff',
        // The installation owner under its DVD name - asserted equal above.
        'owner_set_account_active', 'owner_set_organization_membership', 'owner_set_role',
        // Citizen reports: DVD reviews them until somebody decides otherwise.
        'review_report',
        // "Shares a service with me", owner clause; nothing calls it since P4b.
        'serves_with',
      ],
      policies: [
        'access_grants.grants_owner_read', 'account_status_audit.status_audit_owner_read',
        'citizen_reports.reports_staff_read',
        'organization_membership_audit.membership_audit_owner_read', 'organization_memberships.memberships_owner_read',
        'profiles.profiles_owner_read',
        'report_media.media_owner_or_staff_read', 'report_status_audit.report_audit_leader_read',
        'role_audit.audit_owner_read',
      ],
    });
  });

  it('is a no-op to apply twice', async () => {
    const shape = async () =>
      (await db.query<{ h: string }>(
        `select md5(coalesce((select string_agg(x, '|' order by x) from (
                                select tgname || pg_get_triggerdef(oid) as x from pg_trigger where not tgisinternal) t), '')
                    || coalesce((select string_agg(x, '|' order by x) from (
                                  select proname || md5(prosrc) || coalesce(array_to_string(proacl, ' '), '') as x from pg_proc
                                   where pronamespace = 'public'::regnamespace) f), '')
                    || coalesce((select string_agg(x, '|' order by x) from (
                                  select relname || coalesce(array_to_string(relacl, ' '), '') as x from pg_class
                                   where relnamespace = 'public'::regnamespace and relkind = 'r') g), '')) as h`,
      )).rows[0]!.h;
    const before = await shape();
    await isolated(async () => {
      await db.query(sql(AUDIT));
      expect(await shape()).toBe(before);
    });
  });
});
