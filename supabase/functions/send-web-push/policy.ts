/**
 * The sending policy, as pure functions.
 *
 * Everything here decides WHETHER and WHAT, never HOW - no network, no Deno
 * API, no clock of its own. `deliver.ts` owns the I/O and calls these; the test
 * beside this file calls them directly.
 *
 * That split exists because the rules in here are the ones that wake somebody
 * at three in the morning, and they were previously unreachable by any test:
 * how long to wait before repeating, how many attempts are allowed at all, and
 * - most importantly - exactly which fields may travel to a locked screen.
 */

/** How long after an accepted alert a single repeat may be sent. */
export const REPEAT_AFTER_MS = 90_000;

/**
 * How long a claimed row is left alone before another worker may take it.
 *
 * A worker can die between claiming a row and recording the outcome. Without
 * this the row would sit in `SENT_TO_PROVIDER` forever; with it, a stuck row is
 * retried once - and only once, because `MAX_ATTEMPTS` still applies.
 */
export const CLAIM_STALE_AFTER_MS = 30_000;

/**
 * The initial alert plus at most one repeat. Not a tunable: two is the whole
 * promise the interface makes to a firefighter, and raising it would turn a
 * call-out into a device that will not stop.
 */
export const MAX_ATTEMPTS = 2;

export type OutboxState =
  | 'QUEUED'
  | 'SENT_TO_PROVIDER'
  | 'PROVIDER_ACCEPTED'
  | 'PROVIDER_REJECTED'
  | 'DEVICE_ACKNOWLEDGED'
  | 'FAILED'
  | 'UNKNOWN';

/** A row already accepted by a provider: anything further is the one repeat. */
export function isRepeat(state: string): boolean {
  return state === 'PROVIDER_ACCEPTED';
}

/**
 * Whether this row must be left alone for now.
 *
 * Two different waits, for two different reasons:
 *
 * - an accepted alert waits `REPEAT_AFTER_MS`, so somebody who is already
 *   putting their boots on is not alarmed again a second later;
 * - a claimed-but-unfinished row waits `CLAIM_STALE_AFTER_MS`, so a worker
 *   still talking to a push service is not overtaken by the next scheduler
 *   tick a minute later.
 */
export function holdForNow(
  state: string,
  updatedAt: string | null | undefined,
  now: number,
): boolean {
  const since = updatedAt === null || updatedAt === undefined ? Number.NaN : Date.parse(updatedAt);
  // An unreadable timestamp is treated as "do not hold": a row that can never
  // be sent is worse than one sent slightly early, and the attempt ceiling
  // still bounds it.
  if (!Number.isFinite(since)) return false;
  if (isRepeat(state)) return now - since < REPEAT_AFTER_MS;
  if (state === 'SENT_TO_PROVIDER') return now - since < CLAIM_STALE_AFTER_MS;
  return false;
}

/** Whether another attempt is allowed at all. */
export function attemptsRemain(attemptCount: number): boolean {
  return Number.isFinite(attemptCount) && attemptCount < MAX_ATTEMPTS;
}

/**
 * What to do with a queued alert, given the database's verdict on it.
 *
 * Eligibility is re-decided immediately before delivery: publishing decided it
 * at the moment of publication, a queued alert can sit for minutes, and in that
 * time an account can be suspended, a member deactivated, a membership
 * withdrawn. The alert must reflect the answer NOW.
 *
 * The answer comes from `push_delivery_verdict()`, not from here. It used to be
 * five facts about the ACCOUNT checked in this file - and the account's grant
 * carries DVD's role, so an SZS member was never alerted and a member withdrawn
 * from SZS still was. Whether somebody may be alerted depends on the service of
 * the call-out, which only the stored rows can say; the worker holds the service
 * role and bypasses row-level security, so it must not work that out from
 * anything else.
 *
 * Written against `unknown` because the verdict arrives from a network read:
 * anything not explicitly recognised is left alone - not claimed, not sent.
 */
export type DeliveryAction =
  | { readonly kind: 'SEND'; readonly userId: string; readonly publishedAt: string | null }
  | { readonly kind: 'REFUSE' }
  | { readonly kind: 'CLOSE'; readonly reason: CloseReason }
  | { readonly kind: 'LEAVE' };

/**
 * Why an alert is set aside unsent, as `delivery_close_reason` records it.
 *
 * Two are about the member or the call-out and happen every day: they opened
 * it (MEMBER_OPENED), or it ended before the alert went out (CALLOUT_NOT_OPEN).
 * Two are about the ROW, and no command writes one: its call-out and member are
 * not in its service (SERVICE_MISMATCH), or its member was never sent the
 * call-out (NOT_A_RECIPIENT). Those are an integrity problem - see
 * `QUARANTINE`.
 */
export type CloseReason = 'MEMBER_OPENED' | 'CALLOUT_NOT_OPEN' | 'SERVICE_MISMATCH' | 'NOT_A_RECIPIENT';

/**
 * The reasons a row is set aside because something wrote it that should not
 * have. If one of these cannot even be recorded, that is reported as a failed
 * row rather than passed over as a lost race.
 */
export const QUARANTINE: ReadonlySet<CloseReason> = new Set(['SERVICE_MISMATCH', 'NOT_A_RECIPIENT']);

export function deliveryAction(verdict: unknown): DeliveryAction {
  if (verdict === null || typeof verdict !== 'object') return { kind: 'LEAVE' };
  const { verdict: answer, user_id: userId, published_at: publishedAt } = verdict as Record<string, unknown>;
  if (answer === 'SERVICE_MISMATCH') return { kind: 'CLOSE', reason: 'SERVICE_MISMATCH' };
  if (answer === 'NOT_A_RECIPIENT') return { kind: 'CLOSE', reason: 'NOT_A_RECIPIENT' };
  if (answer === 'OPENED') return { kind: 'CLOSE', reason: 'MEMBER_OPENED' };
  if (answer === 'CALLOUT_NOT_OPEN') return { kind: 'CLOSE', reason: 'CALLOUT_NOT_OPEN' };
  if (answer === 'INELIGIBLE') return { kind: 'REFUSE' };
  if (answer === 'DELIVER') {
    // A deliverable alert names the account whose devices to use. Without one it
    // cannot be delivered, and is refused as the old account check refused it.
    if (typeof userId !== 'string' || userId.length === 0) return { kind: 'REFUSE' };
    return { kind: 'SEND', userId, publishedAt: typeof publishedAt === 'string' ? publishedAt : null };
  }
  return { kind: 'LEAVE' };
}

/** A subscription that is still usable: not revoked, and not past its expiry. */
export function subscriptionUsable(
  expirationTime: string | null | undefined,
  now: number,
): boolean {
  if (expirationTime === null || expirationTime === undefined || expirationTime === '') return true;
  const expires = Date.parse(expirationTime);
  return !Number.isFinite(expires) || expires > now;
}

export interface AlertPayload {
  readonly interventionId: string;
  readonly publishedAt: number;
  readonly repeat: boolean;
}

/**
 * Everything the notification is allowed to carry, and nothing else.
 *
 * A push payload reaches a LOCKED SCREEN that anybody standing nearby can read,
 * and it is stored, briefly, by a push service this society does not run. So
 * the payload names an intervention and says nothing about it: no title, no
 * location, no assembly point, no instructions, no member, no response, no
 * attendance, no account identifier, no endpoint.
 *
 * The service worker turns this into a fixed, generic sentence. Everything a
 * firefighter actually needs to read is fetched after the application opens,
 * through the ordinary authenticated queries, where row level security decides
 * what they may see.
 *
 * Constructed by this one function so that "what may be sent" is a single
 * reviewable list rather than an object literal somebody extends in a hurry.
 */
export function alertPayload(input: AlertPayload): string {
  return JSON.stringify({
    interventionId: input.interventionId,
    publishedAt: input.publishedAt,
    repeat: input.repeat,
  });
}

/** The exact keys `alertPayload` may produce. The test asserts against this. */
export const ALLOWED_PAYLOAD_KEYS = ['interventionId', 'publishedAt', 'repeat'] as const;

// ---------------------------------------------------------------------------
// Latency
// ---------------------------------------------------------------------------

/**
 * How many pushes may be in flight at once.
 *
 * The first version sent strictly one at a time: every row in sequence, and
 * within a row every device in sequence, each a full HTTPS round trip to a push
 * service. A call-out to eight firefighters therefore alerted the eighth person
 * only after seven prior round trips had completed - and the commander's screen
 * was blocked for all of it.
 *
 * Bounded rather than unbounded because a push service is a shared resource and
 * a thundering herd is how a society gets rate-limited on the one night it
 * matters. Eight is comfortably above a realistic call-out's device count while
 * staying a polite number of simultaneous connections.
 */
export const SEND_CONCURRENCY = 8;

/**
 * Runs `work` over `items` with at most `limit` in flight, preserving order.
 *
 * `Promise.all` over the whole list would be unbounded; a `for await` loop is
 * what caused the latency. This is the middle: a fixed number of workers
 * pulling from a shared cursor.
 *
 * Never rejects. Each result is settled so one failed device cannot abandon
 * another member's alert - which is exactly the bug an unguarded `Promise.all`
 * would introduce while "fixing" the speed.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await work(items[index] as T, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}

/**
 * Which path delivered this attempt, recorded so it can be told apart later.
 *
 * The owner reported a substantial delay and there was no way to answer the
 * first question that matters: did the commander's immediate wake-up do the
 * work, or did it fail silently and leave the once-a-minute scheduler to pick
 * it up? Those have completely different fixes, and `ACCEPTED` alone could not
 * distinguish them.
 *
 * It is a status word, not a measurement: `attempted_at` minus the outbox row's
 * `created_at` is the measurement, and it was always there.
 */
export function attemptStatus(outcome: 'ACCEPTED' | 'REVOKED' | 'NONE', viaScheduler: boolean): string {
  const path = viaScheduler ? 'SCHEDULED' : 'IMMEDIATE';
  if (outcome === 'ACCEPTED') return `ACCEPTED_${path}`;
  if (outcome === 'REVOKED') return 'ACCESS_REVOKED';
  return 'NO_ACTIVE_SUBSCRIPTION';
}
