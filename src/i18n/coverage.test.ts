/**
 * Every value the database can hold has a sentence a person can read.
 *
 * The screens are written as `LABEL[value] ?? value`, so a missing label does
 * not crash - it prints the database's own spelling. `NA_LICU_MJESTA` on a
 * board at three in the morning is not an error anybody would notice as one,
 * and that is exactly why it needs a test rather than a fallback.
 *
 * The event types are read out of the MIGRATIONS rather than listed here. A
 * list transcribed by hand agrees with itself forever; reading the source means
 * a new event type added to a command has to be given a sentence before this
 * suite goes green again.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INTERVENTION_KINDS,
  INTERVENTION_STATUSES,
  JOURNEY_STEPS,
  RESPONSE_ANSWERS,
} from '@/auth/operations';
import { LANGUAGES } from './language';
import { textFor } from './useText';

/**
 * Every assertion below runs once per language.
 *
 * A second language is a second chance to print `NA_LICU_MJESTA` on a board at
 * three in the morning, and an English translation that quietly omitted a
 * status would fail in exactly the same invisible way the Montenegrin one used
 * to. The `Strings` type forces the KEYS to exist; this forces the values to be
 * sentences a person can read.
 */
const VOCABULARIES = LANGUAGES.map((language) => [language, textFor(language).vocabulary] as const);

/** SHOUTY_SNAKE_CASE - what the database calls things, never what a person reads. */
const LOOKS_LIKE_AN_ENUM = /^[A-Z][A-Z0-9_]*$/;

function assertReadable(label: string | undefined, value: string): void {
  expect(label, `${value} has no label`).toBeDefined();
  expect(label, `${value} is labelled with its own database spelling`).not.toMatch(
    LOOKS_LIKE_AN_ENUM,
  );
  expect(label?.trim(), `${value} has an empty label`).not.toBe('');
}

describe.each(VOCABULARIES)('every vocabulary the database enforces (%s)', (_language, words) => {
  it.each([...INTERVENTION_KINDS])('kind %s reads as words', (kind) => {
    assertReadable(words.interventionKind[kind], kind);
  });

  it.each([...INTERVENTION_STATUSES])('status %s reads as words', (status) => {
    assertReadable(words.interventionStatus[status], status);
  });

  it.each([...RESPONSE_ANSWERS])('answer %s reads as words', (answer) => {
    assertReadable(words.answer[answer], answer);
  });

  it.each([...JOURNEY_STEPS])('journey step %s reads as words', (step) => {
    assertReadable(words.journey[step], step);
  });

  it.each(['SELF_DECLARED', 'COMMAND_RECORDED', 'UNKNOWN'])(
    'attendance source %s reads as words',
    (source) => {
      assertReadable(words.attendanceSource[source], source);
    },
  );

  it.each(['PENDING', 'CONFIRMED', 'REJECTED'])('attendance state %s reads as words', (state) => {
    assertReadable(words.attendanceState[state], state);
  });

  it.each(['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER', 'CITIZEN'])(
    'role %s reads as words',
    (role) => {
      assertReadable(words.role[role], role);
    },
  );
});

describe.each(VOCABULARIES)('every event a command can record (%s)', (language, words) => {
  /** Read from the migrations, so a new event type cannot slip past unlabelled. */
  const recorded = (() => {
    const dir = resolve(process.cwd(), 'supabase/migrations');
    const found = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(resolve(dir, file), 'utf8');
      for (const match of sql.matchAll(
        /insert into public\.operational_audit[\s\S]{0,400}?values\s*\(([\s\S]{0,400}?)\)\s*;/g,
      )) {
        // One audit write chooses its type with `case when requested_status =
        // 'CLOSED' then 'INTERVENTION_CLOSED' else ...`. The operand of that
        // comparison is a STATUS, not an event type, so comparisons are
        // stripped before the literals are read. Narrowing the pattern to the
        // current naming convention instead would quietly stop noticing a
        // future event type that did not follow it.
        const values = (match[1] ?? '').replace(/(=|<>|!=)\s*'[^']*'/g, '');
        for (const literal of values.matchAll(/'([A-Z][A-Z0-9_]{4,})'/g)) {
          found.add(literal[1] as string);
        }
      }
    }
    return [...found].sort();
  })();

  it('found the event types in the migrations at all', () => {
    // Without this the table below becomes a loop over an empty list, and the
    // whole file passes while proving nothing.
    expect(recorded.length, 'the parser must find the audit writes').toBeGreaterThanOrEqual(10);
    expect(recorded).toContain('INTERVENTION_STATUS_CHANGED');
    expect(recorded).toContain('JOURNEY_PROGRESS_SET');
  });

  it('gives each one a sentence', () => {
    const missing = recorded.filter((type) => words.auditEvent[type] === undefined);
    expect(missing, 'an unlabelled event prints its database spelling in the archive').toEqual([]);
  });

  it('never labels one with its own database spelling', () => {
    for (const [type, label] of Object.entries(words.auditEvent)) {
      expect(label, type).not.toMatch(LOOKS_LIKE_AN_ENUM);
      expect(label.trim(), type).not.toBe('');
    }
  });

  it('never claims anybody was notified', () => {
    // Publishing writes obligations to send. Nothing sends them, and no
    // sentence in the chronology may imply otherwise.
    for (const label of Object.values(words.auditEvent)) {
      expect(label, label).not.toMatch(/obavijest|poslao poruk|poslat[ao]/i);
      expect(label, label).not.toMatch(/\bnotif|\balert(ed|s)?\b|\bpaged\b/i);
    }
  });

  it('never describes a movement as attendance', () => {
    // Reporting a position and being present are different facts, and the
    // archive is the place where blurring them would do the most damage.
    const movement = words.auditEvent.JOURNEY_PROGRESS_SET as string;
    expect(movement, language).not.toMatch(/prisus/i);
    expect(movement, language).not.toMatch(/attend|present\b/i);
  });
});

describe.each(VOCABULARIES)('the words themselves (%s)', (language, words) => {
  const EVERY_LABEL = Object.values(words).flatMap((entry) =>
    typeof entry === 'string' ? [entry] : Object.values(entry),
  );

  it('found labels to check at all', () => {
    expect(EVERY_LABEL.length).toBeGreaterThan(30);
  });

  it('carries no diacritics in the local language, per the brief', () => {
    // English is not held to this: it has none to avoid. The rule exists
    // because this interface writes Montenegrin in plain Latin letters.
    if (language !== 'me') return;
    for (const label of EVERY_LABEL) {
      expect(label, label).not.toMatch(/[čćžšđČĆŽŠĐ]/);
    }
  });

  it('uses no developer vocabulary', () => {
    for (const label of EVERY_LABEL) {
      expect(label, label).not.toMatch(
        /\b(null|undefined|NaN|RPC|SQL|API|JSON|UUID|payload|timestamp|enum|record id)\b/i,
      );
    }
  });

  it('never shows a database error code', () => {
    for (const label of EVERY_LABEL) {
      expect(label, label).not.toMatch(/\b(PGRST\w*|[0-9A-Z]{5}|23505|42501)\b/);
    }
  });
});
