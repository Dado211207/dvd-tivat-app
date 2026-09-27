/**
 * P6 review: the registry is an IDENTITY BOUNDARY across a service switch.
 *
 * The panel keeps its rows in state while it re-reads. Across a service switch
 * that is a leak: until the new service's read finishes, the previous service's
 * roster must not be shown under the new service's label, a read that fails must
 * not leave the previous rows on screen, and a previous-service response that
 * arrives last must not overwrite the new service's rows. Create/edit controls
 * must never act on the previous service's rows while switching.
 *
 * These tests drive the switch with deferred reads so the in-flight window is
 * observable. They failed before the fix.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessProvider, useAccess, type AccessContextValue } from '@/auth/AccessProvider';
import type { AccessGateway } from '@/auth/access';
import { organizationIdOf } from '@/auth/serviceContext';
import type { RosterMember } from '@/auth/roster';
import { AppStateProvider } from '@/state/AppStateContext';
import { resetLanguageForTests } from '@/i18n/language';
import { me } from '@/i18n/strings.me';

const DVD = organizationIdOf('DVD');
const SZS = organizationIdOf('SZS');

interface Deferred {
  readonly promise: Promise<RosterMember[]>;
  resolve(rows: RosterMember[]): void;
  reject(error: unknown): void;
}

// A controllable roster read per service, plus a record of every create so a
// create during/after a switch can be shown to target the right service.
const roster = vi.hoisted(() => {
  const latest = new Map<string, Deferred>();
  const creates: { org: string; name: string }[] = [];
  return {
    latest,
    creates,
    makeRoster(org: string): Promise<RosterMember[]> {
      let resolve!: (rows: RosterMember[]) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<RosterMember[]>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      latest.set(org, { promise, resolve, reject });
      return promise;
    },
  };
});

vi.mock('@/auth/roster', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/roster')>();
  return {
    ...real,
    loadRoster: (organizationId?: string) => roster.makeRoster(organizationId ?? DVD),
    loadGroups: async () => [],
    loadVehicles: async () => [],
    createMember: async (organizationId: string, fullName: string) => {
      roster.creates.push({ org: organizationId, name: fullName });
      return { ok: true } as const;
    },
  };
});

vi.mock('@/auth/directory', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/directory')>();
  return { ...real, loadDirectory: async () => [] };
});

// Imported after the mocks are registered.
import { RegistryView } from './RegistryView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const member = (fullName: string): RosterMember => ({
  id: `m-${fullName}`,
  fullName,
  specialties: [],
  active: true,
  userId: null,
});

/** The installation owner: both services on offer, so the switch is available. */
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

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function resolveRoster(org: string, rows: RosterMember[]) {
  const deferred = roster.latest.get(org);
  if (!deferred) throw new Error(`no pending roster read for ${org}`);
  await act(async () => {
    deferred.resolve(rows);
    await deferred.promise.catch(() => {});
  });
  await flush();
}

async function rejectRoster(org: string) {
  const deferred = roster.latest.get(org);
  if (!deferred) throw new Error(`no pending roster read for ${org}`);
  await act(async () => {
    deferred.reject(new Error('refused'));
    await deferred.promise.catch(() => {});
  });
  await flush();
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
  await flush();
}

const text = () => container.textContent ?? '';

beforeEach(() => {
  roster.latest.clear();
  roster.creates.length = 0;
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

describe('the registry never shows one service under another across a switch', () => {
  const addMemberButton = () =>
    Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === me.registry.addMember,
    );

  it('hides the previous service roster while the new service read is pending', async () => {
    await render();
    await resolveRoster(DVD, [member('DVD Clan')]);
    expect(text()).toContain('DVD Clan');
    expect(addMemberButton(), 'the add control is present once loaded').not.toBeUndefined();

    await act(async () => {
      await captured?.setActingService('SZS');
    });
    await flush();

    // Acting as SZS now, with SZS still loading: no DVD row may be on screen, and
    // no create/edit control is available to act on the previous service's rows.
    expect(text()).not.toContain('DVD Clan');
    expect(addMemberButton(), 'no add control while the new service is loading').toBeUndefined();

    await resolveRoster(SZS, [member('SZS Clan')]);
    expect(text()).toContain('SZS Clan');
    expect(text()).not.toContain('DVD Clan');
  });

  it('ignores a previous-service roster response that arrives after the switch', async () => {
    await render();
    // Leave DVD pending, switch, then resolve SZS, then resolve the stale DVD last.
    await act(async () => {
      await captured?.setActingService('SZS');
    });
    await flush();
    await resolveRoster(SZS, [member('SZS Clan')]);
    expect(text()).toContain('SZS Clan');

    await resolveRoster(DVD, [member('DVD Clan')]);
    expect(text()).toContain('SZS Clan');
    expect(text()).not.toContain('DVD Clan');
  });

  it('does not leave the previous service roster on screen when the new read fails', async () => {
    await render();
    await resolveRoster(DVD, [member('DVD Clan')]);
    expect(text()).toContain('DVD Clan');

    await act(async () => {
      await captured?.setActingService('SZS');
    });
    await flush();
    await rejectRoster(SZS);

    expect(text()).not.toContain('DVD Clan');
    expect(text()).toContain(me.registry.loadFailed);
  });

  it('creates into the service now on screen, never the previous one', async () => {
    await render();
    await resolveRoster(DVD, [member('DVD Clan')]);
    await act(async () => {
      await captured?.setActingService('SZS');
    });
    await flush();
    await resolveRoster(SZS, [member('SZS Clan')]);

    // Add a member on the SZS screen. Set the controlled input through the native
    // value setter so React's onChange sees the change and enables the button.
    const input = container.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('no member name input on the SZS registry');
    const nativeValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      nativeValue.call(input, 'Novi Clan');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === me.registry.addMember,
    );
    if (!addButton) throw new Error('no add-member button');
    await act(async () => {
      addButton.click();
    });
    await flush();

    expect(roster.creates).toHaveLength(1);
    expect(roster.creates[0]!.org).toBe(SZS);
  });
});
