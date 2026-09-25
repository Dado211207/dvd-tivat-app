/**
 * Delivering queued Web Push alerts, and deciding who may ask for it.
 *
 * Moved out of `index.ts` so it can run somewhere other than Deno: the clients
 * and the push sender are handed in. `index.ts` builds them from the request
 * and the function's secrets; db-tests/push_service.test.ts runs this same code
 * as the service role against a real database, with a push service that only
 * records. The decisions themselves live in `policy.ts` and the database.
 *
 * Everything the worker reads and writes, it does as the SERVICE ROLE, which
 * bypasses row-level security. No policy bounds it: the service boundary on
 * this side exists only in these queries. So the one question that depends on
 * a service - may this member still be alerted about this call-out - is put to
 * the database as `push_delivery_verdict()`, answered from the stored alert,
 * call-out and member. Nothing a request carries names a service.
 */

import {
  alertPayload,
  attemptStatus,
  attemptsRemain,
  deliveryAction,
  holdForNow,
  isRepeat,
  mapWithConcurrency,
  MAX_ATTEMPTS,
  SEND_CONCURRENCY,
  subscriptionUsable,
} from './policy.ts';

// ---------------------------------------------------------------------------
// The part of supabase-js the worker uses, written out so this module has no
// runtime dependency and runs under Deno and Node alike.
// ---------------------------------------------------------------------------

export interface Reply {
  readonly data: unknown;
  readonly error: unknown;
}

/** A request being built: every filter returns the request, awaiting it sends it. */
export interface Query extends PromiseLike<Reply> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  in(column: string, values: readonly unknown[]): Query;
  lt(column: string, value: unknown): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
  maybeSingle(): PromiseLike<Reply>;
  single(): PromiseLike<Reply>;
}

export interface Database {
  from(table: string): {
    select(columns: string): Query;
    update(values: Record<string, unknown>): Query;
    insert(values: Record<string, unknown>): PromiseLike<Reply>;
  };
  rpc(fn: string, args?: Record<string, unknown>): Query;
}

export interface PushTarget {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface PushOptions {
  readonly TTL: number;
  readonly urgency: 'high';
  readonly topic: string;
}

/** `webpush.sendNotification`, or a fake. Rejects with `statusCode` when the push service refuses. */
export type Send = (target: PushTarget, payload: string, options: PushOptions) => Promise<unknown>;

export interface Worker {
  /** The service-role client. */
  readonly service: Database;
  readonly send: Send;
  /** Whether the scheduler, rather than a commander's wake-up, is running this. */
  readonly scheduler: boolean;
  readonly now?: () => number;
}

// ---------------------------------------------------------------------------
// Who may wake delivery
// ---------------------------------------------------------------------------

export type WakeDecision = 'ALLOWED' | 'COMMAND_REQUIRED' | 'INTERVENTION_ID_REQUIRED';

/**
 * Whether the signed-in `caller` may wake delivery of `interventionId`.
 *
 * Command in THE CALL-OUT'S service, read from the stored call-out with the
 * service client - never from anything the request says. This used to ask
 * `current_dvd_role()` and never look at the call-out: a DVD commander could set
 * off an SZS call-out's delivery and an SZS commander could not wake their own.
 *
 * An id that matches nothing is refused exactly like one of another service, so
 * the answer says nothing about which ids exist. A caller who commands nothing
 * is refused before being told that an id is required, as before.
 */
export async function authoriseWake(
  service: Database,
  caller: Database,
  interventionId: string | undefined,
): Promise<WakeDecision> {
  if (interventionId === undefined) {
    const { data, error } = await caller.rpc('is_command_anywhere');
    return !error && data === true ? 'INTERVENTION_ID_REQUIRED' : 'COMMAND_REQUIRED';
  }
  const { data: stored, error: readError } = await service
    .from('interventions')
    .select('organization_id')
    .eq('id', interventionId)
    .maybeSingle();
  if (readError) throw new Error('INTERVENTION_READ_FAILED');
  const organization = (stored as { organization_id?: unknown } | null)?.organization_id;
  if (typeof organization !== 'string') return 'COMMAND_REQUIRED';

  const { data: commands, error: roleError } = await caller.rpc('is_command_in', {
    target_organization: organization,
  });
  return !roleError && commands === true ? 'ALLOWED' : 'COMMAND_REQUIRED';
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
export type RowOutcome = 'ACCEPTED' | 'REJECTED' | 'SKIPPED';
export interface Tally {
  accepted: number;
  rejected: number;
  skipped: number;
  failed: number;
}

/**
 * Every due Web Push alert - or, for a wake-up, every due alert of one
 * call-out, which the caller has already been authorised for.
 */
export async function deliverQueued(worker: Worker, interventionId?: string): Promise<Tally> {
  const { service, send, scheduler } = worker;
  const now = worker.now ?? Date.now;
  const stamp = () => new Date(now()).toISOString();

  let outboxQuery = service
    .from('notification_outbox')
    .select('id, intervention_id, member_id, state, attempt_count, created_at, updated_at')
    .eq('channel', 'WEB_PUSH')
    .is('delivery_closed_at', null)
    .in('state', ['QUEUED', 'SENT_TO_PROVIDER', 'PROVIDER_ACCEPTED', 'PROVIDER_REJECTED'])
    .lt('attempt_count', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(50);
  if (interventionId !== undefined) outboxQuery = outboxQuery.eq('intervention_id', interventionId);

  const { data: rows, error: rowsError } = await outboxQuery;
  if (rowsError) throw new Error('OUTBOX_READ_FAILED');

  /**
   * One outbox row, start to finish.
   *
   * Rows run concurrently. They never contend with each other inside one
   * invocation - the read returns distinct ids - and the conditional claim
   * settles the race that matters, which is between this invocation and the
   * scheduler's.
   */
  const deliverRow = async (row: Row): Promise<RowOutcome> => {
    const state = String(row.state);
    const repeat = isRepeat(state);
    // Both waits, and the attempt ceiling, live in `policy.ts` where they are
    // tested. The filter above narrows the read; this is the real decision.
    if (holdForNow(state, row.updated_at as string | null, now())) {
      return 'SKIPPED';
    }
    if (!attemptsRemain(Number(row.attempt_count))) {
      return 'SKIPPED';
    }

    /*
     * One question, answered from the stored rows: are the alert, its
     * call-out and its member in one service; has the member already opened
     * the call-out; may that service still alert them. Asked for every row,
     * first attempt included - a QUEUED row whose immediate wake-up failed can
     * sit for minutes, and the member may have opened the call-out through the
     * in-app path in the meantime.
     */
    const { data: verdict, error: verdictError } = await service
      .rpc('push_delivery_verdict', { target_outbox: row.id })
      .maybeSingle();
    if (verdictError) throw new Error('DELIVERY_VERDICT_FAILED');
    const action = deliveryAction(verdict);

    if (action.kind === 'LEAVE') {
      return 'SKIPPED';
    }
    if (action.kind === 'CLOSE') {
      // Somebody who has opened the call-out is not alarmed again; an alert
      // whose rows disagree about its service is set aside, unsent. Neither is
      // an attempt, so neither is recorded as one.
      const { error: closeError } = await service.from('notification_outbox').update({
        delivery_closed_at: stamp(),
        delivery_close_reason: action.reason,
        updated_at: stamp(),
      }).eq('id', row.id).eq('state', state).eq('attempt_count', row.attempt_count);
      // A mismatch that cannot even be set aside is an integrity problem, not a
      // lost race: surfaced as a failed row on every run until somebody looks.
      if (closeError && action.reason === 'SERVICE_MISMATCH') throw new Error('OUTBOX_QUARANTINE_FAILED');
      return 'SKIPPED';
    }

    const nextAttempt = Number(row.attempt_count) + 1;
    const { data: claimed, error: claimError } = await service
      .from('notification_outbox')
      .update({ state: 'SENT_TO_PROVIDER', attempt_count: nextAttempt, updated_at: stamp() })
      .eq('id', row.id)
      .eq('state', state)
      .eq('attempt_count', row.attempt_count)
      .select('id')
      .maybeSingle();
    if (claimError) throw new Error('OUTBOX_CLAIM_FAILED');
    if (!claimed) {
      return 'SKIPPED';
    }

    if (action.kind === 'REFUSE') {
      await service.from('notification_delivery_attempts').insert({
        outbox_id: row.id,
        provider: 'WEB_PUSH',
        provider_status: attemptStatus('REVOKED', scheduler),
        provider_message: null,
      });
      await service.from('notification_outbox').update({
        state: 'FAILED', updated_at: stamp(),
      }).eq('id', row.id);
      return 'REJECTED';
    }

    // The devices are the ACCOUNT's: somebody serving in two services has one
    // phone, reached as whichever member each call-out was sent to.
    const { data: subscriptions } = await service
      .from('web_push_subscriptions')
      .select('id, endpoint, p256dh, auth_secret, expiration_time')
      .eq('user_id', action.userId)
      .is('revoked_at', null);

    const activeSubscriptions = ((subscriptions ?? []) as Row[]).filter((subscription) =>
      subscriptionUsable(subscription.expiration_time as string | null, now()));
    if (activeSubscriptions.length === 0) {
      await service.from('notification_delivery_attempts').insert({
        outbox_id: row.id,
        provider: 'WEB_PUSH',
        provider_status: attemptStatus('NONE', scheduler),
        provider_message: null,
      });
      await service.from('notification_outbox').update({
        state: 'FAILED', updated_at: stamp(),
      }).eq('id', row.id);
      return 'REJECTED';
    }

    // The only place a payload is built. See `alertPayload` for the whole
    // argument about what a locked screen may be allowed to say.
    const payload = alertPayload({
      interventionId: String(row.intervention_id),
      publishedAt: action.publishedAt ? Date.parse(action.publishedAt) : now(),
      repeat,
    });

    // A member may carry a phone and a tablet. Alerting the tablet only after
    // the phone's round trip finished was pure added delay for no benefit.
    const deviceResults = await mapWithConcurrency(
      activeSubscriptions,
      SEND_CONCURRENCY,
      async (subscription) => {
        // Recorded as the instant the attempt STARTED, not the instant the
        // provider answered. `attempted_at - outbox.created_at` is then the
        // society's own delay, with the push service's time excluded - which
        // is the only way to tell a slow worker from a slow provider.
        const attemptedAt = stamp();
        try {
          await send(
            {
              endpoint: String(subscription.endpoint),
              keys: { p256dh: String(subscription.p256dh), auth: String(subscription.auth_secret) },
            },
            payload,
            { TTL: 180, urgency: 'high', topic: `dvd-${String(row.intervention_id).slice(0, 20)}` },
          );
          await Promise.all([
            service.from('web_push_subscriptions').update({
              last_used_at: stamp(), updated_at: stamp(),
            }).eq('id', subscription.id),
            service.from('notification_delivery_attempts').insert({
              outbox_id: row.id, provider: 'WEB_PUSH', attempted_at: attemptedAt,
              provider_status: attemptStatus('ACCEPTED', scheduler),
              provider_message: null,
            }),
          ]);
          return true;
        } catch (error) {
          const statusCode = Number((error as { statusCode?: unknown }).statusCode ?? 0);
          if (statusCode === 404 || statusCode === 410) {
            await service.from('web_push_subscriptions').update({
              revoked_at: stamp(), updated_at: stamp(),
            }).eq('id', subscription.id);
          }
          await service.from('notification_delivery_attempts').insert({
            outbox_id: row.id,
            provider: 'WEB_PUSH',
            attempted_at: attemptedAt,
            // A code and a category. Never the provider's response body.
            provider_status: statusCode > 0 ? `HTTP_${statusCode}` : 'TRANSPORT_ERROR',
            provider_message: null,
          });
          return false;
        }
      },
    );
    const rowAccepted = deviceResults.some(
      (result) => result.status === 'fulfilled' && result.value === true,
    );

    await service.from('notification_outbox').update({
      state: rowAccepted ? 'PROVIDER_ACCEPTED' : 'PROVIDER_REJECTED',
      updated_at: stamp(),
    }).eq('id', row.id);
    return rowAccepted ? 'ACCEPTED' : 'REJECTED';
  };

  const settled = await mapWithConcurrency((rows ?? []) as Row[], SEND_CONCURRENCY, deliverRow);

  const tally: Tally = { accepted: 0, rejected: 0, skipped: 0, failed: 0 };
  for (const result of settled) {
    // A row that threw - a failed claim, a lost connection, a verdict that could
    // not be read - is counted and left for the scheduler. One broken row is not
    // a reason to stop calling out the rest of the crew.
    if (result.status === 'rejected') tally.failed += 1;
    else if (result.value === 'ACCEPTED') tally.accepted += 1;
    else if (result.value === 'REJECTED') tally.rejected += 1;
    else tally.skipped += 1;
  }
  return tally;
}
