/**
 * Coming back to the application must not throw away where you were.
 *
 * The reported symptom was "the screen reloads when I Alt-Tab back", and the
 * obvious suspect was the service worker forcing `location.reload()`. It is
 * not. The document never reloads. What happens is a REMOUNT, which looks
 * identical from the outside and is worse in one way: it is silent.
 *
 * The chain, established by reading the code and reproduced below:
 *
 *   1. supabase-js re-checks the session when a tab becomes visible again and
 *      emits an auth event even when nothing about the session changed.
 *   2. `AccessProvider` calls `reload()` on every such event, and `loadAccess`
 *      builds a BRAND NEW snapshot object - equal in content, different in
 *      identity.
 *   3. `OperationalGate` listed that object in its effect dependencies, so the
 *      effect re-ran and set its member state back to LOADING.
 *   4. While LOADING the gate returns a spinner INSTEAD OF `children`, so the
 *      whole console unmounts. Every `useState` inside it - the active tab, the
 *      selected intervention, half-typed text - is gone, and a fresh one mounts
 *      a moment later with its initial values.
 *
 * These tests drive that exact path: a second snapshot with identical content
 * and a different identity. They fail on the code as it was.
 */

import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessGateway } from '@/auth/access';
import { AccessProvider } from '@/auth/AccessProvider';
import { OperationalGate } from './OperationalGate';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';

const fetchOwnMemberId = vi.fn(async () => MEMBER_ID as string | null);
vi.mock('@/auth/operations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/operations')>();
  return { ...real, fetchOwnMemberId: () => fetchOwnMemberId() };
});

/**
 * A gateway returning identical content every time.
 *
 * Each call is a fresh object, which is exactly what the real one does - and
 * exactly the thing that used to be mistaken for "the account changed".
 */
function steadyGateway(): AccessGateway {
  return {
    currentUser: async () => ({ id: 'user-1', email: 'komandir@example.invalid' }),
    fetchProfile: async () => ({ fullName: 'Komandir Smjene', profileComplete: true }),
    fetchRole: async () => 'COMMANDER',
    fetchAccountStatus: async () => 'ACTIVE',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  fetchOwnMemberId.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * A child that remembers whether it has ever been unmounted, and holds state
 * of its own - standing in for the active tab, the selected intervention and a
 * half-typed field, all of which live in `useState` inside the gate's children.
 */
let mountCount = 0;

function Console() {
  const [tab, setTab] = useState('poziv');
  return (
    <div>
      <span data-testid="tab">{tab}</span>
      <button type="button" data-testid="to-prisustvo" onClick={() => setTab('prisustvo')}>
        Prisustvo
      </button>
    </div>
  );
}

/** Counts mounts, so a remount is visible rather than inferred. */
function Counted() {
  useEffect(() => {
    mountCount += 1;
  }, []);
  return <Console />;
}

describe('returning to the application preserves where you were', () => {
  it('does not unmount the screen when the session is re-checked', async () => {
    mountCount = 0;
    const onArrival = steadyGateway();

    await act(async () => {
      root.render(
        <AccessProvider gateway={onArrival} configured>
          <OperationalGate allow={['COMMANDER']}>{() => <Counted />}</OperationalGate>
        </AccessProvider>,
      );
    });
    await settle();

    expect(container.querySelector('[data-testid="tab"]')?.textContent).toBe('poziv');
    expect(mountCount, 'mounted once on arrival').toBe(1);

    // The person switches to the attendance tab.
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="to-prisustvo"]')!.click();
    });
    expect(container.querySelector('[data-testid="tab"]')?.textContent).toBe('prisustvo');

    // They Alt-Tab away and back. supabase-js re-checks the session and emits
    // an event; the provider rebuilds an identical snapshot with a new
    // identity. Simulated here by handing the provider a new gateway object
    // that answers exactly the same, which is the same trigger.
    const afterResume = steadyGateway();
    await act(async () => {
      root.render(
        <AccessProvider gateway={afterResume} configured>
          <OperationalGate allow={['COMMANDER']}>{() => <Counted />}</OperationalGate>
        </AccessProvider>,
      );
    });
    await settle();

    expect(mountCount, 'the screen must not be remounted by a session re-check').toBe(1);
    expect(
      container.querySelector('[data-testid="tab"]')?.textContent,
      'the active tab must survive coming back to the application',
    ).toBe('prisustvo');
  });

  it('does not flicker through a loading state on a session re-check', async () => {
    const first = steadyGateway();
    await act(async () => {
      root.render(
        <AccessProvider gateway={first} configured>
          <OperationalGate allow={['COMMANDER']}>{() => <Console />}</OperationalGate>
        </AccessProvider>,
      );
    });
    await settle();
    expect(container.querySelector('[data-testid="tab"]')).not.toBeNull();

    // Re-check mid-flight: at no point may the screen be replaced by a spinner.
    const seen: string[] = [];
    const second = steadyGateway();
    await act(async () => {
      root.render(
        <AccessProvider gateway={second} configured>
          <OperationalGate allow={['COMMANDER']}>{() => <Console />}</OperationalGate>
        </AccessProvider>,
      );
      seen.push(container.textContent ?? '');
    });
    for (let i = 0; i < 8; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
      seen.push(container.textContent ?? '');
    }

    expect(
      seen.some((s) => s.includes('Ucitavanje operativnih podataka')),
      'the console must never be replaced by a spinner while it is already open',
    ).toBe(false);
  });

  it('still re-reads the linked member when the ACCOUNT actually changes', async () => {
    // The fix must not go too far: a different account is a real change and
    // must re-read, or somebody would keep the previous person's screen.
    const sameAccount = steadyGateway();
    await act(async () => {
      root.render(
        <AccessProvider gateway={sameAccount} configured>
          <OperationalGate allow={['COMMANDER']}>{() => <Console />}</OperationalGate>
        </AccessProvider>,
      );
    });
    await settle();
    const before = fetchOwnMemberId.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    const otherAccount: AccessGateway = {
      ...steadyGateway(),
      currentUser: async () => ({ id: 'user-2', email: 'vatrogasac1@example.invalid' }),
    };
    await act(async () => {
      root.render(
        <AccessProvider gateway={otherAccount} configured>
          <OperationalGate allow={['COMMANDER']}>{() => <Console />}</OperationalGate>
        </AccessProvider>,
      );
    });
    await settle();

    expect(
      fetchOwnMemberId.mock.calls.length,
      'a different signed-in account must re-read the linked member',
    ).toBeGreaterThan(before);
  });
});
