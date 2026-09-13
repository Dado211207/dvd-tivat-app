/**
 * How a time is put on the screen.
 *
 * Every timestamp in this system is stored as `timestamptz` and travels as UTC.
 * The only question this module answers is what a person reads, and the answer
 * has to be the same for everybody: Europe/Podgorica, whatever timezone the
 * device happens to be set to.
 *
 * That matters more here than in most applications. The archive is a record of
 * who attended an emergency and for how long. If the same stored fact prints
 * 18:40 on the phone that was at the fire and 16:40 on a laptop reviewing it
 * afterwards, then two people reading the same record disagree about when it
 * happened, and nothing on either screen says which of them is right.
 *
 * These assertions are absolute strings on purpose. They are independent of the
 * machine running them, which is what makes them able to catch a return to
 * device-local rendering - on a UTC runner that change produces a different
 * string and fails here.
 */

import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatTime,
  formatTimeOrNotRecorded,
  formatTimeWithZone,
  NOT_RECORDED,
  SOCIETY_TIME_ZONE,
  timeZoneIsSupported,
} from './labels';

describe('times are shown in the society’s own timezone', () => {
  it('has real timezone data, so the fallback path is not what is being tested', () => {
    // `buildFormatter` returns null on a runtime without full ICU and the
    // formatters then refuse to answer. If that ever happened silently, every
    // assertion below would be testing the wrong code, so it is checked first.
    expect(timeZoneIsSupported(), `${SOCIETY_TIME_ZONE} must be available`).toBe(true);
  });

  it('renders a summer instant at UTC+2', () => {
    // 13 September is summer time in Montenegro.
    expect(formatTime('2026-09-13T16:40:00.000Z')).toBe('13.09.2026. 18:40');
  });

  it('renders a winter instant at UTC+1', () => {
    // The offset is not a constant, which is exactly why the zone is named
    // rather than an hour being added by hand.
    expect(formatTime('2026-01-13T16:40:00.000Z')).toBe('13.01.2026. 17:40');
  });

  it('crosses midnight into the correct day', () => {
    // 23:30 UTC in summer is already the next day in Podgorica. A device-local
    // rendering on a UTC machine would print the previous date here, which on
    // an archive row is a fact about a different night.
    expect(formatTime('2026-09-13T23:30:00.000Z')).toBe('14.09.2026. 01:30');
  });

  it('shows the clock alone in the same zone', () => {
    expect(formatClock('2026-09-13T16:40:00.000Z')).toBe('18:40');
  });

  it('always carries the year', () => {
    // An archive is read months and years later. "13.09." cannot tell last
    // year's fire from this one's.
    expect(formatTime('2025-09-13T16:40:00.000Z')).toContain('2025');
    expect(formatTime('2026-09-13T16:40:00.000Z')).toContain('2026');
  });

  it('names the zone when a header asks for it', () => {
    expect(formatTimeWithZone('2026-09-13T16:40:00.000Z')).toBe(
      '13.09.2026. 18:40 (lokalno vrijeme, Crna Gora)',
    );
  });
});

describe('a time that was never recorded', () => {
  it('says so in words rather than showing a dash or a zero', () => {
    expect(formatTimeOrNotRecorded(null)).toBe(NOT_RECORDED);
    expect(formatTimeOrNotRecorded(undefined)).toBe(NOT_RECORDED);
    expect(formatTimeOrNotRecorded('')).toBe(NOT_RECORDED);
    expect(NOT_RECORDED).toBe('Nije zabiljezeno');
  });

  it('shows a real time when there is one', () => {
    expect(formatTimeOrNotRecorded('2026-09-13T16:40:00.000Z')).toBe('13.09.2026. 18:40');
  });

  it('never puts a broken value on the screen', () => {
    // Whatever arrives, no reader may be shown "Invalid Date", "NaN" or the
    // word "undefined" - all three read as a system fault rather than a
    // missing fact.
    for (const bad of ['not a time', '2026-13-45T99:99:99Z', '']) {
      const shown = formatTime(bad);
      expect(shown).toBe('-');
      expect(shown).not.toMatch(/NaN|Invalid|undefined/);
    }
  });
});
