/**
 * The sending policy, as pure functions.
 *
 * Everything here decides WHETHER and WHAT, never HOW - no network, no Deno
 * API, no clock of its own. `index.ts` owns the I/O and calls these; the test
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

export interface EligibilityInput {
  readonly memberActive: unknown;
  readonly userId: unknown;
  readonly profileComplete: unknown;
  readonly grantActive: unknown;
  readonly grantRole: unknown;
}

export const OPERATIONAL_ROLES = ['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'] as const;

/**
 * The same five conditions `is_eligible_recipient()` applies in the database,
 * re-checked immediately before delivery.
 *
 * It is deliberately a duplicate. Publishing decided who was eligible at the
 * moment of publication; a queued alert can sit for minutes, and in that time
 * an account can be suspended, a member deactivated, a grant withdrawn. The
 * alert must reflect the answer NOW, not the answer then.
 *
 * Written against `unknown` because every value arrives from a network read
 * that may be null or missing: anything that is not explicitly true fails.
 */
export function stillEligible(input: EligibilityInput): boolean {
  return (
    typeof input.userId === 'string' &&
    input.userId.length > 0 &&
    input.memberActive === true &&
    input.profileComplete === true &&
    input.grantActive === true &&
    (OPERATIONAL_ROLES as readonly string[]).includes(String(input.grantRole))
  );
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
