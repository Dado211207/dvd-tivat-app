/**
 * The duration contract, including the exact case an independent review found.
 *
 * The hosted archive displayed an attendance interval of
 * 16:28:11.374456Z - 16:28:21.965675Z as "1 min", and carried that invented
 * minute into the participation total. The first test here is that interval,
 * with its real timestamps.
 *
 * The boundary cases below are not decoration. Every one of them sat on the
 * wrong side of `Math.max(minutes, 1)` in the old formatter: zero, ten seconds,
 * fifty-nine seconds - all of them printed "1 min", which is the difference
 * between a record and a guess.
 */

import { describe, expect, it } from 'vitest';
import {
  between,
  elapsedMs,
  formatDurationMs,
  formatDurationOrNotMeasured,
  sumMs,
} from './duration';

describe('the interval the hosted review found', () => {
  const STARTED = '2026-09-13T16:28:11.374456Z';
  const ENDED = '2026-09-13T16:28:21.965675Z';

  it('is ten and a half seconds, not a minute', () => {
    const ms = elapsedMs(STARTED, ENDED);
    expect(ms).toBe(10591);
    expect(formatDurationMs(ms!)).toBe('11 s');
    expect(formatDurationMs(ms!)).not.toBe('1 min');
  });

  it('leaves the stored timestamps untouched', () => {
    // The fix is in the arithmetic and the rendering. Nothing rewrites a
    // recorded time to make it format better.
    expect(elapsedMs(STARTED, ENDED)).toBe(
      new Date(ENDED).getTime() - new Date(STARTED).getTime(),
    );
  });
});

describe('the boundaries the old formatter got wrong', () => {
  it.each([
    [0, '0 s'],
    [1_000, '1 s'],
    [10_000, '10 s'],
    [59_000, '59 s'],
    [60_000, '1 min'],
    [61_000, '1 min 1 s'],
    [119_000, '1 min 59 s'],
    [120_000, '2 min'],
    [3_599_000, '59 min 59 s'],
    [3_600_000, '1 h'],
    [3_601_000, '1 h 1 s'],
    [3_660_000, '1 h 1 min'],
    [3_661_000, '1 h 1 min 1 s'],
    [86_400_000, '24 h'],
  ])('%i ms reads as %s', (ms, expected) => {
    expect(formatDurationMs(ms)).toBe(expected);
  });

  it('never invents a minute for anything that is not one', () => {
    // Up to 59.499 seconds, which is everything that still rounds to under
    // sixty. 59.5 s onwards genuinely IS a minute to the nearest second, and
    // saying so is correct rounding rather than the old defect - the old
    // formatter printed "1 min" for ten seconds, not for fifty-nine and a half.
    for (let ms = 0; ms <= 59_499; ms += 137) {
      expect(formatDurationMs(ms), `${ms} ms`).toMatch(/^\d+ s$/);
    }
    expect(formatDurationMs(59_499)).toBe('59 s');
    expect(formatDurationMs(59_500), 'this one really is a minute').toBe('1 min');
  });

  it('says exactly sixty seconds when it says "1 min"', () => {
    // "1 min" with no seconds part must mean sixty seconds and nothing else, or
    // a reader cannot tell a round number from a rounded one.
    expect(formatDurationMs(60_000)).toBe('1 min');
    expect(formatDurationMs(60_499)).toBe('1 min');
    expect(formatDurationMs(60_500)).toBe('1 min 1 s');
  });

  it('rounds to the nearest second, once', () => {
    expect(formatDurationMs(1_400)).toBe('1 s');
    expect(formatDurationMs(1_600)).toBe('2 s');
    expect(formatDurationMs(499)).toBe('0 s');
    expect(formatDurationMs(500)).toBe('1 s');
  });
});

describe('summing before formatting, never after', () => {
  it('adds three forty-second intervals to two minutes, not three', () => {
    // The reason the contract says "sum first, format last". Formatted
    // individually and added, these would be three minutes.
    const intervals = [40_000, 40_000, 40_000];
    expect(sumMs(intervals)).toBe(120_000);
    expect(formatDurationMs(sumMs(intervals))).toBe('2 min');
  });

  it('keeps a total that no individual rounding would produce', () => {
    // 29.6 + 29.6 + 29.6 = 88.8 seconds. Rounded individually: 30+30+30 = 90.
    // Summed exactly and rounded once: 89.
    const intervals = [29_600, 29_600, 29_600];
    expect(formatDurationMs(sumMs(intervals))).toBe('1 min 29 s');
  });

  it('skips unmeasured intervals rather than counting them as zero', () => {
    // A null is "nobody recorded this", not "this took no time". Both
    // contribute nothing to the sum, but only one of them is allowed to make
    // the total look complete.
    expect(sumMs([10_000, null, 20_000])).toBe(30_000);
    expect(sumMs([null, null])).toBe(0);
    expect(sumMs([])).toBe(0);
  });
});

describe('what was never measured', () => {
  it.each([
    [null, '2026-09-13T10:00:00Z'],
    ['2026-09-13T10:00:00Z', null],
    [undefined, undefined],
    ['', '2026-09-13T10:00:00Z'],
    ['not a time', '2026-09-13T10:00:00Z'],
    ['2026-09-13T10:00:00Z', 'not a time'],
  ])('gives null for (%s, %s), never a zero', (from, to) => {
    expect(elapsedMs(from, to)).toBeNull();
  });

  it('says so in words rather than showing 0 s', () => {
    expect(formatDurationOrNotMeasured(null)).toBe('Nije zabiljezeno');
    expect(formatDurationOrNotMeasured(0)).toBe('0 s');
  });

  it('keeps a zero-length measurement distinguishable from a missing one', () => {
    // This is the distinction the old `Math.max(1, ...)` destroyed in the
    // other direction, by making a real short interval unrepresentable.
    expect(formatDurationOrNotMeasured(elapsedMs('2026-09-13T10:00:00Z', '2026-09-13T10:00:00Z')))
      .toBe('0 s');
    expect(formatDurationOrNotMeasured(elapsedMs('2026-09-13T10:00:00Z', null)))
      .toBe('Nije zabiljezeno');
  });
});

describe('times that cross something', () => {
  it('measures across midnight', () => {
    // Twenty minutes that happen to span a date boundary is still twenty
    // minutes. Nothing here reads a calendar.
    const ms = between('2026-09-13T23:50:00Z', '2026-09-14T00:10:00Z');
    expect(ms).toBe(20 * 60_000);
    expect(formatDurationMs(ms!)).toBe('20 min');
  });

  it('measures across the start of summer time in Podgorica', () => {
    // 2026-03-29 01:00 UTC is when Montenegro moves from +1 to +2. The wall
    // clock jumps an hour; the elapsed time does not. Anything computed from
    // formatted local strings would report two hours here - which is why
    // durations are computed from the instants and never from the display.
    const ms = between('2026-03-29T00:50:00Z', '2026-03-29T01:10:00Z');
    expect(ms).toBe(20 * 60_000);
    expect(formatDurationMs(ms!)).toBe('20 min');
  });

  it('measures across the end of summer time in Podgorica', () => {
    // 2026-10-25 01:00 UTC, +2 back to +1. The wall clock repeats an hour.
    const ms = between('2026-10-25T00:50:00Z', '2026-10-25T01:10:00Z');
    expect(ms).toBe(20 * 60_000);
    expect(formatDurationMs(ms!)).toBe('20 min');
  });

  it('measures a full hour across the DST boundary as one hour', () => {
    const ms = between('2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z');
    expect(formatDurationMs(ms!)).toBe('1 h');
  });
});

describe('a duration that cannot be true', () => {
  it('shows a negative rather than hiding it as zero', () => {
    // The database forbids `ended_at <= started_at`, so this can only be
    // corrupt data. A 0 would make a broken record look like a brief one.
    const ms = between('2026-09-13T10:10:00Z', '2026-09-13T10:00:00Z');
    expect(ms).toBe(-600_000);
    expect(formatDurationMs(ms!)).toBe('-10 min');
  });

  it('does not crash on an infinite or NaN duration', () => {
    expect(formatDurationMs(Number.NaN)).toBe('-');
    expect(formatDurationMs(Number.POSITIVE_INFINITY)).toBe('-');
  });
});
