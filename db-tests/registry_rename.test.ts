/**
 * The registry rename carries its rows and its writers across.
 *
 * `202609230019` renames `organisation_audit` to `registry_audit` so that the
 * society's registry stops colliding with `organization_memberships` on one
 * letter of spelling. The rename itself is trivial. Two things about it are not,
 * and both are asserted here rather than assumed.
 *
 * FIRST: a bare rename breaks the Records screen. Twelve `security definer`
 * functions write to this table, and PL/pgSQL stores its body as TEXT and
 * re-parses it, so `alter table ... rename` leaves all twelve pointing at a
 * relation that no longer exists. Measured before this migration was written:
 *
 *   before the rename:  admin_create_member -> OK
 *   after  the rename:  admin_create_member -> FAILED:
 *                       relation "public.organisation_audit" does not exist
 *
 * The migration therefore reproduces all twelve. The test below drives one of
 * each KIND of writer - member, group, vehicle, account link - because a single
 * missed function is invisible until somebody taps that button.
 *
 * SECOND: production holds 19 rows in this table, written on 12 September 2026.
 * A rename keeps them by definition, but "by definition" is what people say
 * before losing an audit trail, so the test applies the migrations in two
 * stages with a row written in between, and looks for it on the other side.
 * That is the only way to observe the rename rather than the end state.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  grantRole,
} from './harness';

const RENAME = 'supabase/migrations/202609230019_registry_rename.sql';

let db: Client;
let owner: string;

/** The id written before the rename, looked for after it. */
const CARRIED_ENTITY = '11111111-2222-4333-8444-555555555555';

beforeAll(async () => {
  db = await connect();

  // Stage one: everything up to but NOT including the rename.
  await db.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    create schema public;
    grant all on schema public to postgres;
  `);
  // Strictly before, not "everything except". Filtering applied the migrations
  // that come AFTER the rename as well, which put this file's schema in an
  // order no deployment will ever be in - and made a later phase re-creating
  // these same writers look like a defect in the rename. P4a is the phase that
  // tripped it; slicing is what P3 had to do to 202609240022's test for the
  // same reason.
  const index = MIGRATIONS.indexOf(RENAME);
  expect(index, 'the rename must be in the migration list').toBeGreaterThan(-1);
  const before = MIGRATIONS.slice(0, index);
  for (const file of before) {
    await db.query(readFileSync(resolve(process.cwd(), file), 'utf8'));
  }

  const account = await createAccount(db, 'vlasnik@example.invalid');
  await completeProfile(db, account.userId, 'Vlasnik Sistema');
  await grantRole(db, account.userId, 'OWNER');
  owner = account.userId;

  // A row under the OLD name, standing in for production's nineteen.
  await db.query(
    `insert into public.organisation_audit(entity_kind, entity_id, event_type, detail, changed_by)
     values ('MEMBER', $1, 'WRITTEN_BEFORE_RENAME', '{"proof": true}'::jsonb, $2)`,
    [CARRIED_ENTITY, owner],
  );

  // Stage two: the rename.
  await db.query(readFileSync(resolve(process.cwd(), RENAME), 'utf8'));
});

afterAll(async () => db?.end());

describe('the rename carries the audit trail across', () => {
  it('keeps the row written under the old name', async () => {
    const { rows } = await db.query<{ event_type: string; detail: string }>(
      `select event_type, detail::text from public.registry_audit where entity_id = $1`,
      [CARRIED_ENTITY],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('WRITTEN_BEFORE_RENAME');
    expect(rows[0]!.detail).toContain('"proof"');
  });

  it('leaves no table under the old name', async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'organisation_audit'`,
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('carries the index and the policy across under their new names', async () => {
    const index = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_indexes
        where schemaname = 'public' and indexname = 'registry_audit_entity_idx'`,
    );
    expect(index.rows[0]!.n, 'the index follows the table').toBe('1');

    const policy = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public' and tablename = 'registry_audit'`,
    );
    expect(policy.rows.map((r) => r.policyname)).toEqual(['registry_audit_admin_read']);
  });

  it('still lets an administrator read it, and nobody else', async () => {
    const reader = await createAccount(db, 'vatrogasac@example.invalid');
    await completeProfile(db, reader.userId, 'Ivo Vatrogasac');
    await grantRole(db, reader.userId, 'FIREFIGHTER');

    const asOwner = await asUserCommitted(db, owner, (client) =>
      client.query(`select count(*)::text as n from public.registry_audit`),
    );
    expect(Number(asOwner.rows[0]!.n)).toBeGreaterThan(0);

    const asFirefighter = await asUserCommitted(db, reader.userId, (client) =>
      client.query(`select count(*)::text as n from public.registry_audit`),
    );
    expect(asFirefighter.rows[0]!.n, 'a firefighter reads none of it').toBe('0');
  });
});

describe('every kind of writer survived the rename', () => {
  /*
   * One per shape of writer, because the twelve were reproduced mechanically
   * and a single missed one is invisible until somebody taps that button.
   * `registry.test.ts` covers what each command MEANS; this covers only that
   * it can still reach the table it audits to.
   */
  it('records a created member', async () => {
    await asUserCommitted(db, owner, (client) =>
      client.query(`select public.admin_create_member('Poslije Rename', '{}')`),
    );
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.registry_audit
        where event_type = 'MEMBER_CREATED'`,
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('records a created group', async () => {
    await asUserCommitted(db, owner, (client) =>
      client.query(`select public.admin_create_group('Smjena Rename')`),
    );
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.registry_audit
        where event_type = 'GROUP_CREATED'`,
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('records a created vehicle', async () => {
    await asUserCommitted(db, owner, (client) =>
      client.query(`select public.admin_create_vehicle('R-1', 'Vozilo Rename', 'NAVALNO')`),
    );
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.registry_audit
        where event_type = 'VEHICLE_CREATED'`,
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('records an account link, the one that writes about two entities', async () => {
    const person = await createAccount(db, 'clan@example.invalid');
    await completeProfile(db, person.userId, 'Clan Povezan');
    await grantRole(db, person.userId, 'FIREFIGHTER');

    const memberId = await asUserCommitted(db, owner, async (client) => {
      const created = await client.query<{ id: string }>(
        `select public.admin_create_member('Clan Povezan', '{}') as id`,
      );
      const id = created.rows[0]!.id;
      await client.query(`select public.admin_link_member_account($1, $2)`, [id, person.userId]);
      return id;
    });

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.registry_audit
        where entity_id = $1 and event_type = 'MEMBER_ACCOUNT_LINKED'`,
      [memberId],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('leaves no function still naming the old table', async () => {
    // The mechanical substitution is only trustworthy if nothing was missed.
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and p.prosrc ilike '%organisation_audit%'
        order by p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it('still has exactly twelve functions writing to the registry audit', async () => {
    // The count is the tripwire: if a later migration adds a thirteenth writer
    // without this test noticing, the rename's completeness claim goes stale.
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f'
          and p.prosrc ilike '%registry_audit%'`,
    );
    expect(rows[0]!.n).toBe('12');
  });
});
