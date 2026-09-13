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
import {
  ATTENDANCE_SOURCE_LABEL,
  ATTENDANCE_STATE_LABEL,
  AUDIT_EVENT_LABEL,
  INTERVENTION_KIND_LABEL,
  INTERVENTION_STATUS_LABEL,
  JOURNEY_LABEL,
  SERVER_ANSWER_LABEL,
} from './labels';

/** SHOUTY_SNAKE_CASE - what the database calls things, never what a person reads. */
const LOOKS_LIKE_AN_ENUM = /^[A-Z][A-Z0-9_]*$/;

function assertReadable(label: string | undefined, value: string): void {
  expect(label, `${value} has no label`).toBeDefined();
  expect(label, `${value} is labelled with its own database spelling`).not.toMatch(
    LOOKS_LIKE_AN_ENUM,
  );
  expect(label?.trim(), `${value} has an empty label`).not.toBe('');
}

describe('every vocabulary the database enforces', () => {
  it.each([...INTERVENTION_KINDS])('kind %s reads as words', (kind) => {
    assertReadable(INTERVENTION_KIND_LABEL[kind], kind);
  });

  it.each([...INTERVENTION_STATUSES])('status %s reads as words', (status) => {
    assertReadable(INTERVENTION_STATUS_LABEL[status], status);
  });

  it.each([...RESPONSE_ANSWERS])('answer %s reads as words', (answer) => {
    assertReadable(SERVER_ANSWER_LABEL[answer], answer);
  });

  it.each([...JOURNEY_STEPS])('journey step %s reads as words', (step) => {
    assertReadable(JOURNEY_LABEL[step], step);
  });

  it.each(['SELF_DECLARED', 'COMMAND_RECORDED', 'UNKNOWN'])(
    'attendance source %s reads as words',
    (source) => {
      assertReadable(ATTENDANCE_SOURCE_LABEL[source], source);
    },
  );

  it.each(['PENDING', 'CONFIRMED', 'REJECTED'])('attendance state %s reads as words', (state) => {
    assertReadable(ATTENDANCE_STATE_LABEL[state], state);
  });
});

describe('every event a command can record', () => {
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
    const missing = recorded.filter((type) => AUDIT_EVENT_LABEL[type] === undefined);
    expect(missing, 'an unlabelled event prints its database spelling in the archive').toEqual([]);
  });

  it('never labels one with its own database spelling', () => {
    for (const [type, label] of Object.entries(AUDIT_EVENT_LABEL)) {
      expect(label, type).not.toMatch(LOOKS_LIKE_AN_ENUM);
      expect(label.trim(), type).not.toBe('');
    }
  });

  it('never claims anybody was notified', () => {
    // Publishing writes obligations to send. Nothing sends them, and no
    // sentence in the chronology may imply otherwise.
    for (const label of Object.values(AUDIT_EVENT_LABEL)) {
      expect(label).not.toMatch(/obavijest|poslao poruk|poslat[ao]/i);
    }
  });

  it('never describes a movement as attendance', () => {
    // Reporting a position and being present are different facts, and the
    // archive is the place where blurring them would do the most damage.
    expect(AUDIT_EVENT_LABEL.JOURNEY_PROGRESS_SET).not.toMatch(/prisus/i);
  });
});

describe('the words themselves', () => {
  const EVERY_LABEL = [
    ...Object.values(INTERVENTION_KIND_LABEL),
    ...Object.values(INTERVENTION_STATUS_LABEL),
    ...Object.values(SERVER_ANSWER_LABEL),
    ...Object.values(JOURNEY_LABEL),
    ...Object.values(ATTENDANCE_SOURCE_LABEL),
    ...Object.values(ATTENDANCE_STATE_LABEL),
    ...Object.values(AUDIT_EVENT_LABEL),
  ];

  it('carries no diacritics, per the brief', () => {
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
