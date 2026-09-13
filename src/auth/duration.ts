/**
 * How long something took, and how that is written down.
 *
 * One module for the whole application, because a duration computed one way in
 * a detail row and another way in a total is not a rounding difference - it is
 * two contradictory claims about the same incident, printed on the same screen.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 *
 * An independent hosted review recorded an attendance interval of
 * 16:28:11.374456Z to 16:28:21.965675Z - ten and a half seconds - and the
 * archive displayed it as "1 min". The total carried the same invented minute.
 *
 * The cause was one expression in the old formatter:
 *
 *     if (hours === 0) return `${Math.max(minutes, 1)} min`;
 *
 * It was added deliberately, to stop a confirmed interval rendering as "0 min",
 * which on a board reads as "did not attend". The intent was right and the fix
 * was wrong: it turned EVERY sub-minute duration into a minute. The real
 * problem was that the formatter could not say "seconds" at all, so a minute
 * was the smallest thing it could express.
 *
 * This one can. "0 s" is now distinguishable from "no record", so nothing has
 * to be rounded up to look real.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT
 * ---------------------------------------------------------------------------
 *
 * 1. MILLISECONDS ARE THE UNIT. Every duration is carried as exact elapsed
 *    milliseconds between two server timestamps, and stays that way through
 *    every sum. Timestamps themselves are never altered.
 *
 * 2. FORMATTING HAPPENS ONCE, AT THE END. Sum first, format last. Formatting
 *    each interval and adding the results is how a set of intervals comes to
 *    disagree with its own total - three intervals of 40 seconds are two
 *    minutes, not three.
 *
 * 3. THE DISPLAY ROUNDS TO THE NEAREST SECOND, and nothing coarser. Stated
 *    plainly rather than hidden: 10.591 seconds is written "11 s". Rounding to
 *    the nearest second is the smallest honest step, and it is applied ONCE, to
 *    the already-exact total.
 *
 * 4. WHAT WAS NOT MEASURED IS NOT A ZERO. A missing timestamp gives null, and
 *    the screen says "Nije zabiljezeno". A zero-length duration is a real
 *    measurement and says "0 s".
 */

/** The one place a duration turns into words. Never a zero for "unknown". */
export const NOT_MEASURED = null;

/**
 * Exact elapsed milliseconds between two server timestamps.
 *
 * Null when either end is missing or unparseable - never 0, which would claim
 * that something took no time rather than that nobody recorded it.
 *
 * A negative result is returned as it is, not clamped. It can only come from
 * corrupt data (the database forbids `ended_at <= started_at`), and hiding it
 * behind a 0 would make a broken record look like a brief one.
 */
export function elapsedMs(from: string | null | undefined, to: string | null | undefined): number | null {
  if (from === null || from === undefined || from === '') return null;
  if (to === null || to === undefined || to === '') return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return end - start;
}

/**
 * A duration in words: "0 s", "11 s", "1 min", "1 min 1 s", "2 h 5 min 3 s".
 *
 * Seconds are dropped only when there are none left, so "1 min" means exactly
 * sixty seconds and "1 min 1 s" means sixty-one. A reader can therefore tell a
 * round number from a rounded one, which matters on a record somebody may have
 * to defend.
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 0) return `-${formatDurationMs(-ms)}`;

  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  // Under a minute is the case the old formatter could not express, and the
  // whole reason this module exists.
  if (hours === 0 && minutes === 0) return `${seconds} s`;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0) parts.push(`${seconds} s`);
  return parts.join(' ');
}

/** A duration, or an honest statement that it was never measured. */
export function formatDurationOrNotMeasured(ms: number | null): string {
  return ms === null ? 'Nije zabiljezeno' : formatDurationMs(ms);
}

/**
 * Sums exact millisecond durations.
 *
 * Trivial, and named anyway: every call site that adds durations goes through
 * it, so "sum exactly, format once" is visible in the code rather than being a
 * rule somebody has to remember. Nulls are skipped - an unmeasured interval
 * contributes nothing and must not be read as a zero-length one.
 */
export function sumMs(values: readonly (number | null)[]): number {
  let total = 0;
  for (const value of values) if (value !== null) total += value;
  return total;
}

/**
 * The gap between two events, as a duration, for a metric like
 * "publication to first opening".
 *
 * Identical to `elapsedMs` and named for what it means at the call site,
 * because `elapsedMs(publishedAt, openedAt)` reads as arithmetic and
 * `between(publishedAt, openedAt)` reads as a fact about an incident.
 */
export const between = elapsedMs;
