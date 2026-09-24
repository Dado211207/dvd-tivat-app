/**
 * P3 authority-equivalence gate.
 *
 * docs/MULTI_ORG_PLAN.md section 11 makes this the precondition for the whole
 * policy rewrite: before P4a is written, P3's shim has to be shown to resolve
 * identically for the accounts that actually exist, not only for fixtures.
 * `db-tests/organisation_authority.test.ts` covers twenty-six constructed
 * states and is where the breadth is; this covers the one thing a fixture
 * cannot, which is the real installation.
 *
 * The question, stated narrowly: does applying 202609240022 and 202609240023
 * change what `current_dvd_role()` or `current_member_id()` returns for any
 * account on production? Nothing else is graded here.
 *
 *   node scripts/p3-equivalence-gate.mjs <export.json>
 *
 * The export is produced by scripts/p3-equivalence-export.sql over a read-only
 * path and is pseudonymised at source - see that file for what it does and does
 * not read. Keep it outside the repository.
 *
 * Nothing here touches the hosted project. It drives a local PostgreSQL server
 * (DVD_TEST_DATABASE_URL, same one `npm run test:db` uses), creating and then
 * dropping a database of its own so the test database is left alone. Output is
 * synthetic account numbers and role values only.
 *
 * Exit codes follow scripts/check-migration-drift.mjs:
 *   0  the gate passed
 *   1  the gate failed - something diverged, or a check did not hold
 *   2  the gate could not be RUN, which is not the same as passing
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_URL =
  process.env.DVD_TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:55432/postgres';
const GATE_DB = 'p3_equivalence_gate';
const DVD = '00000000-0000-4000-8000-000000000001';

const P2 = 'supabase/migrations/202609240022_organisation_columns.sql';
const P3 = 'supabase/migrations/202609240023_organisation_authority.sql';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` - ${detail}` : ''}`);
}

function unrunnable(message) {
  console.error(`\nThe gate could not be run: ${message}`);
  process.exit(2);
}

/**
 * The migration order is read out of the harness rather than restated here.
 * Restating it would let the gate pass against an order the suite does not
 * use, which is the exact class of mistake it exists to catch.
 */
function migrationsFromHarness() {
  const source = readFileSync(resolve(REPO, 'db-tests/harness.ts'), 'utf8');
  const start = source.indexOf('export const MIGRATIONS = [');
  if (start === -1) unrunnable('db-tests/harness.ts no longer exports MIGRATIONS');
  const block = source.slice(start, source.indexOf('];', start));
  return [...block.matchAll(/'([^']+\.sql)'/g)].map((match) => match[1]);
}

const sqlFile = (file) => readFileSync(resolve(REPO, file), 'utf8');

async function main() {
  const exportPath = process.argv[2];
  if (!exportPath) {
    unrunnable('no export given. Usage: node scripts/p3-equivalence-gate.mjs <export.json>');
  }
  let exported;
  try {
    exported = JSON.parse(readFileSync(resolve(process.cwd(), exportPath), 'utf8'));
  } catch (error) {
    unrunnable(`the export could not be read - ${error.message}`);
  }
  for (const key of [
    'accounts',
    'organizations',
    'profiles',
    'access_grants',
    'organization_memberships',
    'members',
    'production_baseline',
    'hosted_function_fingerprints',
  ]) {
    if (!exported[key]) unrunnable(`the export has no "${key}" - see scripts/p3-equivalence-export.sql`);
  }

  console.log('=== 1. migration order ===');
  const all = migrationsFromHarness();
  const cut = all.indexOf(P2);
  check('the harness migration list was parsed', all.length > 0, `${all.length} entries`);
  check(`${P2} is present`, cut > -1);
  check(`${P3} immediately follows it`, all[cut + 1] === P3);
  check('nothing follows it', cut + 2 === all.length);
  if (failures) {
    console.error('\nThe gate assumes P2 then P3 are the last two entries; they are not.');
    process.exit(2);
  }
  const before = all.slice(0, cut);
  const toApply = all.slice(cut);
  console.log(`  production state  ${before.length} files, last ${before[before.length - 1]}`);
  toApply.forEach((file, i) => console.log(`  to apply       ${i + 1}. ${file}`));

  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (error) {
    unrunnable(`no local PostgreSQL at ${ADMIN_URL} - run \`npm run db:start\` (${error.message})`);
  }
  await admin.query(`drop database if exists ${GATE_DB} with (force)`);
  await admin.query(`create database ${GATE_DB}`);
  await admin.end();

  const gateUrl = new URL(ADMIN_URL);
  gateUrl.pathname = `/${GATE_DB}`;
  const db = new pg.Client({ connectionString: gateUrl.toString() });
  await db.connect();

  try {
    console.log('\n=== 2. rebuild the production schema state ===');
    for (const file of before) {
      try {
        await db.query(sqlFile(file));
      } catch (error) {
        unrunnable(`migration failed: ${file}\n${error.message}`);
      }
    }
    console.log(`  applied ${before.length} files on an empty database`);

    const { rows: fns } = await db.query(
      `select p.proname, md5(pg_get_functiondef(p.oid)) as md5
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('current_dvd_role','current_member_id')
        order by p.proname`,
    );
    const local = Object.fromEntries(fns.map((row) => [row.proname, row.md5]));
    const hosted = exported.hosted_function_fingerprints;
    for (const name of ['current_dvd_role', 'current_member_id']) {
      check(
        `${name}() is byte-identical to the hosted one`,
        local[name] === hosted[name],
        `local ${local[name]} / hosted ${hosted[name]}`,
      );
    }

    console.log('\n=== 3. load the exported state verbatim ===');
    // Every one of these tables carries a trigger that would rewrite what is
    // being loaded: handle_new_account() would mint a fresh CITIZEN grant, and
    // sync_dvd_membership_from_grant() would recreate the DVD membership the
    // owner deliberately does not have. Replica mode is what makes this a copy
    // rather than a re-enactment of how the rows came to exist.
    await db.query('set session_replication_role = replica');
    const { rows: tables } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
    );
    await db.query(`truncate ${tables.map((t) => `public.${t.relname}`).join(', ')} cascade`);
    await db.query('delete from auth.users');

    const id = (n) => (n === null ? null : exported.accounts.find((a) => a.n === n).id);

    for (const org of exported.organizations) {
      await db.query(
        'insert into public.organizations(id, code, display_name, active) values ($1,$2,$3,$4)',
        [org.id, org.code, org.display_name, org.active],
      );
    }
    for (const account of exported.accounts) {
      await db.query('insert into auth.users(id, email, email_confirmed_at) values ($1,$2,now())', [
        account.id,
        `account-${account.n}@example.invalid`,
      ]);
    }
    // Synthetic values throughout: no authority function reads any of them, and
    // the export never carried the real ones. Only the presence of the optional
    // fields is reproduced, because that is what registration state is made of.
    for (const profile of exported.profiles) {
      await db.query(
        `insert into public.profiles(user_id, email, full_name, phone_e164, date_of_birth, profile_complete)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          id(profile.user_n),
          `account-${profile.user_n}@example.invalid`,
          profile.full_name_present ? `Osoba ${profile.user_n}` : null,
          profile.phone_present ? `+3826700000${profile.user_n}` : null,
          profile.dob_present ? '1990-01-01' : null,
          profile.profile_complete,
        ],
      );
    }
    for (const grant of exported.access_grants) {
      await db.query(
        'insert into public.access_grants(user_id, role, active, granted_by) values ($1,$2,$3,$4)',
        [id(grant.user_n), grant.role, grant.active, id(grant.granted_by_n)],
      );
    }
    for (const membership of exported.organization_memberships) {
      await db.query(
        `insert into public.organization_memberships(organization_id, user_id, role, active, granted_by)
         values ($1,$2,$3,$4,$5)`,
        [
          membership.organization_id,
          id(membership.user_n),
          membership.role,
          membership.active,
          id(membership.granted_by_n),
        ],
      );
    }
    for (const member of exported.members) {
      await db.query(
        'insert into public.members(id, user_id, full_name, specialties, active) values ($1,$2,$3,$4,$5)',
        [member.id, id(member.user_n), `Clan ${member.member_n}`, member.specialties, member.active],
      );
    }
    await db.query('set session_replication_role = origin');

    for (const [table, expected] of [
      ['auth.users', exported.accounts.length],
      ['public.profiles', exported.profiles.length],
      ['public.access_grants', exported.access_grants.length],
      ['public.organizations', exported.organizations.length],
      ['public.organization_memberships', exported.organization_memberships.length],
      ['public.members', exported.members.length],
    ]) {
      const { rows } = await db.query(`select count(*)::int as n from ${table}`);
      check(`${table} holds ${expected} row(s)`, rows[0].n === expected, `found ${rows[0].n}`);
    }

    // Replica mode skipped the foreign keys on the way in. Re-check them by
    // hand: a copy that quietly violates its own constraints is not a copy.
    const { rows: dangling } = await db.query(`
      select 'access_grants.user_id' as ref, count(*)::int as n from public.access_grants g
        where not exists (select 1 from auth.users u where u.id = g.user_id)
      union all select 'access_grants.granted_by', count(*)::int from public.access_grants g
        where g.granted_by is not null and not exists (select 1 from auth.users u where u.id = g.granted_by)
      union all select 'profiles.user_id', count(*)::int from public.profiles p
        where not exists (select 1 from auth.users u where u.id = p.user_id)
      union all select 'organization_memberships.user_id', count(*)::int from public.organization_memberships m
        where not exists (select 1 from auth.users u where u.id = m.user_id)
      union all select 'organization_memberships.organization_id', count(*)::int from public.organization_memberships m
        where not exists (select 1 from public.organizations o where o.id = m.organization_id)
      union all select 'members.user_id', count(*)::int from public.members mem
        where mem.user_id is not null and not exists (select 1 from auth.users u where u.id = mem.user_id)`);
    check(
      'no dangling foreign key after the load',
      dangling.every((row) => row.n === 0),
      dangling.filter((row) => row.n !== 0).map((row) => `${row.ref}=${row.n}`).join(', '),
    );

    const { rows: owners } = await db.query(
      `select count(*)::int as n from public.access_grants where role = 'OWNER'`,
    );
    check(
      'access_grants_single_owner still holds after the load',
      owners[0].n <= 1,
      `${owners[0].n} OWNER grant(s)`,
    );

    console.log('\n=== 4. the two cases that must survive P3 ===');
    const { rows: ownerCase } = await db.query(
      `select g.active as grant_active, p.profile_complete,
              (select count(*)::int from public.organization_memberships m
                where m.user_id = g.user_id) as memberships
         from public.access_grants g join public.profiles p on p.user_id = g.user_id
        where g.role = 'OWNER'`,
    );
    check(
      'the installation owner holds no organisation membership',
      ownerCase.length === 1 &&
        ownerCase[0].memberships === 0 &&
        ownerCase[0].grant_active &&
        ownerCase[0].profile_complete,
      JSON.stringify(ownerCase[0] ?? null),
    );
    const { rows: suspended } = await db.query(
      `select count(*)::int as n from public.access_grants g
         join public.organization_memberships m
           on m.user_id = g.user_id and m.organization_id = $1
        where g.active = false and m.active = true`,
      [DVD],
    );
    check(
      'a suspended account still holds an active DVD membership',
      suspended[0].n >= 1,
      `${suspended[0].n} such account(s) - the mirror never fires on \`active\``,
    );

    /**
     * Probes every account. The caller owns the transaction: a plain `begin`
     * here would be a no-op inside one and its `rollback` would discard the
     * caller's work, which is how the first draft of this gate reported a
     * negative control that had silently undone its own sabotage.
     */
    async function measure() {
      const out = [];
      for (const account of exported.accounts) {
        await db.query('savepoint probe');
        try {
          await db.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: account.id, role: 'authenticated' }),
          ]);
          await db.query('set local role authenticated');
          const { rows } = await db.query(
            'select public.current_dvd_role() as role, public.current_member_id() as member_id',
          );
          const member = exported.members.find((m) => m.id === rows[0].member_id);
          out.push({ n: account.n, role: rows[0].role, member_n: member ? member.member_n : null });
        } finally {
          await db.query('rollback to savepoint probe');
        }
      }
      return out;
    }

    /** Measures the committed state, changing nothing. */
    async function measureAll() {
      await db.query('begin');
      try {
        return await measure();
      } finally {
        await db.query('rollback');
      }
    }

    /** Applies `sabotage`, measures, and always puts the copy back. */
    async function measureWith(sabotage, params = []) {
      await db.query('begin');
      try {
        await db.query(sabotage, params);
        return await measure();
      } finally {
        await db.query('rollback');
      }
    }

    const diff = (baseline, other) =>
      baseline.filter((row) => {
        const after = other.find((o) => o.n === row.n);
        return row.role !== after.role || row.member_n !== after.member_n;
      });

    console.log('\n=== 5. pre-P3 baseline ===');
    const pre = await measureAll();
    const mismatches = pre.filter((row) => {
      const expected = exported.production_baseline.rows.find((r) => r.account_n === row.n);
      return !expected || row.role !== expected.dvd_role || row.member_n !== expected.member_n;
    });
    check(
      "the copy reproduces production's own answers for every account",
      mismatches.length === 0,
      `${mismatches.length} mismatch(es) of ${pre.length}`,
    );
    if (mismatches.length > 0) {
      console.error('\nThe copy does not match production, so nothing measured on it means anything.');
      process.exit(1);
    }

    console.log('\n=== 6. apply the unapplied migrations, in order ===');
    for (const [i, file] of toApply.entries()) {
      const started = Date.now();
      try {
        await db.query(sqlFile(file));
      } catch (error) {
        check(`${file} applies to real production state`, false, error.message);
        process.exit(1);
      }
      console.log(`  ${i + 1}. ${file} - applied in ${Date.now() - started} ms`);
    }

    console.log('\n=== 7. post-P3 results ===');
    const post = await measureAll();
    const diverged = diff(pre, post);
    console.log('\n  n | pre role    | post role   | pre member | post member | verdict');
    console.log('  --+-------------+-------------+------------+-------------+---------');
    for (const row of pre) {
      const after = post.find((p) => p.n === row.n);
      const cell = (value) => String(value ?? 'NULL').padEnd(11);
      console.log(
        `  ${row.n} | ${cell(row.role)} | ${cell(after.role)} | ` +
          `${String(row.member_n ?? 'NULL').padEnd(10)} | ${String(after.member_n ?? 'NULL').padEnd(11)} | ` +
          `${diverged.includes(row) ? 'DIVERGED' : 'same'}`,
      );
    }

    console.log('\n=== 8. verdict ===');
    console.log(`  accounts compared               ${pre.length}`);
    console.log(`  with a role before P3           ${pre.filter((r) => r.role !== null).length}`);
    console.log(`  with a role after P3            ${post.filter((r) => r.role !== null).length}`);
    console.log(`  divergences                     ${diverged.length}`);
    check('no account changed effective access', diverged.length === 0);

    // A gate that cannot fail proves nothing. Three sabotages, because after P3
    // the owner and everybody else reach their role down different paths, and a
    // control exercising only one of them leaves the other unproven.
    console.log('\n=== 9. negative controls ===');
    const membershipsOff = await measureWith(
      'update public.organization_memberships set active = false where organization_id = $1',
      [DVD],
    );
    const caughtA = diff(post, membershipsOff);
    check(
      'deactivating every DVD membership is detected',
      caughtA.length > 0,
      `account(s) ${caughtA.map((r) => r.n).join(', ') || 'none'} flagged`,
    );
    check(
      'the installation owner is NOT affected by it',
      !caughtA.some((row) => row.role === 'OWNER'),
      'the owner resolves through is_installation_owner(), not a membership',
    );

    const ownerRow = post.find((row) => row.role === 'OWNER');
    if (ownerRow) {
      const ownerDemoted = await measureWith(
        `update public.access_grants set role = 'ADMIN' where role = 'OWNER'`,
      );
      const caughtB = diff(post, ownerDemoted);
      const after = ownerDemoted.find((row) => row.n === ownerRow.n);
      check(
        'demoting the OWNER grant is detected',
        caughtB.length > 0,
        `account(s) ${caughtB.map((r) => r.n).join(', ') || 'none'} flagged; ` +
          `the owner becomes ${after.role ?? 'NULL'} once the mirror has run`,
      );

      // 202609240023's header asserts that a shim reading memberships alone
      // would have locked the owner out on the day it was applied. That is a
      // claim about the real installation, so check it against the real
      // installation: run step 3 on its own for the owner's account.
      const { rows: membershipOnly } = await db.query(
        `select (select membership.role
                   from public.organization_memberships membership
                   join public.organizations organization
                     on organization.id = membership.organization_id
                  where membership.organization_id = $1
                    and membership.user_id = $2
                    and membership.active = true
                    and organization.active = true
                    and membership.role in ('ADMIN','COMMANDER','FIREFIGHTER')) as role`,
        [DVD, id(ownerRow.n)],
      );
      check(
        'a membership-only shim would indeed return NULL for the owner',
        membershipOnly[0].role === null,
        `is_installation_owner() is the only thing holding account ${ownerRow.n} up`,
      );
    }
  } finally {
    await db.end();
    const cleanup = new pg.Client({ connectionString: ADMIN_URL });
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${GATE_DB} with (force)`);
    await cleanup.end();
    console.log(`\n  isolated copy dropped (${GATE_DB})`);
  }

  console.log(failures === 0 ? '\nGATE PASSED' : `\nGATE FAILED - ${failures} check(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nThe gate could not be run: ${error.message}`);
  process.exit(2);
});
