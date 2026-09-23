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

  it('020 is a no-op applied on top of the whole list', async () => {
    await applyAll(db, MIGRATIONS);
    const before = await functionText(db);

    await db.query(sql(RESTORE_020));
    const after = await functionText(db);

    expect(after.count).toBe(before.count);
    expect(after.hash).toBe(before.hash);
  });

  it('021 is a no-op applied on top of the whole list', async () => {
    // Safe at the end only because 202609150010 is the only migration that
    // defines `intervention_audit`. If that stops being true this fails, which
    // is the point of asserting it rather than reasoning about it.
    await applyAll(db, MIGRATIONS);
    const before = await functionText(db);

    await db.query(sql(RESTORE_021));
    const after = await functionText(db);

    expect(after.count).toBe(before.count);
    expect(after.hash).toBe(before.hash);
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
