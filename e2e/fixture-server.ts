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

export type FixtureRole = 'OWNER' | 'ADMIN' | 'COMMANDER' | 'FIREFIGHTER';

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
};

const RPC: Record<string, unknown> = {
  current_dvd_role: 'COMMANDER',
  current_account_status: 'ACTIVE',
  current_member_id: MEMBER_ID,
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
 * Installs the fake project and a signed-in session.
 *
 * `role` changes only what `current_dvd_role()` answers, which is exactly how
 * the real thing decides: the client never picks its own role.
 */
export async function installFixtureProject(page: Page, role: FixtureRole = 'COMMANDER'): Promise<void> {
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
      if (name === 'current_dvd_role') return json(route, role);
      // Any command not named here answers "fine" - these tests are about what
      // the screens SHOW, and the commands themselves are proven against a real
      // PostgreSQL in db-tests/ and against the hosted project separately.
      return json(route, name in RPC ? RPC[name] : null);
    }

    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '').split('?')[0] ?? '';
      if (route.request().method() !== 'GET') return json(route, []);

      const rows = TABLES[table] ?? [];
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
  // sign-in form driven on every test.
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

export async function openOperational(page: Page, route: string, role: FixtureRole = 'COMMANDER') {
  await installFixtureProject(page, role);
  await page.goto(`http://127.0.0.1:4174/#/${route}`);
  await page.waitForSelector('main');
}
