/** Client-side guidance only. The database repeats every rule authoritatively. */

export interface RequiredProfile {
  readonly fullName: string;
  readonly phone: string;
  readonly dateOfBirth: string;
}

/** Accept the local Montenegro form or an explicit international number. */
export function normalizeProfilePhone(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || !/^[0-9+(). /-]+$/.test(trimmed)) return null;
  let compact = trimmed.replace(/[\s()./-]/g, '');
  if (compact.startsWith('00')) compact = `+${compact.slice(2)}`;
  else if (compact.startsWith('+')) {
    // Already international.
  } else if (compact.startsWith('0')) compact = `+382${compact.slice(1)}`;
  else if (compact.startsWith('382')) compact = `+${compact}`;
  else return null;
  return /^\+[1-9][0-9]{7,14}$/.test(compact) ? compact : null;
}

export function localTodayIso(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isValidProfileBirthDate(value: string, today = localTodayIso()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) return false;
  return value >= '1900-01-01' && value <= today;
}
