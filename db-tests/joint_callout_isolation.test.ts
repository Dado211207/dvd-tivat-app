/**
 * P7 / D21: on a JOINT call-out, neither service may read the other's individual
 * participant rows. Both see the shared incident facts and their own service's
 * participants; neither sees the other's responses, journeys, attendance or
 * member-linked audit.
 *
 * This is the leak-reproduction suite. Migration 040 widened is_recipient_of()
 * so a cross-service recipient can read the shared call-out (D18/the intended
 * reach). The danger the owner flagged: every policy that gates ONLY on
 * is_recipient_of(intervention_id) then also exposes the OTHER service's
 * individual rows to that recipient. These tests assert the isolation end-state
 * across the whole read surface, so they FAIL on the 040 schema (the leak) and
 * PASS once migration 041 scopes each recipient read to the row's own service.
 *
 * Every leak assertion is paired with a privileged existence check on the same
 * rows (read as the owning service's command), so an empty fixture cannot pass
 * vacuously: the SZS rows really are there; the DVD recipient simply must not
 * see them, and vice-versa. Same-service peer visibility is asserted too, so the
 * fix is proven to scope per service rather than blanket-deny.
 *
 * migrations: 202609290040_joint_callouts.sql (introduces the reach)
 *             202609290041_joint_participation.sql (scopes the reads)
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  asUser,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  createMember,
  grantRole,
  resetSchema,
  type TestAccount,
} from './harness';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

let db: Client;

// Publishers.
let szsCommander: TestAccount; // publishes the SZS -> DVD joint call-out, confirms SZS attendance
let dvdCommander: TestAccount; // publishes the DVD -> SZS joint call-out, confirms DVD attendance

// SZS participants (own-selected on the SZS-published call-out).
let szsFf: TestAccount;
let szsFf2: TestAccount;
let szsFfMember: string;
let szsFf2Member: string;

// DVD participants (own-selected on the DVD-published call-out).
let dvdFf: TestAccount;
let dvdFf2: TestAccount;
let dvdFfMember: string;
let dvdFf2Member: string;

let owner: TestAccount;
let citizen: TestAccount;

let szsJoint: string; // SZS publishes; targets DVD as a whole; SZS members act on it
let dvdJoint: string; // DVD publishes; targets SZS as a whole; DVD members act on it

async function addMembership(organizationId: string, userId: string, role: string): Promise<void> {
  await db.query(
    `insert into public.organization_memberships(organization_id, user_id, role, active, granted_by, granted_at)
     values ($1, $2, $3, true, $2, now())
     on conflict (organization_id, user_id) do update
       set role = excluded.role, active = true, granted_at = now()`,
    [organizationId, userId, role],
  );
}

async function addMemberIn(organizationId: string, fullName: string, userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.members(full_name, user_id, organization_id) values ($1, $2, $3) returning id`,
    [fullName, userId, organizationId],
  );
  return rows[0]!.id;
}

/** Publish a joint call-out through the real command, committed, returning its id. */
async function publishJoint(
  publisher: TestAccount,
  publisherOrg: string,
  ownSelection: string[],
  targetOrgs: string[],
  key: string,
): Promise<string> {
  return asUserCommitted(db, publisher.userId, async (c) => {
    const draft = (
      await c.query<{ id: string }>(
        `select public.create_intervention_draft_in($1, 'POZAR', 'Zajednicka intervencija',
                'Upute su ovdje.', 'Lokacija', $2) as id`,
        [publisherOrg, key],
      )
    ).rows[0]!.id;
    await c.query(`select public.publish_intervention($1, $2, $3)`, [draft, ownSelection, targetOrgs]);
    return draft;
  });
}

/** A member responds, progresses their journey and checks in — the full participant trail. */
async function participate(account: TestAccount, interventionId: string): Promise<void> {
  await asUserCommitted(db, account.userId, async (c) => {
    await c.query(`select public.submit_response($1, 'DOLAZIM', null, true)`, [interventionId]);
    await c.query(`select public.set_journey_progress($1, 'KRECEM')`, [interventionId]);
    await c.query(`select public.attendance_check_in($1)`, [interventionId]);
    await c.query(`select public.acknowledge_intervention($1)`, [interventionId]);
  });
}

/** Command confirms every attendance interval it can see on the call-out. */
async function confirmAllAttendance(commander: TestAccount, interventionId: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `select id from public.attendance_intervals where intervention_id = $1`,
    [interventionId],
  );
  for (const { id } of rows) {
    await asUserCommitted(db, commander.userId, async (c) => {
      await c.query(`select public.attendance_confirm($1, 'Provjereno')`, [id]);
    });
  }
}

/** Column values a given actor can read from a participant table for a call-out. */
function readColumn<T = string>(
  account: TestAccount,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  return asUser(db, account.userId, async (c) => (await c.query(sql, params)).rows.map((r) => Object.values(r)[0] as T));
}

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  szsCommander = await createAccount(db, 'iso-szs-cmd@example.invalid');
  await completeProfile(db, szsCommander.userId, 'SZS Komandir');
  await addMembership(SZS, szsCommander.userId, 'COMMANDER');

  dvdCommander = await createAccount(db, 'iso-dvd-cmd@example.invalid');
  await completeProfile(db, dvdCommander.userId, 'DVD Komandir');
  await grantRole(db, dvdCommander.userId, 'COMMANDER');
  await createMember(db, 'DVD Komandir', dvdCommander.userId);

  szsFf = await createAccount(db, 'iso-szs-ff@example.invalid');
  await completeProfile(db, szsFf.userId, 'SZS Spasilac A');
  await addMembership(SZS, szsFf.userId, 'FIREFIGHTER');
  szsFfMember = await addMemberIn(SZS, 'SZS Spasilac A', szsFf.userId);

  szsFf2 = await createAccount(db, 'iso-szs-ff2@example.invalid');
  await completeProfile(db, szsFf2.userId, 'SZS Spasilac B');
  await addMembership(SZS, szsFf2.userId, 'FIREFIGHTER');
  szsFf2Member = await addMemberIn(SZS, 'SZS Spasilac B', szsFf2.userId);

  dvdFf = await createAccount(db, 'iso-dvd-ff@example.invalid');
  await completeProfile(db, dvdFf.userId, 'DVD Vatrogasac A');
  await grantRole(db, dvdFf.userId, 'FIREFIGHTER');
  dvdFfMember = await createMember(db, 'DVD Vatrogasac A', dvdFf.userId);

  dvdFf2 = await createAccount(db, 'iso-dvd-ff2@example.invalid');
  await completeProfile(db, dvdFf2.userId, 'DVD Vatrogasac B');
  await grantRole(db, dvdFf2.userId, 'FIREFIGHTER');
  dvdFf2Member = await createMember(db, 'DVD Vatrogasac B', dvdFf2.userId);

  owner = await createAccount(db, 'iso-owner@example.invalid');
  await completeProfile(db, owner.userId, 'Vlasnik');
  await grantRole(db, owner.userId, 'OWNER');

  citizen = await createAccount(db, 'iso-citizen@example.invalid');
  await completeProfile(db, citizen.userId, 'Gradjanin');

  // SZS publishes to DVD; the SZS own-selection acts. DVD is reached but its
  // members do not act here (their write path is exercised in the participation
  // suite once migration 041 opens it).
  szsJoint = await publishJoint(szsCommander, SZS, [szsFfMember, szsFf2Member], [DVD], 'iso-szs-joint');
  await participate(szsFf, szsJoint);
  await participate(szsFf2, szsJoint);
  await confirmAllAttendance(szsCommander, szsJoint);

  // DVD publishes to SZS; the DVD own-selection acts.
  dvdJoint = await publishJoint(dvdCommander, DVD, [dvdFfMember, dvdFf2Member], [SZS], 'iso-dvd-joint');
  await participate(dvdFf, dvdJoint);
  await participate(dvdFf2, dvdJoint);
  await confirmAllAttendance(dvdCommander, dvdJoint);
});

afterAll(async () => {
  await db?.end();
});

// ---------------------------------------------------------------------------
// The fixtures are real: prove the SZS/DVD participant rows exist before any
// isolation assertion, read by the owning service's command. A leak assertion
// that passed because the table was empty would be worthless.
// ---------------------------------------------------------------------------
describe('the participant rows really exist (non-vacuous fixture)', () => {
  it('SZS members responded, progressed, attended and were confirmed on the SZS call-out', async () => {
    const responders = await readColumn(
      szsCommander,
      `select member_id from public.intervention_responses where intervention_id = $1 order by member_id`,
      [szsJoint],
    );
    expect(responders.sort()).toEqual([szsFfMember, szsFf2Member].sort());

    const attended = await readColumn(
      szsCommander,
      `select member_id from public.attendance_intervals where intervention_id = $1 and verified order by member_id`,
      [szsJoint],
    );
    expect(attended.sort()).toEqual([szsFfMember, szsFf2Member].sort());
  });

  it('DVD members responded, progressed, attended and were confirmed on the DVD call-out', async () => {
    const responders = await readColumn(
      dvdCommander,
      `select member_id from public.intervention_responses where intervention_id = $1 order by member_id`,
      [dvdJoint],
    );
    expect(responders.sort()).toEqual([dvdFfMember, dvdFf2Member].sort());
  });
});

// ---------------------------------------------------------------------------
// The leak surface: a cross-service recipient must not see the other service's
// individual rows. Each block reproduces the leak on 040 and is closed by 041.
// ---------------------------------------------------------------------------
describe('D21: a DVD recipient of the SZS call-out sees no SZS individual rows', () => {
  it('intervention_responses: no SZS responses are visible', async () => {
    const seen = await readColumn(
      dvdFf,
      `select member_id from public.intervention_responses where intervention_id = $1`,
      [szsJoint],
    );
    expect(seen).not.toContain(szsFfMember);
    expect(seen).not.toContain(szsFf2Member);
    expect(seen).toHaveLength(0); // no DVD member acted on this call-out, so nothing is left
  });

  it('intervention_journey: no SZS journeys are visible', async () => {
    const seen = await readColumn(
      dvdFf,
      `select member_id from public.intervention_journey where intervention_id = $1`,
      [szsJoint],
    );
    expect(seen).not.toContain(szsFfMember);
    expect(seen).not.toContain(szsFf2Member);
  });

  it('attendance_intervals: no SZS attendance is visible', async () => {
    const seen = await readColumn(
      dvdFf,
      `select member_id from public.attendance_intervals where intervention_id = $1`,
      [szsJoint],
    );
    expect(seen).not.toContain(szsFfMember);
    expect(seen).not.toContain(szsFf2Member);
  });

  it('operational_audit (table): no audit row referencing an SZS member is visible', async () => {
    const memberRefs = await readColumn(
      dvdFf,
      `select detail->>'member_id' as m from public.operational_audit
        where intervention_id = $1 and detail ? 'member_id'`,
      [szsJoint],
    );
    expect(memberRefs).not.toContain(szsFfMember);
    expect(memberRefs).not.toContain(szsFf2Member);
  });

  it('intervention_audit (reader function): no SZS member action is returned', async () => {
    const rows = await asUser(db, dvdFf.userId, async (c) =>
      (
        await c.query<{ m: string | null }>(
          `select detail->>'member_id' as m from public.intervention_audit($1)`,
          [szsJoint],
        )
      ).rows.map((r) => r.m),
    );
    expect(rows).not.toContain(szsFfMember);
    expect(rows).not.toContain(szsFf2Member);
  });
});

describe('D21: an SZS recipient of the DVD call-out sees no DVD individual rows (symmetric)', () => {
  it('intervention_responses: no DVD responses are visible', async () => {
    const seen = await readColumn(
      szsFf,
      `select member_id from public.intervention_responses where intervention_id = $1`,
      [dvdJoint],
    );
    expect(seen).not.toContain(dvdFfMember);
    expect(seen).not.toContain(dvdFf2Member);
  });

  it('intervention_journey: no DVD journeys are visible', async () => {
    const seen = await readColumn(
      szsFf,
      `select member_id from public.intervention_journey where intervention_id = $1`,
      [dvdJoint],
    );
    expect(seen).not.toContain(dvdFfMember);
    expect(seen).not.toContain(dvdFf2Member);
  });

  it('attendance_intervals: no DVD attendance is visible', async () => {
    const seen = await readColumn(
      szsFf,
      `select member_id from public.attendance_intervals where intervention_id = $1`,
      [dvdJoint],
    );
    expect(seen).not.toContain(dvdFfMember);
    expect(seen).not.toContain(dvdFf2Member);
  });

  it('intervention_audit (reader function): no DVD member action is returned', async () => {
    const rows = await asUser(db, szsFf.userId, async (c) =>
      (
        await c.query<{ m: string | null }>(
          `select detail->>'member_id' as m from public.intervention_audit($1)`,
          [dvdJoint],
        )
      ).rows.map((r) => r.m),
    );
    expect(rows).not.toContain(dvdFfMember);
    expect(rows).not.toContain(dvdFf2Member);
  });
});

// ---------------------------------------------------------------------------
// Positive controls: the fix must scope per service, not blanket-deny. A
// same-service peer recipient still sees their fellow member's rows, exactly as
// in a single-service call-out today.
// ---------------------------------------------------------------------------
describe('same-service peer visibility is preserved', () => {
  it('an SZS recipient peer sees the other SZS members responses and attendance', async () => {
    const responses = await readColumn(
      szsFf2,
      `select member_id from public.intervention_responses where intervention_id = $1`,
      [szsJoint],
    );
    expect(responses).toContain(szsFfMember); // the peer's row, via the recipient read
    expect(responses).toContain(szsFf2Member);

    const attendance = await readColumn(
      szsFf2,
      `select member_id from public.attendance_intervals where intervention_id = $1`,
      [szsJoint],
    );
    expect(attendance).toContain(szsFfMember);
  });

  it('a DVD recipient peer sees the other DVD members journeys', async () => {
    const seen = await readColumn(
      dvdFf2,
      `select member_id from public.intervention_journey where intervention_id = $1`,
      [dvdJoint],
    );
    expect(seen).toContain(dvdFfMember);
    expect(seen).toContain(dvdFf2Member);
  });
});

// ---------------------------------------------------------------------------
// Shared incident facts: the whole point of the widening (D18) is that a
// cross-service recipient CAN see the shared call-out and which services it
// went to. Those must stay visible.
// ---------------------------------------------------------------------------
describe('shared incident facts stay visible to the cross-service recipient', () => {
  it('the DVD recipient can read the SZS-published call-out itself', async () => {
    const seen = await readColumn(
      dvdFf,
      `select id from public.interventions where id = $1`,
      [szsJoint],
    );
    expect(seen).toEqual([szsJoint]);
  });

  it('the DVD recipient can see which services the call-out went to', async () => {
    const seen = await readColumn(
      dvdFf,
      `select organization_id from public.intervention_recipient_organizations where intervention_id = $1`,
      [szsJoint],
    );
    expect(seen).toEqual([DVD]);
  });
});

// ---------------------------------------------------------------------------
// Already-scoped tables (self/command only, no recipient branch): confirm they
// do not leak either, so a future widening cannot quietly reopen them.
// ---------------------------------------------------------------------------
describe('tables scoped to self/command never leak across services', () => {
  it('a DVD recipient sees no SZS acknowledgements', async () => {
    const seen = await readColumn(
      dvdFf,
      `select member_id from public.intervention_acknowledgements where intervention_id = $1`,
      [szsJoint],
    );
    expect(seen).toHaveLength(0);
  });

  it('a DVD recipient sees no SZS journey history', async () => {
    const seen = await readColumn(
      dvdFf,
      `select member_id from public.intervention_journey_history where intervention_id = $1`,
      [szsJoint],
    );
    expect(seen).toHaveLength(0);
  });

  it('a DVD recipient sees no SZS response revisions', async () => {
    const seen = await readColumn(
      dvdFf,
      `select r.member_id from public.intervention_response_revisions rev
         join public.intervention_responses r on r.id = rev.response_id
        where r.intervention_id = $1`,
      [szsJoint],
    );
    expect(seen).toHaveLength(0);
  });

  it('a DVD recipient sees no SZS notification-outbox rows', async () => {
    const seen = await readColumn(
      dvdFf,
      `select member_id from public.notification_outbox where intervention_id = $1`,
      [szsJoint],
    );
    expect(seen).not.toContain(szsFfMember);
    expect(seen).not.toContain(szsFf2Member);
  });

  it('a DVD recipient sees only their own recipient row, never an SZS one', async () => {
    const seen = await asUser(db, dvdFf.userId, async (c) =>
      (
        await c.query<{ member_id: string; organization_id: string }>(
          `select member_id, organization_id from public.intervention_recipients where intervention_id = $1`,
          [szsJoint],
        )
      ).rows,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]!.member_id).toBe(dvdFfMember);
    expect(seen[0]!.organization_id).toBe(DVD);
  });
});

// ---------------------------------------------------------------------------
// Non-participants see nothing, on either call-out.
// ---------------------------------------------------------------------------
describe('a citizen in neither service sees no participant rows at all', () => {
  it('sees no responses, journeys, attendance or the call-out', async () => {
    for (const id of [szsJoint, dvdJoint]) {
      expect(
        await readColumn(citizen, `select member_id from public.intervention_responses where intervention_id = $1`, [id]),
      ).toHaveLength(0);
      expect(
        await readColumn(citizen, `select member_id from public.attendance_intervals where intervention_id = $1`, [id]),
      ).toHaveLength(0);
      expect(
        await readColumn(citizen, `select id from public.interventions where id = $1`, [id]),
      ).toHaveLength(0);
    }
  });
});
