/**
 * Keeping a screen current without anybody pressing anything.
 *
 * During an incident the commander's console is on a desk and nobody is looking
 * after it. A firefighter answers, starts moving, arrives; the console has to
 * show that without somebody remembering to press a button.
 *
 * **A change notice is never an authorisation decision.** This is the rule the
 * whole module is built around. Nothing here ever puts a payload on the screen.
 * A notice means exactly one thing - "something you care about may have moved" -
 * and the answer is to re-read through the ordinary, policy-checked queries the
 * screen already uses. So a member who should not see a row cannot learn of it
 * from a broadcast: the re-read returns what row level security allows and
 * nothing else, exactly as it did before this file existed.
 *
 * **Two ways to find out, one behaviour.** Realtime is the good one. When it
 * cannot be established - the tables are not in the publication, a proxy blocks
 * the socket, a network refuses to hold one open - the hook falls back to
 * polling in the foreground on a fixed interval. The screen behaves the same
 * either way; only the delay differs. The status is reported so the interface
 * can say which is in use rather than implying a liveness it does not have.
 *
 * **What it never does.** It never subscribes before the server has confirmed
 * who the person is and what they may see. It never opens a second channel for
 * the same scope. It never polls a tab nobody is looking at. It never fires a
 * burst of refetches when several rows change at once. And it never replaces the
 * manual refresh button, which stays as the thing a person can always fall back
 * on.
 */

import { useEffect, useRef, useState } from 'react';
import { accountBackend, isAccountBackendConfigured } from './supabaseClient';

export type LiveStatus =
  /** Not watching: signed out, no access, or no project configured. */
  | 'OFF'
  /** A channel is being established. */
  | 'CONNECTING'
  /** Subscribed. Changes arrive as they happen. */
  | 'LIVE'
  /** Realtime is unavailable; re-reading on a timer while the tab is in front. */
  | 'POLLING';

/**
 * How long to wait after a change notice before re-reading.
 *
 * Publishing a call-out to eight people writes sixteen rows in one transaction.
 * Without this the console would run sixteen refetches, which is both wasteful
 * and visibly janky. One re-read a third of a second later shows the same thing.
 */
const SETTLE_MS = 350;

/** How often to re-read when Realtime is not available. Foreground only. */
const POLL_MS = 12_000;

/** How long to wait before trying Realtime again after it failed. */
const RETRY_MS = 60_000;

/**
 * The tables whose changes matter to an operational screen.
 *
 * Deliberately a short list. Watching every table in the schema would wake the
 * console for a roster edit nobody is looking at.
 */
const WATCHED_TABLES = [
  'interventions',
  'intervention_recipients',
  'intervention_acknowledgements',
  'intervention_responses',
  'intervention_journey',
  'attendance_intervals',
  'vehicle_movements',
  'member_availability',
] as const;

export interface LiveOptions {
  /**
   * Watch only when this is true.
   *
   * The caller passes the result of the access check, so a channel is never
   * opened before the server has said who the person is and that they may see
   * this screen.
   */
  readonly enabled: boolean;
  /** The intervention in focus, so the watch is scoped rather than global. */
  readonly interventionId: string | null;
  /** Re-read. Must go through the normal, policy-checked queries. */
  readonly onChange: () => void;
}

/**
 * Minimal shapes for the parts of the Supabase realtime client used here.
 *
 * Written out rather than imported so the fake channel in the tests is checked
 * against the same contract the real one has to satisfy.
 */
interface LiveChannel {
  on(
    type: 'postgres_changes',
    filter: { event: '*'; schema: string; table: string },
    handler: () => void,
  ): LiveChannel;
  subscribe(callback: (status: string) => void): LiveChannel;
}

interface LiveBackend {
  channel(name: string): LiveChannel;
  removeChannel(channel: LiveChannel): unknown;
}

/** Swapped by the tests. Production always uses the real client. */
let backendForTests: LiveBackend | null = null;

export function __setLiveBackendForTests(backend: LiveBackend | null): void {
  backendForTests = backend;
}

function backend(): LiveBackend | null {
  if (backendForTests !== null) return backendForTests;
  if (!isAccountBackendConfigured()) return null;
  return accountBackend() as unknown as LiveBackend;
}

/**
 * Watches for changes and asks the caller to re-read.
 *
 * Returns what it is currently doing, so a screen can tell a person whether it
 * is live or on a timer instead of leaving them to guess.
 */
export function useLiveOperations({ enabled, interventionId, onChange }: LiveOptions): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('OFF');

  /*
   * The callback lives in a ref and the effect does not depend on it.
   *
   * A caller writing `onChange={() => refresh(id)}` hands us a new function on
   * every render. If the effect depended on it, every render would tear down
   * the channel and open another - which is the duplicate-subscription bug this
   * module is supposed to prevent, arriving through the back door.
   */
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!enabled) {
      setStatus('OFF');
      return;
    }

    let live = true;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: LiveChannel | null = null;
    const api = backend();

    /** One re-read for a burst of changes. */
    const nudge = () => {
      if (!live) return;
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (live) latest.current();
      }, SETTLE_MS);
    };

    const stopPolling = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = () => {
      if (!live || pollTimer !== null) return;
      setStatus('POLLING');
      pollTimer = setInterval(() => {
        // Never poll a tab nobody is looking at. A phone in a pocket must not
        // spend its battery and the society's request quota on a screen that is
        // not on - and coming back to the tab re-reads once anyway, below.
        if (document.visibilityState === 'visible') latest.current();
      }, POLL_MS);
    };

    const openChannel = () => {
      if (!live || api === null) {
        startPolling();
        return;
      }
      setStatus('CONNECTING');
      try {
        // Named for the scope, so switching intervention replaces the channel
        // rather than adding one.
        const next = api.channel(`ops:${interventionId ?? 'all'}`);
        for (const table of WATCHED_TABLES) {
          next.on('postgres_changes', { event: '*', schema: 'public', table }, nudge);
        }
        next.subscribe((state) => {
          if (!live) return;
          if (state === 'SUBSCRIBED') {
            stopPolling();
            setStatus('LIVE');
            // Anything that happened between the last read and the subscription
            // being accepted would otherwise be invisible until the next event.
            latest.current();
            return;
          }
          if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            // Not an error a person needs to see. The screen keeps working on a
            // timer, and the status says so.
            startPolling();
            if (retryTimer === null) {
              retryTimer = setTimeout(() => {
                retryTimer = null;
                if (live) openChannel();
              }, RETRY_MS);
            }
          }
        });
        channel = next;
      } catch {
        startPolling();
      }
    };

    /**
     * Coming back to the application re-reads once, quietly.
     *
     * A socket dropped while the tab was hidden reconnects, but the events that
     * happened in between are gone - Realtime does not replay. One read on
     * resume is what closes that hole.
     */
    const onVisible = () => {
      if (document.visibilityState === 'visible') nudge();
    };
    document.addEventListener('visibilitychange', onVisible);

    openChannel();

    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (settleTimer !== null) clearTimeout(settleTimer);
      if (retryTimer !== null) clearTimeout(retryTimer);
      stopPolling();
      if (channel !== null && api !== null) api.removeChannel(channel);
      channel = null;
    };
    // `onChange` is deliberately absent: see the ref above.
  }, [enabled, interventionId]);

  return status;
}

/** What to tell a person about how the screen is staying current. */
export const LIVE_STATUS_LABEL: Record<LiveStatus, string> = {
  OFF: 'Automatsko osvjezavanje nije ukljuceno',
  CONNECTING: 'Povezivanje sa serverom...',
  LIVE: 'Uzivo - promjene stizu same',
  // Never "uzivo". A twelve-second timer is not the same promise, and a
  // commander deciding whether to trust what is on the screen needs the
  // difference.
  POLLING: 'Osvjezavanje na svakih 12 sekundi',
};
