/**
 * The owner's account directory, actually rendered, for two effects P5
 * (202609250038) changed and one review of #66 caught before merge.
 *
 * P5 made a service membership the only statement of operational authority and
 * moved DVD assignment onto `owner_set_organization_membership`. Two client
 * consequences follow, and both are asserted here against the REAL data layer
 * (a faked `accountBackend`, so `directory.ts` runs for real):
 *
 *  1. Audit visibility. A DVD assignment now writes `organization_membership_audit`,
 *     not `role_audit`. `loadOrganizationMembershipAudit()` used to return `[]`
 *     whenever the multi-service flag was off, so with the flag off the owner
 *     could no longer see a DVD role change they had just made on this screen.
 *     The server always let the owner read that table (`membership_audit_owner_read`),
 *     so the flag gate was a client-only blind spot. Covered flag-off AND flag-on.
 *
 *  2. Role search. `access_grants.role` is now an inert legacy value for the
 *     operational roles: a stood-down firefighter can still carry FIREFIGHTER in
 *     the grant with no active DVD membership. Searching "vatrogasac" must find
 *     the firefighter who actually has the active membership and NOT the one who
 *     stood down. OWNER, which the grant still carries authoritatively, stays
 *     searchable.
 *
 * No testing library, following `AccessProvider.test.tsx`: `createRoot` and `act`.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessGateway } from '@/auth/access';
import { AccessProvider } from '@/auth/AccessProvider';
import { AccountsView } from './AccountsView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OWNER_ID = '00000000-0000-4000-8000-0000000000aa';
const TARGET_ID = '00000000-0000-4000-8000-0000000000bb';
const ACTIVE_FF_ID = '00000000-0000-4000-8000-0000000000cc';
const STOOD_DOWN_FF_ID = '00000000-0000-4000-8000-0000000000dd';
const DVD_ORG = '00000000-0000-4000-8000-000000000001';
const SZS_ORG = '00000000-0000-4000-8000-000000000002';

// Mutable across tests: the flag the mock reads through a getter (ESM live
// binding), the per-table rows the faked backend returns, and the RPC handler.
const env = vi.hoisted(() => ({
  flag: false as boolean,
  data: {} as Record<string, Record<string, unknown>[]>,
  rpc: null as
    | null
    | ((name: string, args: Record<string, unknown>) => { data?: unknown; error: unknown }),
}));

vi.mock('@/auth/supabaseClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/supabaseClient')>();
  function table(name: string) {
    const result = () => ({ data: env.data[name] ?? [], error: null });
    const chain = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (onF: (value: unknown) => unknown, onR?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(onF, onR),
    };
    return chain;
  }
  return {
    ...real,
    get MULTI_SERVICE_ADMIN_AVAILABLE() {
      return env.flag;
    },
    PASSWORD_RESET_AVAILABLE: false,
    accountBackend: () =>
      ({
        from: (name: string) => table(name),
        rpc: async (name: string, args: Record<string, unknown>) =>
          env.rpc ? env.rpc(name, args) : { data: [], error: null },
      }) as unknown as ReturnType<typeof real.accountBackend>,
  } satisfies Partial<typeof import('@/auth/supabaseClient')>;
});

// AccountsView reaches useApp() only for `announce`; a provider would drag in
// storage side-effects this test does not exercise.
vi.mock('@/state/AppStateContext', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/state/AppStateContext')>();
  return {
    ...real,
    useApp: () => ({ announce: () => {} }) as unknown as ReturnType<typeof real.useApp>,
  };
});

const OWNER: AccessGateway = {
  currentUser: async () => ({ id: OWNER_ID, email: 'owner@example.invalid' }),
  fetchProfile: async () => ({ fullName: 'Nadzornik Naloga', profileComplete: true }),
  fetchRole: async () => 'OWNER',
  fetchAccountStatus: async () => 'ACTIVE',
};

function profile(userId: string, fullName: string, email: string) {
  return {
    user_id: userId,
    email,
    full_name: fullName,
    phone_e164: null,
    date_of_birth: null,
    profile_complete: true,
  };
}

function grant(userId: string, role: string) {
  return { user_id: userId, role, active: true, granted_at: '2026-09-20T10:00:00.000Z' };
}

const ORGANIZATIONS = [
  { id: DVD_ORG, code: 'DVD' },
  { id: SZS_ORG, code: 'SZS' },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  env.flag = false;
  env.data = {};
  env.rpc = (name, args) => {
    if (name === 'owner_set_organization_membership') {
      const organization = ORGANIZATIONS.find((o) => o.code === args.organization_code);
      const role = args.requested_role === 'NONE' ? null : (args.requested_role as string);
      (env.data.organization_membership_audit ??= []).push({
        id: `audit-${(env.data.organization_membership_audit?.length ?? 0) + 1}`,
        organization_id: organization?.id ?? DVD_ORG,
        target_user_id: args.target_user,
        previous_role: null,
        next_role: role,
        next_active: role !== null,
        changed_at: '2026-09-26T09:30:00.000Z',
      });
    }
    return { data: [], error: null };
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderAccounts() {
  await act(async () => {
    root.render(
      <AccessProvider gateway={OWNER} configured>
        <AccountsView />
      </AccessProvider>,
    );
  });
  await flush();
}

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => Promise.resolve());
  }
}

function setDvdMembership(targetName: string, value: string) {
  const select = [...container.querySelectorAll('select')].find((candidate) =>
    candidate.getAttribute('aria-label')?.startsWith(`DVD Tivat - ${targetName}`),
  );
  if (!select) throw new Error(`No DVD select for ${targetName}`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value',
  )!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function typeSearch(needle: string) {
  const input = container.querySelector('input[type="search"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  setter.call(input, needle);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AccountsView: a DVD membership change is visible in the audit list', () => {
  for (const flag of [false, true]) {
    it(`shows a DVD assignment in the audit list with the multi-service flag ${flag ? 'on' : 'off'}`, async () => {
      env.flag = flag;
      env.data = {
        profiles: [
          profile(OWNER_ID, 'Nadzornik Naloga', 'owner@example.invalid'),
          profile(TARGET_ID, 'Ciljni Nalog', 'clan@example.invalid'),
        ],
        access_grants: [grant(OWNER_ID, 'OWNER'), grant(TARGET_ID, 'CITIZEN')],
        members: [],
        organizations: ORGANIZATIONS,
        organization_memberships: [],
        role_audit: [],
        account_status_audit: [],
        organization_membership_audit: [],
      };

      await renderAccounts();
      // The owner assigns the target a DVD firefighter role on this screen.
      await act(async () => setDvdMembership('Ciljni Nalog', 'FIREFIGHTER'));
      await flush();

      // "{organization} - uloga: {role}" is the membership-audit line and appears
      // nowhere else on the screen; a firefighter option label alone would not
      // carry the "- uloga:" text.
      expect(container.textContent ?? '').toMatch(/DVD Tivat - uloga: Vatrogasac/);
    });
  }
});

describe('AccountsView: role search follows active memberships, not the inert grant', () => {
  beforeEach(() => {
    env.data = {
      profiles: [
        profile(OWNER_ID, 'Nadzornik Naloga', 'owner@example.invalid'),
        profile(ACTIVE_FF_ID, 'Ana Prva', 'ana@example.invalid'),
        profile(STOOD_DOWN_FF_ID, 'Boris Drugi', 'boris@example.invalid'),
      ],
      access_grants: [
        grant(OWNER_ID, 'OWNER'),
        grant(ACTIVE_FF_ID, 'CITIZEN'),
        // Inert legacy operational value: the grant still says FIREFIGHTER after
        // the stand-down, but there is no active DVD membership any more.
        grant(STOOD_DOWN_FF_ID, 'FIREFIGHTER'),
      ],
      members: [],
      organizations: ORGANIZATIONS,
      organization_memberships: [
        { organization_id: DVD_ORG, user_id: ACTIVE_FF_ID, role: 'FIREFIGHTER', active: true },
        { organization_id: DVD_ORG, user_id: STOOD_DOWN_FF_ID, role: 'FIREFIGHTER', active: false },
      ],
      role_audit: [],
      account_status_audit: [],
      organization_membership_audit: [],
    };
  });

  it('finds the active firefighter and not the stood-down one', async () => {
    await renderAccounts();
    await act(async () => typeSearch('vatrogasac'));
    await flush();

    const text = container.textContent ?? '';
    expect(text).toMatch(/Ana Prva/);
    expect(text).not.toMatch(/Boris Drugi/);
  });

  it('still finds the owner by the OWNER label', async () => {
    await renderAccounts();
    await act(async () => typeSearch('vlasnik'));
    await flush();

    const text = container.textContent ?? '';
    expect(text).toMatch(/Nadzornik Naloga/);
    expect(text).not.toMatch(/Ana Prva/);
    expect(text).not.toMatch(/Boris Drugi/);
  });
});
