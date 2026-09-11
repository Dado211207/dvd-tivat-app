/**
 * The role and status matrix, executed against real row-level security.
 *
 * These are the tests that decide whether the access model is real or
 * decorative. Every one of them switches to the non-superuser `authenticated`
 * database role first; without that, PostgreSQL would bypass every policy and
 * the suite would pass while proving nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  asUser,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  createDraft,
  createMember,
  expectRefused,
  grantRole,
  resetSchema,
} from './harness';

let db: Client;
const cast: Record<string, { userId: string; memberId?: string }> = {};

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  // A full cast, each with the profile/grant state its name describes.
  const make = async (
    key: string,
    email: string,
    role: string,
    opts: { complete?: boolean; active?: boolean; member?: boolean } = {},
  ) => {
    const account = await createAccount(db, email);
    if (opts.complete !== false) await completeProfile(db, account.userId, `Ime ${key}`);
    await grantRole(db, account.userId, role, opts.active !== false);
    const memberId =
      opts.member === false ? undefined : await createMember(db, `Ime ${key}`, account.userId);
    cast[key] = { userId: account.userId, memberId };
  };

  await make('owner', 'owner@example.invalid', 'OWNER');
  await make('admin', 'admin@example.invalid', 'ADMIN');
  await make('commander', 'commander@example.invalid', 'COMMANDER');
  await make('firefighterA', 'ffa@example.invalid', 'FIREFIGHTER');
  await make('firefighterB', 'ffb@example.invalid', 'FIREFIGHTER');
  await make('pending', 'pending@example.invalid', 'PENDING');
  await make('suspended', 'suspended@example.invalid', 'FIREFIGHTER', { active: false });
  await make('incomplete', 'incomplete@example.invalid', 'FIREFIGHTER', { complete: false });
}, 60_000);

afterAll(async () => {
  await db?.end();
});

const roleOf = async (userId: string | null): Promise<string | null> =>
  asUser(db, userId, async (client) => {
    const { rows } = await client.query<{ role: string | null }>('select public.current_dvd_role() as role');
    return rows[0]!.role;
  });

describe('the role contract', () => {
  it('gives an approved, complete, active account its role', async () => {
    expect(await roleOf(cast.owner!.userId)).toBe('OWNER');
    expect(await roleOf(cast.commander!.userId)).toBe('COMMANDER');
    expect(await roleOf(cast.firefighterA!.userId)).toBe('FIREFIGHTER');
  });

  it('gives an unapproved (PENDING) account no internal role', async () => {
    expect(await roleOf(cast.pending!.userId)).toBeNull();
  });

  it('gives a SUSPENDED account no role, even though a role is recorded', async () => {
    expect(await roleOf(cast.suspended!.userId)).toBeNull();
    const { rows } = await db.query('select role from public.access_grants where user_id = $1', [
      cast.suspended!.userId,
    ]);
    expect(rows[0]!.role).toBe('FIREFIGHTER');
  });

  it('gives an account with an incomplete profile no role', async () => {
    // This was the defect: the old function checked neither active nor
    // profile_complete, so a half-registered account kept its privileges.
    expect(await roleOf(cast.incomplete!.userId)).toBeNull();
  });

  it('does not let an anonymous caller ask for a role at all', async () => {
    // Stronger than "returns NULL". Before 202609110004 the anonymous role
    // could execute this through PostgreSQL's default PUBLIC grant and merely
    // got NULL back; now it cannot reach the function.
    const message = await expectRefused(db, null, (client) =>
      client.query('select public.current_dvd_role()'),
    );
    expect(message).toMatch(/permission denied for function current_dvd_role/i);
  });

  it('reports a granular status for the interface without granting anything', async () => {
    const statusOf = (userId: string) =>
      asUser(db, userId, async (client) => {
        const { rows } = await client.query<{ s: string }>('select public.current_account_status() as s');
        return rows[0]!.s;
      });
    expect(await statusOf(cast.suspended!.userId)).toBe('SUSPENDED');
    expect(await statusOf(cast.incomplete!.userId)).toBe('PROFILE_REQUIRED');
    expect(await statusOf(cast.pending!.userId)).toBe('ACTIVE');
    expect(await statusOf(cast.firefighterA!.userId)).toBe('ACTIVE');
  });

  it('does not expose the status function to an anonymous caller', async () => {
    // Least privilege: an anonymous visitor already knows it is anonymous and
    // needs nothing from the operational schema.
    const message = await expectRefused(db, null, (client) =>
      client.query('select public.current_account_status()'),
    );
    expect(message).toMatch(/permission denied/i);
  });
});

describe('reading organisational data', () => {
  it('lets approved staff read the roster', async () => {
    const count = await asUser(db, cast.firefighterA!.userId, async (client) => {
      const { rows } = await client.query<{ n: string }>('select count(*)::text as n from public.members');
      return Number(rows[0]!.n);
    });
    expect(count).toBeGreaterThan(0);
  });

  it('hides the roster from an unapproved account', async () => {
    for (const key of ['pending', 'suspended', 'incomplete']) {
      const count = await asUser(db, cast[key]!.userId, async (client) => {
        const { rows } = await client.query<{ n: string }>('select count(*)::text as n from public.members');
        return Number(rows[0]!.n);
      });
      expect(count, `${key} must not see the roster`).toBe(0);
    }
  });

  it('hides the roster from an anonymous caller', async () => {
    const message = await expectRefused(db, null, (client) => client.query('select * from public.members'));
    expect(message).toMatch(/permission denied/i);
  });
});

describe('role elevation is refused', () => {
  it('refuses an ADMIN attempting to assign a role', async () => {
    const message = await expectRefused(db, cast.admin!.userId, (client) =>
      client.query('select public.owner_set_role($1, $2)', [cast.firefighterA!.userId, 'COMMANDER']),
    );
    expect(message).toContain('OWNER_REQUIRED');
  });

  it('refuses a COMMANDER attempting to assign a role', async () => {
    const message = await expectRefused(db, cast.commander!.userId, (client) =>
      client.query('select public.owner_set_role($1, $2)', [cast.firefighterA!.userId, 'ADMIN']),
    );
    expect(message).toContain('OWNER_REQUIRED');
  });

  it('refuses a FIREFIGHTER attempting to promote themselves', async () => {
    const message = await expectRefused(db, cast.firefighterA!.userId, (client) =>
      client.query('select public.owner_set_role($1, $2)', [cast.firefighterA!.userId, 'OWNER']),
    );
    expect(message).toContain('OWNER_REQUIRED');
  });

  it('refuses the owner granting OWNER to anybody', async () => {
    const message = await expectRefused(db, cast.owner!.userId, (client) =>
      client.query('select public.owner_set_role($1, $2)', [cast.firefighterA!.userId, 'OWNER']),
    );
    expect(message).toContain('ROLE_NOT_ASSIGNABLE');
  });

  it('refuses the owner changing their own role or access', async () => {
    expect(
      await expectRefused(db, cast.owner!.userId, (client) =>
        client.query('select public.owner_set_role($1, $2)', [cast.owner!.userId, 'ADMIN']),
      ),
    ).toContain('CANNOT_CHANGE_OWN_ROLE');

    expect(
      await expectRefused(db, cast.owner!.userId, (client) =>
        client.query('select public.owner_set_account_active($1, false, $2)', [
          cast.owner!.userId,
          'test',
        ]),
      ),
    ).toContain('CANNOT_CHANGE_OWN_ACCESS');
  });

  it('refuses a second OWNER at the database level', async () => {
    // Not a policy that could be forgotten in code: a partial unique index.
    await expect(
      db.query(`update public.access_grants set role = 'OWNER' where user_id = $1`, [
        cast.admin!.userId,
      ]),
    ).rejects.toThrow(/access_grants_single_owner|duplicate key/i);
  });

  it('lets the owner assign an assignable role and records an audit entry', async () => {
    const target = await createAccount(db, `promote-${Date.now()}@example.invalid`);
    await completeProfile(db, target.userId, 'Ime Kandidat');

    await asUserCommitted(db, cast.owner!.userId, (client) =>
      client.query('select public.owner_set_role($1, $2)', [target.userId, 'FIREFIGHTER']),
    );

    const { rows } = await db.query(
      `select previous_role, next_role, changed_by from public.role_audit where target_user_id = $1`,
      [target.userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      previous_role: 'PENDING',
      next_role: 'FIREFIGHTER',
      changed_by: cast.owner!.userId,
    });
  });
});

describe('suspension', () => {
  it('requires a reason, writes an audit entry and removes the role', async () => {
    const target = await createAccount(db, `suspend-${Date.now()}@example.invalid`);
    await completeProfile(db, target.userId, 'Ime Za Suspenziju');
    await grantRole(db, target.userId, 'FIREFIGHTER');
    expect(await roleOf(target.userId)).toBe('FIREFIGHTER');

    expect(
      await expectRefused(db, cast.owner!.userId, (client) =>
        client.query('select public.owner_set_account_active($1, false, $2)', [target.userId, ' ']),
      ),
    ).toContain('REASON_REQUIRED');

    await asUserCommitted(db, cast.owner!.userId, (client) =>
      client.query('select public.owner_set_account_active($1, false, $2)', [
        target.userId,
        'Napustio drustvo.',
      ]),
    );

    expect(await roleOf(target.userId)).toBeNull();

    const { rows } = await db.query(
      `select previous_active, next_active, reason from public.account_status_audit
       where target_user_id = $1`,
      [target.userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ previous_active: true, next_active: false });
  });

  it('refuses suspending the owner account', async () => {
    const message = await expectRefused(db, cast.owner!.userId, (client) =>
      client.query('select public.owner_set_account_active($1, false, $2)', [
        cast.owner!.userId,
        'Pokusaj samosuspenzije.',
      ]),
    );
    // There is exactly one owner, so this is always a self-change: the
    // self-change guard is what refuses it. OWNER_ACCOUNT_PROTECTED remains as
    // defence in depth for a future multi-owner recovery design.
    expect(message).toContain('CANNOT_CHANGE_OWN_ACCESS');
  });

  it('refuses a non-owner suspending anybody', async () => {
    const message = await expectRefused(db, cast.admin!.userId, (client) =>
      client.query('select public.owner_set_account_active($1, false, $2)', [
        cast.firefighterA!.userId,
        'pokusaj',
      ]),
    );
    expect(message).toContain('OWNER_REQUIRED');
  });
});

describe('direct writes are impossible', () => {
  it('refuses an authenticated client inserting an intervention directly', async () => {
    const message = await expectRefused(db, cast.commander!.userId, (client) =>
      client.query(
        `insert into public.interventions(kind, title, instructions, incident_location, created_by, idempotency_key)
         values ('POZAR', 'Direktno', 'Bez servera', 'Nigdje', $1, 'x')`,
        [cast.commander!.userId],
      ),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it('refuses forging an attendance record directly', async () => {
    const intervention = await createDraft(db, cast.commander!.userId);
    const message = await expectRefused(db, cast.firefighterA!.userId, (client) =>
      client.query(
        `insert into public.attendance_intervals(intervention_id, member_id, started_at, recorded_by)
         values ($1, $2, now(), $3)`,
        [intervention, cast.firefighterA!.memberId, cast.firefighterA!.userId],
      ),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it('refuses editing a recorded response directly', async () => {
    const message = await expectRefused(db, cast.firefighterA!.userId, (client) =>
      client.query(`update public.intervention_responses set answer = 'DOLAZIM'`),
    );
    expect(message).toMatch(/permission denied/i);
  });

  it('refuses tampering with the audit trail', async () => {
    const message = await expectRefused(db, cast.owner!.userId, (client) =>
      client.query(`delete from public.role_audit`),
    );
    expect(message).toMatch(/permission denied/i);
  });
});

/**
 * The privilege layer underneath the policies.
 *
 * A Supabase project grants `anon` and `authenticated` every privilege on every
 * new table in `public`, so without 202609110003 the refusals above rest on the
 * absence of a write policy alone - and TRUNCATE is not subject to row level
 * security at all. These tests assert the grants themselves, so a future table
 * cannot quietly arrive with the platform's defaults still on it.
 */
describe('client roles hold only the privileges their policies need', () => {
  /** The only direct writes any policy in this schema permits. */
  const INSERT_ALLOWED = [
    'attendance_correction_requests',
    'citizen_reports',
    'report_media',
  ] as const;

  it('grants anon nothing at all on any table', async () => {
    const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
      `select g.table_name, g.privilege_type
         from information_schema.role_table_grants g
         join pg_class c on c.relname = g.table_name
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
        where g.table_schema = 'public' and c.relkind = 'r' and g.grantee = 'anon'`,
    );
    expect(rows).toEqual([]);
  });

  it('grants authenticated read on every table and write on no other', async () => {
    // `privilege_type` is an information_schema domain, so it is cast to text:
    // the driver has no parser for the domain's array type.
    const { rows } = await db.query<{ table_name: string; privileges: string }>(
      `select g.table_name,
              string_agg(distinct g.privilege_type::text, ',' order by g.privilege_type::text) as privileges
         from information_schema.role_table_grants g
         join pg_class c on c.relname = g.table_name
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
        where g.table_schema = 'public' and c.relkind = 'r' and g.grantee = 'authenticated'
        group by g.table_name
        order by g.table_name`,
    );

    // Every table carries a SELECT policy, so every table is readable and row
    // level security decides the rows.
    const { rows: allTables } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(allTables.map((table) => table.relname));

    for (const row of rows) {
      const expected = (INSERT_ALLOWED as readonly string[]).includes(row.table_name)
        ? ['INSERT', 'SELECT']
        : ['SELECT'];
      expect(`${row.table_name}: ${row.privileges}`).toBe(
        `${row.table_name}: ${expected.join(',')}`,
      );
    }
  });

  it('never grants a client role a privilege with no policy behind it', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select distinct g.table_name
         from information_schema.role_table_grants g
         join pg_class c on c.relname = g.table_name
         join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema
        where g.table_schema = 'public' and c.relkind = 'r'
          and g.grantee in ('anon', 'authenticated')
          and g.privilege_type = 'INSERT'
          and not exists (
            select 1 from pg_policies p
             where p.schemaname = 'public' and p.tablename = g.table_name
               and p.cmd in ('INSERT', 'ALL')
          )`,
    );
    expect(rows).toEqual([]);
  });

  it('leaves no function in public executable by anon', async () => {
    // `revoke ... from anon` does not remove PostgreSQL's default PUBLIC grant,
    // so a function added without its own revoke stays callable over
    // /rest/v1/rpc without signing in. This asserts the end state, not the
    // statement that was written.
    const { rows } = await db.query<{ fn: string; acl: string }>(
      `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn,
              coalesce(array_to_string(p.proacl::text[], ' '), 'DEFAULT') as acl
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not exists (
            select 1 from pg_depend d
             where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
          )
          and has_function_privilege('anon', p.oid, 'EXECUTE')
        order by 1`,
    );
    expect(rows.map((row) => `${row.fn} -> ${row.acl}`)).toEqual([]);
  });

  it('keeps the authority predicates executable by authenticated', async () => {
    // Policies are evaluated with the caller's privileges, so losing these
    // would turn every read into an error rather than an empty result.
    const predicates = [
      'current_dvd_role()',
      'current_member_id()',
      'is_dvd_staff()',
      'is_dvd_command()',
      'is_dvd_owner()',
      'is_recipient_of(uuid)',
    ];
    for (const predicate of predicates) {
      const { rows } = await db.query<{ allowed: boolean }>(
        `select has_function_privilege('authenticated', $1, 'EXECUTE') as allowed`,
        [`public.${predicate}`],
      );
      expect(`${predicate}: ${rows[0]!.allowed}`).toBe(`${predicate}: true`);
    }
  });

  it('refuses TRUNCATE, which row level security would not catch', async () => {
    // `pending` has a complete profile but no operational role. Before the
    // privilege migration this statement succeeded and emptied the table: RLS
    // does not apply to TRUNCATE, so the policies could not have stopped it.
    const message = await expectRefused(db, cast.pending!.userId, (client) =>
      client.query(`truncate public.operational_audit`),
    );
    expect(message).toMatch(/permission denied/i);
  });
});
