/**
 * Integration harness for the SQL migrations.
 *
 * These tests run against a real PostgreSQL 16 server - locally and on a
 * standard GitHub runner's `postgres` service - so the row-level-security
 * policies, constraints and server functions are actually executed rather than
 * merely reviewed. See supabase/tests/00_supabase_stub.sql for exactly which
 * parts of the Supabase platform are emulated and which are not.
 *
 * Everything a test does goes through `asUser`, which sets the same
 * `request.jwt.claims` GUC Supabase sets and switches to the non-superuser
 * `authenticated` role. Without that role switch RLS would be bypassed and the
 * tests would prove nothing.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS = [
  'supabase/tests/00_supabase_stub.sql',
  'supabase/migrations/202609090001_accounts_reports.sql',
  'supabase/migrations/202609090002_internal_operations.sql',
  'supabase/migrations/202609110003_client_role_privileges.sql',
  'supabase/migrations/202609110004_function_execute_privileges.sql',
  'supabase/migrations/202609120005_organisational_writes.sql',
  'supabase/migrations/202609130006_attendance_truth.sql',
];

export const DATABASE_URL =
  process.env.DVD_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres@localhost:55432/postgres';

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * Rebuilds the whole schema from zero and applies every migration in order.
 * This is the "clean database migration from zero" check: if any migration is
 * not runnable on an empty database, every test in the suite fails loudly.
 */
export async function resetSchema(client: Client): Promise<void> {
  await client.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    create schema public;
    grant all on schema public to postgres;
  `);

  for (const file of MIGRATIONS) {
    const sql = readFileSync(resolve(process.cwd(), file), 'utf8');
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(`Migration failed: ${file}\n${(error as Error).message}`);
    }
  }
}

export interface TestAccount {
  userId: string;
  email: string;
  memberId?: string;
}

/** Creates an auth user; the migration's trigger gives it a PENDING grant. */
export async function createAccount(client: Client, email: string): Promise<TestAccount> {
  const { rows } = await client.query<{ id: string }>(
    `insert into auth.users(email, email_confirmed_at) values ($1, now()) returning id`,
    [email],
  );
  return { userId: rows[0]!.id, email };
}

/** Marks the profile complete, which the role contract requires. */
export async function completeProfile(
  client: Client,
  userId: string,
  fullName: string,
): Promise<void> {
  await client.query(
    `update public.profiles set full_name = $2, profile_complete = true where user_id = $1`,
    [userId, fullName],
  );
}

/** Assigns a role directly, bypassing the owner check. Setup only, never a test subject. */
export async function grantRole(
  client: Client,
  userId: string,
  role: string,
  active = true,
): Promise<void> {
  await client.query(`update public.access_grants set role = $2, active = $3 where user_id = $1`, [
    userId,
    role,
    active,
  ]);
}

/** Creates the operational member record and links it to an account. */
export async function createMember(
  client: Client,
  fullName: string,
  userId?: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.members(full_name, user_id) values ($1, $2) returning id`,
    [fullName, userId ?? null],
  );
  return rows[0]!.id;
}

/**
 * Runs `work` as the given authenticated user, with RLS in force.
 *
 * The role switch is what makes this real: `postgres` is a superuser and would
 * silently bypass every policy. Everything is wrapped in a transaction that is
 * always rolled back, so one test cannot leak state into the next.
 */
export async function asUser<T>(
  client: Client,
  userId: string | null,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    const claims = userId === null ? '{"role":"anon"}' : JSON.stringify({ sub: userId, role: 'authenticated' });
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await client.query(`set local role ${userId === null ? 'anon' : 'authenticated'}`);
    return await work(client);
  } finally {
    await client.query('rollback');
  }
}

/**
 * As asUser, but the work is COMMITTED.
 *
 * Needed for multi-actor scenarios: a commander publishes, then a firefighter
 * responds, and the second actor has to be able to see the first one's work.
 * Use asUser for permission checks and this for building the scenario.
 */
export async function asUserCommitted<T>(
  client: Client,
  userId: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await client.query('set local role authenticated');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/**
 * Same as asUser but the work is expected to be refused. Returns the error
 * message so a test can assert on the reason, not merely that something broke.
 */
export async function expectRefused(
  client: Client,
  userId: string | null,
  work: (client: Client) => Promise<unknown>,
): Promise<string> {
  try {
    await asUser(client, userId, work);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('Expected the operation to be refused, but it succeeded');
}

/**
 * Creates a DRAFT intervention THROUGH THE REAL COMMAND, returning its id.
 *
 * This used to insert the row directly as the superuser, which is why a hundred
 * passing tests never noticed that `create_intervention_draft` did not exist:
 * the helper had a privilege no commander in the application has ever held.
 * Going through the command means every scenario below now depends on the
 * authority check, the validation and the grants being right.
 *
 * Use `createDraftAsSuperuser` only to test a database constraint directly.
 */
export async function createDraft(
  client: Client,
  createdBy: string,
  overrides: Partial<{ title: string; location: string; key: string; kind: string }> = {},
): Promise<string> {
  return asUserCommitted(client, createdBy, async (asCommander) => {
    const { rows } = await asCommander.query<{ id: string }>(
      `select public.create_intervention_draft($1, $2, 'Okupljanje u bazi.', $3, $4) as id`,
      [
        overrides.kind ?? 'POZAR',
        overrides.title ?? 'Vjezba: provjera opreme',
        overrides.location ?? 'Poligon (izmisljena lokacija)',
        overrides.key ?? `key-${Math.random().toString(36).slice(2)}`,
      ],
    );
    return rows[0]!.id;
  });
}

/**
 * Inserts a draft with superuser privilege, bypassing every command.
 *
 * The one legitimate use is asserting that a database-level constraint holds
 * even when the command layer is skipped entirely - the backstop, not the door.
 */
export async function createDraftAsSuperuser(
  client: Client,
  createdBy: string,
  key: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.interventions(
       kind, title, instructions, incident_location, created_by, idempotency_key)
     values ('POZAR', 'Vjezba: provjera opreme', 'Okupljanje u bazi.',
             'Poligon (izmisljena lokacija)', $1, $2) returning id`,
    [createdBy, key],
  );
  return rows[0]!.id;
}
