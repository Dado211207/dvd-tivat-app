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

const loadMemberships = vi.fn();

vi.mock('@/auth/directory', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/directory')>();
  return {
    ...real,
    loadOwnOrganizationMemberships: () => loadMemberships(),
  };
});

vi.mock('@/auth/supabaseClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/supabaseClient')>();
  return {
    ...real,
    MULTI_SERVICE_ADMIN_AVAILABLE: true,
  };
});

const CITIZEN: AccessGateway = {
  currentUser: async () => ({ id: 'citizen-1', email: 'gradjanin@example.invalid' }),
  fetchProfile: async () => ({ fullName: 'Probni Gradjanin', profileComplete: true }),
  fetchRole: async () => null,
  fetchAccountStatus: async () => 'ACTIVE',
};

const OWNER: AccessGateway = {
  currentUser: async () => ({ id: 'owner-1', email: 'owner@example.invalid' }),
  fetchProfile: async () => ({ fullName: 'Owner Example', profileComplete: true }),
  fetchRole: async () => 'OWNER',
  fetchAccountStatus: async () => 'ACTIVE',
  fetchServiceContext: async () => ({ memberships: [], isOwner: true }),
  fetchRoleIn: async () => 'OWNER',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  loadMemberships.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderAccount(gateway: AccessGateway = CITIZEN) {
  await act(async () => {
    root.render(
      <AccessProvider gateway={gateway} configured>
        <AccountAccessSetup />
      </AccessProvider>,
    );
  });
  for (let index = 0; index < 8; index += 1) {
    await act(async () => Promise.resolve());
  }
}

describe('citizen-first service access', () => {
  it('shows a new account as a limited citizen rather than a failed approval', async () => {
    loadMemberships.mockResolvedValue([]);
    await renderAccount();

    const text = container.textContent ?? '';
    expect(text).toMatch(/aktivan kao gradjanski nalog/i);
    expect(text).toMatch(/DVD, SZS ili obje sluzbe/i);
    expect(text).not.toMatch(/ceka odobrenje/i);
  });

  it('shows an independent SZS role without implying DVD access', async () => {
    loadMemberships.mockResolvedValue([
      {
        organization: 'SZS',
        displayName: 'Sluzba zastite i spasavanja Tivat',
        role: 'COMMANDER',
      },
    ]);
    await renderAccount();

    const text = container.textContent ?? '';
    expect(text).toMatch(/Sluzba zastite i spasavanja Tivat clanstvo je aktivno/i);
    expect(text).toMatch(/Komandir/i);
    expect(text).toMatch(/DVD podaci ostaju nedostupni/i);
  });
});

describe('installation owner service access', () => {
  it('explains owner access without inventing a membership row', async () => {
    loadMemberships.mockResolvedValue([]);
    await renderAccount(OWNER);

    const text = container.textContent ?? '';
    expect(text).toMatch(/Nema dodijeljenu sluzbu/);
    expect(text).toMatch(/Vlasnicka uloga omogucava operativni pristup/);
    expect(text).not.toMatch(/DVD Tivat — Vlasnik sistema/);
  });
});
