import { describe, expect, it } from 'vitest';
import {
  availableServices,
  canSwitchService,
  readRememberedService,
  resolveActingService,
  writeRememberedService,
} from './serviceContext';

describe('availableServices', () => {
  it('a DVD-only member can act only in DVD', () => {
    expect(availableServices(['DVD'], false)).toEqual(['DVD']);
    expect(canSwitchService(availableServices(['DVD'], false))).toBe(false);
  });

  it('an SZS-only member can act only in SZS (no DVD membership required)', () => {
    expect(availableServices(['SZS'], false)).toEqual(['SZS']);
    expect(canSwitchService(availableServices(['SZS'], false))).toBe(false);
  });

  it('a dual-service member can act in both, in DVD, SZS order', () => {
    expect(availableServices(['SZS', 'DVD'], false)).toEqual(['DVD', 'SZS']);
    expect(canSwitchService(availableServices(['SZS', 'DVD'], false))).toBe(true);
  });

  it('the owner can act in both services with no membership rows', () => {
    expect(availableServices([], true)).toEqual(['DVD', 'SZS']);
    expect(canSwitchService(availableServices([], true))).toBe(true);
  });

  it('the owner still sees both even if they also hold one membership', () => {
    expect(availableServices(['SZS'], true)).toEqual(['DVD', 'SZS']);
  });

  it('a citizen with no membership and no ownership can act in nothing', () => {
    expect(availableServices([], false)).toEqual([]);
    expect(canSwitchService([])).toBe(false);
  });
});

describe('resolveActingService', () => {
  it('is null when no service is available', () => {
    expect(resolveActingService([], 'DVD')).toBeNull();
  });

  it('defaults a DVD-only person to DVD', () => {
    expect(resolveActingService(['DVD'], null)).toBe('DVD');
  });

  it('defaults an SZS-only person to SZS', () => {
    expect(resolveActingService(['SZS'], null)).toBe('SZS');
  });

  it('defaults a dual person to DVD (stable order) when nothing is remembered', () => {
    expect(resolveActingService(['DVD', 'SZS'], null)).toBe('DVD');
  });

  it('honours a remembered choice that is still available', () => {
    expect(resolveActingService(['DVD', 'SZS'], 'SZS')).toBe('SZS');
  });

  it('ignores a remembered choice that is no longer available (e.g. SZS membership withdrawn)', () => {
    expect(resolveActingService(['DVD'], 'SZS')).toBe('DVD');
  });

  it('ignores a garbage remembered value', () => {
    expect(resolveActingService(['DVD', 'SZS'], 'NONSENSE')).toBe('DVD');
  });
});

describe('remembered service storage', () => {
  it('round-trips per user id', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    writeRememberedService(storage, 'user-1', 'SZS');
    expect(readRememberedService(storage, 'user-1')).toBe('SZS');
    // A different account on the same device does not inherit it.
    expect(readRememberedService(storage, 'user-2')).toBeNull();
  });

  it('returns null and never throws when storage is absent', () => {
    expect(readRememberedService(null, 'user-1')).toBeNull();
    expect(() => writeRememberedService(null, 'user-1', 'DVD')).not.toThrow();
  });

  it('fails soft when storage throws (private window)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readRememberedService(throwing, 'user-1')).toBeNull();
    expect(() => writeRememberedService(throwing, 'user-1', 'DVD')).not.toThrow();
  });
});
