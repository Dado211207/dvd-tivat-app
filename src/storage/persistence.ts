/**
 * localStorage persistence for the prototype.
 *
 * What the user must understand, and what the interface says out loud:
 * this data belongs to THIS browser on THIS device. Nothing is synchronised.
 * A second device shows a different, unrelated state, and clearing browser data
 * deletes it. That is a property of a local demonstration, not a defect - but
 * silence about it would let a demonstration imply a shared system.
 *
 * Every failure below is real in practice: private browsing modes, blocked site
 * data, an embedded frame, a full quota, or data written by an older build.
 */

import { createSeedState } from '@/domain/seed';
import { SCHEMA_VERSION, type AppState } from '@/domain/types';

export const STORAGE_KEY = 'dvd-tivat-prototip:v1';

export type LoadStatus =
  | 'UCITANO'
  | 'PRVO_POKRETANJE'
  | 'NEDOSTUPNO'
  | 'SAMO_CITANJE'
  | 'OSTECENI_PODACI'
  | 'NEPOZNATA_VERZIJA';

export interface LoadResult {
  state: AppState;
  status: LoadStatus;
  /** Local-language warning to show, when there is something to warn about. */
  warning: string | null;
}

const WARNINGS: Record<LoadStatus, string | null> = {
  UCITANO: null,
  PRVO_POKRETANJE: null,
  NEDOSTUPNO:
    'Ovaj pregledac ne dozvoljava cuvanje podataka. Prototip radi, ali ce se podaci izgubiti pri osvjezavanju stranice.',
  SAMO_CITANJE:
    'Sacuvani probni podaci su ucitani, ali izmjene trenutno nije moguce cuvati. Nove promjene ce se izgubiti pri osvjezavanju stranice.',
  OSTECENI_PODACI:
    'Sacuvani probni podaci nisu citljivi i vraceni su na pocetno stanje. Nista nije poslato niti izgubljeno izvan ovog pregledaca.',
  NEPOZNATA_VERZIJA:
    'Sacuvani podaci su iz druge verzije prototipa i nisu ucitani. Prikazano je pocetno stanje.',
};

/**
 * Reaching localStorage at all can throw - a sandboxed frame, or a browser set
 * to block site data. This only obtains the reference; it does not write.
 */
function storageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether this browser will accept a write. Costs one write, so it runs once at
 * start-up rather than on every save - and saveState reports its own failures
 * from the real write, which is what distinguishes a full quota from a browser
 * that refuses storage outright.
 */
function storageAcceptsWrites(storage: Storage): boolean {
  // Stay inside this prototype's namespace, and restore any value already at
  // the probe key. A generic fixed key can belong to another application on
  // the same origin; overwriting and deleting it would corrupt unrelated data.
  const probe = `${STORAGE_KEY}:write-probe`;
  let previous: string | null = null;
  let previousRead = false;
  try {
    previous = storage.getItem(probe);
    previousRead = true;
    storage.setItem(probe, '1');
    if (previous === null) storage.removeItem(probe);
    else storage.setItem(probe, previous);
    return true;
  } catch {
    // A backend may mutate and then throw. Best-effort restoration prevents a
    // failed capability check from becoming a destructive write of its own.
    if (previousRead) {
      try {
        if (previous === null) storage.removeItem(probe);
        else storage.setItem(probe, previous);
      } catch {
        // The caller will report storage as unavailable; no stronger claim is
        // possible when the browser also refuses the restoration.
      }
    }
    return false;
  }
}

export function loadState(): LoadResult {
  const storage = storageOrNull();
  if (!storage) {
    return { state: createSeedState(), status: 'NEDOSTUPNO', warning: WARNINGS.NEDOSTUPNO };
  }
  // A full quota can still allow reads. Never replace readable saved work
  // with the seed just because a new write would be refused.
  const writable = storageAcceptsWrites(storage);

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    // Access can be revoked between the capability probe and the real read.
    // Starting with the fictional seed plus a visible warning is safer than
    // crashing the entire prototype during React initialisation.
    return { state: createSeedState(), status: 'NEDOSTUPNO', warning: WARNINGS.NEDOSTUPNO };
  }
  if (raw === null) {
    return writable
      ? { state: createSeedState(), status: 'PRVO_POKRETANJE', warning: null }
      : { state: createSeedState(), status: 'NEDOSTUPNO', warning: WARNINGS.NEDOSTUPNO };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      state: createSeedState(),
      status: 'OSTECENI_PODACI',
      warning: WARNINGS.OSTECENI_PODACI,
    };
  }

  if (!isPlausibleBaseState(parsed)) {
    return {
      state: createSeedState(),
      status: 'OSTECENI_PODACI',
      warning: WARNINGS.OSTECENI_PODACI,
    };
  }

  // The only known migration is explicit and lossless: schema 1 predates the
  // citizen-report inbox, so it gains an empty array and nothing else changes.
  // Unknown versions are still refused below rather than guessed at.
  if (parsed.schemaVersion === 1 && !('citizenReports' in parsed)) {
    const migrated: AppState = {
      ...(parsed as Omit<AppState, 'schemaVersion' | 'citizenReports'>),
      schemaVersion: SCHEMA_VERSION,
      citizenReports: [],
    };
    if (!writable) {
      return {
        state: migrated,
        status: 'SAMO_CITANJE',
        warning: WARNINGS.SAMO_CITANJE,
      };
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return { state: migrated, status: 'UCITANO', warning: null };
    } catch {
      return {
        state: migrated,
        status: 'SAMO_CITANJE',
        warning: WARNINGS.SAMO_CITANJE,
      };
    }
  }

  // No silent migration. Guessing at the shape of data from another build is
  // how a demonstration ends up showing something that was never true.
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    return {
      state: createSeedState(),
      status: 'NEPOZNATA_VERZIJA',
      warning: WARNINGS.NEPOZNATA_VERZIJA,
    };
  }
  if (!isCurrentState(parsed)) {
    return {
      state: createSeedState(),
      status: 'OSTECENI_PODACI',
      warning: WARNINGS.OSTECENI_PODACI,
    };
  }

  return writable
    ? { state: parsed, status: 'UCITANO', warning: null }
    : { state: parsed, status: 'SAMO_CITANJE', warning: WARNINGS.SAMO_CITANJE };
}

export type SaveResult = { ok: true } | { ok: false; warning: string };

const SAVE_FAILED =
  'Promjena nije sacuvana u ovom pregledacu (nema prostora ili je cuvanje blokirano). Prototip radi dalje, ali podaci nece preziviti osvjezavanje stranice.';

export function saveState(state: AppState): SaveResult {
  const storage = storageOrNull();
  if (!storage) return { ok: false, warning: WARNINGS.NEDOSTUPNO as string };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch {
    // Quota exceeded, or storage revoked mid-session. The in-memory state stays
    // usable; only persistence is lost, and the user is told so.
    return { ok: false, warning: SAVE_FAILED };
  }
}

/** Removes ONLY this prototype's own key. Nothing else in the browser is touched. */
export function clearStoredState(): void {
  const storage = storageOrNull();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do; the caller resets in-memory state regardless.
  }
}

/**
 * A structural check, not a full schema validation. Enough to tell stored state
 * from unrelated JSON without pretending to guarantee its contents.
 */
type PlausibleBaseState = Omit<AppState, 'citizenReports'> & { citizenReports?: unknown };

function isPlausibleBaseState(value: unknown): value is PlausibleBaseState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const arrays = [
    'members',
    'groups',
    'vehicles',
    'exercises',
    'calls',
    'deliveryAttempts',
    'responses',
    'vehicleMovements',
    'activity',
    'appliedCommandIds',
  ];
  if (!arrays.every((key) => Array.isArray(candidate[key]))) return false;
  if (typeof candidate.schemaVersion !== 'number') return false;
  const simulation = candidate.simulation as Record<string, unknown> | undefined;
  return (
    typeof simulation === 'object' &&
    simulation !== null &&
    typeof simulation.actorId === 'string' &&
    typeof simulation.viewRole === 'string'
  );
}

function isCurrentState(value: PlausibleBaseState): value is AppState {
  return Array.isArray(value.citizenReports);
}
