/**
 * The worker's handling of answers a real database rarely gives.
 *
 * db-tests/push_service.test.ts runs `deliver.ts` against real rows as the
 * service role - who is alerted, who is refused, the repeat, the race. This
 * covers what fixtures cannot easily produce: a verdict that cannot be read or
 * is not recognised, a quarantine the database refuses, and exactly what the
 * wake-up asks of each client. The database here is a script.
 */

import { describe, expect, it } from 'vitest';
import { authoriseWake, deliverQueued, type Database, type Query, type Reply } from './deliver';

interface Op {
  readonly kind: 'select' | 'update' | 'insert' | 'rpc';
  readonly table: string;
  readonly payload: Record<string, unknown> | undefined;
  readonly filters: readonly (readonly [string, unknown])[];
}

/** A Database whose every request is recorded and answered by `answer`. */
function scripted(answer: (op: Op) => Reply): Database & { ops: Op[] } {
  const ops: Op[] = [];
  const request = (kind: Op['kind'], table: string, payload?: Record<string, unknown>): Query => {
    const filters: [string, unknown][] = [];
    const settle = () => {
      const op = { kind, table, payload, filters };
      ops.push(op);
      return Promise.resolve(answer(op));
    };
    const filter = (column: string, value: unknown): Query => {
      filters.push([column, value]);
      return query;
    };
    const query: Query = {
      select: () => query,
      eq: filter,
      is: filter,
      in: filter,
      lt: filter,
      order: () => query,
      limit: () => query,
      maybeSingle: settle,
      single: settle,
      then: (fulfilled, rejected) => settle().then(fulfilled, rejected),
    };
    return query;
  };
  return {
    ops,
    from: (table) => ({
      select: () => request('select', table),
      update: (values) => request('update', table, values),
      insert: (values) => request('insert', table, values),
    }),
    rpc: (fn, args) => request('rpc', fn, args),
  };
}

const ALERT = '11111111-1111-4111-8111-111111111111';
const CALLOUT = '22222222-2222-4222-8222-222222222222';
const SZS = '00000000-0000-4000-8000-000000000002';
const queued = { id: ALERT, intervention_id: CALLOUT, member_id: 'm', state: 'QUEUED', attempt_count: 0, updated_at: null };

/** One queued alert; `verdict` answers push_delivery_verdict, `write` every update and insert. */
function queue(verdict: Reply, write: Reply = { data: null, error: null }) {
  return scripted((op) => {
    if (op.kind === 'select' && op.table === 'notification_outbox') return { data: [queued], error: null };
    if (op.kind === 'rpc' && op.table === 'push_delivery_verdict') return verdict;
    return write;
  });
}

const neverSend = async () => {
  throw new Error('nothing may be sent');
};
const writes = (db: { ops: Op[] }) => db.ops.filter((op) => op.kind === 'update' || op.kind === 'insert');

describe('an answer the worker cannot act on', () => {
  it('counts a row as failed, and touches nothing, when its verdict cannot be read', async () => {
    const db = queue({ data: null, error: { message: 'connection lost' } });
    expect(await deliverQueued({ service: db, send: neverSend, scheduler: true })).toEqual({
      accepted: 0, rejected: 0, skipped: 0, failed: 1,
    });
    expect(writes(db)).toEqual([]);
  });

  it('leaves alone a row it has no recognised answer about - not claimed, not sent', async () => {
    for (const verdict of [null, { verdict: 'MAYBE' }]) {
      const db = queue({ data: verdict, error: null });
      expect(await deliverQueued({ service: db, send: neverSend, scheduler: true })).toMatchObject({ skipped: 1, failed: 0 });
      expect(writes(db), JSON.stringify(verdict)).toEqual([]);
    }
  });

  it('asks about the alert by its stored id, and nothing else', async () => {
    const db = queue({ data: null, error: null });
    await deliverQueued({ service: db, send: neverSend, scheduler: true });
    expect(db.ops.find((op) => op.kind === 'rpc')?.payload).toEqual({ target_outbox: ALERT });
  });
});

describe('setting an alert aside', () => {
  it('closes a mismatched alert only if nobody has moved it on, without an attempt', async () => {
    const db = queue({ data: { verdict: 'SERVICE_MISMATCH', user_id: null, published_at: null }, error: null });
    expect(await deliverQueued({ service: db, send: neverSend, scheduler: true })).toMatchObject({ skipped: 1 });
    expect(writes(db)).toEqual([
      expect.objectContaining({
        kind: 'update',
        table: 'notification_outbox',
        payload: expect.objectContaining({ delivery_close_reason: 'SERVICE_MISMATCH' }),
        filters: [['id', ALERT], ['state', 'QUEUED'], ['attempt_count', 0]],
      }),
    ]);
  });

  it('reports a mismatch the database will not let it set aside, and still sends nothing', async () => {
    const db = queue(
      { data: { verdict: 'SERVICE_MISMATCH', user_id: null, published_at: null }, error: null },
      { data: null, error: { message: 'ORGANIZATION_MISMATCH' } },
    );
    expect(await deliverQueued({ service: db, send: neverSend, scheduler: true })).toMatchObject({ failed: 1, skipped: 0 });
  });

  it('treats a lost race to close an opened alert as it always did', async () => {
    const db = queue(
      { data: { verdict: 'OPENED', user_id: null, published_at: null }, error: null },
      { data: null, error: { message: 'serialization failure' } },
    );
    expect(await deliverQueued({ service: db, send: neverSend, scheduler: true })).toMatchObject({ skipped: 1, failed: 0 });
  });
});

describe('who may wake delivery', () => {
  const stored = (reply: Reply) => scripted(() => reply);
  const caller = (reply: Reply) => scripted(() => reply);

  it('asks the caller about the service of the STORED call-out', async () => {
    const service = stored({ data: { organization_id: SZS }, error: null });
    const asked = caller({ data: true, error: null });
    expect(await authoriseWake(service, asked, CALLOUT)).toBe('ALLOWED');
    expect(service.ops).toEqual([{ kind: 'select', table: 'interventions', payload: undefined, filters: [['id', CALLOUT]] }]);
    expect(asked.ops).toEqual([{ kind: 'rpc', table: 'is_command_in', payload: { target_organization: SZS }, filters: [] }]);
  });

  it('refuses an id that matches nothing without asking the caller anything', async () => {
    const asked = caller({ data: true, error: null });
    expect(await authoriseWake(stored({ data: null, error: null }), asked, CALLOUT)).toBe('COMMAND_REQUIRED');
    expect(asked.ops).toEqual([]);
  });

  it('refuses when the caller\'s answer is anything but yes', async () => {
    const service = stored({ data: { organization_id: SZS }, error: null });
    for (const answer of [{ data: false, error: null }, { data: null, error: { message: 'JWT expired' } }, { data: 'true', error: null }]) {
      expect(await authoriseWake(service, caller(answer), CALLOUT), JSON.stringify(answer)).toBe('COMMAND_REQUIRED');
    }
  });

  it('fails rather than guesses when the call-out cannot be read', async () => {
    await expect(
      authoriseWake(stored({ data: null, error: { message: 'timeout' } }), caller({ data: true, error: null }), CALLOUT),
    ).rejects.toThrow('INTERVENTION_READ_FAILED');
  });

  it('tells a commander an id is required, and anybody else only that they may not', async () => {
    const service = stored({ data: null, error: null });
    expect(await authoriseWake(service, caller({ data: true, error: null }), undefined)).toBe('INTERVENTION_ID_REQUIRED');
    expect(await authoriseWake(service, caller({ data: false, error: null }), undefined)).toBe('COMMAND_REQUIRED');
    expect(service.ops, 'nothing is read for a request that names no call-out').toEqual([]);
  });
});
