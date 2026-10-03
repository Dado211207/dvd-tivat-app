/**
 * P8: rename this device's operational storage keys off the `dvd-tivat.` prefix.
 *
 * The app is not DVD's alone any more, so its per-device keys should not be
 * named for one service. This copies each existing value from its old key to the
 * new one and removes the old, ONCE, on start-up - so a member who upgrades keeps
 * their acting-service choice, their alarm sound, their language and any call-out
 * draft they were part-way through. It is idempotent: a second run finds the new
 * keys already present and the old ones gone, and does nothing.
 *
 * Deliberately NOT migrated (they stay `dvd-tivat`):
 *   - `dvd-tivat-prototip:v2` and `SOCIETY_PROFILE` belong to the abandoned
 *     citizen-reporting prototype, which stays DVD-shaped by decision (plan §10).
 *
 * Every access is wrapped: `localStorage` can be absent, blocked or throw (a
 * private window, an embedded webview, disabled site data). A device whose storage
 * refuses the migration simply keeps reading nothing and starts fresh under the
 * new keys - the same graceful-empty path every accessor already tolerates - and
 * an old key is removed only after its value has been written under the new one,
 * so a mid-way failure never loses a setting.
 */

/** Old prefix -> new prefix. A prefix matches its exact key and any `:suffix`. */
const RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['dvd-tivat.callout-draft', 'boka-operativa.callout-draft'],
  ['dvd-tivat.acting-service:', 'boka-operativa.acting-service:'],
  ['dvd-tivat.alarm-sound:', 'boka-operativa.alarm-sound:'],
  ['dvd-tivat.language', 'boka-operativa.language'],
];

function deviceStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Migrate every legacy key present. `storage` is injectable for tests; production
 * uses this device's localStorage.
 */
export function migrateLegacyStorageKeys(storage: Storage | null = deviceStorage()): void {
  if (!storage) return;

  // Snapshot the keys first, through the standard length/key(i) API (robust
  // across real and test Storage): the loop writes and removes, and iterating
  // storage while mutating it is unsafe.
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null) keys.push(key);
    }
  } catch {
    return;
  }

  for (const key of keys) {
    const rename = RENAMES.find(([oldPrefix]) => key.startsWith(oldPrefix));
    if (!rename) continue;
    const [oldPrefix, newPrefix] = rename;
    const newKey = newPrefix + key.slice(oldPrefix.length);
    try {
      const value = storage.getItem(key);
      if (value === null) continue;
      // Never clobber a value already written under the new key (e.g. after a
      // previous run, or a fresh choice made since the upgrade).
      if (storage.getItem(newKey) === null) {
        storage.setItem(newKey, value);
      }
      // Only now that the value is safely under the new key.
      storage.removeItem(key);
    } catch {
      // A single key that will not move must not stop the others.
    }
  }
}
