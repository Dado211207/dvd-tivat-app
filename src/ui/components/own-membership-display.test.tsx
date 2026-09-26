/**
 * The signed-in person's own service memberships, shown on the account card.
 *
 * P5 (202609250038) made a DVD role a service membership. The own-membership
 * read (`loadOwnOrganizationMemberships` + this component's effect) was gated by
 * `VITE_MULTI_SERVICE_ADMIN_ENABLED`, so with the flag off it returned `[]`
 * without asking the server, and a DVD firefighter with an active membership was
 * shown "Nema dodijeljenu sluzbu" (no service) even though the server gives them
 * the FIREFIGHTER role. The flag is meant to gate SZS *assignment controls*, not
 * the truthful read of a person's own memberships, which `current_organization_memberships()`
 * already scopes to `auth.uid()`.
 *
 * These render the real component against a faked `accountBackend` (so the real
 * `directory.ts` read runs) with the flag OFF, and assert the card tells the
 * truth: a DVD firefighter sees their DVD role, a dual-service person sees both,
 * an owner with no membership is not given an invented one, and a FAILED read is
 * shown as unavailable rather than as "no service". Flag-on parity is covered too.
 *
 * No testing library, following `service-account-access.test.tsx`.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessGateway } from '@/auth/access';
import { AccessProvider } from '@/auth/AccessProvider';
import { AccountAccessSetup } from './AccountAccessSetup';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mutable flag (read through a getter, ESM live binding) and RPC handler.
const env = vi.hoisted(() => ({
  flag: false as boolean,
  rpc: null as null | ((name: string) => { data?: unknown; error?: unknown }),
}));

vi.mock('@/auth/supabaseClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/supabaseClient')>();
  return {
    ...real,
    get MULTI_SERVICE_ADMIN_AVAILABLE() {
      return env.flag;
    },
    PASSWORD_RESET_AVAILABLE: false,
    accountBackend: () =>
      ({
        rpc: async (name: string) => (env.rpc ? env.rpc(name) : { data: [], error: null }),
      }) as unknown as ReturnType<typeof real.accountBackend>,
  } satisfies Partial<typeof import('@/auth/supabaseClient')>;
});

const DVD_ROW = {
  organization_code: 'DVD',
  organization_name: 'DVD Tivat',
  membership_role: 'FIREFIGHTER',
};
const SZS_ROW = {
  organization_code: 'SZS',
  organization_name: 'Sluzba zastite i spasavanja Tivat',
  membership_role: 'COMMANDER',
};

function gateway(id: string, role: string): AccessGateway {
  return {
    currentUser: async () => ({ id, email: `${id}@example.invalid` }),
    fetchProfile: async () => ({ fullName: 'Marko Petrovic', profileComplete: true }),
    fetchRole: async () => role,
    fetchAccountStatus: async () => 'ACTIVE',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  env.flag = false;
  env.rpc = () => ({ data: [], error: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(g: AccessGateway) {
  await act(async () => {
    root.render(
      <AccessProvider gateway={g} configured>
        <AccountAccessSetup />
      </AccessProvider>,
    );
  });
  for (let index = 0; index < 12; index += 1) {
    await act(async () => Promise.resolve());
  }
}

describe('own-membership display: the flag does not hide a real membership', () => {
  it('shows a DVD firefighter their DVD role with the multi-service flag OFF', async () => {
    env.flag = false;
    env.rpc = () => ({ data: [DVD_ROW], error: null });
    await render(gateway('dvd-ff', 'FIREFIGHTER'));

    const text = container.textContent ?? '';
    expect(text).toMatch(/DVD Tivat/);
    expect(text).toMatch(/Vatrogasac/);
    expect(text).not.toMatch(/Nema dodijeljenu sluzbu/);
    // Display only: the personal card grants no assignment control.
    expect(container.querySelector('select')).toBeNull();
  });

  it('shows a dual-service person both memberships with the flag OFF', async () => {
    env.flag = false;
    env.rpc = () => ({ data: [DVD_ROW, SZS_ROW], error: null });
    await render(gateway('dual', 'FIREFIGHTER'));

    const text = container.textContent ?? '';
    expect(text).toMatch(/DVD Tivat/);
    expect(text).toMatch(/Sluzba zastite i spasavanja Tivat/);
    expect(text).not.toMatch(/Nema dodijeljenu sluzbu/);
  });

  it('does not invent a membership for the owner with none (flag OFF)', async () => {
    env.flag = false;
    env.rpc = () => ({ data: [], error: null });
    await render(gateway('owner', 'OWNER'));

    const text = container.textContent ?? '';
    expect(text).toMatch(/Nema dodijeljenu sluzbu/);
    expect(text).not.toMatch(/DVD Tivat/);
  });

  it('shows a FAILED own-membership read as unavailable, not as "no service" (flag OFF)', async () => {
    env.flag = false;
    env.rpc = () => ({ data: null, error: new Error('read refused') });
    await render(gateway('dvd-ff', 'FIREFIGHTER'));

    const text = container.textContent ?? '';
    expect(text).toMatch(/nijesu mogle biti provjerene/); // servicesUnavailable
    expect(text).not.toMatch(/Nema dodijeljenu sluzbu/);
  });

  it('still shows the DVD role with the flag ON (parity)', async () => {
    env.flag = true;
    env.rpc = () => ({ data: [DVD_ROW], error: null });
    await render(gateway('dvd-ff', 'FIREFIGHTER'));

    const text = container.textContent ?? '';
    expect(text).toMatch(/DVD Tivat/);
    expect(text).toMatch(/Vatrogasac/);
    expect(text).not.toMatch(/Nema dodijeljenu sluzbu/);
  });
});
