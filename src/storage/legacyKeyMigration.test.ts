/**
 * P8: the device storage-key rename must carry every existing draft and setting
 * across, so an upgrading member loses nothing. These run against jsdom's real
 * localStorage, seeding the legacy `dvd-tivat` keys and asserting the migration
 * moves each to its `boka-operativa` name, once, without clobbering or touching
 * anything else.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyStorageKeys } from './legacyKeyMigration';

const SZS = '00000000-0000-4000-8000-000000000002';

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('migrateLegacyStorageKeys', () => {
  it('carries a half-written call-out draft across the rename (AC3)', () => {
    const draft = JSON.stringify({ title: 'Požar', location: 'Baza' });
    window.localStorage.setItem('dvd-tivat.callout-draft', draft);
    migrateLegacyStorageKeys(window.localStorage);
    expect(window.localStorage.getItem('boka-operativa.callout-draft')).toBe(draft);
    expect(window.localStorage.getItem('dvd-tivat.callout-draft')).toBeNull();
  });

  it('carries every setting family, including the per-service and per-user suffixes', () => {
    window.localStorage.setItem('dvd-tivat.callout-draft', 'dvd-draft');
    window.localStorage.setItem(`dvd-tivat.callout-draft:${SZS}`, 'szs-draft');
    window.localStorage.setItem('dvd-tivat.acting-service:user-1', SZS);
    window.localStorage.setItem('dvd-tivat.alarm-sound:user-1', 'siren');
    window.localStorage.setItem('dvd-tivat.language', 'en');

    migrateLegacyStorageKeys(window.localStorage);

    expect(window.localStorage.getItem('boka-operativa.callout-draft')).toBe('dvd-draft');
    expect(window.localStorage.getItem(`boka-operativa.callout-draft:${SZS}`)).toBe('szs-draft');
    expect(window.localStorage.getItem('boka-operativa.acting-service:user-1')).toBe(SZS);
    expect(window.localStorage.getItem('boka-operativa.alarm-sound:user-1')).toBe('siren');
    expect(window.localStorage.getItem('boka-operativa.language')).toBe('en');
    // The legacy keys are gone - cleaned up, not merely copied.
    for (const key of [
      'dvd-tivat.callout-draft',
      `dvd-tivat.callout-draft:${SZS}`,
      'dvd-tivat.acting-service:user-1',
      'dvd-tivat.alarm-sound:user-1',
      'dvd-tivat.language',
    ]) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
  });

  it('is a no-op on a second run (idempotent)', () => {
    window.localStorage.setItem('dvd-tivat.language', 'en');
    migrateLegacyStorageKeys(window.localStorage);
    migrateLegacyStorageKeys(window.localStorage);
    expect(window.localStorage.getItem('boka-operativa.language')).toBe('en');
  });

  it('never clobbers a value already written under the new key', () => {
    window.localStorage.setItem('dvd-tivat.language', 'en');
    window.localStorage.setItem('boka-operativa.language', 'me'); // a choice made since the upgrade
    migrateLegacyStorageKeys(window.localStorage);
    expect(window.localStorage.getItem('boka-operativa.language')).toBe('me');
    // the stale legacy key is still cleaned up
    expect(window.localStorage.getItem('dvd-tivat.language')).toBeNull();
  });

  it('leaves unrelated keys untouched, including the abandoned prototype state (stays DVD-shaped)', () => {
    window.localStorage.setItem('dvd-tivat-prototip:v2', '{"demo":true}');
    window.localStorage.setItem('some-other-app.key', 'value');
    migrateLegacyStorageKeys(window.localStorage);
    expect(window.localStorage.getItem('dvd-tivat-prototip:v2')).toBe('{"demo":true}');
    expect(window.localStorage.getItem('some-other-app.key')).toBe('value');
  });

  it('does nothing and does not throw when storage is absent', () => {
    expect(() => migrateLegacyStorageKeys(null)).not.toThrow();
  });

  it('survives a storage whose writes throw, without losing the legacy value', () => {
    const throwingSetItem: Storage = {
      length: 1,
      key: () => 'dvd-tivat.language',
      getItem: (k: string) => (k === 'dvd-tivat.language' ? 'en' : null),
      setItem: () => {
        throw new DOMException('quota');
      },
      removeItem: () => {
        throw new Error('should not be reached when setItem failed');
      },
      clear: () => undefined,
    } as unknown as Storage;
    expect(() => migrateLegacyStorageKeys(throwingSetItem)).not.toThrow();
  });
});
