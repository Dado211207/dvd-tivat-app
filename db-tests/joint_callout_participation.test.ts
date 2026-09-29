/**
 * P7 / D20: a recipient-service member takes part in a joint call-out under their
 * OWN member record and service, each service commands only its own participants,
 * and the publishing service alone commands the incident lifecycle.
 *
 * On the 040 schema every write below was refused — submit_response and
 * set_journey_progress resolved the caller in the CALL-OUT's service, so a DVD
 * member paged by an SZS call-out hit MEMBER_RECORD_REQUIRED / STAFF_REQUIRED, and
 * attendance keyed confirmation off the call-out's service, so a DVD commander
 * could not confirm a DVD member. Migration 041 resolves each actor in their own
 * recipient service and keys attendance authority off the credited service, so:
 *
 *   - a DVD recipient answers, progresses and checks in as their DVD member (D20);
 *   - their participation is credited to DVD (D15), never to the publisher;
 *   - DVD command confirms DVD attendance; SZS command cannot, and vice-versa (D20);
 *   - the publisher (SZS) alone changes status and closes; DVD command cannot (D20);
 *   - a dual-service person is paged once and answers once (D16);
 *   - a single-service call-out behaves exactly as before.
 *
 * migrations: 202609290040_joint_callouts.sql, 202609290041_joint_participation.sql
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
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

let szsCommander: TestAccount;
let dvdCommander: TestAccount;
let dvdFf: TestAccount;
let dvdFf2: TestAccount; // a second DVD member, for the single-service check (dvdFf keeps an open interval on the joint call-out)
let szsFf: TestAccount;
let dual: TestAccount;

let dvdFf2Member: string;
let dvdFfMember: string;
let szsFfMember: string;
let dualSzsMember: string;
let dualDvdMember: string;

let joint: string; // SZS publishes; DVD is targeted whole-service

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
const act = (account: TestAccount, sql: string, params: unknown[] = []) =>
  asUserCommitted(db, account.userId, async (c) => {
    await c.query(sql, params);
    return 'OK';
  }).catch((e: Error) => (e.message.match(/[A-Z_]{4,}/)?.[0] ?? e.message));

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  szsCommander = await createAccount(db, 'part-szs-cmd@example.invalid');
  await completeProfile(db, szsCommander.userId, 'SZS Komandir');
  await addMembership(SZS, szsCommander.userId, 'COMMANDER');

  dvdCommander = await createAccount(db, 'part-dvd-cmd@example.invalid');
  await completeProfile(db, dvdCommander.userId, 'DVD Komandir');
  await grantRole(db, dvdCommander.userId, 'COMMANDER');
  await createMember(db, 'DVD Komandir', dvdCommander.userId);

  dvdFf = await createAccount(db, 'part-dvd-ff@example.invalid');
  await completeProfile(db, dvdFf.userId, 'DVD Vatrogasac');
  await grantRole(db, dvdFf.userId, 'FIREFIGHTER');
  dvdFfMember = await createMember(db, 'DVD Vatrogasac', dvdFf.userId);

  dvdFf2 = await createAccount(db, 'part-dvd-ff2@example.invalid');
  await completeProfile(db, dvdFf2.userId, 'DVD Vatrogasac Dva');
  await grantRole(db, dvdFf2.userId, 'FIREFIGHTER');
  dvdFf2Member = await createMember(db, 'DVD Vatrogasac Dva', dvdFf2.userId);

  szsFf = await createAccount(db, 'part-szs-ff@example.invalid');
  await completeProfile(db, szsFf.userId, 'SZS Spasilac');
  await addMembership(SZS, szsFf.userId, 'FIREFIGHTER');
  szsFfMember = await addMemberIn(SZS, 'SZS Spasilac', szsFf.userId);

  dual = await createAccount(db, 'part-dual@example.invalid');
  await completeProfile(db, dual.userId, 'Dvojna Sluzba');
  await grantRole(db, dual.userId, 'FIREFIGHTER'); // DVD member
  dualDvdMember = await createMember(db, 'Dvojna Sluzba', dual.userId);
  await addMembership(SZS, dual.userId, 'FIREFIGHTER');
  dualSzsMember = await addMemberIn(SZS, 'Dvojna Sluzba', dual.userId);

  joint = await asUserCommitted(db, szsCommander.userId, async (c) => {
    const draft = (
      await c.query<{ id: string }>(
        `select public.create_intervention_draft_in($1, 'POZAR', 'Zajednicka intervencija',
                'Upute su ovdje.', 'Lokacija', 'part-joint-1') as id`,
        [SZS],
      )
    ).rows[0]!.id;
    await c.query(`select public.publish_intervention($1, $2, $3)`, [draft, [szsFfMember, dualSzsMember], [DVD]]);
    return draft;
  });
});

afterAll(async () => {
  await db?.end();
});

describe('a DVD recipient takes part in an SZS-published joint call-out (D20)', () => {
  it('answers as their own DVD member, and the answer is a DVD row', async () => {
    expect(await act(dvdFf, `select public.submit_response($1, 'DOLAZIM', null, true)`, [joint])).toBe('OK');
    const { rows } = await db.query<{ member_id: string; organization_id: string }>(
      `select member_id, organization_id from public.intervention_responses
        where intervention_id = $1 and member_id = $2`,
      [joint, dvdFfMember],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(DVD); // the responder's own service, not SZS
  });

  it('progresses their journey as their DVD member, a DVD row', async () => {
    expect(await act(dvdFf, `select public.set_journey_progress($1, 'KRECEM')`, [joint])).toBe('OK');
    const { rows } = await db.query<{ organization_id: string }>(
      `select organization_id from public.intervention_journey
        where intervention_id = $1 and member_id = $2`,
      [joint, dvdFfMember],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(DVD);
  });

  it('checks in, and the interval is credited to DVD though the call-out is SZS (D15)', async () => {
    expect(await act(dvdFf, `select public.attendance_check_in($1)`, [joint])).toBe('OK');
    const { rows } = await db.query<{ organization_id: string; credited: string; source: string }>(
      `select organization_id, credited_organization_id as credited, source
         from public.attendance_intervals where intervention_id = $1 and member_id = $2`,
      [joint, dvdFfMember],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(SZS); // whose intervention (§6.3)
    expect(rows[0]!.credited).toBe(DVD); // whose participation (D15)
    expect(rows[0]!.source).toBe('SELF_DECLARED');
  });
});

describe('each service confirms only its own participants attendance (D20)', () => {
  it('the SZS own-selection checks in too, credited to SZS', async () => {
    expect(await act(szsFf, `select public.attendance_check_in($1)`, [joint])).toBe('OK');
    const { rows } = await db.query<{ credited: string }>(
      `select credited_organization_id as credited from public.attendance_intervals
        where intervention_id = $1 and member_id = $2`,
      [joint, szsFfMember],
    );
    expect(rows[0]!.credited).toBe(SZS);
  });

  it('DVD command confirms the DVD interval; SZS command is refused it', async () => {
    const dvdInterval = (
      await db.query<{ id: string }>(
        `select id from public.attendance_intervals where intervention_id = $1 and member_id = $2`,
        [joint, dvdFfMember],
      )
    ).rows[0]!.id;
    expect(await act(szsCommander, `select public.attendance_confirm($1, null)`, [dvdInterval])).toBe(
      'ORGANIZATION_MISMATCH',
    );
    expect(await act(dvdCommander, `select public.attendance_confirm($1, null)`, [dvdInterval])).toBe('OK');
  });

  it('SZS command confirms the SZS interval; DVD command is refused it', async () => {
    const szsInterval = (
      await db.query<{ id: string }>(
        `select id from public.attendance_intervals where intervention_id = $1 and member_id = $2`,
        [joint, szsFfMember],
      )
    ).rows[0]!.id;
    expect(await act(dvdCommander, `select public.attendance_confirm($1, null)`, [szsInterval])).toBe(
      'ORGANIZATION_MISMATCH',
    );
    expect(await act(szsCommander, `select public.attendance_confirm($1, null)`, [szsInterval])).toBe('OK');
  });
});

describe('the publisher alone commands the incident lifecycle (D20)', () => {
  it('DVD command cannot change the status of an SZS call-out; SZS command can', async () => {
    expect(
      await act(dvdCommander, `select public.set_intervention_status($1, 'ASSEMBLING', null)`, [joint]),
    ).toBe('ORGANIZATION_MISMATCH');
    expect(
      await act(szsCommander, `select public.set_intervention_status($1, 'ASSEMBLING', null)`, [joint]),
    ).toBe('OK');
  });

  it('DVD command cannot close an SZS call-out; SZS command can', async () => {
    expect(
      await act(dvdCommander, `select public.close_intervention($1, 'CLOSED', 'Gotovo je.', true)`, [joint]),
    ).toBe('ORGANIZATION_MISMATCH');
    expect(
      await act(szsCommander, `select public.close_intervention($1, 'CLOSED', 'Intervencija zavrsena.', true)`, [joint]),
    ).toBe('OK');
  });
});

describe('a dual-service person is paged and answers once, under the publishing service (D16)', () => {
  it('has one recipient row (SZS) and answers once, written to the SZS record', async () => {
    // The dual member appears once, filed under SZS (the publisher, §6.2).
    const recipients = (
      await db.query<{ member_id: string }>(
        `select member_id from public.intervention_recipients
          where intervention_id = $1 and member_id in ($2, $3)`,
        [joint, dualDvdMember, dualSzsMember],
      )
    ).rows;
    expect(recipients).toHaveLength(1);
    expect(recipients[0]!.member_id).toBe(dualSzsMember);

    // A fresh open call-out to answer on (the canonical one is now closed).
    const open = await asUserCommitted(db, szsCommander.userId, async (c) => {
      const draft = (
        await c.query<{ id: string }>(
          `select public.create_intervention_draft_in($1, 'POZAR', 'Druga zajednicka',
                  'Upute.', 'Lokacija', 'part-joint-2') as id`,
          [SZS],
        )
      ).rows[0]!.id;
      await c.query(`select public.publish_intervention($1, $2, $3)`, [draft, [dualSzsMember], [DVD]]);
      return draft;
    });
    expect(await act(dual, `select public.submit_response($1, 'DOLAZIM', null, true)`, [open])).toBe('OK');
    const answers = (
      await db.query<{ member_id: string; organization_id: string }>(
        `select member_id, organization_id from public.intervention_responses where intervention_id = $1`,
        [open],
      )
    ).rows;
    expect(answers).toHaveLength(1);
    expect(answers[0]!.member_id).toBe(dualSzsMember);
    expect(answers[0]!.organization_id).toBe(SZS);
  });
});

describe('single-service participation is unchanged', () => {
  it('a DVD member answers and checks in on a DVD-only call-out exactly as before', async () => {
    const dvdOnly = await asUserCommitted(db, dvdCommander.userId, async (c) => {
      const draft = (
        await c.query<{ id: string }>(
          `select public.create_intervention_draft_in($1, 'POZAR', 'Samo DVD',
                  'Upute.', 'Lokacija', 'part-dvd-only') as id`,
          [DVD],
        )
      ).rows[0]!.id;
      await c.query(`select public.publish_intervention($1, $2, $3)`, [draft, [dvdFf2Member], []]);
      return draft;
    });
    expect(await act(dvdFf2, `select public.submit_response($1, 'DOLAZIM', null, true)`, [dvdOnly])).toBe('OK');
    expect(await act(dvdFf2, `select public.attendance_check_in($1)`, [dvdOnly])).toBe('OK');
    const { rows } = await db.query<{ organization_id: string; credited: string }>(
      `select a.organization_id, a.credited_organization_id as credited
         from public.attendance_intervals a where a.intervention_id = $1 and a.member_id = $2`,
      [dvdOnly, dvdFf2Member],
    );
    expect(rows[0]!.organization_id).toBe(DVD);
    expect(rows[0]!.credited).toBe(DVD); // credited == organization_id on a single-service call-out
    // DVD command confirms its own, as always.
    const interval = (
      await db.query<{ id: string }>(
        `select id from public.attendance_intervals where intervention_id = $1 and member_id = $2`,
        [dvdOnly, dvdFf2Member],
      )
    ).rows[0]!.id;
    expect(await act(dvdCommander, `select public.attendance_confirm($1, null)`, [interval])).toBe('OK');
  });
});

describe('a non-recipient of the other service is still refused (isolation preserved)', () => {
  it('an SZS-only bystander cannot answer or check in on a DVD-only call-out', async () => {
    const dvdOnly = await asUserCommitted(db, dvdCommander.userId, async (c) => {
      const draft = (
        await c.query<{ id: string }>(
          `select public.create_intervention_draft_in($1, 'POZAR', 'Samo DVD 2',
                  'Upute.', 'Lokacija', 'part-dvd-only-2') as id`,
          [DVD],
        )
      ).rows[0]!.id;
      await c.query(`select public.publish_intervention($1, $2, $3)`, [draft, [dvdFfMember], []]);
      return draft;
    });
    // An SZS firefighter holds no DVD member: refused before learning the state.
    expect(await act(szsFf, `select public.submit_response($1, 'DOLAZIM', null, true)`, [dvdOnly])).toBe(
      'MEMBER_RECORD_REQUIRED',
    );
    expect(await act(szsFf, `select public.attendance_check_in($1)`, [dvdOnly])).toBe('STAFF_REQUIRED');
  });
});
