/**
 * The sending policy, against the situations that actually occur.
 *
 * These rules decide whether a phone makes a noise at three in the morning and
 * what a stranger can read off a locked screen, and until this file existed not
 * one of them had ever been executed by a test - they lived inside an Edge
 * Function that only runs in Deno, against a live push service.
 *
 * Nothing here touches the network. `index.ts` owns the I/O; this owns the
 * decisions, which is the half that can be wrong quietly.
 */

import { describe, expect, it } from 'vitest';
import {
  ALLOWED_PAYLOAD_KEYS,
  alertPayload,
  attemptStatus,
  attemptsRemain,
  CLAIM_STALE_AFTER_MS,
  deliveryAction,
  holdForNow,
  isRepeat,
  mapWithConcurrency,
  MAX_ATTEMPTS,
  REPEAT_AFTER_MS,
  SEND_CONCURRENCY,
  subscriptionUsable,
} from './policy';

const NOW = Date.parse('2026-09-14T10:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('at most one repeat, and only after the member has had time', () => {
  it('sends the first alert immediately', () => {
    expect(holdForNow('QUEUED', ago(0), NOW)).toBe(false);
    expect(attemptsRemain(0)).toBe(true);
  });

  it('holds the repeat until ninety seconds have passed', () => {
    expect(holdForNow('PROVIDER_ACCEPTED', ago(1_000), NOW)).toBe(true);
    expect(holdForNow('PROVIDER_ACCEPTED', ago(REPEAT_AFTER_MS - 1), NOW)).toBe(true);
    expect(holdForNow('PROVIDER_ACCEPTED', ago(REPEAT_AFTER_MS), NOW)).toBe(false);
  });

  it('allows exactly two attempts and never a third', () => {
    // The initial alert and one repeat. A firefighter who has not answered gets
    // told twice; a device that will not stop is a different product.
    expect(MAX_ATTEMPTS).toBe(2);
    expect(attemptsRemain(0)).toBe(true);
    expect(attemptsRemain(1)).toBe(true);
    expect(attemptsRemain(2)).toBe(false);
    expect(attemptsRemain(3)).toBe(false);
  });

  it('leaves a row another worker is still working on alone', () => {
    // The atomic claim stops two workers taking the same row; this stops the
    // next scheduler tick overtaking a send that is simply slow.
    expect(holdForNow('SENT_TO_PROVIDER', ago(1_000), NOW)).toBe(true);
    expect(holdForNow('SENT_TO_PROVIDER', ago(CLAIM_STALE_AFTER_MS - 1), NOW)).toBe(true);
  });

  it('recovers a row whose worker died mid-send', () => {
    // Claimed and never finished. It must not sit in SENT_TO_PROVIDER forever,
    // and the attempt ceiling still bounds what recovery can do.
    expect(holdForNow('SENT_TO_PROVIDER', ago(CLAIM_STALE_AFTER_MS + 1), NOW)).toBe(false);
  });

  it('retries a provider refusal once, within the same ceiling', () => {
    expect(holdForNow('PROVIDER_REJECTED', ago(0), NOW)).toBe(false);
    expect(attemptsRemain(1)).toBe(true);
    expect(attemptsRemain(2)).toBe(false);
  });

  it('does not stall on a timestamp it cannot read', () => {
    // A row that can never be sent is worse than one sent slightly early, and
    // the attempt ceiling is what actually bounds the damage.
    for (const broken of [null, undefined, '', 'not a time']) {
      expect(holdForNow('PROVIDER_ACCEPTED', broken, NOW), String(broken)).toBe(false);
    }
  });

  it('knows which state means "this would be the repeat"', () => {
    expect(isRepeat('PROVIDER_ACCEPTED')).toBe(true);
    for (const state of ['QUEUED', 'SENT_TO_PROVIDER', 'PROVIDER_REJECTED', 'FAILED']) {
      expect(isRepeat(state), state).toBe(false);
    }
  });
});

describe('the database\'s verdict decides what happens to an alert', () => {
  // Who is still eligible is decided by push_delivery_verdict() from the stored
  // alert, call-out and member - db-tests/push_service.test.ts covers that
  // against real rows. This is what the worker does with the answer.
  const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const published = '2026-09-14T10:00:00.123456+00:00';

  it('sends a deliverable alert to the account the database named', () => {
    expect(deliveryAction({ verdict: 'DELIVER', user_id: account, published_at: published })).toEqual({
      kind: 'SEND', userId: account, publishedAt: published,
    });
    expect(deliveryAction({ verdict: 'DELIVER', user_id: account, published_at: null })).toEqual({
      kind: 'SEND', userId: account, publishedAt: null,
    });
  });

  it('refuses an alert the member may no longer receive - or one that names nobody to send it to', () => {
    expect(deliveryAction({ verdict: 'INELIGIBLE', user_id: null, published_at: null })).toEqual({ kind: 'REFUSE' });
    for (const nobody of [null, undefined, '', 1, {}]) {
      expect(deliveryAction({ verdict: 'DELIVER', user_id: nobody }), String(nobody)).toEqual({ kind: 'REFUSE' });
    }
  });

  it('closes an opened alert, and sets aside one whose rows disagree about the service', () => {
    expect(deliveryAction({ verdict: 'OPENED' })).toEqual({ kind: 'CLOSE', reason: 'MEMBER_OPENED' });
    expect(deliveryAction({ verdict: 'SERVICE_MISMATCH' })).toEqual({ kind: 'CLOSE', reason: 'SERVICE_MISMATCH' });
  });

  it('leaves alone anything it does not recognise, rather than send on it', () => {
    // No row (not a queued Web Push alert), or an answer this build does not
    // know. Neither is a reason to wake somebody, nor to spend their one repeat.
    for (const unknown of [null, undefined, 'DELIVER', 1, { verdict: 'deliver' }, { verdict: 'MAYBE' }, { verdict: true }, {}]) {
      expect(deliveryAction(unknown), JSON.stringify(unknown)).toEqual({ kind: 'LEAVE' });
    }
  });
});

describe('an expired device is not sent to', () => {
  it('accepts a subscription with no stated expiry', () => {
    for (const value of [null, undefined, '']) {
      expect(subscriptionUsable(value, NOW)).toBe(true);
    }
  });

  it('accepts one that has not expired and refuses one that has', () => {
    expect(subscriptionUsable(new Date(NOW + 60_000).toISOString(), NOW)).toBe(true);
    expect(subscriptionUsable(new Date(NOW - 1).toISOString(), NOW)).toBe(false);
  });
});

describe('what may travel to a locked screen', () => {
  const payload = alertPayload({
    interventionId: '33333333-3333-4333-8333-333333333333',
    publishedAt: NOW,
    repeat: false,
  });

  it('carries exactly three fields and no fourth', () => {
    expect(Object.keys(JSON.parse(payload)).sort()).toEqual([...ALLOWED_PAYLOAD_KEYS].sort());
  });

  it('names an intervention and says nothing whatever about it', () => {
    // The list the review asked for, as an assertion rather than a promise.
    // Anybody standing near a locked phone can read this, and a push service
    // this society does not run stores it on the way.
    const sensitive = [
      'Pozar', 'pozar', 'title', 'naslov',
      'location', 'lokacija', 'Donja Lastva', 'assembly', 'okupljanje',
      'instructions', 'uputstvo',
      'member', 'clan', 'Ivo', 'name', 'ime',
      'answer', 'odgovor', 'attendance', 'prisustvo',
      'endpoint', 'user_id', 'userId', 'email', 'auth', 'p256dh', 'token', 'key',
    ];
    for (const value of sensitive) {
      expect(payload, `"${value}" must never reach a push payload`).not.toContain(value);
    }
  });

  it('distinguishes the repeat without describing it', () => {
    const repeated = JSON.parse(
      alertPayload({ interventionId: '33333333-3333-4333-8333-333333333333', publishedAt: NOW, repeat: true }),
    );
    expect(repeated.repeat).toBe(true);
    expect(Object.keys(repeated).sort()).toEqual([...ALLOWED_PAYLOAD_KEYS].sort());
  });

  it('cannot be widened by passing extra fields', () => {
    // The failure mode this function exists to prevent: somebody in a hurry
    // spreading a whole row into the payload.
    const sneaky = alertPayload({
      interventionId: '33333333-3333-4333-8333-333333333333',
      publishedAt: NOW,
      repeat: false,
      // @ts-expect-error - deliberately passing a field the type forbids
      title: 'Pozar niskog rastinja',
      incidentLocation: 'Donja Lastva',
    });
    expect(sneaky).not.toContain('Pozar');
    expect(sneaky).not.toContain('Donja Lastva');
    expect(Object.keys(JSON.parse(sneaky)).sort()).toEqual([...ALLOWED_PAYLOAD_KEYS].sort());
  });
});

describe('the crew is alerted together, not one after another', () => {
  /** A unit of work that takes `ms` and records when it ran. */
  const timed = (log: number[], ms: number) => async (value: number) => {
    log.push(value);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return value * 2;
  };

  it('starts up to the limit at once instead of waiting for each', async () => {
    // The defect this replaced: eight firefighters meant eight sequential HTTPS
    // round trips, so the eighth phone rang last by seven round trips.
    const started: number[] = [];
    const began = Date.now();
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 8, timed(started, 30));
    expect(started).toHaveLength(8);
    // Eight sequential 30ms units would be 240ms. Generous ceiling: the
    // assertion is "not serialised", not a benchmark.
    expect(Date.now() - began).toBeLessThan(200);
  });

  it('respects the limit rather than sending everything at once', async () => {
    // A thundering herd is how a society gets rate limited on the one night it
    // matters, so the width is bounded even when the list is long.
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 40 }, (_, index) => index), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('returns results in the order of the input, not the order they finished', async () => {
    const results = await mapWithConcurrency([50, 10, 30], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(results.map((result) => (result.status === 'fulfilled' ? result.value : null)))
      .toEqual([50, 10, 30]);
  });

  it('does not let one failed device abandon another member', async () => {
    // The bug an unguarded `Promise.all` would have introduced while "fixing"
    // the speed: the first rejection discards every other alert in flight.
    const results = await mapWithConcurrency([1, 2, 3], 3, async (value) => {
      if (value === 2) throw new Error('PROVIDER_REFUSED');
      return value;
    });
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
  });

  it('handles an empty list and a nonsense limit without hanging', async () => {
    await expect(mapWithConcurrency([], 8, async () => 1)).resolves.toEqual([]);
    await expect(mapWithConcurrency([1, 2], 0, async (value) => value)).resolves.toHaveLength(2);
    await expect(mapWithConcurrency([1, 2], -5, async (value) => value)).resolves.toHaveLength(2);
  });

  it('keeps the width sane by default', () => {
    expect(SEND_CONCURRENCY).toBeGreaterThan(1);
    expect(SEND_CONCURRENCY).toBeLessThanOrEqual(16);
  });
});

describe('which path delivered the alert is recorded', () => {
  it('tells the commander wake-up apart from the scheduled sweep', () => {
    // The whole point. A delay caused by the immediate request never arriving
    // and a delay caused by the immediate request being slow have completely
    // different fixes, and `ACCEPTED` alone could not tell them apart.
    expect(attemptStatus('ACCEPTED', false)).toBe('ACCEPTED_IMMEDIATE');
    expect(attemptStatus('ACCEPTED', true)).toBe('ACCEPTED_SCHEDULED');
  });

  it('leaves the refusal categories unchanged and path-free', () => {
    // These say why nothing was sent, which does not depend on who asked.
    for (const viaScheduler of [true, false]) {
      expect(attemptStatus('REVOKED', viaScheduler)).toBe('ACCESS_REVOKED');
      expect(attemptStatus('NONE', viaScheduler)).toBe('NO_ACTIVE_SUBSCRIPTION');
    }
  });

  it('says nothing about the member, the device or the intervention', () => {
    const everyStatus = [
      attemptStatus('ACCEPTED', false), attemptStatus('ACCEPTED', true),
      attemptStatus('REVOKED', false), attemptStatus('NONE', false),
    ];
    for (const status of everyStatus) {
      // A status word is written to a table commanders can read. It is allowed
      // to be a category and a path, and nothing else.
      expect(status).toMatch(/^[A-Z_]+$/);
      expect(status.length).toBeLessThan(40);
    }
  });
});
