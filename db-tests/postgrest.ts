/**
 * A PostgREST stand-in for the push worker, against the real test database.
 *
 * The worker (supabase/functions/send-web-push/deliver.ts) holds the SERVICE
 * ROLE key, and the service role bypasses row-level security. Not one policy
 * test says anything about what the worker reads or writes - the service
 * boundary on its side exists only in its own queries. So those queries are
 * run here, as written, against real rows, constraints, triggers and locks.
 *
 * Each supabase-js call the worker makes is translated into the SQL PostgREST
 * runs for it: one transaction per request, under the request's role and JWT
 * claims, with rows serialised by PostgreSQL's own JSON functions - which is
 * what PostgREST returns, down to the timestamp format. Requests draw from a
 * pool, so rows handled concurrently really do contend in the database.
 *
 * Deliberately small: only what the worker calls. A builder method missing
 * here is one the worker does not use.
 */

import { Pool } from 'pg';
import type { Database, Query, Reply } from '../supabase/functions/send-web-push/deliver';
import { DATABASE_URL } from './harness';

export type Caller = { role: 'service_role' } | { role: 'authenticated'; userId: string };

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`not an identifier: ${name}`);
  return name;
}

function columnList(list: string): string[] {
  return list.split(',').map((column) => identifier(column.trim()));
}

interface Filter {
  readonly column: string;
  readonly op: 'eq' | 'is' | 'in' | 'lt';
  readonly value: unknown;
}

type Shape = 'many' | 'maybe' | 'single';

interface Spec {
  kind: 'select' | 'update' | 'insert' | 'rpc';
  table: string;
  columns: string[] | null;
  values: Record<string, unknown> | null;
  args: Record<string, unknown> | null;
  filters: Filter[];
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
}

class Built implements Query {
  constructor(
    private readonly spec: Spec,
    private readonly run: (spec: Spec, shape: Shape) => Promise<Reply>,
  ) {}

  private with(change: Partial<Spec>): Built {
    return new Built({ ...this.spec, ...change, filters: change.filters ?? this.spec.filters }, this.run);
  }

  select(columns: string): Query {
    return this.with({ columns: columnList(columns) });
  }
  eq(column: string, value: unknown): Query {
    return this.with({ filters: [...this.spec.filters, { column: identifier(column), op: 'eq', value }] });
  }
  is(column: string, value: null): Query {
    return this.with({ filters: [...this.spec.filters, { column: identifier(column), op: 'is', value }] });
  }
  in(column: string, values: readonly unknown[]): Query {
    return this.with({ filters: [...this.spec.filters, { column: identifier(column), op: 'in', value: [...values] }] });
  }
  lt(column: string, value: unknown): Query {
    return this.with({ filters: [...this.spec.filters, { column: identifier(column), op: 'lt', value }] });
  }
  order(column: string, options: { ascending: boolean }): Query {
    return this.with({ order: { column: identifier(column), ascending: options.ascending } });
  }
  limit(count: number): Query {
    return this.with({ limit: count });
  }
  maybeSingle(): PromiseLike<Reply> {
    return this.run(this.spec, 'maybe');
  }
  single(): PromiseLike<Reply> {
    return this.run(this.spec, 'single');
  }
  then<A = Reply, B = never>(
    fulfilled?: ((value: Reply) => A | PromiseLike<A>) | null,
    rejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run(this.spec, 'many').then(fulfilled, rejected);
  }
}

export interface Rest extends Database {
  /** Closes the pool. */
  end(): Promise<void>;
  /** Every request sent, as `kind table` - for asserting which queries ran. */
  readonly sent: string[];
}

/** A supabase-js-shaped client that talks to the test database as `caller`. */
export function postgrest(caller: Caller, poolSize = 4): Rest {
  const pool = new Pool({ connectionString: DATABASE_URL, max: poolSize });
  const setOf = new Map<string, boolean>();
  const sent: string[] = [];

  async function run(spec: Spec, shape: Shape): Promise<Reply> {
    sent.push(`${spec.kind} ${spec.table}`);
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = spec.filters.map((filter) => {
      const column = `t.${filter.column}`;
      if (filter.op === 'eq') return `${column} = ${param(filter.value)}`;
      if (filter.op === 'lt') return `${column} < ${param(filter.value)}`;
      if (filter.op === 'in') return `${column} = any(${param(filter.value)})`;
      if (filter.value !== null) throw new Error('only IS NULL is supported');
      return `${column} is null`;
    });
    const whereSql = where.length ? `where ${where.join(' and ')}` : '';
    const table = `public.${identifier(spec.table)}`;

    let sql: string;
    let rowsWanted = true;
    if (spec.kind === 'select') {
      const order = spec.order ? `order by t.${spec.order.column} ${spec.order.ascending ? 'asc' : 'desc'}` : '';
      const limit = spec.limit === null ? '' : `limit ${Number(spec.limit)}`;
      sql = `select to_jsonb(x) as row from (
               select ${(spec.columns ?? ['*']).map((c) => (c === '*' ? 't.*' : `t.${c}`)).join(', ')}
                 from ${table} t ${whereSql} ${order} ${limit}) x`;
    } else if (spec.kind === 'update') {
      const assigned = Object.keys(spec.values ?? {}).map(identifier);
      const values = param(JSON.stringify(spec.values ?? {}));
      sql = `with changed as (
               update ${table} t set ${assigned.map((c) => `${c} = v.${c}`).join(', ')}
                 from jsonb_populate_record(null::${table}, ${values}::jsonb) v
                ${whereSql} returning t.*)
             select to_jsonb(x) as row from (select ${(spec.columns ?? ['id']).map((c) => `changed.${c}`).join(', ')} from changed) x`;
      rowsWanted = spec.columns !== null;
    } else if (spec.kind === 'insert') {
      const assigned = Object.keys(spec.values ?? {}).map(identifier);
      const values = param(JSON.stringify(spec.values ?? {}));
      sql = `insert into ${table}(${assigned.join(', ')})
             select ${assigned.map((c) => `v.${c}`).join(', ')} from jsonb_populate_record(null::${table}, ${values}::jsonb) v`;
      rowsWanted = false;
    } else {
      if (!setOf.has(spec.table)) {
        const { rows } = await pool.query<{ rows: boolean }>(
          `select (p.proretset or p.prorettype = 'record'::regtype) as rows
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = $1 limit 1`,
          [spec.table],
        );
        if (!rows.length) return { data: null, error: { code: 'PGRST202', message: `function ${spec.table} not found` } };
        setOf.set(spec.table, rows[0]!.rows);
      }
      const args = Object.entries(spec.args ?? {}).map(([name, value]) => `${identifier(name)} => ${param(value)}`);
      const call = `public.${identifier(spec.table)}(${args.join(', ')})`;
      if (setOf.get(spec.table)) {
        // As PostgREST does for a function returning rows: its result is
        // selected, filtered, ordered and limited like a table's.
        const order = spec.order ? `order by t.${spec.order.column} ${spec.order.ascending ? 'asc' : 'desc'}` : '';
        const limit = spec.limit === null ? '' : `limit ${Number(spec.limit)}`;
        sql = `select to_jsonb(x) as row from (
                 select ${(spec.columns ?? ['*']).map((c) => (c === '*' ? 't.*' : `t.${c}`)).join(', ')}
                   from ${call} t ${whereSql} ${order} ${limit}) x`;
      } else {
        if (where.length || spec.order || spec.limit !== null) throw new Error(`${spec.table} returns no rows to filter`);
        sql = `select to_jsonb(${call}) as row`;
      }
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const claims = caller.role === 'service_role'
        ? { role: 'service_role' }
        : { sub: caller.userId, role: 'authenticated' };
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await client.query(`set local role ${caller.role}`);
      const { rows } = await client.query<{ row: unknown }>(sql, params);
      await client.query('commit');

      const data = rows.map((row) => row.row);
      if (spec.kind === 'rpc' && !setOf.get(spec.table)) return { data: data[0] ?? null, error: null };
      if (!rowsWanted) return { data: null, error: null };
      if (shape === 'many') return { data, error: null };
      if (data.length > 1 || (shape === 'single' && data.length === 0)) {
        return { data: null, error: { code: 'PGRST116', message: `${data.length} rows where one was expected` } };
      }
      return { data: data[0] ?? null, error: null };
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      const { code, message } = error as { code?: string; message?: string };
      return { data: null, error: { code, message } };
    } finally {
      client.release();
    }
  }

  const blank = (kind: Spec['kind'], table: string): Spec => ({
    kind, table, columns: null, values: null, args: null, filters: [], order: null, limit: null,
  });

  return {
    sent,
    from(table: string) {
      return {
        select: (columns: string) => new Built({ ...blank('select', table), columns: columnList(columns) }, run),
        update: (values: Record<string, unknown>) => new Built({ ...blank('update', table), values }, run),
        insert: (values: Record<string, unknown>) => run({ ...blank('insert', table), values }, 'many'),
      };
    },
    rpc(fn: string, args?: Record<string, unknown>) {
      return new Built({ ...blank('rpc', fn), args: args ?? {} }, run);
    },
    end: () => pool.end(),
  };
}
