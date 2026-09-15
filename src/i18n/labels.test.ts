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
  endSentence,
  formatClock,
  formatTime,
  formatTimeOrNotRecorded,
  formatTimeWithZone,
  forSentence,
  notRecorded,
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
    expect(formatTime('2026-09-13T16:40:00.000Z')).toBe('13.09.2026. 18:40:00');
  });

  it('renders a winter instant at UTC+1', () => {
    // The offset is not a constant, which is exactly why the zone is named
    // rather than an hour being added by hand.
    expect(formatTime('2026-01-13T16:40:00.000Z')).toBe('13.01.2026. 17:40:00');
  });

  it('crosses midnight into the correct day', () => {
    // 23:30 UTC in summer is already the next day in Podgorica. A device-local
    // rendering on a UTC machine would print the previous date here, which on
    // an archive row is a fact about a different night.
    expect(formatTime('2026-09-13T23:30:00.000Z')).toBe('14.09.2026. 01:30:00');
  });

  it('shows the clock alone in the same zone', () => {
    expect(formatClock('2026-09-13T16:40:00.000Z')).toBe('18:40:00');
  });

  it('carries seconds, so events in sequence do not look simultaneous', () => {
    // From the hosted review: a chronology to the minute showed a member
    // opening a call-out, answering it and setting off as though all three had
    // happened at the same instant. On a record of an incident, "we cannot tell
    // which came first" is a defect.
    expect(formatTime('2026-09-13T16:40:07.000Z')).toBe('13.09.2026. 18:40:07');
    expect(formatTime('2026-09-13T16:40:08.000Z')).toBe('13.09.2026. 18:40:08');
    expect(formatTime('2026-09-13T16:40:07.000Z')).not.toBe(
      formatTime('2026-09-13T16:40:08.000Z'),
    );
  });

  it('always carries the year', () => {
    // An archive is read months and years later. "13.09." cannot tell last
    // year's fire from this one's.
    expect(formatTime('2025-09-13T16:40:00.000Z')).toContain('2025');
    expect(formatTime('2026-09-13T16:40:00.000Z')).toContain('2026');
  });

  it('names the zone when a header asks for it', () => {
    expect(formatTimeWithZone('2026-09-13T16:40:00.000Z')).toBe(
      '13.09.2026. 18:40:00 (lokalno vrijeme, Crna Gora)',
    );
  });
});

describe('a time that was never recorded', () => {
  it('says so in words rather than showing a dash or a zero', () => {
    expect(formatTimeOrNotRecorded(null)).toBe(notRecorded());
    expect(formatTimeOrNotRecorded(undefined)).toBe(notRecorded());
    expect(formatTimeOrNotRecorded('')).toBe(notRecorded());
    expect(notRecorded()).toBe('Nije zabiljezeno');
  });

  it('shows a real time when there is one', () => {
    expect(formatTimeOrNotRecorded('2026-09-13T16:40:00.000Z')).toBe('13.09.2026. 18:40:00');
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

// ---------------------------------------------------------------------------

/**
 * A note somebody typed, quoted into a sentence the application writes.
 *
 * The hosted review found a chronology line ending "prototipa..": the
 * commander's closing note already carried a full stop and the sentence around
 * it added another. Both halves of the fix are here.
 *
 * The rule these two functions keep between them: **the stored text is never
 * altered.** `operational_audit` is append-only and a closing note is evidence.
 * What changes is the copy that goes on screen.
 */
describe('quoting a typed note inside a built sentence', () => {
  const REPORTED = 'Vjezba zavrsena - test operativnog prototipa.';

  it('is the exact line the review found, without the second full stop', () => {
    expect(endSentence(`je zatvorio intervenciju: ${forSentence(REPORTED)}`)).toBe(
      'je zatvorio intervenciju: Vjezba zavrsena - test operativnog prototipa.',
    );
    expect(endSentence(`je zatvorio intervenciju: ${forSentence(REPORTED)}`)).not.toContain('..');
  });

  it('leaves the stored text alone', () => {
    // `forSentence` returns a NEW string. Nothing it does can reach the row it
    // came from, and this pins that the argument is not mutated in place.
    const note = REPORTED;
    forSentence(note);
    expect(note).toBe('Vjezba zavrsena - test operativnog prototipa.');
  });

  describe('forSentence', () => {
    it.each([
      ['Zavrseno.', 'Zavrseno'],
      ['Zavrseno,', 'Zavrseno'],
      ['Zavrseno;', 'Zavrseno'],
      ['Zavrseno:', 'Zavrseno'],
      ['Zavrseno...', 'Zavrseno'],
      ['Zavrseno .  ', 'Zavrseno'],
      ['  Zavrseno  ', 'Zavrseno'],
    ])('trims %s to %s', (input, expected) => {
      expect(forSentence(input)).toBe(expected);
    });

    it('keeps a question or exclamation mark, which carry meaning', () => {
      // "Da li je oprema vracena?" is not the same sentence without its mark.
      expect(forSentence('Da li je oprema vracena?')).toBe('Da li je oprema vracena?');
      expect(forSentence('Hitno!')).toBe('Hitno!');
    });

    it('never turns an empty or whitespace note into a quotation', () => {
      // A note of "." would otherwise be quoted as an empty string, producing
      // "je zatvorio intervenciju: ." on the record.
      for (const empty of ['', '   ', '.', '. . .', null, undefined]) {
        expect(forSentence(empty)).toBeNull();
      }
    });

    it('does not touch punctuation inside the note', () => {
      expect(forSentence('Vjezba zavrsena, oprema vracena.')).toBe(
        'Vjezba zavrsena, oprema vracena',
      );
    });
  });

  describe('endSentence', () => {
    it.each([
      ['je zatvorio intervenciju', 'je zatvorio intervenciju.'],
      ['je zatvorio intervenciju.', 'je zatvorio intervenciju.'],
      ['Da li je oprema vracena?', 'Da li je oprema vracena?'],
      ['Hitno!', 'Hitno!'],
      ['Nastavlja se...', 'Nastavlja se...'],
      ['je zatvorio intervenciju  ', 'je zatvorio intervenciju.'],
    ])('closes %s as %s', (input, expected) => {
      expect(endSentence(input)).toBe(expected);
    });

    it('never produces two terminators in a row', () => {
      for (const ending of ['.', '!', '?', '…', 'bez tacke']) {
        expect(endSentence(`Tekst ${ending}`)).not.toMatch(/[.!?…]{2}$/);
      }
    });
  });
});
