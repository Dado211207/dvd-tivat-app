/**
 * Every time this application prints, in the society's own time zone.
 *
 * ---------------------------------------------------------------------------
 * THE ZONE IS FIXED. THE LANGUAGE IS NOT.
 * ---------------------------------------------------------------------------
 *
 * Every timestamp is stored `timestamptz` and travels as UTC. It is displayed
 * in EUROPE/PODGORICA, always - never in the time zone of the device doing the
 * reading, and never in one chosen by the language setting.
 *
 * That distinction is not pedantry, and it is the one thing "locale-aware
 * formatting" must not be allowed to break. The record answers "when did this
 * happen", and the answer has to be the same instant for everybody: a commander
 * reviewing an intervention from abroad, a laptop whose clock region was never
 * set, and the phone that was at the fire. A device-local rendering makes one
 * stored fact print three different times, with nothing on the screen to say
 * which to believe.
 *
 * Montenegro observes summer time, so the offset is +1 or +2 depending on the
 * date. The IANA database knows this and we do not, which is why the zone is
 * named rather than an offset being added by hand.
 *
 * What DOES follow the language is how the same instant is written down:
 * `13.09.2026. 18:40:21` reading in Crnogorski, `13/09/2026 18:40:21` reading in
 * English, and the words around it. Different sentence, same moment.
 */

import { activeLanguage, LANGUAGE_TAG, type Language } from './language';

export const SOCIETY_TIME_ZONE = 'Europe/Podgorica';

/** What an unrecorded fact says. Never a zero, a dash, or a guessed value. */
const NOT_RECORDED_TEXT: Record<Language, string> = {
  me: 'Nije zabiljezeno',
  en: 'Not recorded',
};

/** Named so a reader knows the instant is not theirs to reinterpret. */
const ZONE_NOTE: Record<Language, string> = {
  me: 'lokalno vrijeme, Crna Gora',
  en: 'local time, Montenegro',
};

/** The separator between day, month and year, and whether a year ends in a dot. */
const DATE_STYLE: Record<Language, { separator: string; trailingDot: boolean }> = {
  // `13.09.2026.` - the trailing dot is part of how a date is written here, not
  // a typing mistake.
  me: { separator: '.', trailingDot: true },
  en: { separator: '/', trailingDot: false },
};

export const NOT_RECORDED_FOR_TESTS = NOT_RECORDED_TEXT;

/**
 * Builds a formatter, or null if the runtime has no time zone data.
 *
 * A runtime built without full ICU throws on a named zone. Falling back to
 * device-local time would then be silently wrong, so this reports the failure to
 * its callers instead of hiding it, and `timeZoneIsSupported()` lets a test
 * assert the real path is the one in use.
 */
function buildFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null {
  try {
    // Formatted from the numeric parts below, so the tag only has to produce a
    // Gregorian calendar and Latin digits, which every supported locale does.
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: SOCIETY_TIME_ZONE });
  } catch {
    return null;
  }
}

const DATE_AND_TIME = buildFormatter({
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const TIME_ONLY = buildFormatter({
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** True when times really are being rendered in Podgorica rather than fallback. */
export function timeZoneIsSupported(): boolean {
  return DATE_AND_TIME !== null && TIME_ONLY !== null;
}

interface ZonedParts {
  readonly day: string;
  readonly month: string;
  readonly year: string;
  readonly hour: string;
  readonly minute: string;
  readonly second: string;
}

/**
 * Null for an unusable timestamp or an unusable runtime. Also null if any
 * expected piece is missing, rather than composing "undefined.09.2026." out of
 * whatever did arrive - a visibly absent time is recoverable, a malformed one
 * that looks like data is not.
 */
function zonedParts(formatter: Intl.DateTimeFormat | null, iso: string): ZonedParts | null {
  if (formatter === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) found[part.type] = part.value;

  const { day = '', month = '', year = '', hour = '', minute = '', second = '' } = found;
  if (hour === '' || minute === '' || second === '') return null;
  return { day, month, year, hour, minute, second };
}

/** What an unrecorded fact says, in the language now in force. */
export function notRecorded(): string {
  return NOT_RECORDED_TEXT[activeLanguage()];
}

/**
 * A full date and time in Podgorica, written the way the chosen language writes
 * one: "13.09.2026. 18:40:21" or "13/09/2026 18:40:21".
 *
 * The year is present on purpose. An archive is read months and years later,
 * and "13.09." alone cannot tell last year's fire from this one's.
 *
 * SECONDS ARE PRESENT for the same reason, and were added after an independent
 * review of the hosted application: a chronology to the minute showed several
 * events that had clearly happened in sequence - a member opening a call-out,
 * answering it, and setting off - as though they had happened at the same
 * instant. On a record of an incident, "we cannot tell which came first" is a
 * defect, not a detail.
 *
 * Nothing computes a duration from this string. Every duration in the
 * application is elapsed milliseconds between two server timestamps; see
 * `src/auth/duration.ts`.
 */
export function formatTime(iso: string): string {
  const parts = zonedParts(DATE_AND_TIME, iso);
  if (parts === null) return '-';
  const style = DATE_STYLE[activeLanguage()];
  const date = [parts.day, parts.month, parts.year].join(style.separator) + (style.trailingDot ? '.' : '');
  return `${date} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** The full date and time with the zone named, for a record header. */
export function formatTimeWithZone(iso: string): string {
  const shown = formatTime(iso);
  return shown === '-' ? shown : `${shown} (${ZONE_NOTE[activeLanguage()]})`;
}

/** Just the clock, in Podgorica: "18:40:21". For rows already dated by context. */
export function formatClock(iso: string): string {
  const parts = zonedParts(TIME_ONLY, iso);
  if (parts === null) return '-';
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * A time, or an honest statement that there isn't one.
 *
 * Use this wherever the timestamp may legitimately be absent. Printing a dash
 * or falling back to a different column would both read as an answer.
 */
export function formatTimeOrNotRecorded(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return notRecorded();
  return formatTime(iso);
}

/** A whole number written the way the chosen language writes one. */
export function formatCount(value: number): string {
  try {
    return new Intl.NumberFormat(LANGUAGE_TAG[activeLanguage()]).format(value);
  } catch {
    return String(value);
  }
}
