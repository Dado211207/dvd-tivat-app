/**
 * The three "restore the exact repository text" migrations, and where they go.
 *
 * None changes behaviour. All three exist because an apply to the hosted project
 * carried the right SQL with the in-body comments stripped. For the first two
 * the correction was then run against the server and never committed, so the
 * thing that fixed the drift became drift; `202609130006a` sat that way for
 * eleven days. The third, `202609230021`, was found by
 * `scripts/check-migration-drift.mjs` rather than by hand, which is what that
 * script is for.
 *
 * A file that does nothing is easy to move, and one of these three cannot be
 * moved. `202609130006a` re-creates thirteen function bodies at their state
 * after `202609130006`, and three of those thirteen are re-created AGAIN by
 * `202609230019` so they write to `registry_audit` instead of the renamed-away
 * `organisation_audit`. Applied after the rename it puts the dead table name
 * back into all three - and PL/pgSQL only re-parses a body when it runs, so
 * nothing fails until somebody edits a group, adds a member or links an
 * account.
 *
 * The last test below is the one that matters: it applies the file in the wrong
 * place on purpose and shows the breakage, so the ordering rule has evidence
 * behind it rather than a comment.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, asUserCommitted, completeProfile, connect, createAccount, grantRole } from './harness';

const RESTORE_006A = 'supabase/migrations/202609130006a_restore_exact_repository_function_text.sql';
const RESTORE_020 = 'supabase/migrations/202609230020_restore_exact_repository_function_text_audit_triggers.sql';
const RESTORE_021 = 'supabase/migrations/202609230021_restore_intervention_audit_exact_text.sql';
const ATTENDANCE_TRUTH = 'supabase/migrations/202609130006_attendance_truth.sql';
const REGISTRY_RENAME = 'supabase/migrations/202609230019_registry_rename.sql';
const P4B_OUTPUTS = 'supabase/migrations/202609250029_intervention_outputs.sql';

let db: Client;

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

async function blankSchema(client: Client): Promise<void> {
  await client.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    create schema public;
    grant all on schema public to postgres;
  `);
}

/** Every function body in `public`, as one hash. Nothing else distinguishes a
 *  no-op from a re-creation that quietly changed a line. */
async function functionText(client: Client): Promise<{ count: number; hash: string }> {
  const { rows } = await client.query<{ sig: string; body: string }>(
    `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
            md5(p.prosrc) as body
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind in ('f', 'p')
      order by sig`,
  );
  return {
    count: rows.length,
    hash: createHash('md5').update(rows.map((r) => `${r.sig}=${r.body}`).join('\n')).digest('hex'),
  };
}

async function applyAll(client: Client, files: readonly string[]): Promise<void> {
  await blankSchema(client);
  for (const file of files) {
    await client.query(sql(file));
  }
}

beforeAll(async () => {
  db = await connect();
});

afterAll(async () => db?.end());

describe('the restore files are in the migration list where they ran', () => {
  it('puts 006a immediately after the migration it restores', () => {
    const truth = MIGRATIONS.indexOf(ATTENDANCE_TRUTH);
    const restore = MIGRATIONS.indexOf(RESTORE_006A);
    expect(truth, 'attendance_truth is in the list').toBeGreaterThan(-1);
    expect(restore, '006a is in the list').toBe(truth + 1);
  });

  it('keeps 006a before the registry rename', () => {
    // Stated separately from the line above because THIS is the constraint with
    // teeth; the position after 006 is only how it is satisfied.
    expect(MIGRATIONS.indexOf(RESTORE_006A)).toBeLessThan(MIGRATIONS.indexOf(REGISTRY_RENAME));
  });
});

describe('neither restore file changes anything on a replay', () => {
  it('006a is a no-op applied where it belongs', async () => {
    const upTo006 = MIGRATIONS.slice(0, MIGRATIONS.indexOf(RESTORE_006A));
    await applyAll(db, upTo006);
    const before = await functionText(db);

    await db.query(sql(RESTORE_006A));
    const after = await functionText(db);

    expect(after.count, 'it creates nothing new').toBe(before.count);
    expect(after.hash, 'and rewrites nothing').toBe(before.hash);
  });

  it('020 is a no-op applied where it sits', async () => {
    // This used to be asserted on top of the WHOLE list, which held only while
    // nothing after 020 changed a function 020 restores. 202609250038 (P5)
    // rewrites `owner_set_role` and `owner_set_organization_membership` to retire
    // the DVD role mirror, so re-applying 020 at the end would now undo P5 - the
    // same situation the 021 block below already handles for `intervention_audit`.
    // So 020 is asserted where it sits, and the block below asserts what it would
    // undo later.
    await applyAll(db, MIGRATIONS.slice(0, MIGRATIONS.indexOf(RESTORE_020) + 1));
    const before = await functionText(db);

    await db.query(sql(RESTORE_020));
    const after = await functionText(db);

    expect(after.count).toBe(before.count);
    expect(after.hash).toBe(before.hash);
  });

  it('what 020 would undo if it ran after P5: the mirror comes back', async () => {
    // The counterpart to the "where it sits" assertion: 020 re-creates the
    // pre-P5 text of the two owner functions, so replaying it on the full list
    // resurrects the compatibility-grant mirror block. This is why the migration
    // order matters and why 020 is not re-run at the end.
    await applyAll(db, MIGRATIONS);
    const beforeReplay = await functionText(db);
    await db.query(sql(RESTORE_020));
    const afterReplay = await functionText(db);
    expect(afterReplay.hash, '020 out of order rewrites the P5 functions').not.toBe(beforeReplay.hash);
  });

  it('021 is a no-op applied where it sits', async () => {
    // This used to be asserted at the END of the list, which held only while
    // 202609150010 was the sole migration defining `intervention_audit`. The
    // test said it would fail when that stopped being true, and it did:
    // 202609250029 re-creates the function with a service check. So 021 is
    // now asserted where it sits, and the block below asserts what it would
    // undo anywhere later.
    await applyAll(db, MIGRATIONS.slice(0, MIGRATIONS.indexOf(RESTORE_021) + 1));
    const before = await functionText(db);

    await db.query(sql(RESTORE_021));
    const after = await functionText(db);

    expect(after.count).toBe(before.count);
    expect(after.hash).toBe(before.hash);
  });
});

describe('021 after the P4b output migration is not harmless either', () => {
  /*
   * 021 restores `intervention_audit` at its DVD-only text. 202609250029
   * re-creates it asking the call-out's own service, because as a `security
   * definer` reader it returned an SZS call-out's whole chronology to any DVD
   * commander. Replayed after 029 - where a later contributor would put it,
   * since that is where new migrations go - 021 would reopen exactly that.
   * Its position is load-bearing now, as 006a's always was.
   */
  it('keeps 021 before the migration that secures the function it restores', () => {
    expect(MIGRATIONS.indexOf(RESTORE_021)).toBeGreaterThan(-1);
    expect(MIGRATIONS.indexOf(RESTORE_021)).toBeLessThan(MIGRATIONS.indexOf(P4B_OUTPUTS));
  });

  it('puts the DVD-only predicate back if replayed after it', async () => {
    await applyAll(db, MIGRATIONS);
    const body = async () =>
      (
        await db.query<{ src: string }>(
          `select prosrc as src from pg_proc where oid = 'public.intervention_audit(uuid)'::regprocedure`,
        )
      ).rows[0]!.src;
    expect(await body()).toContain('is_command_in(entry.organization_id)');

    await db.query(sql(RESTORE_021));
    expect(await body()).toContain('is_dvd_command()');
  });
});

describe('006a in the wrong place is not harmless', () => {
  /*
   * The whole reason the file is numbered 006a. Run the same list with it moved
   * to the end - the shape a later contributor would reach for, since that is
   * where new migrations go - and three commands stop working.
   */
  const misordered = [...MIGRATIONS.filter((file) => file !== RESTORE_006A), RESTORE_006A];

  it('puts the renamed-away table back into three function bodies', async () => {
    await applyAll(db, misordered);
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosrc ilike '%organisation_audit%'
        order by p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual([
      'admin_link_member_account',
      'admin_set_group_members',
      'admin_unlink_member_account',
    ]);
  });

  it('and breaks them at the point of use, not at apply time', async () => {
    // Already applied misordered above; the schema is the one under test.
    const account = await createAccount(db, 'vlasnik.redoslijed@example.invalid');
    await completeProfile(db, account.userId, 'Vlasnik Redoslijed');
    await grantRole(db, account.userId, 'OWNER');

    const group = await asUserCommitted(db, account.userId, (client) =>
      client.query<{ id: string }>(`select public.admin_create_group('Smjena Redoslijed') as id`),
    );
    const member = await asUserCommitted(db, account.userId, (client) =>
      client.query<{ id: string }>(`select public.admin_create_member('Clan Redoslijed', '{}') as id`),
    );

    let message = '';
    try {
      await asUserCommitted(db, account.userId, (client) =>
        client.query(`select public.admin_set_group_members($1, array[$2]::uuid[])`, [
          group.rows[0]!.id,
          member.rows[0]!.id,
        ]),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message, 'setting group members fails against the dead table name').toContain(
      'relation "public.organisation_audit" does not exist',
    );
  });

  it('and the same list in the committed order does not', async () => {
    await applyAll(db, MIGRATIONS);
    const account = await createAccount(db, 'vlasnik.ispravno@example.invalid');
    await completeProfile(db, account.userId, 'Vlasnik Ispravno');
    await grantRole(db, account.userId, 'OWNER');

    const group = await asUserCommitted(db, account.userId, (client) =>
      client.query<{ id: string }>(`select public.admin_create_group('Smjena Ispravno') as id`),
    );
    const member = await asUserCommitted(db, account.userId, (client) =>
      client.query<{ id: string }>(`select public.admin_create_member('Clan Ispravno', '{}') as id`),
    );
    await asUserCommitted(db, account.userId, (client) =>
      client.query(`select public.admin_set_group_members($1, array[$2]::uuid[])`, [
        group.rows[0]!.id,
        member.rows[0]!.id,
      ]),
    );

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.registry_audit where event_type = 'GROUP_MEMBERS_CHANGED'`,
    );
    expect(Number(rows[0]!.n), 'and it audits to the renamed table').toBeGreaterThan(0);
  });
});
