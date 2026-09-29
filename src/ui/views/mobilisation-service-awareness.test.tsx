/**
 * The notification entry point, for a member who serves in two services (P6, D14).
 *
 * A Web Push carries only the call-out id - never its service, because a locked
 * phone must show no incident detail. The firefighter's screen resolves that id
 * against the service the person is CURRENTLY acting as. So a dual-service member
 * woken for the service they are not acting as taps the alarm and, without this,
 * lands on a screen that quietly shows nothing - the worst possible dead end on
 * the one action a mobilisation tool exists to serve.
 *
 * These tests drive that exact situation: acting as DVD, a push for an SZS
 * call-out. They assert the screen says where the call-out is and offers an
 * EXPLICIT switch (never a silent one, per D14), that it never reads the other
 * service's per-call-out detail while doing so, and - the negative controls that
 * would fail if the service scoping were dropped - that it offers nothing for a
 * call-out in no service the person may act in, and that a single-service member's
 * screen never reaches into another service at all.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessGateway } from '@/auth/access';
import { AccessProvider } from '@/auth/AccessProvider';
import { organizationIdOf } from '@/auth/serviceContext';
import { resetLanguageForTests } from '@/i18n/language';
import { textFor } from '@/i18n/useText';
import { MobilisationView } from './MobilisationView';

const SZS = organizationIdOf('SZS');
// The human label the notice names the service by - "SZS" the code is never shown.
const SZS_LABEL = textFor('me').accounts.organizationLabel.SZS;

const DVD_MEMBER = '11111111-1111-4111-8111-111111111111';
const SZS_MEMBER = '22222222-2222-4222-8222-222222222222';
const DVD_CALL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SZS_CALL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STRANGER_CALL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function interventionIn(service: 'DVD' | 'SZS', id: string) {
  return {
    id,
    kind: 'POZAR' as const,
    otherKindNote: null,
    title: service === 'DVD' ? 'DVD: dimnjak' : 'SZS: sistem javljanja',
    instructions: 'Okupljanje u bazi.',
    incidentLocation: service === 'DVD' ? 'Tivat centar' : 'Luka',
    assemblyPoint: 'Baza',
    latitude: null,
    longitude: null,
    status: 'PUBLISHED' as const,
    version: 1,
    publishedAt: '2026-09-28T08:00:00.000Z',
    closedAt: null,
    closeReason: null,
    createdAt: '2026-09-28T07:59:00.000Z',
  };
}

// Per-service reads, so the deep-link probe's cross-service query is observable and
// its argument can be asserted. The per-id detail reads are spied so the test can
// prove the OTHER service's call-out detail is never fetched while acting as DVD.
const recipientFacts = vi.hoisted(() => vi.fn());
const attendance = vi.hoisted(() => vi.fn());
const interventionsFor = vi.hoisted(() => ({ dvd: [] as unknown[], szs: [] as unknown[] }));
const addressedFor = vi.hoisted(() => ({ dvd: [] as unknown[], szs: [] as unknown[] }));

vi.mock('@/auth/operations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/operations')>();
  return {
    ...real,
    fetchOwnMemberId: vi.fn(async (organizationId?: string) => ({
      ok: true as const,
      value: organizationId === SZS ? SZS_MEMBER : DVD_MEMBER,
    })),
    fetchInterventions: vi.fn(async (organizationId?: string) => ({
      ok: true as const,
      value: (organizationId === SZS ? interventionsFor.szs : interventionsFor.dvd) as never,
    })),
    fetchAddressedInterventions: vi.fn(async (organizationId: string) => ({
      ok: true as const,
      value: (organizationId === SZS ? addressedFor.szs : addressedFor.dvd) as never,
    })),
    fetchAvailability: vi.fn(async () => ({ ok: true as const, value: [] })),
    fetchRecipientFacts: recipientFacts.mockImplementation(async () => ({ ok: true, value: [] })),
    fetchAttendance: attendance.mockImplementation(async () => ({ ok: true, value: [] })),
  };
});

vi.mock('@/auth/roster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/roster')>()),
  loadRoster: vi.fn(async () => []),
}));

// Realtime is irrelevant here and needs a project; stub it to a settled status.
vi.mock('@/auth/live', () => ({ useLiveOperations: () => 'off' }));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function dualGateway(): AccessGateway {
  return {
    currentUser: async () => ({ id: 'dual-user', email: 'dvojni@example.invalid' }),
    fetchProfile: async () => ({ fullName: 'Dvojna Sluzba', profileComplete: true }),
    fetchRole: async () => {
      throw new Error('legacy path must not run');
    },
    fetchAccountStatus: async () => 'ACTIVE',
    fetchServiceContext: async () => ({ memberships: ['DVD', 'SZS'], isOwner: false }),
    fetchRoleIn: async () => 'FIREFIGHTER',
  };
}

function singleGateway(): AccessGateway {
  return {
    currentUser: async () => ({ id: 'dvd-user', email: 'dvd@example.invalid' }),
    fetchProfile: async () => ({ fullName: 'Samo DVD', profileComplete: true }),
    fetchRole: async () => {
      throw new Error('legacy path must not run');
    },
    fetchAccountStatus: async () => 'ACTIVE',
    fetchServiceContext: async () => ({ memberships: ['DVD'], isOwner: false }),
    fetchRoleIn: async () => 'FIREFIGHTER',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  resetLanguageForTests();
  interventionsFor.dvd = [interventionIn('DVD', DVD_CALL)];
  interventionsFor.szs = [interventionIn('SZS', SZS_CALL)];
  addressedFor.dvd = [...interventionsFor.dvd];
  addressedFor.szs = [...interventionsFor.szs];
  recipientFacts.mockClear();
  attendance.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.location.hash = '';
  vi.clearAllMocks();
});

async function show(gateway: AccessGateway, hash: string) {
  window.location.hash = hash;
  await act(async () => {
    root.render(
      <AccessProvider gateway={gateway} configured storage={window.localStorage}>
        <MobilisationView />
      </AccessProvider>,
    );
  });
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const crossNotice = () => container.querySelector('[data-testid="cross-service-callout"]');
const switchButton = () =>
  container.querySelector<HTMLButtonElement>('[data-testid="switch-to-other-service"]');
const calledWith = (spy: ReturnType<typeof vi.fn>, id: string) =>
  spy.mock.calls.some((args) => args[0] === id);

describe('a notification for a call-out in the other service', () => {
  it('tells a dual-service member where it is and offers an explicit switch', async () => {
    await show(dualGateway(), `#/mobilizacija?intervention=${SZS_CALL}`);

    const notice = crossNotice();
    expect(notice, 'the cross-service notice must be shown').not.toBeNull();
    expect(notice?.textContent).toContain(SZS_LABEL);
    expect(switchButton(), 'an explicit switch must be offered').not.toBeNull();
  });

  it('never reads the other service call-out detail while acting as DVD', async () => {
    await show(dualGateway(), `#/mobilizacija?intervention=${SZS_CALL}`);

    // The DVD screen reads its OWN focused call-out's detail...
    expect(calledWith(recipientFacts, DVD_CALL)).toBe(true);
    // ...and never the SZS call-out's, which belongs to the service not on screen.
    expect(calledWith(recipientFacts, SZS_CALL)).toBe(false);
    expect(calledWith(attendance, SZS_CALL)).toBe(false);
  });

  it('switches only on the explicit tap, and then shows the call-out', async () => {
    await show(dualGateway(), `#/mobilizacija?intervention=${SZS_CALL}`);
    expect(crossNotice()).not.toBeNull();

    await act(async () => {
      switchButton()!.click();
    });
    for (let i = 0; i < 12; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    // Now acting as SZS: the prompt is gone and the SZS call-out is on screen.
    expect(crossNotice()).toBeNull();
    expect(container.textContent).toContain('SZS: sistem javljanja');
  });

  it('switches to the addressed service when the current service owns the joint incident', async () => {
    const joint = { ...interventionIn('DVD', SZS_CALL), title: 'DVD zove SZS' };
    // RLS permits the SZS recipient to read the DVD-owned parent, but their DVD
    // member was not paged. The DVD screen must not offer a DVD action for it.
    interventionsFor.dvd = [joint];
    interventionsFor.szs = [];
    addressedFor.dvd = [];
    addressedFor.szs = [joint];

    await show(dualGateway(), `#/mobilizacija?intervention=${SZS_CALL}`);
    expect(crossNotice()?.textContent).toContain(SZS_LABEL);
    expect(container.querySelector('[data-testid="acknowledge"]')).toBeNull();
    expect(calledWith(recipientFacts, SZS_CALL)).toBe(false);

    await act(async () => { switchButton()!.click(); });
    for (let i = 0; i < 12; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(crossNotice()).toBeNull();
    expect(container.textContent).toContain('DVD zove SZS');
  });

  it('offers nothing for a call-out in no service the person may act in', async () => {
    // A stale link, or somebody else's call-out: neither service holds it, so the
    // silent fallback stands - prompting a switch that also would not help is worse.
    await show(dualGateway(), `#/mobilizacija?intervention=${STRANGER_CALL}`);
    expect(crossNotice()).toBeNull();
  });

  it('never reaches into another service for a single-service member', async () => {
    const operations = await import('@/auth/operations');
    const fetchAddressedInterventions = vi.mocked(operations.fetchAddressedInterventions);
    await show(singleGateway(), `#/mobilizacija?intervention=${SZS_CALL}`);

    expect(crossNotice()).toBeNull();
    // A DVD-only member's screen never probes another service's recipient rows.
    expect(fetchAddressedInterventions.mock.calls.every((args) => args[0] !== SZS)).toBe(true);
  });
});
