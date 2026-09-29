/**
 * Attendance is credited to the participant's OWN service.
 *
 * P6 of docs/MULTI_ORG_PLAN.md, the schema half of Q5 (owner, 2026-09-27):
 * hours count for the member's own service, read from the stored member record,
 * never from the call-out that published the intervention and never from a value
 * a caller sends. `202609270039` gives `credited_organization_id` that rule; the
 * additive column, its backfill and its freeze were already in place (022, 031).
 *
 * The gap only shows when the member's service and the call-out's service differ
 * - a DVD member on an SZS call-out - which is the P7 joint case. No such row can
 * exist in P6, so the change is a no-op for every real row today; the test forces
 * the divergence directly to prove the rule is correct in advance, and rolls each
 * probe back so nothing persists (the migration asserts every stored row already
 * satisfies the invariant).
 *
 * Failing-before/passing-after in one file: the schema is built through 038 (the
 * old "credited = the call-out's service" trigger), the old behaviour is pinned,
 * then 039 is applied and the new behaviour asserted - the same shape 038's own
 * test used.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, connect, createAccount, createMember } from './harness';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
const CREDIT = 'supabase/migrations/202609270039_attendance_credit_service.sql';

const sql = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

let db: Client;
let recordedBy: string;
let dvdMember: string;
let szsMember: string;
let dvdCallOut: string;
let szsCallOut: string;

/**
 * Rebuilds the schema applying every migration strictly BEFORE 039.
 *
 * Sliced by 039's index, not filtered by name: a name filter that only drops 039
 * would still apply every FUTURE migration (040+) to the "before" stage, so the
 * pre-039 state would silently include later schema changes - the staging bug
 * found before in other tests. The "before" stage is exactly "main as it was one
 * migration ago".
 */
async function buildBeforeCredit(client: Client): Promise<void> {
  const creditIndex = MIGRATIONS.indexOf(CREDIT);
  if (creditIndex === -1) {
    throw new Error(`${CREDIT} not found in MIGRATIONS - update this test`);
  }
  await client.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    create schema public;
    grant all on schema public to postgres;
  `);
  for (const file of MIGRATIONS.slice(0, creditIndex)) {
    await client.query(sql(file));
  }
}

async function szsMemberId(client: Client, fullName: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.members(full_name, organization_id) values ($1, $2) returning id`,
    [fullName, SZS],
  );
  return rows[0]!.id;
}

async function szsCallOutId(client: Client, key: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.interventions(
       kind, title, instructions, incident_location, created_by, idempotency_key, organization_id)
     values ('POZAR', 'SZS vjezba', 'Okupljanje.', 'Poligon', $1, $2, $3) returning id`,
    [recordedBy, key, SZS],
  );
  return rows[0]!.id;
}

async function dvdCallOutId(client: Client, key: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.interventions(
       kind, title, instructions, incident_location, created_by, idempotency_key)
     values ('POZAR', 'DVD vjezba', 'Okupljanje.', 'Poligon', $1, $2) returning id`,
    [recordedBy, key],
  );
  return rows[0]!.id;
}

/**
 * Inserts one attendance interval and returns the service it lands credited to,
 * then rolls the whole thing back so no row persists.
 */
async function creditedFor(
  memberId: string,
  interventionId: string,
  providedCredit?: string,
): Promise<{ credited: string; organization: string }> {
  await db.query('begin');
  try {
    const columns = providedCredit
      ? '(intervention_id, member_id, started_at, recorded_by, credited_organization_id)'
      : '(intervention_id, member_id, started_at, recorded_by)';
    const values = providedCredit ? '($1, $2, now(), $3, $4)' : '($1, $2, now(), $3)';
    const params = providedCredit
      ? [interventionId, memberId, recordedBy, providedCredit]
      : [interventionId, memberId, recordedBy];
    const { rows } = await db.query<{ credited_organization_id: string; organization_id: string }>(
      `insert into public.attendance_intervals ${columns} values ${values}
         returning credited_organization_id, organization_id`,
      params,
    );
    return { credited: rows[0]!.credited_organization_id, organization: rows[0]!.organization_id };
  } finally {
    await db.query('rollback');
  }
}

beforeAll(async () => {
  db = await connect();
  await buildBeforeCredit(db);
  const account = await createAccount(db, 'recorder@example.invalid');
  recordedBy = account.userId;
  dvdMember = await createMember(db, 'DVD Clan');
  szsMember = await szsMemberId(db, 'SZS Clan');
  dvdCallOut = await dvdCallOutId(db, 'key-dvd');
  szsCallOut = await szsCallOutId(db, 'key-szs');
});

afterAll(async () => {
  await db.end();
});

describe('before 202609270039: credit follows the call-out, and a claim is kept', () => {
  it('credits a DVD member on an SZS call-out to SZS (the call-out), not DVD', async () => {
    const { credited, organization } = await creditedFor(dvdMember, szsCallOut);
    expect(organization).toBe(SZS);
    expect(credited).toBe(SZS); // the gap 039 closes: credited to the publisher
  });

  it('keeps a caller-provided credited service instead of overriding it', async () => {
    const { credited } = await creditedFor(dvdMember, dvdCallOut, SZS);
    expect(credited).toBe(SZS); // a false claim survives: the trigger only filled a null
  });

  it('credits a DVD member on a DVD call-out to DVD (coincidental match today)', async () => {
    const { credited } = await creditedFor(dvdMember, dvdCallOut);
    expect(credited).toBe(DVD);
  });
});

describe('after 202609270039: credit follows the member, from the stored record', () => {
  beforeAll(async () => {
    await db.query(sql(CREDIT));
  });

  it("credits a DVD member on an SZS call-out to DVD (the member's own service)", async () => {
    const { credited, organization } = await creditedFor(dvdMember, szsCallOut);
    expect(organization).toBe(SZS); // the call-out is still SZS's
    expect(credited).toBe(DVD); // but the hours are the DVD member's own
  });

  it('overrides a caller-provided credited service with the member\'s (not a claim)', async () => {
    const { credited } = await creditedFor(dvdMember, dvdCallOut, SZS);
    expect(credited).toBe(DVD);
  });

  it('credits an SZS member on an SZS call-out to SZS', async () => {
    const { credited } = await creditedFor(szsMember, szsCallOut);
    expect(credited).toBe(SZS);
  });

  it('leaves a DVD member on a DVD call-out credited to DVD (unchanged)', async () => {
    const { credited } = await creditedFor(dvdMember, dvdCallOut);
    expect(credited).toBe(DVD);
  });

  it('still refuses to move an interval\'s credited service after insert (031 freeze)', async () => {
    await db.query('begin');
    try {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.attendance_intervals (intervention_id, member_id, started_at, recorded_by)
         values ($1, $2, now(), $3) returning id`,
        [dvdCallOut, dvdMember, recordedBy],
      );
      await expect(
        db.query(`update public.attendance_intervals set credited_organization_id = $2 where id = $1`, [
          rows[0]!.id,
          SZS,
        ]),
      ).rejects.toThrow(/ATTENDANCE_IDENTITY_FIXED/);
    } finally {
      await db.query('rollback');
    }
  });
});
