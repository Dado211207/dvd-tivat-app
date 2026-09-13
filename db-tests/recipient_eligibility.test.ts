/**
 * Who may be called out.
 *
 * Found on the real hosted project during the physical device test of
 * 13 September 2026: the recipient picker offered "Bivsi Clan", the fictional
 * member whose account the owner had withdrawn. That was not a rendering
 * mistake - `publish_intervention` filtered on `members.active` alone, so a
 * member row still active in the roster passed even though the person behind
 * it can no longer sign in, holds no role, and would be refused by every
 * command in this schema the moment they tried to answer.
 *
 * Every case below goes through the real command as a real authenticated
 * non-superuser. The one that matters most is the last: a modified client
 * posting an ineligible member id straight at the RPC, which is the only
 * version of this the server is actually responsible for.
 */

import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  asUser,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  createDraftAsSuperuser,
  createMember,
  expectRefused,
  grantRole,
  resetSchema,
} from './harness';

let db: Client;

/** Every actor the eligibility rule has an opinion about. */
interface Cast {
  commanderUser: string;
  eligible: Record<string, string>;
  ineligible: Record<string, string>;
}

let cast: Cast;

async function buildCast(): Promise<Cast> {
  const eligible: Record<string, string> = {};
  const ineligible: Record<string, string> = {};

  const commander = await createAccount(db, 'komandir@example.invalid');
  await completeProfile(db, commander.userId, 'Komandir Smjene');
  await grantRole(db, commander.userId, 'COMMANDER');
  eligible.commander = await createMember(db, 'Komandir Smjene', commander.userId);

  const firefighter = await createAccount(db, 'vatrogasac1@example.invalid');
  await completeProfile(db, firefighter.userId, 'Ivo Vatrogasac');
  await grantRole(db, firefighter.userId, 'FIREFIGHTER');
  eligible.firefighter = await createMember(db, 'Ivo Vatrogasac', firefighter.userId);

  const admin = await createAccount(db, 'administrator@example.invalid');
  await completeProfile(db, admin.userId, 'Admin Kancelarija');
  await grantRole(db, admin.userId, 'ADMIN');
  eligible.admin = await createMember(db, 'Admin Kancelarija', admin.userId);

  const owner = await createAccount(db, 'vlasnik@example.invalid');
  await completeProfile(db, owner.userId, 'Vlasnik Naloga');
  await grantRole(db, owner.userId, 'OWNER');
  eligible.owner = await createMember(db, 'Vlasnik Naloga', owner.userId);

  // THE ONE FROM THE REAL TEST: roster row still active, account withdrawn.
  const withdrawn = await createAccount(db, 'ukinut@example.invalid');
  await completeProfile(db, withdrawn.userId, 'Bivsi Clan');
  await grantRole(db, withdrawn.userId, 'FIREFIGHTER', false);
  ineligible.withdrawnAccount = await createMember(db, 'Bivsi Clan', withdrawn.userId);

  const pending = await createAccount(db, 'cekanje@example.invalid');
  await completeProfile(db, pending.userId, 'Novi Clan');
  await grantRole(db, pending.userId, 'PENDING');
  ineligible.pendingAccount = await createMember(db, 'Novi Clan', pending.userId);

  const incomplete = await createAccount(db, 'nepotpun@example.invalid');
  await grantRole(db, incomplete.userId, 'FIREFIGHTER');
  ineligible.incompleteProfile = await createMember(db, 'Nepotpun Profil', incomplete.userId);

  // A member with no account at all: a real roster entry for somebody who
  // simply never signed up. Nothing can reach them.
  ineligible.noAccount = await createMember(db, 'Marko Probni');

  const inactivePerson = await createAccount(db, 'neaktivan@example.invalid');
  await completeProfile(db, inactivePerson.userId, 'Neaktivan Clan');
  await grantRole(db, inactivePerson.userId, 'FIREFIGHTER');
  ineligible.inactiveMember = await createMember(db, 'Neaktivan Clan', inactivePerson.userId);
  await db.query('update public.members set active = false where id = $1', [
    ineligible.inactiveMember,
  ]);

  return { commanderUser: commander.userId, eligible, ineligible };
}

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);
  cast = await buildCast();
}, 180_000);

afterAll(async () => {
  await db?.end();
});

describe('is_eligible_recipient answers for every state a person can be in', () => {
  it.each([
    ['an active firefighter', () => cast.eligible.firefighter, true],
    ['a commander - they turn out too', () => cast.eligible.commander, true],
    ['an administrator - they turn out too', () => cast.eligible.admin, true],
    ['the owner', () => cast.eligible.owner, true],
    ['a WITHDRAWN account', () => cast.ineligible.withdrawnAccount, false],
    ['an account still awaiting approval', () => cast.ineligible.pendingAccount, false],
    ['an incomplete profile', () => cast.ineligible.incompleteProfile, false],
    ['a member with no linked account', () => cast.ineligible.noAccount, false],
    ['an inactive member record', () => cast.ineligible.inactiveMember, false],
  ])('%s -> %s', async (_label, member, expected) => {
    const { rows } = await db.query<{ eligible: boolean }>(
      'select public.is_eligible_recipient($1) as eligible',
      [member()],
    );
    expect(rows[0]!.eligible).toBe(expected);
  });
});

describe('the commander is only offered people who can actually answer', () => {
  it('lists every eligible member and no ineligible one', async () => {
    const names = await asUser(db, cast.commanderUser, async (client) => {
      const { rows } = await client.query<{ full_name: string }>(
        'select full_name from public.eligible_recipients()',
      );
      return rows.map((r) => r.full_name);
    });

    expect(names).toContain('Ivo Vatrogasac');
    expect(names).toContain('Komandir Smjene');
    expect(names).toContain('Admin Kancelarija');

    // The exact name that appeared in the real picker.
    expect(names, 'a withdrawn account must not be offered').not.toContain('Bivsi Clan');
    expect(names).not.toContain('Novi Clan');
    expect(names).not.toContain('Nepotpun Profil');
    expect(names).not.toContain('Marko Probni');
    expect(names).not.toContain('Neaktivan Clan');
  });

  it('is refused to somebody with no operational access at all', async () => {
    const rows = await asUser(db, null, async (client) => {
      const result = await client
        .query('select * from public.eligible_recipients()')
        .catch(() => ({ rows: [] }));
      return result.rows;
    });
    expect(rows).toEqual([]);
  });
});

describe('publishing refuses an ineligible recipient', () => {
  let intervention: string;

  let serial = 0;
  beforeEach(async () => {
    serial += 1;
    intervention = await createDraftAsSuperuser(db, cast.commanderUser, `eligibility-${serial}`);
  });

  it('publishes to an eligible firefighter', async () => {
    // Committed, because the assertion below reads from outside the
    // transaction. `asUser` rolls back, which would make this pass for the
    // wrong reason - an empty table proves nothing if the write was undone.
    await asUserCommitted(db, cast.commanderUser, async (client) => {
      await client.query('select public.publish_intervention($1, $2)', [
        intervention,
        [cast.eligible.firefighter],
      ]);
    });
    const { rows } = await db.query(
      'select member_id from public.intervention_recipients where intervention_id = $1',
      [intervention],
    );
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['a withdrawn account', () => cast.ineligible.withdrawnAccount],
    ['an account awaiting approval', () => cast.ineligible.pendingAccount],
    ['an incomplete profile', () => cast.ineligible.incompleteProfile],
    ['a member with no account', () => cast.ineligible.noAccount],
    ['an inactive member', () => cast.ineligible.inactiveMember],
  ])('refuses %s sent straight to the command', async (_label, member) => {
    // Straight at the RPC, which is the only version of this the server is
    // responsible for: a modified client can send any id it likes.
    const message = await expectRefused(db, cast.commanderUser, (client) =>
      client.query('select public.publish_intervention($1, $2)', [intervention, [member()]]),
    );
    expect(message).toContain('RECIPIENT_NOT_ELIGIBLE');
  });

  it('refuses the WHOLE call-out when one of several is ineligible', async () => {
    // Silently dropping the ineligible one would leave a commander believing
    // five people were called when four were, and they would only find out
    // when somebody never answered.
    const message = await expectRefused(db, cast.commanderUser, (client) =>
      client.query('select public.publish_intervention($1, $2)', [
        intervention,
        [cast.eligible.firefighter, cast.ineligible.withdrawnAccount],
      ]),
    );
    expect(message).toContain('RECIPIENT_NOT_ELIGIBLE');
  });

  it('leaves nothing behind, because a refusal is atomic', async () => {
    // PostgREST runs each RPC call in its own transaction, so a raise undoes
    // everything the function did before it. This does not prove the raise -
    // the tests above do that - it records the property the refusal relies on,
    // so a future rewrite that swallows the error and returns normally, having
    // already written half a recipient list, fails here.
    await expectRefused(db, cast.commanderUser, (client) =>
      client.query('select public.publish_intervention($1, $2)', [
        intervention,
        [cast.eligible.firefighter, cast.ineligible.withdrawnAccount],
      ]),
    );

    const recipients = await db.query<{ n: number }>(
      'select count(*)::int as n from public.intervention_recipients where intervention_id = $1',
      [intervention],
    );
    const outbox = await db.query<{ n: number }>(
      'select count(*)::int as n from public.notification_outbox where intervention_id = $1',
      [intervention],
    );
    const state = await db.query<{ status: string; published_at: string | null }>(
      'select status, published_at from public.interventions where id = $1',
      [intervention],
    );

    expect(recipients.rows[0]!.n).toBe(0);
    expect(outbox.rows[0]!.n).toBe(0);
    expect(state.rows[0]!.status).toBe('DRAFT');
    expect(state.rows[0]!.published_at).toBeNull();
  });
});
