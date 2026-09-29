/**
 * P6: the registry screen reads the service being acted as, and re-reads on a
 * switch.
 *
 * This is the integration point of the no-leak property: the row-level-security
 * policies return BOTH services' rows to a dual-service admin or the owner, so it
 * is this screen passing the acting service's id to the reads that keeps the DVD
 * view free of SZS members. If it ever regressed to an unscoped read, a dual admin
 * acting as DVD would see SZS's roster - so the read's argument is pinned here, and
 * the switch is shown to re-scope it. The exact filter each adapter then sends is
 * pinned in auth/roster.service.test.ts, and the real RLS in
 * db-tests/service_registry_scope.test.ts.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessProvider, useAccess, type AccessContextValue } from '@/auth/AccessProvider';
import type { AccessGateway } from '@/auth/access';
import { organizationIdOf } from '@/auth/serviceContext';
import { AppStateProvider } from '@/state/AppStateContext';
import { resetLanguageForTests } from '@/i18n/language';

const calls = vi.hoisted(() => ({ roster: [] as (string | undefined)[] }));

vi.mock('@/auth/roster', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/roster')>();
  return {
    ...real,
    loadRoster: vi.fn(async (organizationId?: string) => {
      calls.roster.push(organizationId);
      return [];
    }),
    loadGroups: vi.fn(async () => []),
    loadVehicles: vi.fn(async () => []),
  };
});

vi.mock('@/auth/directory', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/directory')>();
  return { ...real, loadDirectory: vi.fn(async () => []) };
});

// Imported after the mocks are registered.
import { RegistryView } from './RegistryView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DVD = organizationIdOf('DVD');
const SZS = organizationIdOf('SZS');

/** The installation owner: OWNER in both services, no membership - so both show. */
function ownerGateway(): AccessGateway {
  return {
    currentUser: async () => ({ id: 'user-1', email: 'vlasnik@example.invalid' }),
    fetchProfile: async () => ({ fullName: 'Vlasnik Sistema', profileComplete: true }),
    fetchRole: async () => {
      throw new Error('legacy path must not run');
    },
    fetchAccountStatus: async () => 'ACTIVE',
    fetchServiceContext: async () => ({ memberships: [], isOwner: true }),
    fetchRoleIn: async () => 'OWNER',
  };
}

let container: HTMLDivElement;
let root: Root;
let captured: AccessContextValue | null = null;

function Capture() {
  captured = useAccess();
  return null;
}

beforeEach(() => {
  calls.roster = [];
  captured = null;
  window.localStorage.clear();
  resetLanguageForTests();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render() {
  await act(async () => {
    root.render(
      <AppStateProvider>
        <AccessProvider gateway={ownerGateway()} configured storage={window.localStorage}>
          <Capture />
          <RegistryView />
        </AccessProvider>
      </AppStateProvider>,
    );
  });
  await settle();
}

const text = () => container.textContent ?? '';

describe('the registry reads the acting service', () => {
  it('reads the acting service (DVD by default) and names it, never the other', async () => {
    await render();
    // Every roster read that happened asked for DVD - none for SZS.
    expect(calls.roster.length).toBeGreaterThan(0);
    expect(calls.roster.every((id) => id === DVD)).toBe(true);
    expect(calls.roster).not.toContain(SZS);
    expect(text()).toContain('DVD Tivat');
  });

  it('re-reads the OTHER service after an explicit switch', async () => {
    await render();
    calls.roster = [];
    await act(async () => {
      await captured?.setActingService('SZS');
    });
    await settle();
    // The re-read is for SZS now, and DVD is no longer being asked for.
    expect(calls.roster.length).toBeGreaterThan(0);
    expect(calls.roster.every((id) => id === SZS)).toBe(true);
    expect(calls.roster).not.toContain(DVD);
  });
});
