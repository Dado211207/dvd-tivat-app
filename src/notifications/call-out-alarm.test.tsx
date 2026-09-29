/**
 * The app-level call-out alarm, rendered on its own - i.e. with NO operational
 * screen mounted, which is the whole point: it must sound a newly-arrived call-out
 * whatever route is open. These tests drive it through a realtime notice (a stubbed
 * `useLiveOperations`) and stubbed recipient reads, and read the hidden signal it
 * exposes (`data-plays`) to see whether it sounded.
 *
 * They cover: the baseline (already-open call-outs never sound), a genuinely new
 * one (does), a refused read (no baseline, no sound), default off (nothing mounted
 * at all), the recipient rules (DVD-only never SZS, dual-service either service,
 * owner-without-member silent), and a shared-device account switch where a late
 * read from the previous account must be ignored.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessProvider } from '@/auth/AccessProvider';
import type { AccessGateway } from '@/auth/access';
import { organizationIdOf } from '@/auth/serviceContext';
import type { ReadResult } from '@/auth/operations';
import { writeAlarmSound } from './alarmSounds';
import { CallOutAlarm } from './CallOutAlarm';

const DVD = organizationIdOf('DVD');
const SZS = organizationIdOf('SZS');

// Controllable server answers.
const memberByOrg = vi.hoisted(() => new Map<string, string | null>());
const memberReadFailures = vi.hoisted(() => new Set<string>());
const addressedByMember = vi.hoisted(() => new Map<string, ReadResult<readonly string[]> | Promise<ReadResult<readonly string[]>>>());
// The latest realtime onChange the listener registered, so a test can fire a notice.
const live = vi.hoisted(() => ({ onChange: null as null | (() => void) }));

vi.mock('@/auth/operations', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/operations')>();
  return {
    ...real,
    fetchOwnMemberId: vi.fn(async (org?: string) =>
      org !== undefined && memberReadFailures.has(org)
        ? { ok: false as const, reason: 'UNAVAILABLE' as const }
        : { ok: true as const, value: (org !== undefined ? memberByOrg.get(org) : null) ?? null },
    ),
    fetchAddressedOpenInterventionIds: vi.fn(
      async (_org: string, memberId: string): Promise<ReadResult<readonly string[]>> =>
        addressedByMember.get(memberId) ?? { ok: true, value: [] },
    ),
  };
});

vi.mock('@/auth/live', () => ({
  useLiveOperations: ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => {
    live.onChange = enabled ? onChange : null;
    return 'LIVE';
  },
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function gateway(config: {
  userId: string;
  memberships: readonly string[];
  isOwner?: boolean;
}): AccessGateway {
  return {
    currentUser: async () => ({ id: config.userId, email: `${config.userId}@example.invalid` }),
    fetchProfile: async () => ({ fullName: 'Probni', profileComplete: true }),
    fetchRole: async () => {
      throw new Error('legacy path must not run');
    },
    fetchAccountStatus: async () => 'ACTIVE',
    fetchServiceContext: async () => ({ memberships: config.memberships, isOwner: config.isOwner ?? false }),
    fetchRoleIn: async () => 'FIREFIGHTER',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  memberByOrg.clear();
  memberReadFailures.clear();
  addressedByMember.clear();
  live.onChange = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderFor(g: AccessGateway) {
  await act(async () => {
    root.render(
      <AccessProvider gateway={g} configured storage={window.localStorage}>
        <CallOutAlarm />
      </AccessProvider>,
    );
  });
  await flush();
}

const el = () => container.querySelector('[data-testid="callout-alarm"]');
const plays = () => Number(el()?.getAttribute('data-plays') ?? '-1');
const ready = () => el()?.getAttribute('data-ready') ?? 'absent';
const watching = () => Number(el()?.getAttribute('data-watching') ?? '-1');

async function notice() {
  await act(async () => {
    live.onChange?.();
  });
  await flush();
}

describe('the app-level call-out alarm', () => {
  it('is not even mounted while the choice is off (the default)', async () => {
    memberByOrg.set(DVD, 'dvd-member');
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));
    // No element, no reads: off is the listener being absent.
    expect(el()).toBeNull();
    const ops = await import('@/auth/operations');
    expect(vi.mocked(ops.fetchAddressedOpenInterventionIds)).not.toHaveBeenCalled();
  });

  it('does not sound the call-outs already open when it starts (baseline)', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member');
    addressedByMember.set('dvd-member', { ok: true, value: ['already-open'] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));
    expect(ready()).toBe('true');
    expect(plays()).toBe(0);
  });

  it('sounds a call-out that arrives after the baseline, with no screen mounted', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member');
    addressedByMember.set('dvd-member', { ok: true, value: [] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));
    expect(plays()).toBe(0);

    addressedByMember.set('dvd-member', { ok: true, value: ['fresh-call'] });
    await notice();
    expect(plays()).toBe(1);
  });

  it('does not re-sound the same call-out on a later notice/reconnect', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member');
    addressedByMember.set('dvd-member', { ok: true, value: [] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));
    addressedByMember.set('dvd-member', { ok: true, value: ['fresh-call'] });
    await notice();
    expect(plays()).toBe(1);
    await notice(); // same set again
    expect(plays()).toBe(1);
  });

  it('quietly catches up after a hidden tab becomes visible, then sounds later arrivals', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member');
    addressedByMember.set('dvd-member', { ok: true, value: [] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      // Realtime was unavailable while hidden; the call-out is already open
      // when the person returns. Their device's push notification handled it.
      addressedByMember.set('dvd-member', { ok: true, value: ['while-hidden'] });
      visibility.mockReturnValue('visible');
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      await notice();
      expect(plays()).toBe(0);

      addressedByMember.set('dvd-member', { ok: true, value: ['while-hidden', 'while-visible'] });
      await notice();
      expect(plays()).toBe(1);
    } finally {
      visibility.mockRestore();
    }
  });

  it('keeps the resume baseline pending through a refused read', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member');
    addressedByMember.set('dvd-member', { ok: true, value: [] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      visibility.mockReturnValue('visible');
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      addressedByMember.set('dvd-member', { ok: false, reason: 'UNAVAILABLE' });
      await notice();
      expect(plays()).toBe(0);

      addressedByMember.set('dvd-member', { ok: true, value: ['during-outage'] });
      await notice();
      expect(plays()).toBe(0);

      addressedByMember.set('dvd-member', { ok: true, value: ['during-outage', 'fresh'] });
      await notice();
      expect(plays()).toBe(1);
    } finally {
      visibility.mockRestore();
    }
  });

  it('ignores a hidden-tab read that finishes after the tab becomes visible', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member');
    addressedByMember.set('dvd-member', { ok: true, value: [] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      let finishHidden!: (value: ReadResult<readonly string[]>) => void;
      addressedByMember.set('dvd-member', new Promise((resolve) => { finishHidden = resolve; }));
      await notice(); // starts while hidden, finishes later

      visibility.mockReturnValue('visible');
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      await act(async () => finishHidden({ ok: true, value: ['while-hidden'] }));
      await flush();
      expect(plays()).toBe(0);

      addressedByMember.set('dvd-member', { ok: true, value: ['while-hidden'] });
      await notice(); // first successful visible snapshot becomes the baseline
      expect(plays()).toBe(0);

      addressedByMember.set('dvd-member', { ok: true, value: ['while-hidden', 'later'] });
      await notice();
      expect(plays()).toBe(1);
    } finally {
      visibility.mockRestore();
    }
  });

  it('ignores an older read that finishes after a newer arrival read', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member');
    addressedByMember.set('dvd-member', { ok: true, value: [] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));

    let finishOld!: (value: ReadResult<readonly string[]>) => void;
    const oldRead = new Promise<ReadResult<readonly string[]>>((resolve) => {
      finishOld = resolve;
    });
    addressedByMember.set('dvd-member', oldRead);
    await notice();

    addressedByMember.set('dvd-member', { ok: true, value: ['new-call'] });
    await notice();
    expect(plays()).toBe(1);

    await act(async () => finishOld({ ok: true, value: [] }));
    await flush();
    await notice();
    expect(plays()).toBe(1);
  });

  it('treats a newly granted service as a fresh baseline, not a new call-out', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member');
    memberByOrg.set(SZS, 'szs-member');
    addressedByMember.set('dvd-member', { ok: true, value: [] });
    addressedByMember.set('szs-member', { ok: true, value: ['already-open-szs'] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));
    expect(plays()).toBe(0);

    await renderFor(gateway({ userId: 'u1', memberships: ['DVD', 'SZS'] }));
    expect(ready()).toBe('true');
    expect(plays()).toBe(0);

    addressedByMember.set('szs-member', { ok: true, value: ['already-open-szs', 'new-szs'] });
    await notice();
    expect(plays()).toBe(1);
  });

  it('does not establish a baseline from a refused read, and does not sound', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member');
    addressedByMember.set('dvd-member', { ok: false, reason: 'REFUSED' });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));
    expect(ready()).toBe('false');
    expect(plays()).toBe(0);

    // A later successful read is the first real baseline; an already-open call-out
    // in it must still not sound.
    addressedByMember.set('dvd-member', { ok: true, value: ['was-open-during-outage'] });
    await notice();
    expect(ready()).toBe('true');
    expect(plays()).toBe(0);
  });

  it('retries a failed member-id lookup on the next notice instead of treating it as no membership', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberReadFailures.add(DVD);
    memberByOrg.set(DVD, 'dvd-member');
    addressedByMember.set('dvd-member', { ok: true, value: ['already-open'] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));
    expect(ready()).toBe('false');
    expect(watching()).toBe(0);

    memberReadFailures.delete(DVD);
    await notice();
    expect(ready()).toBe('true');
    expect(watching()).toBe(1);
    expect(plays()).toBe(0);

    addressedByMember.set('dvd-member', { ok: true, value: ['already-open', 'new-call'] });
    await notice();
    expect(plays()).toBe(1);
  });

  it('never sounds a DVD-only member for an SZS call-out', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member'); // no SZS member
    addressedByMember.set('dvd-member', { ok: true, value: [] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] }));
    expect(watching()).toBe(1);
    // An SZS call-out (addressed to some SZS member) is invisible: this account
    // has no SZS member, so it is never read or sounded.
    addressedByMember.set('szs-member', { ok: true, value: ['szs-call'] });
    await notice();
    expect(plays()).toBe(0);
  });

  it('sounds a dual-service member for a call-out in either service', async () => {
    writeAlarmSound(window.localStorage, 'u1', 'siren');
    memberByOrg.set(DVD, 'dvd-member');
    memberByOrg.set(SZS, 'szs-member');
    addressedByMember.set('dvd-member', { ok: true, value: [] });
    addressedByMember.set('szs-member', { ok: true, value: [] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD', 'SZS'] }));
    expect(watching()).toBe(2);

    // A call-out addressed to their SZS member sounds even though the acting
    // service is DVD (the alarm never consults the acting-service selector).
    addressedByMember.set('szs-member', { ok: true, value: ['szs-call'] });
    await notice();
    expect(plays()).toBe(1);
  });

  it('turns on the moment the choice is switched on in Settings, no reload', async () => {
    memberByOrg.set(DVD, 'dvd-member');
    addressedByMember.set('dvd-member', { ok: true, value: [] });
    await renderFor(gateway({ userId: 'u1', memberships: ['DVD'] })); // default off
    expect(el()).toBeNull();

    // The Settings picker writes the choice; the same-tab emitter wakes the
    // listener. It mounts fresh, so the call-outs open at that moment are its
    // baseline and do not sound.
    addressedByMember.set('dvd-member', { ok: true, value: ['already-open'] });
    await act(async () => {
      writeAlarmSound(window.localStorage, 'u1', 'chime');
    });
    await flush();
    expect(el()).not.toBeNull();
    expect(ready()).toBe('true');
    expect(plays()).toBe(0);

    addressedByMember.set('dvd-member', { ok: true, value: ['already-open', 'new-after-enable'] });
    await notice();
    expect(plays()).toBe(1);
  });

  it('gives an owner with no member record nothing to be alerted about', async () => {
    writeAlarmSound(window.localStorage, 'owner', 'siren');
    // Owner: available in both services, but a member of neither.
    memberByOrg.set(DVD, null);
    memberByOrg.set(SZS, null);
    await renderFor(gateway({ userId: 'owner', memberships: [], isOwner: true }));
    expect(watching()).toBe(0);
    expect(ready()).toBe('true'); // a real "nothing addressed to me", not an error

    // Even a call-out that exists in a service they administer does not sound.
    addressedByMember.set('some-member', { ok: true, value: ['a-call'] });
    await notice();
    expect(plays()).toBe(0);
  });
});

describe('a shared device switching account', () => {
  it('watches only the new account and never reads the previous member after the switch', async () => {
    const ops = await import('@/auth/operations');
    const addressedRead = vi.mocked(ops.fetchAddressedOpenInterventionIds);

    writeAlarmSound(window.localStorage, 'first', 'siren');
    writeAlarmSound(window.localStorage, 'second', 'siren');
    memberByOrg.set(DVD, 'first-member');
    addressedByMember.set('first-member', { ok: true, value: ['first-open'] });
    await renderFor(gateway({ userId: 'first', memberships: ['DVD'] }));
    expect(plays()).toBe(0);

    // Switch to the second account in place: the same acting service, a different
    // person. The listener is keyed by user id, so it remounts fresh - fresh
    // baseline, fresh member identity, fresh play count.
    memberByOrg.set(DVD, 'second-member');
    addressedByMember.set('second-member', { ok: true, value: [] });
    addressedRead.mockClear();
    await act(async () => {
      root.render(
        <AccessProvider gateway={gateway({ userId: 'second', memberships: ['DVD'] })} configured storage={window.localStorage}>
          <CallOutAlarm />
        </AccessProvider>,
      );
    });
    await flush();

    expect(ready()).toBe('true');
    expect(plays()).toBe(0);
    // The load-bearing invariant: after the switch, the alarm reads the SECOND
    // account's member and never the first's cached identity.
    const membersRead = addressedRead.mock.calls.map((call) => call[1]);
    expect(membersRead).toContain('second-member');
    expect(membersRead).not.toContain('first-member');

    // A call-out for the second account sounds; the first account's row would not,
    // because the first member is never read.
    addressedByMember.set('second-member', { ok: true, value: ['second-call'] });
    await notice();
    expect(plays()).toBe(1);
  });
});
