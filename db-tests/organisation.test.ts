/**
 * The organisational write paths: members, groups, vehicles and intervention
 * drafts.
 *
 * Two rules this file exists to prove:
 *
 * 1. Maintaining the roster is ADMIN authority, not command authority. A
 *    COMMANDER runs call-outs and does not edit who is in the society.
 * 2. Linking an account to a member is what makes the whole response system
 *    reachable, and it confers no authority whatsoever while doing so.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
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
let owner: string;
let admin: string;
let commander: string;
let firefighter: string;
let pending: string;

/** Every organisational command, with arguments that would otherwise succeed. */
const ADMIN_COMMANDS: ReadonlyArray<readonly [string, string, unknown[]]> = [
  ['admin_create_member', 'select public.admin_create_member($1)', ['Probno Ime']],
  [
    'admin_update_member',
    'select public.admin_update_member($1, $2, $3)',
    ['00000000-0000-0000-0000-000000000000', 'Probno Ime', []],
  ],
  [
    'admin_set_member_active',
    'select public.admin_set_member_active($1, $2, $3)',
    ['00000000-0000-0000-0000-000000000000', false, 'razlog'],
  ],
  [
    'admin_link_member_account',
    'select public.admin_link_member_account($1, $2)',
    ['00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000'],
  ],
  ['admin_create_group', 'select public.admin_create_group($1)', ['Probna grupa']],
  [
    'admin_create_vehicle',
    'select public.admin_create_vehicle($1, $2, $3)',
    ['P-1', 'Probno vozilo', 'navalno'],
  ],
];

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  const make = async (email: string, role: string, name: string): Promise<string> => {
    const account = await createAccount(db, email);
    await completeProfile(db, account.userId, name);
    await grantRole(db, account.userId, role);
    return account.userId;
  };

  owner = await make('vlasnik@example.invalid', 'OWNER', 'Ime Vlasnik');
  admin = await make('admin@example.invalid', 'ADMIN', 'Ime Administrator');
  commander = await make('komandir@example.invalid', 'COMMANDER', 'Ime Komandir');
  firefighter = await make('vatrogasac@example.invalid', 'FIREFIGHTER', 'Ime Vatrogasac');
  pending = await make('cekanje@example.invalid', 'PENDING', 'Ime Na Cekanju');
}, 60_000);

afterAll(async () => {
  await db?.end();
});

describe('who may maintain organisational records', () => {
  it('refuses a firefighter every organisational command', async () => {
    for (const [name, sql, args] of ADMIN_COMMANDS) {
      const message = await expectRefused(db, firefighter, (client) => client.query(sql, args));
      expect(`${name}: ${message.includes('ADMIN_REQUIRED')}`).toBe(`${name}: true`);
    }
  });

  it('refuses a COMMANDER too, because command is not roster authority', async () => {
    // The distinction ACCESS_MODEL.md states in prose: a commander publishes
    // call-outs, an administrator maintains who is in the society. Before this
    // slice the difference had no predicate to stand on.
    for (const [name, sql, args] of ADMIN_COMMANDS) {
      const message = await expectRefused(db, commander, (client) => client.query(sql, args));
      expect(`${name}: ${message.includes('ADMIN_REQUIRED')}`).toBe(`${name}: true`);
    }
  });

  it('refuses an unapproved account', async () => {
    const message = await expectRefused(db, pending, (client) =>
      client.query('select public.admin_create_member($1)', ['Probno Ime']),
    );
    expect(message).toContain('ADMIN_REQUIRED');
  });

  it('refuses an anonymous caller at the privilege layer, before any check runs', async () => {
    for (const [name, sql, args] of ADMIN_COMMANDS) {
      const message = await expectRefused(db, null, (client) => client.query(sql, args));
      expect(`${name}: ${/permission denied/i.test(message)}`).toBe(`${name}: true`);
    }
  });

  it('allows an ADMIN and an OWNER', async () => {
    for (const actor of [admin, owner]) {
      const { rows } = await asUser(db, actor, (client) =>
        client.query<{ id: string }>('select public.admin_create_member($1) as id', ['Probno Ime']),
      );
      expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('members', () => {
  it('creates a member and records who created it', async () => {
    const id = await asUserCommitted(db, admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.admin_create_member($1, $2) as id',
        ['Novi Clan', ['bolnicar']],
      );
      return rows[0]!.id;
    });

    const { rows } = await db.query<{ full_name: string; specialties: string[]; active: boolean }>(
      'select full_name, specialties, active from public.members where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ full_name: 'Novi Clan', specialties: ['bolnicar'], active: true });

    const audit = await db.query<{ event_type: string; changed_by: string }>(
      `select event_type, changed_by from public.organisation_audit
        where entity_kind = 'MEMBER' and entity_id = $1`,
      [id],
    );
    expect(audit.rows).toEqual([{ event_type: 'MEMBER_CREATED', changed_by: admin }]);
  });

  it('refuses a name too short to be a name', async () => {
    const message = await expectRefused(db, admin, (client) =>
      client.query('select public.admin_create_member($1)', ['X']),
    );
    expect(message).toContain('FULL_NAME_REQUIRED');
  });

  it('records what an update changed, not merely that it changed', async () => {
    const id = await asUserCommitted(db, admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.admin_create_member($1) as id',
        ['Staro Ime'],
      );
      return rows[0]!.id;
    });
    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_update_member($1, $2, $3)', [id, 'Novo Ime', ['vozac']]),
    );

    const { rows } = await db.query<{ detail: Record<string, unknown> }>(
      `select detail from public.organisation_audit
        where entity_id = $1 and event_type = 'MEMBER_UPDATED'`,
      [id],
    );
    expect(rows[0]!.detail).toMatchObject({
      previous_full_name: 'Staro Ime',
      next_full_name: 'Novo Ime',
      next_specialties: ['vozac'],
    });
  });

  it('refuses deactivating without a reason', async () => {
    const id = await createMember(db, 'Clan Za Gasenje');
    const message = await expectRefused(db, admin, (client) =>
      client.query('select public.admin_set_member_active($1, $2, $3)', [id, false, '  ']),
    );
    expect(message).toContain('REASON_REQUIRED');
  });

  it('takes away the operational identity when a member is deactivated', async () => {
    // This is the real consequence, and the reason a reason is required:
    // current_member_id() resolves only for an ACTIVE member, so deactivating
    // somebody stops them responding to anything on their very next request.
    const account = await createAccount(db, 'gasenje@example.invalid');
    await completeProfile(db, account.userId, 'Clan Sa Nalogom');
    await grantRole(db, account.userId, 'FIREFIGHTER');
    const memberId = await createMember(db, 'Clan Sa Nalogom', account.userId);

    const before = await asUser(db, account.userId, (client) =>
      client.query<{ id: string | null }>('select public.current_member_id() as id'),
    );
    expect(before.rows[0]!.id).toBe(memberId);

    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_set_member_active($1, $2, $3)', [
        memberId,
        false,
        'Privremeno van sastava (vjezba)',
      ]),
    );

    const after = await asUser(db, account.userId, (client) =>
      client.query<{ id: string | null }>('select public.current_member_id() as id'),
    );
    expect(after.rows[0]!.id).toBeNull();
  });

  it('refuses an unknown member', async () => {
    const message = await expectRefused(db, admin, (client) =>
      client.query('select public.admin_update_member($1, $2, $3)', [
        '00000000-0000-0000-0000-000000000000',
        'Bilo Ko',
        [],
      ]),
    );
    expect(message).toContain('MEMBER_NOT_FOUND');
  });
});

describe('linking an account to a member', () => {
  async function freshAccount(email: string, name: string): Promise<string> {
    const account = await createAccount(db, email);
    await completeProfile(db, account.userId, name);
    await grantRole(db, account.userId, 'FIREFIGHTER');
    return account.userId;
  }

  it('is what makes a member able to answer a call-out at all', async () => {
    // This used to publish to the unlinked member and check that
    // `submit_response` refused them. That state is now unreachable, which is a
    // stronger guarantee and the one the test asserts instead: an unlinked
    // member cannot even be ADDRESSED. They could never have opened the
    // call-out, so counting them among the people called was always wrong.
    const userId = await freshAccount('veza@example.invalid', 'Clan Za Vezu');
    const memberId = await createMember(db, 'Clan Za Vezu');

    const intervention = await createDraft(db, commander, { key: `veza-${Date.now()}` });
    const refusedPublish = await expectRefused(db, commander, (client) =>
      client.query('select public.publish_intervention($1, $2)', [intervention, [memberId]]),
    );
    expect(refusedPublish).toContain('RECIPIENT_NOT_ELIGIBLE');

    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_link_member_account($1, $2)', [memberId, userId]),
    );

    // Linked, and now callable. The same draft, so this is the identical
    // request that was refused a moment ago - only the link has changed.
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.publish_intervention($1, $2)', [intervention, [memberId]]),
    );

    await asUserCommitted(db, userId, (client) =>
      client.query('select public.submit_response($1, $2, $3, $4)', [
        intervention,
        'DOLAZIM',
        null,
        false,
      ]),
    );
    const { rows } = await db.query<{ answer: string }>(
      'select answer from public.intervention_responses where intervention_id = $1',
      [intervention],
    );
    expect(rows).toEqual([{ answer: 'DOLAZIM' }]);
  });

  it('confers no authority of its own', async () => {
    // Authority is read from access_grants and nowhere else. A member row is an
    // operational person; it has never carried a role and must not start now.
    const account = await createAccount(db, 'bezuloge@example.invalid');
    await completeProfile(db, account.userId, 'Clan Bez Uloge');
    const memberId = await createMember(db, 'Clan Bez Uloge');
    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_link_member_account($1, $2)', [memberId, account.userId]),
    );

    const { rows } = await asUser(db, account.userId, (client) =>
      client.query<{ role: string | null; staff: boolean }>(
        'select public.current_dvd_role() as role, public.is_dvd_staff() as staff',
      ),
    );
    expect(rows[0]).toEqual({ role: null, staff: false });
  });

  it('reports the two one-to-one collisions differently', async () => {
    // "This person already has an account" and "this account is already
    // somebody else" need different corrections from the administrator.
    const userOne = await freshAccount('jedan@example.invalid', 'Clan Jedan');
    const userTwo = await freshAccount('dva@example.invalid', 'Clan Dva');
    const memberOne = await createMember(db, 'Clan Jedan');
    const memberTwo = await createMember(db, 'Clan Dva');

    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_link_member_account($1, $2)', [memberOne, userOne]),
    );

    const alreadyLinkedMember = await expectRefused(db, admin, (client) =>
      client.query('select public.admin_link_member_account($1, $2)', [memberOne, userTwo]),
    );
    expect(alreadyLinkedMember).toContain('MEMBER_ALREADY_LINKED');

    const alreadyLinkedAccount = await expectRefused(db, admin, (client) =>
      client.query('select public.admin_link_member_account($1, $2)', [memberTwo, userOne]),
    );
    expect(alreadyLinkedAccount).toContain('ACCOUNT_ALREADY_LINKED');
  });

  it('treats relinking the same pair as a retry, not a second link', async () => {
    const userId = await freshAccount('ponovo@example.invalid', 'Clan Ponovo');
    const memberId = await createMember(db, 'Clan Ponovo');
    for (let i = 0; i < 2; i += 1) {
      await asUserCommitted(db, admin, (client) =>
        client.query('select public.admin_link_member_account($1, $2)', [memberId, userId]),
      );
    }
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.organisation_audit
        where entity_id = $1 and event_type = 'MEMBER_ACCOUNT_LINKED'`,
      [memberId],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('refuses linking an account that does not exist', async () => {
    const memberId = await createMember(db, 'Clan Bez Naloga');
    const message = await expectRefused(db, admin, (client) =>
      client.query('select public.admin_link_member_account($1, $2)', [
        memberId,
        '00000000-0000-0000-0000-000000000000',
      ]),
    );
    expect(message).toContain('ACCOUNT_NOT_FOUND');
  });

  it('unlinks with a reason, and the identity goes away again', async () => {
    const userId = await freshAccount('razvez@example.invalid', 'Clan Razvez');
    const memberId = await createMember(db, 'Clan Razvez');
    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_link_member_account($1, $2)', [memberId, userId]),
    );

    const noReason = await expectRefused(db, admin, (client) =>
      client.query('select public.admin_unlink_member_account($1, $2)', [memberId, '']),
    );
    expect(noReason).toContain('REASON_REQUIRED');

    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_unlink_member_account($1, $2)', [
        memberId,
        'Nalog pogresno povezan (vjezba)',
      ]),
    );
    const { rows } = await asUser(db, userId, (client) =>
      client.query<{ id: string | null }>('select public.current_member_id() as id'),
    );
    expect(rows[0]!.id).toBeNull();
  });
});

describe('groups', () => {
  it('refuses a duplicate name regardless of case', async () => {
    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_create_group($1)', ['Prva smjena']),
    );
    const message = await expectRefused(db, admin, (client) =>
      client.query('select public.admin_create_group($1)', ['PRVA SMJENA']),
    );
    expect(message).toContain('GROUP_NAME_TAKEN');
  });

  it('replaces the membership list and records what actually changed', async () => {
    const groupId = await asUserCommitted(db, admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.admin_create_group($1) as id',
        ['Grupa za izmjene'],
      );
      return rows[0]!.id;
    });
    const one = await createMember(db, 'Clan Grupe Jedan');
    const two = await createMember(db, 'Clan Grupe Dva');
    const three = await createMember(db, 'Clan Grupe Tri');

    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_set_group_members($1, $2)', [groupId, [one, two]]),
    );
    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_set_group_members($1, $2)', [groupId, [two, three]]),
    );

    const { rows } = await db.query<{ member_id: string }>(
      'select member_id from public.group_members where group_id = $1 order by member_id',
      [groupId],
    );
    expect(rows.map((row) => row.member_id).sort()).toEqual([two, three].sort());

    const audit = await db.query<{ detail: { added: string[]; removed: string[] } }>(
      `select detail from public.organisation_audit
        where entity_id = $1 and event_type = 'GROUP_MEMBERS_CHANGED'
        order by changed_at`,
      [groupId],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[1]!.detail.added).toEqual([three]);
    expect(audit.rows[1]!.detail.removed).toEqual([one]);
  });

  it('refuses the whole edit when one member id is unknown, changing nothing', async () => {
    // Silently dropping an unknown id would leave the administrator believing
    // they had assigned somebody they had not.
    const groupId = await asUserCommitted(db, admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.admin_create_group($1) as id',
        ['Grupa sa greskom'],
      );
      return rows[0]!.id;
    });
    const real = await createMember(db, 'Stvarni Clan');
    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_set_group_members($1, $2)', [groupId, [real]]),
    );

    const message = await expectRefused(db, admin, (client) =>
      client.query('select public.admin_set_group_members($1, $2)', [
        groupId,
        [real, '00000000-0000-0000-0000-000000000000'],
      ]),
    );
    expect(message).toContain('MEMBER_NOT_FOUND');

    const { rows } = await db.query<{ n: number }>(
      'select count(*)::int as n from public.group_members where group_id = $1',
      [groupId],
    );
    expect(rows[0]!.n).toBe(1);
  });
});

describe('vehicles', () => {
  it('refuses a duplicate callsign regardless of case', async () => {
    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_create_vehicle($1, $2, $3)', [
        'V-1',
        'Navalno vozilo (izmisljeno)',
        'navalno',
      ]),
    );
    const message = await expectRefused(db, admin, (client) =>
      client.query('select public.admin_create_vehicle($1, $2, $3)', [
        'v-1',
        'Drugo vozilo',
        'cisterna',
      ]),
    );
    expect(message).toContain('CALLSIGN_TAKEN');
  });

  it('deactivates with a reason and records both sides of the change', async () => {
    const id = await asUserCommitted(db, admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select public.admin_create_vehicle($1, $2, $3) as id',
        ['V-9', 'Vozilo za servis (izmisljeno)', 'navalno'],
      );
      return rows[0]!.id;
    });
    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_set_vehicle_active($1, $2, $3)', [
        id,
        false,
        'Na servisu (vjezba)',
      ]),
    );

    const { rows } = await db.query<{ detail: Record<string, boolean>; reason: string }>(
      `select detail, reason from public.organisation_audit
        where entity_id = $1 and event_type = 'VEHICLE_ACTIVE_CHANGED'`,
      [id],
    );
    expect(rows[0]!.detail).toEqual({ previous_active: true, next_active: false });
    expect(rows[0]!.reason).toBe('Na servisu (vjezba)');
  });
});

describe('creating an intervention draft', () => {
  const draft = (client: Client, args: unknown[]) =>
    client.query<{ id: string }>(
      `select public.create_intervention_draft($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`,
      args,
    );

  it('refuses a firefighter, because drafting is command authority', async () => {
    const message = await expectRefused(db, firefighter, (client) =>
      draft(client, [
        'POZAR',
        'Naslov vjezbe',
        'Uputstvo za vjezbu.',
        'Izmisljena lokacija',
        `ff-${Date.now()}`,
        null,
        null,
        null,
        null,
      ]),
    );
    expect(message).toContain('COMMAND_REQUIRED');
  });

  it('creates a DRAFT that no firefighter can see', async () => {
    const id = await createDraft(db, commander, { key: `vidljivost-${Date.now()}` });
    const { rows } = await db.query<{ status: string }>(
      'select status from public.interventions where id = $1',
      [id],
    );
    expect(rows[0]!.status).toBe('DRAFT');

    const seen = await asUser(db, firefighter, (client) =>
      client.query('select id from public.interventions where id = $1', [id]),
    );
    expect(seen.rows).toEqual([]);
  });

  it("requires a note saying what 'DRUGO' actually is", async () => {
    const message = await expectRefused(db, commander, (client) =>
      draft(client, [
        'DRUGO',
        'Naslov vjezbe',
        'Uputstvo za vjezbu.',
        'Izmisljena lokacija',
        `drugo-${Date.now()}`,
        null,
        null,
        null,
        null,
      ]),
    );
    expect(message).toContain('KIND_NOTE_REQUIRED');
  });

  it('refuses half a coordinate pair, and a pair with no provenance', async () => {
    const halfPair = await expectRefused(db, commander, (client) =>
      draft(client, [
        'POZAR',
        'Naslov vjezbe',
        'Uputstvo za vjezbu.',
        'Izmisljena lokacija',
        `pola-${Date.now()}`,
        null,
        42.43,
        null,
        null,
      ]),
    );
    expect(halfPair).toContain('INVALID_COORDINATES');

    const noSource = await expectRefused(db, commander, (client) =>
      draft(client, [
        'POZAR',
        'Naslov vjezbe',
        'Uputstvo za vjezbu.',
        'Izmisljena lokacija',
        `bezizvora-${Date.now()}`,
        null,
        42.43,
        18.7,
        null,
      ]),
    );
    expect(noSource).toContain('INVALID_COORDINATES');
  });

  it('stamps the coordinate capture time from the server, not the caller', async () => {
    // There is deliberately no parameter for it. A client must not be able to
    // claim a pin was placed at a time of its choosing.
    const id = await asUserCommitted(db, commander, async (client) => {
      const { rows } = await draft(client, [
        'POZAR',
        'Naslov vjezbe',
        'Uputstvo za vjezbu.',
        'Izmisljena lokacija',
        `pin-${Date.now()}`,
        null,
        42.43,
        18.7,
        'MAP_PIN',
      ]);
      return rows[0]!.id;
    });

    const { rows } = await db.query<{
      coordinate_source: string;
      captured_recently: boolean;
    }>(
      `select coordinate_source,
              coordinate_captured_at > now() - interval '1 minute' as captured_recently
         from public.interventions where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ coordinate_source: 'MAP_PIN', captured_recently: true });
  });

  it('still requires a typed place even when a pin is dropped', async () => {
    const message = await expectRefused(db, commander, (client) =>
      draft(client, [
        'POZAR',
        'Naslov vjezbe',
        'Uputstvo za vjezbu.',
        ' ',
        `bezmjesta-${Date.now()}`,
        null,
        42.43,
        18.7,
        'MAP_PIN',
      ]),
    );
    expect(message).toContain('LOCATION_REQUIRED');
  });
});

describe('editing and discarding a draft', () => {
  it('refuses an edit whose expected version is stale', async () => {
    const id = await createDraft(db, commander, { key: `verzija-${Date.now()}` });
    await asUserCommitted(db, commander, (client) =>
      client.query(
        'select public.update_intervention_draft($1, $2, $3, $4, $5)',
        [id, 'Ispravljen naslov', 'Ispravljeno uputstvo.', 'Izmisljena lokacija', 1],
      ),
    );
    const message = await expectRefused(db, commander, (client) =>
      client.query(
        'select public.update_intervention_draft($1, $2, $3, $4, $5)',
        [id, 'Jos jedan naslov', 'Jos jedno uputstvo.', 'Izmisljena lokacija', 1],
      ),
    );
    expect(message).toContain('VERSION_CONFLICT');
  });

  it('refuses editing a draft that has already been published', async () => {
    // After publication an operationally important edit becomes an
    // intervention_updates row, so that what recipients already acted on is
    // never silently rewritten.
    // A member who can actually be called: publishing now refuses anybody who
    // could not open the call-out, so the fixture has to be a real recipient.
    const recipient = await createAccount(db, `izmjena-${Date.now()}@example.invalid`);
    await completeProfile(db, recipient.userId, 'Primalac Izmjene');
    await grantRole(db, recipient.userId, 'FIREFIGHTER');
    const memberId = await createMember(db, 'Primalac Izmjene', recipient.userId);
    const id = await createDraft(db, commander, { key: `objavljen-${Date.now()}` });
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.publish_intervention($1, $2)', [id, [memberId]]),
    );

    const message = await expectRefused(db, commander, (client) =>
      client.query(
        'select public.update_intervention_draft($1, $2, $3, $4, $5)',
        [id, 'Novi naslov', 'Novo uputstvo.', 'Izmisljena lokacija', 2],
      ),
    );
    expect(message).toContain('INTERVENTION_NOT_DRAFT');
  });

  it('keeps the original capture time when the pin has not moved', async () => {
    const id = await asUserCommitted(db, commander, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select public.create_intervention_draft(
           $1, $2, $3, $4, $5, null, $6, $7, $8) as id`,
        [
          'POZAR',
          'Naslov vjezbe',
          'Uputstvo za vjezbu.',
          'Izmisljena lokacija',
          `nepomjeren-${Date.now()}`,
          42.43,
          18.7,
          'MAP_PIN',
        ],
      );
      return rows[0]!.id;
    });
    const before = await db.query<{ at: Date }>(
      'select coordinate_captured_at as at from public.interventions where id = $1',
      [id],
    );

    await asUserCommitted(db, commander, (client) =>
      client.query(
        `select public.update_intervention_draft($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, 'Drugi naslov', 'Drugo uputstvo.', 'Izmisljena lokacija', 1, 42.43, 18.7, 'MAP_PIN'],
      ),
    );

    const after = await db.query<{ at: Date }>(
      'select coordinate_captured_at as at from public.interventions where id = $1',
      [id],
    );
    expect(after.rows[0]!.at.getTime()).toBe(before.rows[0]!.at.getTime());
  });

  it('cancels a discarded draft rather than deleting it', async () => {
    const id = await createDraft(db, commander, { key: `odbacen-${Date.now()}` });

    const noReason = await expectRefused(db, commander, (client) =>
      client.query('select public.discard_intervention_draft($1, $2)', [id, '']),
    );
    expect(noReason).toContain('REASON_REQUIRED');

    await asUserCommitted(db, commander, (client) =>
      client.query('select public.discard_intervention_draft($1, $2)', [
        id,
        'Greskom kreirano (vjezba)',
      ]),
    );

    const { rows } = await db.query<{ status: string; close_reason: string }>(
      'select status, close_reason from public.interventions where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({
      status: 'CANCELLED',
      close_reason: 'Greskom kreirano (vjezba)',
    });
  });
});

describe('the organisational audit trail', () => {
  it('is readable by an administrator and by nobody below', async () => {
    await asUserCommitted(db, admin, (client) =>
      client.query('select public.admin_create_member($1)', ['Clan Za Reviziju']),
    );

    const asAdmin = await asUser(db, admin, (client) =>
      client.query('select id from public.organisation_audit'),
    );
    expect(asAdmin.rows.length).toBeGreaterThan(0);

    for (const actor of [commander, firefighter, pending]) {
      const { rows } = await asUser(db, actor, (client) =>
        client.query('select id from public.organisation_audit'),
      );
      expect(rows).toEqual([]);
    }
  });

  it('cannot be written or erased directly, by anybody', async () => {
    const insert = await expectRefused(db, admin, (client) =>
      client.query(
        `insert into public.organisation_audit(entity_kind, entity_id, event_type, changed_by)
         values ('MEMBER', gen_random_uuid(), 'FORGED', $1)`,
        [admin],
      ),
    );
    expect(insert).toMatch(/permission denied/i);

    const remove = await expectRefused(db, admin, (client) =>
      client.query('delete from public.organisation_audit'),
    );
    expect(remove).toMatch(/permission denied/i);
  });
});
