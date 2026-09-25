/**
 * The worker's handling of answers a real database rarely gives.
 *
 * db-tests/push_service.test.ts runs `deliver.ts` against real rows as the
 * service role - who is alerted, who is refused, the repeat, the race, a
 * call-out that ended, a row nobody can write. This covers what fixtures
 * cannot easily produce: a verdict or a count that cannot be read, a verdict
 * that is not recognised, a close the database refuses, and exactly what the
 * worker and the wake-up ask of each client. The database here is a script.
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

/**
 * One queued alert; `verdict` answers push_delivery_verdict, `write` every
 * update and insert, `count` push_delivery_mislabelled and `sweep` the queue.
 */
function queue(
  verdict: Reply,
  write: Reply = { data: null, error: null },
  count: Reply = { data: 0, error: null },
  sweep: Reply = { data: [queued], error: null },
) {
  return scripted((op) => {
    if (op.kind === 'rpc' && op.table === 'push_delivery_queue') return sweep;
    if (op.kind === 'rpc' && op.table === 'push_delivery_verdict') return verdict;
    if (op.kind === 'rpc' && op.table === 'push_delivery_mislabelled') return count;
    if (op.kind === 'select' && op.table === 'notification_outbox') throw new Error('the table is never swept directly');
    return write;
  });
}

const neverSend = async () => {
  throw new Error('nothing may be sent');
};
const writes = (db: { ops: Op[] }) => db.ops.filter((op) => op.kind === 'update' || op.kind === 'insert');
const verdictOf = (verdict: string) => ({ data: { verdict, user_id: null, published_at: null }, error: null });

describe('what the worker sweeps', () => {
  it('reads push_delivery_queue() - never the table - with the filters it always used', async () => {
    for (const woken of [undefined, CALLOUT]) {
      const db = queue({ data: null, error: null });
      await deliverQueued({ service: db, send: neverSend, scheduler: woken === undefined }, woken);
      const sweep = db.ops.filter((op) => op.kind === 'rpc' && op.table === 'push_delivery_queue');
      expect(sweep.map((op) => op.filters), String(woken)).toEqual([[
        ['state', ['QUEUED', 'SENT_TO_PROVIDER', 'PROVIDER_ACCEPTED', 'PROVIDER_REJECTED']],
        ['attempt_count', 2],
        ...(woken === undefined ? [] : [['intervention_id', CALLOUT]]),
      ]]);
    }
  });

  it('fails the run, and sends nothing, when the sweep cannot be read', async () => {
    const db = queue({ data: null, error: null }, undefined, undefined, { data: null, error: { message: 'timeout' } });
    await expect(deliverQueued({ service: db, send: neverSend, scheduler: true })).rejects.toThrow('OUTBOX_READ_FAILED');
  });

  it('reports the alerts nobody can write - all of them, or only the woken call-out\'s', async () => {
    for (const woken of [undefined, CALLOUT]) {
      const db = queue(verdictOf('OPENED'), undefined, { data: 51, error: null });
      expect(await deliverQueued({ service: db, send: neverSend, scheduler: true }, woken)).toMatchObject({ mislabelled: 51, skipped: 1 });
      const asked = db.ops.filter((op) => op.kind === 'rpc' && op.table === 'push_delivery_mislabelled');
      expect(asked.map((op) => op.payload)).toEqual([{ target_intervention: woken ?? null }]);
    }
  });

  it('delivers as usual, and says it could not count, when the count cannot be read', async () => {
    for (const count of [{ data: null, error: { message: 'timeout' } }, { data: '51', error: null }]) {
      const db = queue(verdictOf('OPENED'), undefined, count);
      expect(await deliverQueued({ service: db, send: neverSend, scheduler: true }), JSON.stringify(count)).toEqual({
        accepted: 0, rejected: 0, skipped: 1, failed: 0, mislabelled: null,
      });
      // The count is asked after every alert has been dealt with.
      expect(db.ops.at(-1)).toMatchObject({ kind: 'rpc', table: 'push_delivery_mislabelled' });
    }
  });
});

describe('an answer the worker cannot act on', () => {
  it('counts a row as failed, and touches nothing, when its verdict cannot be read', async () => {
    const db = queue({ data: null, error: { message: 'connection lost' } });
    expect(await deliverQueued({ service: db, send: neverSend, scheduler: true })).toEqual({
      accepted: 0, rejected: 0, skipped: 0, failed: 1, mislabelled: 0,
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
    expect(db.ops.find((op) => op.kind === 'rpc' && op.table === 'push_delivery_verdict')?.payload).toEqual({ target_outbox: ALERT });
  });
});

describe('setting an alert aside', () => {
  const CLOSES = [
    ['SERVICE_MISMATCH', 'SERVICE_MISMATCH'],
    ['NOT_A_RECIPIENT', 'NOT_A_RECIPIENT'],
    ['OPENED', 'MEMBER_OPENED'],
    ['CALLOUT_NOT_OPEN', 'CALLOUT_NOT_OPEN'],
  ] as const;

  it('closes it with its own reason, only if nobody has moved it on, without an attempt', async () => {
    for (const [verdict, reason] of CLOSES) {
      const db = queue(verdictOf(verdict));
      expect(await deliverQueued({ service: db, send: neverSend, scheduler: true }), verdict).toMatchObject({ skipped: 1 });
      expect(writes(db), verdict).toEqual([
        expect.objectContaining({
          kind: 'update',
          table: 'notification_outbox',
          payload: expect.objectContaining({ delivery_close_reason: reason }),
          filters: [['id', ALERT], ['state', 'QUEUED'], ['attempt_count', 0]],
        }),
      ]);
    }
  });

  it('reports a row that should not exist and cannot be set aside, and still sends nothing', async () => {
    for (const verdict of ['SERVICE_MISMATCH', 'NOT_A_RECIPIENT']) {
      const db = queue(verdictOf(verdict), { data: null, error: { message: 'ORGANIZATION_MISMATCH' } });
      expect(await deliverQueued({ service: db, send: neverSend, scheduler: true }), verdict).toMatchObject({ failed: 1, skipped: 0 });
    }
  });

  it('treats a lost race to close an opened alert, or one whose call-out ended, as it always did', async () => {
    for (const verdict of ['OPENED', 'CALLOUT_NOT_OPEN']) {
      const db = queue(verdictOf(verdict), { data: null, error: { message: 'serialization failure' } });
      expect(await deliverQueued({ service: db, send: neverSend, scheduler: true }), verdict).toMatchObject({ skipped: 1, failed: 0 });
    }
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
