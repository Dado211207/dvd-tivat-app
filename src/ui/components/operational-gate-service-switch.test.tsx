/**
 * P6 review: switching the acting service is an IDENTITY BOUNDARY for the member.
 *
 * OperationalGate keeps the last known member on screen while it re-reads, so a
 * tab regaining focus does not flash a spinner. That is right for a SAME-service
 * refresh. It is wrong across a SERVICE SWITCH: the member record belongs to one
 * service, and the previous service's memberId must never be handed to `children`
 * under the new service - not while the new read is in flight, not if the new
 * read fails, and not if the previous service's read arrives last.
 *
 * These tests drive the switch with deferred reads so the in-flight window is
 * observable. They failed before the fix (the DVD memberId showed under SZS while
 * SZS was pending, and a failed SZS read fell back to the DVD memberId).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessProvider, useAccess, type AccessContextValue } from '@/auth/AccessProvider';
import type { AccessGateway } from '@/auth/access';
import { organizationIdOf } from '@/auth/serviceContext';
import type { ReadResult } from '@/auth/operations';
import { OperationalGate } from './OperationalGate';

const DVD = organizationIdOf('DVD');
const SZS = organizationIdOf('SZS');

interface Deferred {
  readonly promise: Promise<ReadResult<string | null>>;
  resolve(value: ReadResult<string | null>): void;
}

// A controllable current_member_id_in per service, so the switch's in-flight
// window can be held open and inspected.
const members = vi.hoisted(() => {
  const latest = new Map<string, Deferred>();
  return {
    latest,
    make(org: string): Promise<ReadResult<string | null>> {
      let resolve!: (value: ReadResult<string | null>) => void;
      const promise = new Promise<ReadResult<string | null>>((r) => {
        resolve = r;
      });
      latest.set(org, { promise, resolve });
      return promise;
    },
  };
});

vi.mock('@/auth/operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/operations')>()),
  fetchOwnMemberId: (organizationId?: string) => members.make(organizationId ?? DVD),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let captured: AccessContextValue | null = null;

function dualGateway(): AccessGateway {
  return {
    currentUser: async () => ({ id: 'user-1', email: 'dvojni@example.invalid' }),
    fetchProfile: async () => ({ fullName: 'Dvojna Sluzba', profileComplete: true }),
    fetchRole: async () => {
      throw new Error('legacy path must not run');
    },
    fetchAccountStatus: async () => 'ACTIVE',
    fetchServiceContext: async () => ({ memberships: ['DVD', 'SZS'], isOwner: false }),
    fetchRoleIn: async () => 'FIREFIGHTER',
  };
}

function Capture() {
  captured = useAccess();
  return null;
}

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function resolveMember(org: string, value: ReadResult<string | null>) {
  const deferred = members.latest.get(org);
  if (!deferred) throw new Error(`no pending member read for ${org}`);
  await act(async () => {
    deferred.resolve(value);
    await deferred.promise;
  });
  await flush();
}

async function render(gateway: AccessGateway = dualGateway()) {
  await act(async () => {
    root.render(
      <AccessProvider gateway={gateway} configured storage={window.localStorage}>
        <Capture />
        <OperationalGate allow={['FIREFIGHTER']} requiresMember>
          {(ctx) => <p data-testid="ctx">{`${ctx.service}:${ctx.memberId}`}</p>}
        </OperationalGate>
      </AccessProvider>,
    );
  });
  await flush();
}

const text = () => container.textContent ?? '';

beforeEach(() => {
  members.latest.clear();
  captured = null;
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('the acting service is an identity boundary for the member record', () => {
  it('never hands the previous account member to a new account in the same service', async () => {
    let userId = 'user-1';
    const gateway: AccessGateway = {
      ...dualGateway(),
      currentUser: async () => ({ id: userId, email: `${userId}@example.invalid` }),
    };
    await render(gateway);
    await resolveMember(DVD, { ok: true, value: 'first-member' });
    expect(text()).toContain('DVD:first-member');

    userId = 'user-2';
    await act(async () => {
      await captured?.reload();
    });
    await flush();
    expect(text()).not.toContain('first-member');
    expect(container.querySelector('[data-testid="ctx"]')).toBeNull();

    await resolveMember(DVD, { ok: true, value: 'second-member' });
    expect(text()).toContain('DVD:second-member');
  });

  it('never shows the previous service member while the new service read is pending', async () => {
    await render();
    await resolveMember(DVD, { ok: true, value: 'dvd-member' });
    expect(text()).toContain('DVD:dvd-member');

    // Switch, but leave the SZS read pending.
    await act(async () => {
      await captured?.setActingService('SZS');
    });
    await flush();

    // The DVD member must be gone the instant we are acting as SZS.
    expect(text()).not.toContain('dvd-member');
    expect(container.querySelector('[data-testid="ctx"]')).toBeNull();

    await resolveMember(SZS, { ok: true, value: 'szs-member' });
    expect(text()).toContain('SZS:szs-member');
    expect(text()).not.toContain('dvd-member');
  });

  it('does not fall back to the previous service member when the new read fails', async () => {
    await render();
    await resolveMember(DVD, { ok: true, value: 'dvd-member' });
    expect(text()).toContain('DVD:dvd-member');

    await act(async () => {
      await captured?.setActingService('SZS');
    });
    await flush();
    await resolveMember(SZS, { ok: false, reason: 'REFUSED' });

    // A refused SZS read is a failure for SZS - never the DVD member.
    expect(text()).not.toContain('dvd-member');
    expect(container.querySelector('[data-testid="member-check-failed"]')).not.toBeNull();
  });

  it('ignores the previous service read arriving after the switch', async () => {
    await render();
    // Do not resolve DVD yet; switch first.
    await act(async () => {
      await captured?.setActingService('SZS');
    });
    await flush();
    await resolveMember(SZS, { ok: true, value: 'szs-member' });
    expect(text()).toContain('SZS:szs-member');

    // The stale DVD read now arrives last; it must change nothing.
    await resolveMember(DVD, { ok: true, value: 'dvd-member' });
    expect(text()).toContain('SZS:szs-member');
    expect(text()).not.toContain('dvd-member');
  });

  it('keeps the no-spinner behaviour on a same-service refresh', async () => {
    await render();
    await resolveMember(DVD, { ok: true, value: 'dvd-member' });
    expect(text()).toContain('DVD:dvd-member');

    // A same-service reload (e.g. a token refresh) must keep the member on screen
    // while it re-reads - no spinner, no flash.
    await act(async () => {
      await captured?.reload();
    });
    await flush();
    expect(text()).toContain('DVD:dvd-member');
  });
});
