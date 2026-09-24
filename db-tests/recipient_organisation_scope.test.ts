/**
 * A call-out may only reach the service that sent it.
 *
 * `is_eligible_recipient()` and `eligible_recipients()` decide who may be
 * called out. Both ask five questions about a person - active member record,
 * linked account, complete profile, active grant, operational role - and never
 * which SERVICE they serve in. `organizations` has held two rows since
 * 202609200013, so that omission is real.
 *
 * WHAT IS NOT TRUE, and was claimed before this file was written: that the
 * omission is reachable today. It is not, and the first section below proves
 * why. `sync_dvd_membership_from_grant` mirrors every operational grant into
 * an active DVD membership and mirrors a DVD stand-down back to CITIZEN, so
 * "holds an operational grant" and "is an active DVD member" are currently the
 * same set of people, the owner aside. Every command-layer route to an
 * SZS-only account leaves it with a CITIZEN grant, which the fifth question
 * already refuses.
 *
 * So this is not a live-bug fix. It is the removal of a trap that springs at
 * P5, when the mirror is retired and that invariant disappears - at the point
 * in the rewrite where the schema is at its most disturbed and this would be
 * one defect among fifty. Closing it now costs one function and is provable
 * against a fixture; closing it then is guesswork.
 *
 * The second section therefore builds the post-P5 state deliberately, with
 * superuser SQL, the way `createDraftAsSuperuser` exists to test a constraint
 * with the command layer skipped: the backstop, not the door.
 */

import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

interface Person {
  userId: string;
  memberId: string;
}
interface Cast {
  /** OWNER. Holds no membership row at all, by design - see 202609210016. */
  owner: Person;
  dvdCommander: Person;
  dvdFirefighter: Person;
  /** Operational grant, SZS membership active, DVD membership stood down. */
  szsOnly: Person;
}

let cast: Cast;

const SZS_ONLY_EMAIL = 'komandir-szs@example.invalid';

async function memberships(userId: string): Promise<string> {
  const { rows } = await db.query<{ services: string }>(
    `select coalesce(string_agg(
              service.code || '=' || membership.role ||
              case when membership.active then '' else '(off)' end,
              ',' order by service.code), '(none)') as services
       from public.organization_memberships membership
       join public.organizations service on service.id = membership.organization_id
      where membership.user_id = $1`,
    [userId],
  );
  return rows[0]!.services;
}

async function grantOf(userId: string): Promise<string> {
  const { rows } = await db.query<{ role: string }>(
    `select role from public.access_grants where user_id = $1`,
    [userId],
  );
  return rows[0]!.role;
}

const eligible = (callerUserId: string, memberId: string) =>
  asUser(db, callerUserId, async (client) => {
    const { rows } = await client.query<{ eligible: boolean }>(
      `select public.is_eligible_recipient($1) as eligible`,
      [memberId],
    );
    return rows[0]!.eligible;
  });

const picker = (callerUserId: string) =>
  asUser(db, callerUserId, async (client) => {
    const { rows } = await client.query<{ full_name: string }>(
      `select full_name from public.eligible_recipients() order by full_name`,
    );
    return rows.map((row) => row.full_name);
  });

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  const owner = await createAccount(db, 'vlasnik@example.invalid');
  await completeProfile(db, owner.userId, 'Vlasnik Sistema');
  await grantRole(db, owner.userId, 'OWNER');
  const ownerMember = await createMember(db, 'Vlasnik Sistema', owner.userId);

  const dvdCommander = await createAccount(db, 'komandir-dvd@example.invalid');
  await completeProfile(db, dvdCommander.userId, 'Komandir Dvd');
  await grantRole(db, dvdCommander.userId, 'COMMANDER');
  const dvdCommanderMember = await createMember(db, 'Komandir Dvd', dvdCommander.userId);

  const dvdFirefighter = await createAccount(db, 'vatrogasac-dvd@example.invalid');
  await completeProfile(db, dvdFirefighter.userId, 'Ivo Vatrogasac');
  await grantRole(db, dvdFirefighter.userId, 'FIREFIGHTER');
  const dvdFirefighterMember = await createMember(db, 'Ivo Vatrogasac', dvdFirefighter.userId);

  const szsOnly = await createAccount(db, SZS_ONLY_EMAIL);
  await completeProfile(db, szsOnly.userId, 'Komandir Szs');
  const szsOnlyMember = await createMember(db, 'Komandir Szs', szsOnly.userId);

  cast = {
    owner: { userId: owner.userId, memberId: ownerMember },
    dvdCommander: { userId: dvdCommander.userId, memberId: dvdCommanderMember },
    dvdFirefighter: { userId: dvdFirefighter.userId, memberId: dvdFirefighterMember },
    szsOnly: { userId: szsOnly.userId, memberId: szsOnlyMember },
  };
});

afterAll(async () => db.end());

describe('today the command layer masks the missing predicate', () => {
  /*
   * These four run in order and leave the SZS account in the state the rest of
   * the file needs. They are the evidence for the claim in this file's header,
   * and they are worth keeping afterwards: if the mirror's behaviour ever
   * changes, this is where it shows up as a decision rather than a surprise.
   */

  it('gives a fresh SZS assignment no operational grant, so it is not callable', async () => {
    await asUserCommitted(db, cast.owner.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, 'SZS', 'COMMANDER')`, [
        cast.szsOnly.userId,
      ]),
    );

    expect(await memberships(cast.szsOnly.userId)).toBe('SZS=COMMANDER');
    expect(await grantOf(cast.szsOnly.userId), 'SZS never touches the grant').toBe('CITIZEN');
    // Refused by the FIFTH question - the operational-role one - not by the
    // service question this migration adds. Both before and after the fix.
    expect(await eligible(cast.dvdCommander.userId, cast.szsOnly.memberId)).toBe(false);
  });

  it('mirrors any operational grant straight back into an active DVD membership', async () => {
    await asUserCommitted(db, cast.owner.userId, (client) =>
      client.query(`select public.owner_set_role($1, 'COMMANDER')`, [cast.szsOnly.userId]),
    );

    // This is the masking invariant, stated: you cannot hold an operational
    // grant and not be in DVD. The person is now genuinely in both services,
    // so a DVD commander seeing them is correct, not a leak.
    expect(await memberships(cast.szsOnly.userId)).toBe('DVD=COMMANDER,SZS=COMMANDER');
    expect(await eligible(cast.dvdCommander.userId, cast.szsOnly.memberId)).toBe(true);
  });

  it('mirrors a DVD stand-down back to CITIZEN, closing the route again', async () => {
    await asUserCommitted(db, cast.owner.userId, (client) =>
      client.query(`select public.owner_set_organization_membership($1, 'DVD', 'NONE')`, [
        cast.szsOnly.userId,
      ]),
    );

    expect(await memberships(cast.szsOnly.userId)).toBe('DVD=COMMANDER(off),SZS=COMMANDER');
    expect(await grantOf(cast.szsOnly.userId), 'the stand-down costs the grant').toBe('CITIZEN');
    expect(await eligible(cast.dvdCommander.userId, cast.szsOnly.memberId)).toBe(false);
  });

  it('leaves no command-layer route to an SZS-only account that is still callable', async () => {
    // The conclusion of the three above, asserted as one statement so it reads
    // as the finding it is rather than as a side effect of the sequence.
    const grant = await grantOf(cast.szsOnly.userId);
    const services = await memberships(cast.szsOnly.userId);
    expect(
      grant === 'CITIZEN' || services.includes('DVD=') === false || services.includes('(off)'),
      'an operational grant always carries an active DVD membership',
    ).toBe(true);
  });
});

describe('after the mirror is retired, the service question is the one that refuses', () => {
  /*
   * The P5 state, built with superuser SQL because no command produces it:
   * an operational grant, an active SZS membership, and NO active DVD one.
   * `createDraftAsSuperuser` exists for exactly this - proving a rule holds
   * when the command layer is skipped entirely.
   */
  beforeAll(async () => {
    await db.query(`update public.access_grants set role = 'COMMANDER' where user_id = $1`, [
      cast.szsOnly.userId,
    ]);
    // Straight at the table, so the grant is NOT mirrored back to CITIZEN.
    await db.query(
      `update public.organization_memberships membership
          set active = false
         from public.organizations service
        where service.id = membership.organization_id
          and service.code = 'DVD'
          and membership.user_id = $1`,
      [cast.szsOnly.userId],
    );
  });

  it('really is the post-P5 state: operational grant, SZS only', async () => {
    expect(await grantOf(cast.szsOnly.userId)).toBe('COMMANDER');
    expect(await memberships(cast.szsOnly.userId)).toBe('DVD=COMMANDER(off),SZS=COMMANDER');
  });

  /** FAILS against the old schema: the SZS commander was eligible to DVD. */
  it('does not count an SZS-only member as eligible for a DVD commander', async () => {
    expect(await eligible(cast.dvdCommander.userId, cast.szsOnly.memberId)).toBe(false);
  });

  /** FAILS against the old schema: the picker listed the whole installation. */
  it('does not offer an SZS-only member in a DVD commander picker', async () => {
    expect(await picker(cast.dvdCommander.userId)).not.toContain('Komandir Szs');
  });

  /** FAILS against the old schema. The mirror image, so neither side is special. */
  it('does not offer DVD members in an SZS commander picker', async () => {
    const offered = await picker(cast.szsOnly.userId);
    expect(offered).not.toContain('Ivo Vatrogasac');
    expect(offered).not.toContain('Komandir Dvd');
  });

  /**
   * FAILS against the old schema, and this is the one that matters.
   *
   * The picker is courtesy. A modified client posting the other service's
   * member id straight at the RPC is the only version of this the server is
   * responsible for, and it has to refuse the WHOLE call-out rather than
   * quietly dropping one name.
   */
  it('refuses a published call-out that names a member of the other service', async () => {
    const draft = await createDraft(db, cast.dvdCommander.userId, { key: 'cross-service-1' });
    const message = await expectRefused(db, cast.dvdCommander.userId, (client) =>
      client.query(`select public.publish_intervention($1, $2)`, [
        draft,
        [cast.dvdFirefighter.memberId, cast.szsOnly.memberId],
      ]),
    );
    expect(message).toContain('RECIPIENT_NOT_ELIGIBLE');

    // A partial publication would be worse than a refusal: the commander would
    // believe two people were paged when one was.
    const { rows } = await db.query<{ recipients: string; outbox: string }>(
      `select (select count(*) from public.intervention_recipients
                where intervention_id = $1)::text as recipients,
              (select count(*) from public.notification_outbox
                where intervention_id = $1)::text as outbox`,
      [draft],
    );
    expect(rows[0]!.recipients).toBe('0');
    expect(rows[0]!.outbox).toBe('0');
  });
});

describe('a single-service installation sees no change at all', () => {
  it('still counts a DVD firefighter as eligible for a DVD commander', async () => {
    expect(await eligible(cast.dvdCommander.userId, cast.dvdFirefighter.memberId)).toBe(true);
  });

  it('still offers every DVD member in the DVD commander picker', async () => {
    const offered = await picker(cast.dvdCommander.userId);
    expect(offered).toContain('Ivo Vatrogasac');
    expect(offered).toContain('Komandir Dvd');
  });

  it('still publishes a call-out to members of the caller own service', async () => {
    const draft = await createDraft(db, cast.dvdCommander.userId, { key: 'same-service-1' });
    const published = await asUserCommitted(db, cast.dvdCommander.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select public.publish_intervention($1, $2) as id`,
        [draft, [cast.dvdFirefighter.memberId]],
      );
      return rows[0]!.id;
    });
    expect(published).toBe(draft);

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.intervention_recipients where intervention_id = $1`,
      [draft],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('still lets somebody confirm their own eligibility, for push registration', async () => {
    // `register_web_push_subscription` asks `is_eligible_recipient` about the
    // caller's OWN member record. That still holds for somebody who actually
    // serves in the service being asked about.
    expect(await eligible(cast.dvdFirefighter.userId, cast.dvdFirefighter.memberId)).toBe(true);

    // CHANGED BY P4b (202609250027). `is_eligible_recipient` now means
    // "eligible for a DVD call-out" rather than "eligible anywhere", so it is
    // answered against DVD authority rather than the installation-wide grant.
    // This person's member record sits in DVD - `createMember` takes the
    // transitional default - but by this point in the file the mirror has stood
    // their DVD membership down, so they hold no DVD authority and are not
    // somebody a DVD call-out may reach. Asking themselves does not change that.
    //
    // Nothing reachable regresses: `register_web_push_subscription` already
    // refuses this account at its own `current_dvd_role()` gate, several checks
    // earlier, so the caller never arrives here.
    expect(await eligible(cast.szsOnly.userId, cast.szsOnly.memberId)).toBe(false);
  });
});

describe('the installation owner belongs to every service', () => {
  /*
   * The owner holds NO membership row - 202609210016 keeps it that way so that
   * assigning it a service cannot overwrite the only OWNER grant. A plain
   * "shares a membership" rule would therefore make the owner invisible to
   * everybody and blind to everybody, which is a behaviour change nobody asked
   * this migration for. Both directions are asserted.
   */
  it('is still callable by a DVD commander, as 202609150008 decided', async () => {
    expect(await eligible(cast.dvdCommander.userId, cast.owner.memberId)).toBe(true);
  });

  it('is not asked about by an SZS commander in DVD terms', async () => {
    // CHANGED BY P4b (202609250029). Under P0 this was true through
    // `serves_with`, whose owner clause answers for the owner to everybody.
    // Since 027 `is_eligible_recipient` means "may a DVD call-out reach this
    // person", and 029 answers that only for somebody who is staff in DVD -
    // which this account, stood down from DVD by the mirror, is not. 027 had
    // dropped P0's caller bound altogether, so a citizen could ask it too.
    //
    // SZS still pages the owner: through an SZS member record, with
    // `is_eligible_recipient_in(<that record>, SZS)` - asserted in
    // organisation_interventions.test.ts.
    expect(await eligible(cast.szsOnly.userId, cast.owner.memberId)).toBe(false);
  });

  it('sees every member of the service it is picking for', async () => {
    // CHANGED BY P4b (202609250027). `eligible_recipients()` is now the DVD
    // list, and `eligible_recipients_in(service)` is the general one. The owner
    // still reaches both - one service at a time, which is the only shape a
    // call-out has until P7 answers the joint-intervention questions.
    const offered = await picker(cast.owner.userId);
    expect(offered).toContain('Ivo Vatrogasac');
    expect(offered).toContain('Komandir Dvd');
    expect(offered).toContain('Vlasnik Sistema');
    // Stood down from DVD by the mirror earlier in this file, so not somebody a
    // DVD call-out may reach.
    expect(offered).not.toContain('Komandir Szs');
  });

  it('may no longer put two services on one call-out', async () => {
    // CHANGED BY P4b (202609250027), and deliberately: one call-out reaches one
    // service. The owner keeps both services - they may run a call-out in each -
    // but mixing them into a single recipient list is a joint intervention,
    // which Q1-Q8 have not been answered for and P7 is where it is designed.
    const draft = await createDraft(db, cast.owner.userId, { key: 'owner-both-1' });
    const message = await expectRefused(db, cast.owner.userId, (client) =>
      client.query(`select public.publish_intervention($1, $2)`, [
        draft,
        [cast.dvdFirefighter.memberId, cast.szsOnly.memberId],
      ]),
    );
    expect(message).toContain('RECIPIENT_NOT_ELIGIBLE');

    // ...and the same call-out to its own service still goes out.
    const published = await asUserCommitted(db, cast.owner.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select public.publish_intervention($1, $2) as id`,
        [draft, [cast.dvdFirefighter.memberId]],
      );
      return rows[0]!.id;
    });
    expect(published).toBe(draft);
  });
});

describe('serving with somebody is not authority', () => {
  it('reads whether two people share a service, never which role they hold', async () => {
    // If this ever starts depending on the membership ROLE, authority has
    // quietly moved into a function documented as granting none - which is the
    // whole reason P0 can ship before the authority rewrite.
    const { rows } = await db.query<{ src: string }>(
      `select pg_get_functiondef(p.oid) as src
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'serves_with'`,
    );
    const source = rows[0]!.src;
    expect(source).toContain('organization_memberships');
    expect(source).not.toMatch(/mine\.role|theirs\.role/);
  });

  it('refuses an anonymous caller', async () => {
    await expectRefused(db, null, (client) =>
      client.query(`select public.serves_with($1)`, [cast.dvdFirefighter.userId]),
    );
  });
});
