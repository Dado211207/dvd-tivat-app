/**
 * The client's reads and commands must name things the database actually has.
 *
 * This is the one class of defect the rest of the suite cannot see. The unit
 * tests exercise pure functions; the browser tests run against a build with no
 * project configured, so every request is skipped. A misspelled column or a
 * renamed function argument therefore compiles, lints, and passes 240 tests -
 * and then returns HTTP 400 the first time somebody opens the screen.
 *
 * It was not hypothetical. Writing this check found two live faults on the two
 * most important screens in the application:
 *
 *   `intervention_acknowledgements.acknowledged_at`  - the column is `opened_at`
 *   `intervention_responses.created_at`              - the column is `responded_at`
 *
 * Both sat on the commander's overview and the firefighter's call-out screen.
 *
 * How it works: the migrated schema is the authority - real `information_schema`
 * and `pg_proc` rows, not a transcription of them. Only the TypeScript side is
 * parsed, and only in the narrow, consistent shapes the data layer is written
 * in. If a future call site is written differently enough that the parser
 * cannot see it, the count assertions at the end fail rather than the check
 * silently covering less than its name claims.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, resetSchema } from './harness';

/**
 * Every module allowed to talk to PostgREST. A new one must be listed here.
 *
 * Keep it in step with `grep -rl '\.from(' src/`: a module left off this list
 * is not checked at all, which is the failure mode the count assertions at the
 * bottom of this file exist to catch.
 */
const DATA_LAYER = [
  'src/auth/operations.ts',
  'src/auth/roster.ts',
  'src/auth/directory.ts',
  'src/auth/supabaseClient.ts',
];

interface SelectSite {
  readonly file: string;
  readonly table: string;
  readonly columns: readonly string[];
}

interface RpcSite {
  readonly file: string;
  readonly name: string;
  readonly args: readonly string[];
}

/** Matching `(`/`)` or `{`/`}` from an opening position. */
function balanced(text: string, start: number, open: string, close: string): string | null {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start + 1, i);
    }
  }
  return null;
}

/**
 * Split a PostgREST select list on its TOP-LEVEL commas, keeping an embedded
 * resource whole: `intervention_id, interventions(status, title)` becomes
 * `['intervention_id', 'interventions(status, title)']`, not four fragments. A
 * naive `split(',')` would tear the embed's own column list apart.
 */
function splitSelectList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function readDataLayer(): { selects: SelectSite[]; rpcs: RpcSite[] } {
  const selects: SelectSite[] = [];
  const rpcs: RpcSite[] = [];

  for (const file of DATA_LAYER) {
    const text = readFileSync(resolve(process.cwd(), file), 'utf8');

    // `.from('table')` … `.select('a, b, c')`, the string possibly split across
    // lines with `+`. Nothing else in this layer builds a select list.
    for (const match of text.matchAll(/\.from\('([a-z_0-9]+)'\)\s*\n?\s*\.select\(/g)) {
      const open = text.indexOf('(', match.index + match[0].length - 1);
      const inner = balanced(text, open, '(', ')');
      if (inner === null) continue;
      const joined = [...inner.matchAll(/'([^']*)'/g)].map((m) => m[1]).join('');
      selects.push({
        file,
        table: match[1] as string,
        columns: splitSelectList(joined)
          .map((c) => c.trim())
          .filter((c) => c.length > 0),
      });
    }

    // `.rpc('name', { arg: … })`, and the two wrappers that forward to it.
    for (const match of text.matchAll(
      /(?:\.rpc|command|commandReturning<[^>]*>)\(\s*'([a-z_0-9]+)'\s*(,?)/g,
    )) {
      const name = match[1] as string;
      if (match[2] !== ',') {
        rpcs.push({ file, name, args: [] });
        continue;
      }
      const open = text.indexOf('{', match.index + match[0].length);
      const inner = open === -1 ? null : balanced(text, open, '{', '}');
      if (inner === null) continue;
      rpcs.push({
        file,
        name,
        args: [...inner.matchAll(/(?:^|[,{\n])\s*([a-z_][a-z_0-9]*)\s*:/g)].map(
          (m) => m[1] as string,
        ),
      });
    }
  }

  return { selects, rpcs };
}

describe('the client names things the database has', () => {
  let client: Client;
  let columns: Map<string, Set<string>>;
  let functions: Map<string, Set<string>[]>;
  // Unordered `a\u0000b` keys for each foreign-key edge, so an embed can be
  // validated as a real relationship in either direction (to-one or to-many).
  let relationships: Set<string>;
  const { selects, rpcs } = readDataLayer();

  const fkKey = (a: string, b: string): string => [a, b].sort().join('\u0000');

  beforeAll(async () => {
    client = await connect();
    await resetSchema(client);

    columns = new Map();
    const columnRows = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'`,
    );
    for (const row of columnRows.rows) {
      const set = columns.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      columns.set(row.table_name, set);
    }

    functions = new Map();
    // Every overload separately: a call is valid if ANY overload accepts it.
    const functionRows = await client.query<{ proname: string; args: string[] | null }>(
      `select p.proname,
              coalesce(p.proargnames, array[]::text[]) as args
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'`,
    );
    for (const row of functionRows.rows) {
      const list = functions.get(row.proname) ?? [];
      list.push(new Set(row.args ?? []));
      functions.set(row.proname, list);
    }

    relationships = new Set();
    const fkRows = await client.query<{ child: string; parent: string }>(
      `select rel.relname as child, frel.relname as parent
         from pg_constraint c
         join pg_class rel on rel.oid = c.conrelid
         join pg_class frel on frel.oid = c.confrelid
         join pg_namespace n on n.oid = c.connamespace
        where c.contype = 'f' and n.nspname = 'public'`,
    );
    for (const row of fkRows.rows) {
      relationships.add(fkKey(row.child, row.parent));
    }
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  /**
   * Check one select token against a table. A plain token is a column (possibly
   * `alias:column`); a token of the shape `[alias:]relation(inner, …)` is a
   * PostgREST embedded resource, valid only when `relation` is a real table
   * joined to `table` by a foreign key, and its inner tokens are then checked
   * against that relation (recursively, since embeds can nest).
   */
  function checkToken(table: string, token: string, file: string, faults: string[]): void {
    const trimmed = token.trim();
    if (trimmed === '') return;

    const embed = /^(?:[a-z_0-9]+:)?([a-z_0-9]+)\((.*)\)$/is.exec(trimmed);
    if (embed) {
      const relation = embed[1] as string;
      if (!columns.has(relation)) {
        faults.push(`${file}: no embedded table public.${relation}`);
        return;
      }
      if (!relationships.has(fkKey(table, relation))) {
        faults.push(`${file}: no foreign key joins public.${table} to public.${relation}`);
        return;
      }
      for (const inner of splitSelectList(embed[2] as string)) {
        checkToken(relation, inner, file, faults);
      }
      return;
    }

    const known = columns.get(table);
    if (known === undefined) {
      faults.push(`${file}: no table public.${table}`);
      return;
    }
    // PostgREST allows `alias:column`; the real name is after the colon.
    const real = (trimmed.includes(':') ? trimmed.split(':')[1] : trimmed)?.trim() ?? trimmed;
    if (real !== '*' && !known.has(real)) {
      faults.push(`${file}: public.${table} has no column "${real}"`);
    }
  }

  it('reads only columns that exist', () => {
    const faults: string[] = [];
    for (const site of selects) {
      if (!columns.has(site.table)) {
        faults.push(`${site.file}: no table public.${site.table}`);
        continue;
      }
      for (const column of site.columns) {
        checkToken(site.table, column, site.file, faults);
      }
    }
    expect(faults).toEqual([]);
  });

  it('calls only functions that exist, with argument names they accept', () => {
    const faults: string[] = [];
    for (const site of rpcs) {
      const overloads = functions.get(site.name);
      if (overloads === undefined) {
        faults.push(`${site.file}: no function public.${site.name}`);
        continue;
      }
      const accepted = overloads.some((names) => site.args.every((arg) => names.has(arg)));
      if (!accepted) {
        faults.push(
          `${site.file}: public.${site.name} rejects {${site.args.join(', ')}}; ` +
            `accepts ${overloads.map((n) => `{${[...n].join(', ')}}`).join(' or ')}`,
        );
      }
    }
    expect(faults).toEqual([]);
  });

  /**
   * A parser that quietly stops matching would turn both tests above into
   * assertions about an empty list. These lower bounds are the tripwire: they
   * are meant to be raised as the data layer grows, and to fail loudly if it
   * is ever rewritten into a shape this file cannot read.
   */
  it('actually found the call sites it claims to check', () => {
    expect(selects.length).toBeGreaterThanOrEqual(18);
    expect(rpcs.length).toBeGreaterThanOrEqual(39);
    expect(new Set(selects.map((s) => s.table)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(rpcs.map((r) => r.name)).size).toBeGreaterThanOrEqual(31);
  });
});
