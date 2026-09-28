/**
 * A fake Supabase project, answered inside the browser.
 *
 * The host `fixture-not-a-real-project.supabase.co` is deliberately not a
 * project anybody owns. Every request to it is intercepted and answered here,
 * so these tests need no credentials, contact nothing, and run in CI - while
 * the application underneath believes it is signed in and talking to a server.
 *
 * That is the only way to see the operational screens in a real browser. The
 * ordinary build has no project configured, so all of them stop at the gate and
 * render "this copy is not connected to a server" - which is honest, and proves
 * nothing about the screens themselves.
 */

import type { Page, Route } from '@playwright/test';

export const PROJECT_HOST = 'fixture-not-a-real-project.supabase.co';
const PROJECT_REF = 'fixture-not-a-real-project';

export const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ID = '22222222-2222-4222-8222-222222222222';
export const INTERVENTION_ID = '33333333-3333-4333-8333-333333333333';
export const INTERVAL_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '99999999-9999-4999-8999-999999999999';
const SECOND_USER_ID = '55555555-5555-4555-8555-555555555555';
const DVD_ID = '00000000-0000-4000-8000-000000000001';
const SZS_ID = '00000000-0000-4000-8000-000000000002';

// P6 multi-service seed: distinct member ids, call-outs and rosters per service,
// so a dual-service or owner session proves the CLIENT scopes everything to the
// acting service (isolation itself is RLS, proven in db-tests/).
export const DUAL_DVD_MEMBER = 'aaaa0d13-0000-4000-8000-000000000001';
export const DUAL_SZS_MEMBER = 'bbbb0d13-0000-4000-8000-000000000002';
const DVD_ORG_CALLOUT = 'aaaa0001-0000-4000-8000-000000000011';
const SZS_ORG_CALLOUT = 'bbbb0002-0000-4000-8000-000000000022';
export const DVD_CALLOUT_TITLE = 'DVD poziv (izmišljeni podaci)';
export const SZS_CALLOUT_TITLE = 'SZS poziv (izmišljeni podaci)';
export const DVD_ROSTER_NAME = 'Marko DVD (izmišljeno)';
export const SZS_ROSTER_NAME = 'Ana SZS (izmišljeno)';

export type FixtureRole = 'OWNER' | 'ADMIN' | 'COMMANDER' | 'FIREFIGHTER';

/** One service a multi-service account belongs to, as the server would report it. */
export interface FixtureMembership {
  readonly service: 'DVD' | 'SZS';
  /** What `current_role_in(this service)` returns. */
  readonly role: FixtureRole;
  /** What `current_member_id_in(this service)` returns; null = no member record. */
  readonly memberId: string | null;
}

/**
 * The situations the screens have to be legible in, not just the happy one.
 *
 * The fixture answered exactly one state - a commander, an active account, one
 * published call-out - so every browser test was a test of the busiest screen
 * this application ever shows. The states nobody had looked at in a browser are
 * the ones a firefighter is most likely to meet: no call-out running, an
 * a limited citizen account, a suspended account, a draft half-written.
 * An empty state that is wrong is as bad as a full one that is wrong, and it is
 * far easier to ship without noticing.
 */
export interface FixtureOptions {
  /** P6: run the browser fixture as an SZS-only member, without a DVD role. */
  readonly service?: 'DVD' | 'SZS';
  /** A small mutable fake for one isolated call-out lifecycle. */
  readonly lifecycle?: boolean;
  /**
   * What `current_dvd_role()` answers.
   *
   * `null` is a real answer, not an absence: an account that exists, is signed
   * in and has no DVD operational grant yet. That is the citizen state -
   * the gate derives it from a null role, there is no account status spelling
   * it - and a fixture that could not express it could not test it.
   */
  readonly role?: FixtureRole | null;
  /**
   * What `current_account_status()` answers.
   *
   * Exactly the five values the function can return - see `ACCOUNT_STATUSES` in
   * `src/auth/access.ts`. Anything else is narrowed to null by the client and
   * shows as "server unreachable", which is the right way to fail on an
   * unrecognised value and the wrong thing for a test to be asserting.
   */
  readonly accountStatus?:
    | 'ANONYMOUS'
    | 'UNKNOWN'
    | 'SUSPENDED'
    | 'PROFILE_REQUIRED'
    | 'ACTIVE';
  /**
   * What the `interventions` table holds.
   *
   * `PUBLISHED_AND_DRAFT` is the case the brief cares most about: a commander
   * running one call-out with another half-written, which is where losing a
   * typed draft would actually cost something.
   */
  readonly interventions?: 'PUBLISHED' | 'NONE' | 'DRAFT' | 'PUBLISHED_AND_DRAFT';
  /** Seeded into this device's storage before the application boots. */
  readonly language?: 'me' | 'en';
  /** False leaves the browser with no session, so the gate asks for sign-in. */
  readonly signedIn?: boolean;
  /**
   * Make the server fail, in the two ways that read differently to a person.
   *
   * `ACCESS` breaks the access check itself, so the gate cannot decide who this
   * is and says the server is unreachable. `READS` lets the gate succeed and
   * then refuses the table reads with a policy error, which is the case a
   * commander meets when a role is changed underneath them - the console has to
   * say "refused" rather than "unavailable", because those call for different
   * things from the person reading them.
   */
  readonly serverFails?: 'ACCESS' | 'READS';
  /**
   * Hold every answer this long, so the loading state can actually be looked at.
   *
   * Without it the fixture answers instantly and "Ucitavanje..." exists for a
   * frame nobody can catch - which is why it had never been checked in a
   * browser at all.
   */
  readonly slowMs?: number;
  /**
   * Give the account directory the longest name and email a person might have.
   *
   * The Accounts table was built and looked at with "Ivo Vatrogasac" in it, and
   * on a telephone it clipped its last two columns off the right edge - which
   * is where a person's status and role live. Long text is what makes that
   * visible at a width where short text still just fits.
   */
  readonly longText?: boolean;
  /**
   * Refuse these tables by name, leaving every other read working.
   *
   * A whole-server outage is the easy case - something fails and every screen
   * says so. The dangerous case is ONE table a role no longer reaches while
   * everything around it still answers: nothing throws, the read comes back
   * empty, and the screen renders a confident empty result. This is how that
   * case gets reproduced.
   */
  readonly refuseTables?: readonly string[];
  /**
   * Refuse these commands by name, leaving every other answer working.
   *
   * `refuseTables` cannot express this one, because `current_member_id` is a
   * command rather than a table - and it is the command whose swallowed refusal
   * was the most expensive, because the gate turned it into "your account is
   * not linked to a member of the society". A whole-server failure is
   * `serverFails: 'ACCESS'`; this is the narrower and nastier case where the
   * access check succeeds, the screens underneath work, and exactly one command
   * answers 42501.
   */
  readonly refuseRpcs?: readonly string[];
  /**
   * What `current_member_id()` answers.
   *
   * `null` is a real answer, not an absence: a signed-in account with an
   * operational role and no member record on the roster. It is the state the
   * gate's "not linked to a member of the society" sentence is FOR, and until
   * a refused read could be told apart from it, the fixture had no reason to
   * express it - both produced the same screen.
   */
  readonly memberId?: string | null;
  /**
   * P6: a multi-service account - a dual-service member (two member records), or
   * the installation owner who administers both. When set, it drives the identity
   * RPCs (`current_organization_memberships`, `current_role_in`,
   * `current_member_id_in`, `is_installation_owner`) for BOTH services and seeds a
   * distinct call-out and roster per service, so a browser test can switch the
   * acting service and prove the client re-scopes every read. It overrides the
   * single-service `service`/`role`/`memberId` shims. `owner` forces
   * `is_installation_owner` true even when no membership is OWNER (the owner who
   * administers a service they are not a member of).
   */
  readonly memberships?: readonly FixtureMembership[];
  readonly owner?: boolean;
}

const DRAFT_ID = '88888888-8888-4888-8888-888888888888';

function interventionRows(which: NonNullable<FixtureOptions['interventions']>): unknown[] {
  const published = {
    id: INTERVENTION_ID,
    kind: 'VJEZBA',
    other_kind_note: null,
    title: 'Vjezba: provjera opreme',
    instructions: 'Okupljanje u bazi DVD Tivat. Ponijeti naprtnjace.',
    incident_location: 'Poligon iznad Donje Lastve (izmisljena lokacija)',
    assembly_point: 'Baza DVD Tivat',
    latitude: null,
    longitude: null,
    status: 'PUBLISHED',
    version: 2,
    published_at: '2026-09-13T08:00:00.000Z',
    closed_at: null,
    close_reason: null,
    created_at: '2026-09-13T07:55:00.000Z',
  };
  const draft = {
    ...published,
    id: DRAFT_ID,
    kind: 'POZAR',
    title: 'Nacrt: dimnjak (izmisljeno)',
    instructions: 'Jos nije objavljeno.',
    incident_location: 'Izmisljena adresa 1',
    assembly_point: null,
    status: 'DRAFT',
    version: 1,
    published_at: null,
    created_at: '2026-09-13T08:30:00.000Z',
  };

  switch (which) {
    case 'NONE':
      return [];
    case 'DRAFT':
      return [draft];
    case 'PUBLISHED_AND_DRAFT':
      // Newest first, the order `fetchInterventions` reads them in, so the
      // console's "focus the open one" rule is genuinely exercised: the draft
      // is newer and must NOT win.
      return [draft, published];
    case 'PUBLISHED':
    default:
      return [published];
  }
}

/**
 * Rows shaped exactly as the tables are, because the client reads named columns
 * and a fixture with the wrong column name would hide the very class of defect
 * `db-tests/client_schema_contract.test.ts` exists to catch.
 */
const TABLES: Record<string, unknown[]> = {
  interventions: [
    {
      id: INTERVENTION_ID,
      kind: 'VJEZBA',
      other_kind_note: null,
      title: 'Vjezba: provjera opreme',
      instructions: 'Okupljanje u bazi DVD Tivat. Ponijeti naprtnjace.',
      incident_location: 'Poligon iznad Donje Lastve (izmisljena lokacija)',
      assembly_point: 'Baza DVD Tivat',
      latitude: null,
      longitude: null,
      status: 'PUBLISHED',
      version: 2,
      published_at: '2026-09-13T08:00:00.000Z',
      closed_at: null,
      close_reason: null,
      created_at: '2026-09-13T07:55:00.000Z',
    },
  ],
  intervention_recipients: [
    { member_id: MEMBER_ID, member_name_at_publication: 'Ivo Vatrogasac' },
    { member_id: OTHER_ID, member_name_at_publication: 'Pero Vatrogasac' },
  ],
  intervention_acknowledgements: [{ member_id: MEMBER_ID, opened_at: '2026-09-13T08:01:00.000Z' }],
  intervention_responses: [
    {
      member_id: MEMBER_ID,
      answer: 'DOLAZIM',
      eta_minutes: null,
      updated_at: '2026-09-13T08:02:00.000Z',
      responded_at: '2026-09-13T08:02:00.000Z',
    },
    {
      member_id: OTHER_ID,
      answer: 'NE_MOGU',
      eta_minutes: null,
      updated_at: '2026-09-13T08:03:00.000Z',
      responded_at: '2026-09-13T08:03:00.000Z',
    },
  ],
  intervention_journey: [
    { member_id: MEMBER_ID, progress: 'NA_LICU_MJESTA', updated_at: '2026-09-13T08:10:00.000Z' },
  ],
  // Ninety minutes, closed, and NOT confirmed. The whole point of the product.
  attendance_intervals: [
    {
      id: INTERVAL_ID,
      member_id: MEMBER_ID,
      started_at: '2026-09-13T08:15:00.000Z',
      ended_at: '2026-09-13T09:45:00.000Z',
      source: 'SELF_DECLARED',
      verified: false,
      rejected_at: null,
      rejection_reason: null,
    },
  ],
  vehicle_movements: [],
  vehicles: [
    { id: '55555555-5555-4555-8555-555555555555', callsign: 'NV-1', name: 'Navalno vozilo', kind: 'Navalno', active: true },
    { id: '66666666-6666-4666-8666-666666666666', callsign: 'AC-2', name: 'Auto-cisterna', kind: 'Cisterna', active: true },
  ],
  member_availability: [
    { member_id: MEMBER_ID, available: true, note: 'U gradu sam.', changed_at: '2026-09-13T07:00:00.000Z' },
  ],
  members: [
    { id: MEMBER_ID, full_name: 'Ivo Vatrogasac', specialties: ['Nosilac IDA aparata'], active: true, user_id: USER_ID },
    { id: OTHER_ID, full_name: 'Pero Vatrogasac', specialties: ['Prva pomoc'], active: true, user_id: null },
  ],
  groups: [{ id: '77777777-7777-4777-8777-777777777777', name: 'Prva smjena', active: true }],
  group_members: [{ group_id: '77777777-7777-4777-8777-777777777777', member_id: MEMBER_ID }],
  // The signed-in account is linked to Ivo, so the identity pill must say
  // Ivo - not a second name that contradicts the roster on the same screen.
  profiles: [{ user_id: USER_ID, email: 'ivo@example.invalid', full_name: 'Ivo Vatrogasac', profile_complete: true }],
  access_grants: [
    { user_id: USER_ID, role: 'COMMANDER', active: true, granted_at: '2026-09-12T21:00:00.000Z' },
    { user_id: SECOND_USER_ID, role: 'FIREFIGHTER', active: true, granted_at: '2026-09-12T21:00:00.000Z' },
  ],
  organizations: [
    { id: DVD_ID, code: 'DVD' },
    { id: SZS_ID, code: 'SZS' },
  ],
  organization_memberships: [
    { organization_id: DVD_ID, user_id: USER_ID, role: 'COMMANDER', active: true },
    { organization_id: DVD_ID, user_id: SECOND_USER_ID, role: 'FIREFIGHTER', active: true },
  ],
};

/**
 * The same directory, with the longest name and address a person might have.
 *
 * A layout that only ever meets "Ivo Vatrogasac" has not been tested. Real
 * Montenegrin names run long, and an email can be longer still; a table that
 * fits one and clips the other is the defect this exists to catch.
 */
const LONG_TEXT_PROFILES = [
  {
    user_id: USER_ID,
    email: 'ivo.vatrogasac.komandir.smjene@vrlo-dugacak-naziv-domena.example.invalid',
    full_name: 'Ivo Aleksandar Vatrogasac Njegusevic',
    profile_complete: true,
  },
  {
    user_id: SECOND_USER_ID,
    email: 'pero@example.invalid',
    full_name: 'Pero Vatrogasac',
    profile_complete: true,
  },
];

const RPC: Record<string, unknown> = {
  current_dvd_role: 'COMMANDER',
  current_account_status: 'ACTIVE',
  current_member_id: MEMBER_ID,
  // Only reachable once the multi-service admin flag is on, which is why it
  // was missing: the fixture build had the flag off, so nothing ever called
  // this and the Accounts screen stopped at "server unavailable" the moment it
  // was switched on. The server scopes this to the caller, so one row is right.
  current_organization_memberships: [
    { organization_code: 'DVD', organization_name: 'DVD Tivat', membership_role: 'COMMANDER' },
  ],
  /*
   * Who may be called out. Answered by the server in the real thing, so it is
   * answered by the fixture here rather than derived from `members` - a fixture
   * that recomputed the rule would stop testing the screen and start testing a
   * copy of the rule.
   *
   * Pero is in `members` above and deliberately NOT here: he stands in for the
   * member whose roster row is active but whose account has been withdrawn,
   * which is the case the device test found in the real picker.
   */
  eligible_recipients: [
    { member_id: MEMBER_ID, full_name: 'Ivo Vatrogasac', role: 'FIREFIGHTER', specialties: [] },
  ],
  /*
   * The recorded chronology. Three separate movements for one member, which is
   * the point: the current-state row can only hold the last of them, so a
   * screen showing all three proves it is reading the audit and not the
   * snapshot.
   */
  intervention_audit: [
    {
      event_id: 'aa000001-0000-4000-8000-000000000001',
      occurred_at: '2026-09-13T08:00:00.000Z',
      event_type: 'INTERVENTION_PUBLISHED',
      detail: { recipient_count: 2 },
      actor_name: 'Komandir Smjene',
      actor_is_you: true,
    },
    {
      event_id: 'aa000001-0000-4000-8000-000000000002',
      occurred_at: '2026-09-13T08:04:00.000Z',
      event_type: 'JOURNEY_PROGRESS_SET',
      detail: { member_id: MEMBER_ID, from: null, to: 'KRECEM' },
      actor_name: 'Ivo Vatrogasac',
      actor_is_you: false,
    },
    {
      event_id: 'aa000001-0000-4000-8000-000000000003',
      occurred_at: '2026-09-13T08:07:00.000Z',
      event_type: 'JOURNEY_PROGRESS_SET',
      detail: { member_id: MEMBER_ID, from: 'KRECEM', to: 'U_PUTU' },
      actor_name: 'Ivo Vatrogasac',
      actor_is_you: false,
    },
    {
      event_id: 'aa000001-0000-4000-8000-000000000004',
      occurred_at: '2026-09-13T08:10:00.000Z',
      event_type: 'JOURNEY_PROGRESS_SET',
      detail: { member_id: MEMBER_ID, from: 'U_PUTU', to: 'NA_LICU_MJESTA' },
      actor_name: 'Ivo Vatrogasac',
      actor_is_you: false,
    },
    {
      event_id: 'aa000001-0000-4000-8000-000000000005',
      occurred_at: '2026-09-13T08:12:00.000Z',
      event_type: 'INTERVENTION_STATUS_CHANGED',
      detail: { from: 'PUBLISHED', to: 'DEPLOYED' },
      actor_name: 'Komandir Smjene',
      actor_is_you: true,
    },
  ],
  attendance_totals: [
    {
      member_id: MEMBER_ID,
      full_name: 'Ivo Vatrogasac',
      confirmed_intervals: 1,
      confirmed_seconds: 5400,
      unverified_intervals: 1,
      unverified_seconds: 1800,
      open_intervals: 0,
      rejected_intervals: 0,
    },
  ],
};

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });
}

/**
 * A two-service store for a multi-service account.
 *
 * Every operational read the client makes is scoped by `organization_id`
 * (`operations.ts`/`roster.ts` add `?organization_id=eq.<org>`), and the fixture
 * already honours equality filters, so labelling each row with its service is all
 * it takes for a switch to re-scope: the DVD read returns the DVD call-out and
 * roster, the SZS read the SZS ones, with nothing to compute here. The real
 * isolation is the database's RLS, proven in `db-tests/`; this proves the client
 * asks the right, service-scoped questions and shows only their answers.
 */
function multiServiceStore(memberships: readonly FixtureMembership[], isOwner: boolean): {
  interventions: Record<string, unknown>[];
  tables: Record<string, unknown[]>;
  eligibleByOrg: Record<string, unknown[]>;
} {
  const spec = {
    DVD: { org: DVD_ID, callout: DVD_ORG_CALLOUT, title: DVD_CALLOUT_TITLE, member: DUAL_DVD_MEMBER, memberName: DVD_ROSTER_NAME },
    SZS: { org: SZS_ID, callout: SZS_ORG_CALLOUT, title: SZS_CALLOUT_TITLE, member: DUAL_SZS_MEMBER, memberName: SZS_ROSTER_NAME },
  } as const;
  const interventions: Record<string, unknown>[] = [];
  const members: Record<string, unknown>[] = [];
  const recipients: Record<string, unknown>[] = [];
  const vehicles: Record<string, unknown>[] = [];
  const eligibleByOrg: Record<string, unknown[]> = {};
  for (const svc of ['DVD', 'SZS'] as const) {
    const s = spec[svc];
    const membership = memberships.find((m) => m.service === svc);
    interventions.push({
      id: s.callout, organization_id: s.org, kind: 'VJEZBA', other_kind_note: null,
      title: s.title, instructions: 'Okupljanje (izmišljeni podaci).',
      incident_location: `${svc} lokacija (izmišljeno)`, assembly_point: null,
      latitude: null, longitude: null, status: 'PUBLISHED', version: 2,
      published_at: '2026-09-13T08:00:00.000Z', closed_at: null, close_reason: null,
      created_at: '2026-09-13T07:55:00.000Z',
    });
    // The roster row exists per service; a service where the account has a member
    // record links to this user, otherwise it belongs to somebody else entirely.
    members.push({
      id: s.member, organization_id: s.org, full_name: s.memberName, specialties: [],
      active: true, user_id: membership?.memberId ? USER_ID : null,
    });
    recipients.push({
      intervention_id: s.callout, organization_id: s.org, member_id: s.member,
      member_name_at_publication: s.memberName,
    });
    vehicles.push({
      id: svc === 'DVD' ? 'aaaa0000-0000-4000-8000-0000000000a1' : 'bbbb0000-0000-4000-8000-0000000000b2',
      organization_id: s.org, callsign: svc === 'DVD' ? 'NV-1' : 'SC-1',
      name: `${svc} vozilo (izmišljeno)`, kind: svc === 'DVD' ? 'Navalno' : 'Cisterna', active: true,
    });
    eligibleByOrg[s.org] = [{ member_id: s.member, full_name: s.memberName, role: 'FIREFIGHTER', specialties: [] }];
  }
  // The account directory reads `access_grants` (the base role) and
  // `organization_memberships` (the per-service columns) for EVERY account, so
  // they must match the chosen identity, not the single-service defaults. The
  // owner has an OWNER base grant and ZERO memberships (their OWNER-in-each-
  // service comes from ownership, not a membership row); a member has a CITIZEN
  // base grant and one membership per service. This is the P5+ model proven in
  // `db-tests/retire_role_mirror.test.ts`.
  const accessGrants = [
    { user_id: USER_ID, role: isOwner ? 'OWNER' : 'CITIZEN', active: true, granted_at: '2026-09-12T21:00:00.000Z' },
  ];
  const organizationMemberships = memberships.map((m) => ({
    organization_id: m.service === 'SZS' ? SZS_ID : DVD_ID,
    user_id: USER_ID, role: m.role, active: true,
  }));
  return {
    interventions,
    eligibleByOrg,
    tables: {
      ...TABLES,
      interventions, members, vehicles,
      access_grants: accessGrants,
      organization_memberships: organizationMemberships,
      intervention_recipients: recipients,
      intervention_acknowledgements: [], intervention_responses: [],
      intervention_journey: [], attendance_intervals: [], vehicle_movements: [],
    },
  };
}

/**
 * Installs the fake project and a signed-in session.
 *
 * `role` changes only what `current_dvd_role()` answers, which is exactly how
 * the real thing decides: the client never picks its own role.
 */
export async function installFixtureProject(
  page: Page,
  roleOrOptions: FixtureRole | FixtureOptions = 'COMMANDER',
): Promise<void> {
  const options: FixtureOptions =
    typeof roleOrOptions === 'string' ? { role: roleOrOptions } : roleOrOptions;
  // `?? 'COMMANDER'` would turn an explicit `role: null` back into a commander,
  // so the default is applied only when the key is genuinely absent.
  const role = 'role' in options ? options.role : 'COMMANDER';
  const accountStatus = options.accountStatus ?? 'ACTIVE';
  const orgId = options.service === 'SZS' ? SZS_ID : DVD_ID;
  // A multi-service account (dual member or owner) overrides the single-service
  // seed with a per-service store the acting-service switch re-scopes across.
  const multi = options.memberships
    ? multiServiceStore(options.memberships, options.owner ?? false)
    : null;
  const interventions = multi
    ? multi.interventions
    : options.lifecycle
      ? [{ ...interventionRows('PUBLISHED')[0] as Record<string, unknown>,
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', organization_id: DVD_ID,
        title: 'DVD poziv koji SZS ne smije vidjeti' }]
      : interventionRows(options.interventions ?? 'PUBLISHED');
  const tables: Record<string, unknown[]> = multi
    ? multi.tables
    : options.lifecycle
      ? {
        ...TABLES,
        members: (TABLES.members ?? []).map((row) => ({ ...row as object, organization_id: orgId })),
        vehicles: [], vehicle_movements: [],
        intervention_recipients: [], intervention_acknowledgements: [],
        intervention_responses: [], intervention_journey: [], attendance_intervals: [],
      }
      : TABLES;
  const draftId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const intervalId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  if (options.language) {
    await page.addInitScript((language) => {
      window.localStorage.setItem('dvd-tivat.language', language);
    }, options.language);
  }

  await page.route(`**://${PROJECT_HOST}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*',
        },
      });
    }

    // Everything after the authentication handshake, so the session is real and
    // only the DATA is slow - which is the shape of an actual bad connection.
    if (options.slowMs && !path.startsWith('/auth/v1/')) {
      await new Promise((resolve) => setTimeout(resolve, options.slowMs));
    }

    if (path.startsWith('/auth/v1/user')) {
      return json(route, { id: USER_ID, email: 'ivo@example.invalid', aud: 'authenticated' });
    }
    if (path.startsWith('/auth/v1/')) {
      return json(route, {
        access_token: 'fixture',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'fixture',
        user: { id: USER_ID, email: 'ivo@example.invalid' },
      });
    }

    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.replace('/rest/v1/rpc/', '');

      // A 500 on the access check is what the gate cannot recover from: it
      // genuinely does not know who this is, so it must show nothing rather
      // than guess. Stale data on an intervention is worse than a blank screen.
      if (options.serverFails === 'ACCESS') {
        return json(route, { message: 'fixture: access check failed' }, 500);
      }

      if (options.refuseRpcs?.includes(name) ?? false) {
        return json(route, { code: '42501', message: 'permission denied for function ' + name }, 403);
      }

      // A multi-service account answers the identity RPCs for BOTH services from
      // its membership list, so switching the acting service resolves a real role
      // and member (or, for the owner, a role but no member) in the chosen one.
      if (multi) {
        const memberships = options.memberships!;
        const isOwner = options.owner ?? false;
        const orgService = (org: string | undefined): 'DVD' | 'SZS' | null =>
          org === DVD_ID ? 'DVD' : org === SZS_ID ? 'SZS' : null;
        const target = () =>
          (route.request().postDataJSON() as { target_organization?: string } | null)?.target_organization;
        // The owner holds OWNER in EVERY service through ownership, with no
        // membership row and no member id - the contract in
        // `db-tests/retire_role_mirror.test.ts`. A member's role and id come from
        // their membership; a service they are not a member of answers null.
        const roleIn = (svc: 'DVD' | 'SZS' | null): string | null =>
          memberships.find((m) => m.service === svc)?.role ?? (isOwner ? 'OWNER' : null);
        if (name === 'current_account_status') return json(route, accountStatus);
        if (name === 'is_installation_owner') return json(route, isOwner);
        if (name === 'current_organization_memberships') {
          // The caller's OWN membership rows: an owner with zero memberships
          // answers an empty list, exactly as the server does.
          return json(route, memberships.map((m) => ({
            organization_code: m.service,
            organization_name: m.service === 'SZS' ? 'SZS Tivat' : 'DVD Tivat',
            membership_role: m.role,
          })));
        }
        if (name === 'current_dvd_role') return json(route, roleIn('DVD'));
        if (name === 'current_role_in') return json(route, roleIn(orgService(target())));
        if (name === 'current_member_id_in') {
          const svc = orgService(target());
          return json(route, memberships.find((m) => m.service === svc)?.memberId ?? null);
        }
        if (name === 'current_member_id') {
          return json(route, memberships.find((m) => m.memberId)?.memberId ?? null);
        }
        if (name === 'eligible_recipients_in') {
          return json(route, multi.eligibleByOrg[target() ?? ''] ?? []);
        }
      }

      // P6: the client resolves the role and member for the ACTING service through
      // `current_role_in` / `current_member_id_in`; `is_installation_owner` and
      // `current_organization_memberships` decide which services are on offer.
      // These answer exactly as the DVD shims do, so a fixture written for the
      // DVD-only client keeps meaning the same thing for the service-aware one.
      if (name === 'current_dvd_role') return json(route, options.service === 'SZS' ? null : role ?? null);
      if (name === 'current_role_in') {
        const body = route.request().postDataJSON() as { target_organization?: string };
        return json(route, body.target_organization === orgId ? role ?? null : null);
      }
      if (name === 'is_installation_owner') return json(route, role === 'OWNER');
      if (name === 'current_account_status') return json(route, accountStatus);
      if (name === 'current_member_id' || name === 'current_member_id_in') {
        if (name === 'current_member_id_in' && options.service === 'SZS') {
          const body = route.request().postDataJSON() as { target_organization?: string };
          return json(route, body.target_organization === orgId ? MEMBER_ID : null);
        }
        if ('memberId' in options) return json(route, options.memberId ?? null);
        return json(route, RPC.current_member_id);
      }
      if (options.service === 'SZS' && name === 'current_organization_memberships') {
        return json(route, [{ organization_code: 'SZS', organization_name: 'SZS Tivat', membership_role: role }]);
      }
      if (name === 'eligible_recipients_in') return json(route, RPC.eligible_recipients);
      if (options.lifecycle) {
        const args = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        const current = interventions.find((row) => (row as Record<string, unknown>).id === draftId) as Record<string, unknown> | undefined;
        if (name === 'create_intervention_draft_in') {
          if (args.target_organization !== orgId) return json(route, { message: 'COMMAND_REQUIRED' }, 400);
          interventions.unshift({ id: draftId, organization_id: orgId,
            kind: args.requested_kind, other_kind_note: null, title: args.requested_title,
            instructions: args.requested_instructions, incident_location: args.requested_location,
            assembly_point: args.requested_assembly_point, latitude: null, longitude: null,
            status: 'DRAFT', version: 1, published_at: null, closed_at: null,
            close_reason: null, created_at: new Date().toISOString() });
          return json(route, draftId);
        }
        if (name === 'publish_intervention' && current) {
          current.status = 'PUBLISHED'; current.version = 2; current.published_at = new Date().toISOString();
          tables.intervention_recipients = (args.recipient_member_ids as string[]).map((member_id) => ({
            intervention_id: draftId, member_id, member_name_at_publication: 'Ivo Vatrogasac',
          }));
          return json(route, draftId);
        }
        if (name === 'acknowledge_intervention') {
          tables.intervention_acknowledgements!.push({ intervention_id: draftId, member_id: MEMBER_ID, opened_at: new Date().toISOString() });
        }
        if (name === 'submit_response') {
          tables.intervention_responses!.push({ intervention_id: draftId, member_id: MEMBER_ID,
            answer: args.requested_answer, eta_minutes: args.requested_eta,
            updated_at: new Date().toISOString(), responded_at: new Date().toISOString() });
        }
        if (name === 'set_journey_progress') {
          tables.intervention_journey = [{ intervention_id: draftId, member_id: MEMBER_ID,
            progress: args.requested_progress, updated_at: new Date().toISOString() }];
        }
        if (name === 'attendance_check_in') {
          tables.attendance_intervals!.push({ id: intervalId, intervention_id: draftId,
            member_id: MEMBER_ID, started_at: new Date().toISOString(), ended_at: null,
            source: 'SELF_DECLARED', verified: false, rejected_at: null, rejection_reason: null });
          return json(route, intervalId);
        }
        if (name === 'attendance_check_out') {
          (tables.attendance_intervals![0] as Record<string, unknown>).ended_at = new Date().toISOString();
        }
        if (name === 'attendance_confirm' || name === 'attendance_confirm_many') {
          (tables.attendance_intervals![0] as Record<string, unknown>).verified = true;
          if (name === 'attendance_confirm_many') return json(route, [{ interval_id: intervalId, outcome: 'CONFIRMED' }]);
        }
        if (name === 'close_intervention' && current) {
          current.status = args.requested_status; current.closed_at = new Date().toISOString();
          current.close_reason = args.requested_reason;
        }
        if (name === 'intervention_audit') return json(route, []);
        if (name === 'attendance_totals') return json(route, []);
      }
      // Any command not named here answers "fine" - these tests are about what
      // the screens SHOW, and the commands themselves are proven against a real
      // PostgreSQL in db-tests/ and against the hosted project separately.
      return json(route, name in RPC ? RPC[name] : null);
    }

    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '').split('?')[0] ?? '';

      /*
       * A policy refusal, not an outage.
       *
       * PostgREST answers 403 with `42501` when a row-level policy says no, and
       * the console tells the two apart on the word "permission" - see the
       * `REFUSED_READ` branch in `CommandView`. They call for different things
       * from the person reading them: an outage is waited out, a refusal means
       * somebody changed what this account may see.
       *
       * `profiles` is deliberately still readable, because that is the real
       * shape of this failure: a member whose ROLE is taken away keeps the
       * own-row policy on their own profile and loses the operational tables.
       * Refusing everything instead broke the access check itself, and the gate
       * then - correctly - reported an unreachable server, so the console was
       * never reached and the branch under test never ran.
       */
      if (
        (options.serverFails === 'READS' && table !== 'profiles') ||
        (options.refuseTables?.includes(table) ?? false)
      ) {
        return json(
          route,
          { code: '42501', message: 'permission denied for table ' + table },
          403,
        );
      }

      if (route.request().method() !== 'GET') return json(route, []);

      const all =
        table === 'interventions'
          ? interventions
          : table === 'profiles' && options.longText
            ? LONG_TEXT_PROFILES
            : (tables[table] ?? []);

      /*
       * Apply `?column=eq.value`, because the real server does.
       *
       * This fixture used to hand back every row and ignore the filter, which
       * looked harmless only because most tables held a single row. The moment
       * `profiles` held two, `fetchProfile`'s `.maybeSingle()` received both,
       * refused to pick one, and the gate reported an unreachable server - a
       * failure invented entirely by the fixture. Honouring equality filters
       * is the smallest thing that makes a multi-row table behave like the
       * server it stands in for.
       */
      const rows = all.filter((row) => {
        for (const [column, value] of url.searchParams) {
          if (!value.startsWith('eq.')) continue;
          const record = row as Record<string, unknown>;
          if (!(column in record)) continue;
          if (String(record[column]) !== value.slice(3)) return false;
        }
        return true;
      });
      // `.single()` and `.maybeSingle()` ask PostgREST for ONE OBJECT, not an
      // array, through this header. A fixture that always answers with an array
      // makes every such read look like a missing row - which is how this first
      // reported "Nalog nije potpun" on a perfectly good profile.
      const wantsObject = (route.request().headers()['accept'] ?? '').includes(
        'application/vnd.pgrst.object+json',
      );
      if (wantsObject) {
        return rows.length > 0
          ? json(route, rows[0])
          : json(route, { code: 'PGRST116', message: 'no rows' }, 406);
      }
      return json(route, rows);
    }

    return json(route, {}, 404);
  });

  // A session in storage, so the client starts signed in rather than needing a
  // sign-in form driven on every test. Skipped deliberately when the point of
  // the test is what a signed-OUT person sees.
  if (options.signedIn === false) return;
  await page.addInitScript(
    ([ref, userId]) => {
      const session = {
        access_token: 'fixture',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        refresh_token: 'fixture',
        user: { id: userId, email: 'ivo@example.invalid', aud: 'authenticated', app_metadata: {}, user_metadata: {} },
      };
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
    },
    [PROJECT_REF, USER_ID] as const,
  );
}

export async function openOperational(
  page: Page,
  route: string,
  roleOrOptions: FixtureRole | FixtureOptions = 'COMMANDER',
) {
  await installFixtureProject(page, roleOrOptions);
  await page.goto(`http://127.0.0.1:4174/#/${route}`);
  await page.waitForSelector('main');
}
