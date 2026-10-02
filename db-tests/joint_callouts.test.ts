/**
 * P7: joint cross-service call-outs, proven against real row-level security.
 *
 * A call-out published by one service may also target the other (D18 symmetric).
 * Every eligible member of a targeted service is paged (D19, whole-service). A
 * person who serves in both is paged ONCE, under their publishing-service member
 * record (D16, §6.2). A recipient row is scoped to the MEMBER'S service, so each
 * service sees only its own participants and never the other's (the foundation of
 * D20/D21). These tests build the four account shapes — DVD-only, SZS-only,
 * dual-service and owner — and assert both the reach and the isolation.
 *
 * migration: 202609290040_joint_callouts.sql
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

let szsCommander: TestAccount; // publisher of the canonical joint call-out (SZS)
let dvdCommander: TestAccount; // DVD command, and publisher for the symmetric case
let dvdFf: TestAccount; // DVD-only firefighter — paged via the DVD recipient org
let szsFf: TestAccount; // SZS-only firefighter — own-selected by the SZS publisher
let dual: TestAccount; // serves in both — must be paged once, under SZS
let owner: TestAccount; // installation owner, no member record — never paged
let citizen: TestAccount; // no role — a leak control

let szsFfMember: string;
let dvdFfMember: string;
let dvdCommanderMember: string;
let dualDvdMember: string;
let dualSzsMember: string;

let joint: string; // the canonical SZS -> DVD joint call-out

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

/** The recipient rows a given actor may read for the joint call-out, by member and service. */
function recipientsSeenBy(account: TestAccount, interventionId: string) {
  return asUser(db, account.userId, async (c) =>
    (
      await c.query<{ member_id: string; organization_id: string }>(
        `select member_id, organization_id from public.intervention_recipients
          where intervention_id = $1 order by organization_id, member_id`,
        [interventionId],
      )
    ).rows,
  );
}

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  // Publisher: an SZS commander. is_command_in(SZS) is what publish checks.
  szsCommander = await createAccount(db, 'p7-szs-cmd@example.invalid');
  await completeProfile(db, szsCommander.userId, 'SZS Komandir');
  await addMembership(SZS, szsCommander.userId, 'COMMANDER');

  // DVD command — reads DVD participants, and publishes the symmetric case.
  dvdCommander = await createAccount(db, 'p7-dvd-cmd@example.invalid');
  await completeProfile(db, dvdCommander.userId, 'DVD Komandir');
  await grantRole(db, dvdCommander.userId, 'COMMANDER'); // DVD COMMANDER membership
  dvdCommanderMember = await createMember(db, 'DVD Komandir', dvdCommander.userId); // DVD member

  // DVD-only firefighter — reached only because DVD is a recipient organisation.
  dvdFf = await createAccount(db, 'p7-dvd-ff@example.invalid');
  await completeProfile(db, dvdFf.userId, 'DVD Vatrogasac');
  await grantRole(db, dvdFf.userId, 'FIREFIGHTER');
  dvdFfMember = await createMember(db, 'DVD Vatrogasac', dvdFf.userId);

  // SZS-only firefighter — own-selected by the SZS publisher.
  szsFf = await createAccount(db, 'p7-szs-ff@example.invalid');
  await completeProfile(db, szsFf.userId, 'SZS Spasilac');
  await addMembership(SZS, szsFf.userId, 'FIREFIGHTER');
  szsFfMember = await addMemberIn(SZS, 'SZS Spasilac', szsFf.userId);

  // Dual-service: a DVD member AND an SZS member. Own-selected on the SZS side
  // AND eligible on the DVD side, so both branches see them — dedupe must keep one.
  dual = await createAccount(db, 'p7-dual@example.invalid');
  await completeProfile(db, dual.userId, 'Dvojna Sluzba');
  await grantRole(db, dual.userId, 'FIREFIGHTER'); // DVD FIREFIGHTER membership
  dualDvdMember = await createMember(db, 'Dvojna Sluzba', dual.userId); // DVD member
  await addMembership(SZS, dual.userId, 'FIREFIGHTER'); // SZS membership
  dualSzsMember = await addMemberIn(SZS, 'Dvojna Sluzba', dual.userId); // SZS member

  owner = await createAccount(db, 'p7-owner@example.invalid');
  await completeProfile(db, owner.userId, 'Vlasnik Sistema');
  await grantRole(db, owner.userId, 'OWNER'); // OWNER grant, no membership, no member

  citizen = await createAccount(db, 'p7-citizen@example.invalid');
  await completeProfile(db, citizen.userId, 'Gradjanin');

  // The canonical joint call-out: SZS publishes, selecting its own szsFf and the
  // dual member (as SZS), and additionally targeting the whole of DVD.
  joint = await asUserCommitted(db, szsCommander.userId, async (c) => {
    const draft = (
      await c.query<{ id: string }>(
        `select public.create_intervention_draft_in($1, 'POZAR', 'Zajednicka intervencija',
                'Upute su ovdje.', 'Lokacija', 'p7-joint-1') as id`,
        [SZS],
      )
    ).rows[0]!.id;
    await c.query(`select public.publish_intervention($1, $2, $3)`, [
      draft,
      [szsFfMember, dualSzsMember],
      [DVD],
    ]);
    return draft;
  });
});

afterAll(async () => {
  await db?.end();
});

describe('a joint SZS -> DVD call-out reaches the other service (D18, D19)', () => {
  it('records DVD as an additional recipient organisation', async () => {
    const { rows } = await db.query<{ organization_id: string }>(
      `select organization_id from public.intervention_recipient_organizations where intervention_id = $1`,
      [joint],
    );
    expect(rows.map((r) => r.organization_id)).toEqual([DVD]);
  });

  it('pages a DVD-only member, with the recipient row scoped to DVD', async () => {
    const { rows } = await db.query<{ organization_id: string }>(
      `select organization_id from public.intervention_recipients
        where intervention_id = $1 and member_id = $2`,
      [joint, dvdFfMember],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(DVD); // the member's service, not the publisher's
  });

  it('pages the SZS own-selection, scoped to SZS', async () => {
    const { rows } = await db.query<{ organization_id: string }>(
      `select organization_id from public.intervention_recipients
        where intervention_id = $1 and member_id = $2`,
      [joint, szsFfMember],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(SZS);
  });
});

describe('a dual-service person is paged once, under the publishing service (D16, §6.2)', () => {
  it('has exactly one recipient row, its SZS member record', async () => {
    const { rows } = await db.query<{ member_id: string; organization_id: string }>(
      `select member_id, organization_id from public.intervention_recipients
        where intervention_id = $1 and member_id in ($2, $3)`,
      [joint, dualDvdMember, dualSzsMember],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.member_id).toBe(dualSzsMember);
    expect(rows[0]!.organization_id).toBe(SZS); // credited to the publishing service (D15)
  });

  it('has exactly one IN_APP outbox row, deduped by user', async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*) as n from public.notification_outbox
        where intervention_id = $1 and user_id = $2 and channel = 'IN_APP'`,
      [joint, dual.userId],
    );
    expect(rows[0]!.n).toBe('1');
  });
});

describe('each service sees only its own participants (D20/D21 foundation)', () => {
  it('the SZS commander sees the SZS participants, never the DVD ones', async () => {
    const seen = await recipientsSeenBy(szsCommander, joint);
    const orgs = new Set(seen.map((r) => r.organization_id));
    expect(orgs.has(SZS)).toBe(true);
    expect(orgs.has(DVD)).toBe(false); // no DVD recipient rows visible to SZS command
    expect(seen.some((r) => r.member_id === dvdFfMember)).toBe(false);
    expect(seen.some((r) => r.member_id === szsFfMember)).toBe(true);
  });

  it('the DVD commander sees the DVD participants, never the SZS ones', async () => {
    const seen = await recipientsSeenBy(dvdCommander, joint);
    const orgs = new Set(seen.map((r) => r.organization_id));
    expect(orgs.has(DVD)).toBe(true);
    expect(orgs.has(SZS)).toBe(false);
    expect(seen.some((r) => r.member_id === dvdFfMember)).toBe(true);
    expect(seen.some((r) => r.member_id === szsFfMember)).toBe(false);
    expect(seen.some((r) => r.member_id === dualSzsMember)).toBe(false); // dual is filed under SZS
  });

  it('a paged DVD-only member reads their own recipient row', async () => {
    const seen = await recipientsSeenBy(dvdFf, joint);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.member_id).toBe(dvdFfMember);
  });
});

describe('cross-service leak controls', () => {
  it('a citizen in neither service sees no recipient rows and no recipient organisations', async () => {
    const seenRecipients = await recipientsSeenBy(citizen, joint);
    expect(seenRecipients).toHaveLength(0);
    const seenOrgs = await asUser(db, citizen.userId, async (c) =>
      (
        await c.query(
          `select 1 from public.intervention_recipient_organizations where intervention_id = $1`,
          [joint],
        )
      ).rowCount,
    );
    expect(seenOrgs).toBe(0);
  });

  it('a paged member may see which services the call-out went to', async () => {
    const seen = await asUser(db, dvdFf.userId, async (c) =>
      (
        await c.query<{ organization_id: string }>(
          `select organization_id from public.intervention_recipient_organizations where intervention_id = $1`,
          [joint],
        )
      ).rows,
    );
    expect(seen.map((r) => r.organization_id)).toEqual([DVD]);
  });

  it('refuses an own-selection member from another service (P4b isolation preserved)', async () => {
    await expect(
      asUser(db, szsCommander.userId, async (c) => {
        const draft = (
          await c.query<{ id: string }>(
            `select public.create_intervention_draft_in($1, 'POZAR', 'Podmetnuto',
                    'Upute su ovdje.', 'Lokacija', 'p7-forge-1') as id`,
            [SZS],
          )
        ).rows[0]!.id;
        // A DVD member id in the OWN selection (not as a recipient organisation).
        await c.query(`select public.publish_intervention($1, $2, $3)`, [draft, [dvdFfMember], []]);
      }),
    ).rejects.toThrow(/ORGANIZATION_MISMATCH/);
  });
});

describe('symmetric: DVD may also target SZS (D18)', () => {
  it('a DVD-published call-out pages an SZS member, scoped to SZS', async () => {
    const dvdJoint = await asUserCommitted(db, dvdCommander.userId, async (c) => {
      const draft = (
        await c.query<{ id: string }>(
          `select public.create_intervention_draft_in($1, 'POZAR', 'DVD zove SZS',
                  'Upute su ovdje.', 'Lokacija', 'p7-symmetric-1') as id`,
          [DVD],
        )
      ).rows[0]!.id;
      await c.query(`select public.publish_intervention($1, $2, $3)`, [draft, [dvdCommanderMember], [SZS]]);
      return draft;
    });
    const { rows } = await db.query<{ organization_id: string }>(
      `select organization_id from public.intervention_recipients
        where intervention_id = $1 and member_id = $2`,
      [dvdJoint, szsFfMember],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organization_id).toBe(SZS);
  });
});

describe('the owner (no member record) commands a joint call-out but is never paged', () => {
  it('owner can publish a joint SZS -> DVD call-out and appears on no recipient list', async () => {
    const ownerJoint = await asUserCommitted(db, owner.userId, async (c) => {
      const draft = (
        await c.query<{ id: string }>(
          `select public.create_intervention_draft_in($1, 'POZAR', 'Vlasnik objavljuje',
                  'Upute su ovdje.', 'Lokacija', 'p7-owner-1') as id`,
          [SZS],
        )
      ).rows[0]!.id;
      await c.query(`select public.publish_intervention($1, $2, $3)`, [draft, [szsFfMember], [DVD]]);
      return draft;
    });
    // The owner holds no member record in either service, so no recipient row is theirs.
    const { rows } = await db.query<{ n: string }>(
      `select count(*) as n from public.intervention_recipients r
         join public.members m on m.id = r.member_id
        where r.intervention_id = $1 and m.user_id = $2`,
      [ownerJoint, owner.userId],
    );
    expect(rows[0]!.n).toBe('0');
    // But the DVD firefighter was reached, so the call-out really did go out.
    const dvdReached = await db.query<{ n: string }>(
      `select count(*) as n from public.intervention_recipients
        where intervention_id = $1 and member_id = $2`,
      [ownerJoint, dvdFfMember],
    );
    expect(dvdReached.rows[0]!.n).toBe('1');
  });
});
