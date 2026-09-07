/**
 * Storage failures are not edge cases: private browsing, blocked site data, a
 * full quota and stale data from an older build all happen on real devices.
 * The prototype must keep working and must say what went wrong.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedState } from '@/domain/seed';
import { SCHEMA_VERSION } from '@/domain/types';
import { clearStoredState, loadState, saveState, STORAGE_KEY } from './persistence';

/** A minimal in-memory Storage that can be told to misbehave. */
function fakeStorage(options: { failRead?: boolean; failWrite?: boolean } = {}) {
  const data = new Map<string, string>();
  return {
    store: {
      getItem: (key: string) => {
        if (options.failRead) throw new DOMException('SecurityError');
        return data.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (options.failWrite) throw new DOMException('QuotaExceededError');
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    } as Storage,
    data,
  };
}

function install(storage: Storage | null) {
  if (storage === null) {
    // A browser that has localStorage but throws on any access.
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('SecurityError');
      },
    });
    return;
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
}

let original: PropertyDescriptor | undefined;

beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(window, 'localStorage');
});

afterEach(() => {
  if (original) Object.defineProperty(window, 'localStorage', original);
  vi.restoreAllMocks();
});

describe('loading', () => {
  it('starts from the fictional seed on a first run, without warning', () => {
    install(fakeStorage().store);
    const result = loadState();
    expect(result.status).toBe('PRVO_POKRETANJE');
    expect(result.warning).toBeNull();
    expect(result.state.members.length).toBeGreaterThan(0);
  });

  it('reads back what was written', () => {
    const { store } = fakeStorage();
    install(store);

    const state = createSeedState();
    expect(saveState(state).ok).toBe(true);

    const loaded = loadState();
    expect(loaded.status).toBe('UCITANO');
    expect(loaded.state.members).toHaveLength(state.members.length);
  });

  it('warns and falls back to the seed when storage is unavailable', () => {
    install(null);
    const result = loadState();
    expect(result.status).toBe('NEDOSTUPNO');
    expect(result.warning).toMatch(/ne dozvoljava cuvanje/i);
    expect(result.state.members.length).toBeGreaterThan(0);
  });

  it('warns instead of crashing when reading storage is refused after access succeeds', () => {
    install(fakeStorage({ failRead: true }).store);

    expect(() => loadState()).not.toThrow();
    const result = loadState();
    expect(result.status).toBe('NEDOSTUPNO');
    expect(result.warning).toMatch(/ne dozvoljava cuvanje/i);
  });

  it('does not overwrite or delete an unrelated application write probe', () => {
    const { store, data } = fakeStorage();
    install(store);
    store.setItem('__dvd_tivat_probe__', 'belongs-to-another-application');
    store.setItem(`${STORAGE_KEY}:write-probe`, 'pre-existing-value');

    loadState();

    expect(data.get('__dvd_tivat_probe__')).toBe('belongs-to-another-application');
    expect(data.get(`${STORAGE_KEY}:write-probe`)).toBe('pre-existing-value');
  });

  it('falls back to the seed on unparseable data instead of crashing', () => {
    const { store } = fakeStorage();
    install(store);
    store.setItem(STORAGE_KEY, '{not json');

    const result = loadState();
    expect(result.status).toBe('OSTECENI_PODACI');
    expect(result.warning).not.toBeNull();
  });

  it('rejects JSON that is not a stored state', () => {
    const { store } = fakeStorage();
    install(store);
    store.setItem(STORAGE_KEY, JSON.stringify({ hello: 'world' }));

    expect(loadState().status).toBe('OSTECENI_PODACI');
  });

  it('refuses to guess at data from another schema version', () => {
    const { store } = fakeStorage();
    install(store);
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...createSeedState(), schemaVersion: SCHEMA_VERSION + 1 }),
    );

    const result = loadState();
    expect(result.status).toBe('NEPOZNATA_VERZIJA');
    expect(result.state.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('saving', () => {
  it('reports a failure rather than losing it silently', () => {
    install(fakeStorage({ failWrite: true }).store);
    const result = saveState(createSeedState());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.warning).toMatch(/nije sacuvana/i);
  });

  it('reports a failure when storage cannot be reached at all', () => {
    install(null);
    expect(saveState(createSeedState()).ok).toBe(false);
  });
});

describe('reset', () => {
  it('removes only this prototype key and nothing else in the browser', () => {
    const { store, data } = fakeStorage();
    install(store);

    store.setItem('nesto-drugo', 'ostaje');
    saveState(createSeedState());
    expect(data.has(STORAGE_KEY)).toBe(true);

    clearStoredState();

    expect(data.has(STORAGE_KEY)).toBe(false);
    expect(data.get('nesto-drugo')).toBe('ostaje');
  });

  it('does not throw when storage is unavailable', () => {
    install(null);
    expect(() => clearStoredState()).not.toThrow();
  });
});
