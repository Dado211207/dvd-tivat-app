/**
 * The rule this file exists to hold: **nothing protected renders until the
 * server has answered.**
 *
 * Rendered with the real React DOM in jsdom and a fake gateway, so the ordering
 * is observed rather than reasoned about. No testing library is used - the
 * project keeps its dependencies small, and `createRoot` plus `act` is all this
 * needs.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccessProvider, useAccess, type AccessContextValue } from './AccessProvider';
import type { AccessGateway } from './access';
import { organizationIdOf, rememberedServiceKey } from './serviceContext';
import { RequireRole } from '@/ui/components/RequireRole';

// React 18 wants this flag set before `act` is used.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** A gateway whose answer is released only when the test says so. */
function deferredGateway(role: string | null) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gateway: AccessGateway = {
    currentUser: async () => {
      await gate;
      return { id: 'user-1', email: 'probni@example.invalid' };
    },
    fetchProfile: async () => ({ fullName: 'Probni Korisnik', profileComplete: true }),
    fetchRole: async () => role,
    fetchAccountStatus: async () => 'ACTIVE',
  };
  return { gateway, release: () => release() };
}

function renderGuarded(gateway: AccessGateway) {
  act(() => {
    root.render(
      <AccessProvider gateway={gateway} configured>
        <RequireRole allow={['OWNER']}>
          <p>TAJNI SADRZAJ</p>
        </RequireRole>
      </AccessProvider>,
    );
  });
}

const text = () => container.textContent ?? '';

describe('protected content and the server answer', () => {
  it('renders nothing protected before the server has answered', async () => {
    const { gateway, release } = deferredGateway('OWNER');
    renderGuarded(gateway);

    // The critical assertion: at this instant a session may well exist in the
    // browser, but the server has not said what it means, so the guard shows
    // the loading state and not the content.
    expect(text()).not.toContain('TAJNI SADRZAJ');
    expect(text()).toContain('Provjeravam pristup');

    await act(async () => {
      release();
      await Promise.resolve();
    });

    expect(text()).toContain('TAJNI SADRZAJ');
  });

  it('keeps protected content away from an account the server gave no role', async () => {
    const { gateway, release } = deferredGateway(null);
    renderGuarded(gateway);
    await act(async () => {
      release();
      await Promise.resolve();
    });

    expect(text()).not.toContain('TAJNI SADRZAJ');
    expect(text()).toContain('namijenjen drugoj ulozi');
  });

  it('keeps protected content away from a role that is not allowed', async () => {
    const { gateway, release } = deferredGateway('FIREFIGHTER');
    renderGuarded(gateway);
    await act(async () => {
      release();
      await Promise.resolve();
    });

    expect(text()).not.toContain('TAJNI SADRZAJ');
  });

  it('shows nothing protected when the server cannot be reached', async () => {
    const failing: AccessGateway = {
      currentUser: async () => ({ id: 'user-1', email: 'probni@example.invalid' }),
      fetchProfile: async () => ({ fullName: 'Probni Korisnik', profileComplete: true }),
      fetchRole: async () => {
        throw new Error('network');
      },
      fetchAccountStatus: async () => 'ACTIVE',
    };
    renderGuarded(failing);
    await act(async () => {
      await Promise.resolve();
    });

    expect(text()).not.toContain('TAJNI SADRZAJ');
    // An unreachable server is reported as unreachable, never as "no role".
    expect(text()).toContain('Server nije dostupan');
  });

  it('shows nothing protected when no project is configured', async () => {
    const unused: AccessGateway = {
      currentUser: async () => {
        throw new Error('the gateway must not be called when unconfigured');
      },
      fetchProfile: async () => null,
      fetchRole: async () => null,
      fetchAccountStatus: async () => null,
    };
    act(() => {
      root.render(
        <AccessProvider gateway={unused} configured={false}>
          <RequireRole allow={['OWNER']}>
            <p>TAJNI SADRZAJ</p>
          </RequireRole>
        </AccessProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(text()).not.toContain('TAJNI SADRZAJ');
    expect(text()).toContain('Server nije podesen');
  });

  it('takes access away when a reload says the account has been suspended', async () => {
    // The suspension path that matters: the person is already looking at the
    // screen when the owner suspends them. Their JWT stays syntactically valid,
    // so only re-asking the server can take the screen away - which is why the
    // provider reloads rather than trusting what it loaded at sign-in.
    let role: string | null = 'OWNER';
    let status = 'ACTIVE';
    const gateway: AccessGateway = {
      currentUser: async () => ({ id: 'user-1', email: 'probni@example.invalid' }),
      fetchProfile: async () => ({ fullName: 'Probni Korisnik', profileComplete: true }),
      fetchRole: async () => role,
      fetchAccountStatus: async () => status,
    };

    let reload: (() => Promise<void>) | null = null;
    function Capture() {
      reload = useAccess().reload;
      return null;
    }

    act(() => {
      root.render(
        <AccessProvider gateway={gateway} configured>
          <Capture />
          <RequireRole allow={['OWNER']}>
            <p>TAJNI SADRZAJ</p>
          </RequireRole>
        </AccessProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(text()).toContain('TAJNI SADRZAJ');

    role = null;
    status = 'SUSPENDED';
    await act(async () => {
      await reload?.();
    });

    expect(text()).not.toContain('TAJNI SADRZAJ');
    expect(text()).toContain('Pristup ovom nalogu je ukinut');
  });
});

/**
 * P6: the acting service the provider hands downstream, and the switch.
 *
 * The provider owns which service a person is acting as: it resolves it on load
 * from what the server says they may act in and what this device remembers, and
 * `setActingService` changes it - by remembering the choice and reloading, so the
 * new service's role and member still come from the server, never from the click.
 */
describe('the acting service the provider exposes', () => {
  function serviceGateway(config: {
    memberships: readonly string[];
    isOwner?: boolean;
    roleByService: Readonly<Record<string, string | null>>;
  }): AccessGateway {
    return {
      currentUser: async () => ({ id: 'user-1', email: 'probni@example.invalid' }),
      fetchProfile: async () => ({ fullName: 'Probni Korisnik', profileComplete: true }),
      fetchRole: async () => {
        throw new Error('legacy fetchRole must not be used on the service path');
      },
      fetchAccountStatus: async () => 'ACTIVE',
      fetchServiceContext: async () => ({
        memberships: config.memberships,
        isOwner: config.isOwner ?? false,
      }),
      fetchRoleIn: async (organizationId) => {
        if (organizationId === organizationIdOf('DVD')) return config.roleByService.DVD ?? null;
        if (organizationId === organizationIdOf('SZS')) return config.roleByService.SZS ?? null;
        return null;
      },
    };
  }

  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      map,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    };
  }

  let captured: AccessContextValue | null = null;
  function Capture() {
    captured = useAccess();
    const service = captured.actingService ?? 'none';
    const role = captured.access.kind === 'SIGNED_IN' ? captured.access.role ?? 'null' : '-';
    return <p data-testid="ctx">{`${service}/${role}`}</p>;
  }

  const shown = () => container.querySelector('[data-testid="ctx"]')?.textContent ?? '';

  async function render(gateway: AccessGateway, storage: ReturnType<typeof fakeStorage>) {
    await act(async () => {
      root.render(
        <AccessProvider gateway={gateway} configured storage={storage}>
          <Capture />
        </AccessProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('defaults a dual-service member to DVD and offers the switch', async () => {
    const storage = fakeStorage();
    await render(
      serviceGateway({ memberships: ['DVD', 'SZS'], roleByService: { DVD: 'ADMIN', SZS: 'COMMANDER' } }),
      storage,
    );
    expect(shown()).toBe('DVD/ADMIN');
    expect(captured?.canSwitchService).toBe(true);
    expect(captured?.availableServices).toEqual(['DVD', 'SZS']);
  });

  it('switches service on request, reads the new role, and remembers the choice', async () => {
    const storage = fakeStorage();
    await render(
      serviceGateway({ memberships: ['DVD', 'SZS'], roleByService: { DVD: 'ADMIN', SZS: 'COMMANDER' } }),
      storage,
    );
    await act(async () => {
      await captured?.setActingService('SZS');
    });
    expect(shown()).toBe('SZS/COMMANDER');
    // The choice was written to this device, so a later reload keeps it.
    expect(storage.map.get(rememberedServiceKey('user-1'))).toBe('SZS');
  });

  it('honours a remembered choice on load, without a silent reset on reload', async () => {
    const storage = fakeStorage({ [rememberedServiceKey('user-1')]: 'SZS' });
    await render(
      serviceGateway({ memberships: ['DVD', 'SZS'], roleByService: { DVD: 'ADMIN', SZS: 'COMMANDER' } }),
      storage,
    );
    expect(shown()).toBe('SZS/COMMANDER');
    // A token refresh reloads the snapshot; it must not silently drop back to DVD.
    await act(async () => {
      await captured?.reload();
    });
    expect(shown()).toBe('SZS/COMMANDER');
  });

  it('never switches to a service the person does not hold', async () => {
    const storage = fakeStorage();
    await render(
      serviceGateway({ memberships: ['DVD'], roleByService: { DVD: 'FIREFIGHTER', SZS: 'COMMANDER' } }),
      storage,
    );
    expect(captured?.canSwitchService).toBe(false);
    await act(async () => {
      await captured?.setActingService('SZS');
    });
    // The click is dropped: still DVD, and nothing was written for SZS.
    expect(shown()).toBe('DVD/FIREFIGHTER');
    expect(storage.map.get(rememberedServiceKey('user-1'))).toBeUndefined();
  });

  it('gives the installation owner both services and OWNER in each', async () => {
    const storage = fakeStorage();
    await render(
      serviceGateway({ memberships: [], isOwner: true, roleByService: { DVD: 'OWNER', SZS: 'OWNER' } }),
      storage,
    );
    expect(shown()).toBe('DVD/OWNER');
    expect(captured?.availableServices).toEqual(['DVD', 'SZS']);
    await act(async () => {
      await captured?.setActingService('SZS');
    });
    expect(shown()).toBe('SZS/OWNER');
  });
});
