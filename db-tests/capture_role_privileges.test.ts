/**
 * The P4 capture credential: what it can WRITE.
 *
 * The production equivalence capture (scripts/p4-equivalence-production.sql)
 * impersonates every account - it sets `request.jwt.claims` and then
 * `set local role authenticated` - so it can measure what each one may read.
 * #85 documented a dedicated "read-only" capture role for it: SELECT, RLS
 * bypass and `GRANT authenticated TO <role>`. That role is not read-only.
 *
 *   inherited INSERT + BYPASSRLS   `authenticated` holds INSERT on three
 *                                  tables. Inherited by a BYPASSRLS role,
 *                                  those inserts skip the row policies that
 *                                  make them safe for the app.
 *   forged claims + SET ROLE       `request.jwt.claims` is an ordinary setting.
 *                                  Anyone who can `set role authenticated` can
 *                                  claim to be the owner and call every
 *                                  owner/commander function. INHERIT FALSE does
 *                                  not help: the capture needs SET.
 *   default_transaction_read_only  only a session default; the holder turns it
 *                                  off. `set transaction read only` inside the
 *                                  capture batch protects that batch, not the
 *                                  credential.
 *
 * So no role that can run this capture against a live database is unable to
 * write to it. The role that cannot write - SELECT and BYPASSRLS, no membership
 * in any API role - cannot impersonate, and is fit only to DUMP the data for a
 * capture run on a disposable restored copy. The last block holds that
 * property, so a later grant to PUBLIC cannot quietly break it.
 *
 * Every role here is created and dropped by this file; each connects as itself,
 * because SET ROLE from the superuser would make the superuser the session
 * user and every membership check would pass.
 */

import type { Client } from 'pg';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_URL, completeProfile, connect, createAccount, createMember, grantRole, resetSchema } from './harness';

const DOCUMENTED = 'p4_probe_documented';
const NO_INHERIT = 'p4_probe_noinherit';
const DUMP_ONLY = 'p4_probe_dump_only';
const ROLES = [DOCUMENTED, NO_INHERIT, DUMP_ONLY] as const;
const PASSWORD = 'local-test-only-not-a-secret';

let db: Client;
let owner = '';
let firefighter = '';

async function dropRoles(client: Client) {
  for (const role of ROLES) {
    const { rows } = await client.query(`select 1 from pg_roles where rolname = $1`, [role]);
    if (rows.length) await client.query(`drop owned by ${role}; drop role ${role}`);
  }
}

async function as<T>(role: string, work: (client: Client) => Promise<T>): Promise<T> {
  const url = new URL(DATABASE_URL);
  url.username = role;
  url.password = PASSWORD;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function attempt(client: Client, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await client.query(sql, params);
    return 'COMMITTED';
  } catch (error) {
    return (error as Error).message;
  }
}

/** Claims to be the owner, switches to the API role, and promotes the firefighter. */
async function forgedOwnerPromotion(client: Client): Promise<string> {
  await client.query('set default_transaction_read_only = off');
  await client.query('begin');
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: owner, role: 'authenticated' }),
    ]);
    await client.query('set local role authenticated');
    await client.query(`select public.owner_set_organization_membership($1, 'DVD', 'ADMIN')`, [firefighter]);
    await client.query('commit');
    return 'COMMITTED';
  } catch (error) {
    await client.query('rollback');
    return (error as Error).message;
  }
}

const NO_JWT_REPORT = `insert into public.citizen_reports(reporter_user_id, kind, description, incident_location)
  values ($1, 'DRUGO', 'written by the capture credential', 'nowhere')`;

beforeAll(async () => {
  db = await connect();
  await dropRoles(db);
  await resetSchema(db);

  owner = (await createAccount(db, 'capture-owner@example.test')).userId;
  await completeProfile(db, owner, 'Owner Capture');
  await grantRole(db, owner, 'OWNER');
  firefighter = (await createAccount(db, 'capture-ff@example.test')).userId;
  await completeProfile(db, firefighter, 'Ff Capture');
  await grantRole(db, firefighter, 'FIREFIGHTER');
  await createMember(db, 'Ff Capture', firefighter);

  for (const role of ROLES) {
    await db.query(`create role ${role} login bypassrls password '${PASSWORD}'`);
    await db.query(`grant usage on schema public, auth to ${role}`);
    await db.query(`grant select on all tables in schema public to ${role}`);
    await db.query(`grant select on auth.users to ${role}`);
    await db.query(`alter role ${role} set default_transaction_read_only = on`);
  }
  await db.query(`grant authenticated to ${DOCUMENTED}`);
  await db.query(`grant authenticated to ${NO_INHERIT} with inherit false, set true`);
}, 120_000);

afterAll(async () => {
  if (db) {
    await dropRoles(db);
    await db.end();
  }
});

async function reset() {
  await db.query(`delete from public.citizen_reports`);
  await grantRole(db, firefighter, 'FIREFIGHTER');
}

async function firefighterRole(): Promise<string> {
  const { rows } = await db.query<{ role: string }>(
    `select role from public.organization_memberships where user_id = $1 and organization_id = '00000000-0000-4000-8000-000000000001'`,
    [firefighter],
  );
  return rows[0]!.role;
}

describe('the role #85 documented (SELECT + BYPASSRLS + GRANT authenticated) can write', () => {
  it('ignores its own read-only default once it asks to', async () => {
    await as(DOCUMENTED, async (client) => {
      expect(await attempt(client, NO_JWT_REPORT, [firefighter])).toMatch(/read-only transaction/);
      await client.query('set default_transaction_read_only = off');
      expect(await attempt(client, NO_JWT_REPORT, [firefighter])).toBe('COMMITTED');
    });
    // No JWT at all: the reports_create_own policy would have refused it.
    expect((await db.query(`select count(*)::int as n from public.citizen_reports`)).rows[0].n).toBe(1);
    await reset();
  });

  it('acts as the owner with forged claims', async () => {
    expect(await as(DOCUMENTED, forgedOwnerPromotion)).toBe('COMMITTED');
    expect(await firefighterRole()).toBe('ADMIN');
    await reset();
  });
});

describe('WITH INHERIT FALSE, SET TRUE removes the direct writes but not the impersonation', () => {
  it('holds no write privilege of its own', async () => {
    await as(NO_INHERIT, async (client) => {
      await client.query('set default_transaction_read_only = off');
      expect(await attempt(client, NO_JWT_REPORT, [firefighter])).toMatch(/permission denied/);
    });
  });

  it('still acts as the owner with forged claims', async () => {
    expect(await as(NO_INHERIT, forgedOwnerPromotion)).toBe('COMMITTED');
    expect(await firefighterRole()).toBe('ADMIN');
    await reset();
  });
});

describe('SELECT + BYPASSRLS with no API-role membership has no write path (dump only)', () => {
  it('holds no table write privilege and no callable volatile security-definer function', async () => {
    await as(DUMP_ONLY, async (client) => {
      const { rows } = await client.query<{ writes: number; definers: number; roles: string[] }>(`
        select
          (select count(*)::int from pg_class t join pg_namespace s on s.oid = t.relnamespace
             cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p
            where s.nspname in ('public','auth','storage') and t.relkind in ('r','p','v')
              and has_table_privilege(current_user, t.oid, p)) as writes,
          (select count(*)::int from pg_proc f join pg_namespace s on s.oid = f.pronamespace
            where s.nspname in ('public','auth','storage') and f.prosecdef and f.provolatile = 'v'
              and has_function_privilege(current_user, f.oid, 'EXECUTE')) as definers,
          (select coalesce(array_agg(rolname::text order by rolname), '{}'::text[]) from pg_roles
            where rolname in ('anon','authenticated','service_role')
              and (pg_has_role(current_user, oid, 'USAGE') or pg_has_role(current_user, oid, 'SET'))) as roles`);
      expect(rows[0]).toEqual({ writes: 0, definers: 0, roles: [] });
    });
  });

  it('cannot write directly or impersonate', async () => {
    await as(DUMP_ONLY, async (client) => {
      await client.query('set default_transaction_read_only = off');
      expect(await attempt(client, NO_JWT_REPORT, [firefighter])).toMatch(/permission denied/);
    });
    expect(await as(DUMP_ONLY, forgedOwnerPromotion)).toMatch(/permission denied to set role "authenticated"/);
    expect(await firefighterRole()).toBe('FIREFIGHTER');
  });

  it('still reads every row past RLS, which is all a dump needs', async () => {
    const all = (await db.query(`select count(*)::int as n from auth.users`)).rows[0].n;
    expect(all).toBeGreaterThanOrEqual(2);
    await as(DUMP_ONLY, async (client) => {
      expect((await client.query(`select count(*)::int as n from auth.users`)).rows[0].n).toBe(all);
      expect((await client.query(`select count(*)::int as n from public.profiles`)).rows[0].n).toBe(all);
    });
  });
});
