/**
 * One fake project, shared by two independent browser contexts, with a real
 * Realtime socket.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AND WHAT IT REPLACED
 * ---------------------------------------------------------------------------
 *
 * An independent review asked for proof that a change made by one signed-in
 * person appears on another person's already-open screen without navigation or
 * a manual refresh. The previous attempt at that proof signed out and signed
 * back in, which proves nothing: one session at a time never has to deliver
 * anything to anybody.
 *
 * `e2e/fixture-server.ts` cannot answer it either. It installs a read-only
 * snapshot per page, so two pages there hold two unrelated copies of the world
 * and a write in one is invisible to the other by construction.
 *
 * So this module holds ONE mutable store in the Node test process and serves it
 * to every browser context that installs it. A command from context A really
 * does change the row that context B reads. Both contexts are created with
 * `browser.newContext()`, which gives each its own cookie jar, its own
 * `localStorage` and its own Supabase session - the independence the review
 * asked for, and the reason two tabs of one browser would not have counted.
 *
 * ---------------------------------------------------------------------------
 * THE REALTIME SOCKET IS REAL
 * ---------------------------------------------------------------------------
 *
 * `page.route` does not intercept a WebSocket, so under the old fixture the
 * socket simply failed and every screen fell back to twelve-second polling.
 * A test that waits twelve seconds and then sees the change has not tested
 * Realtime; it has tested a timer.
 *
 * `context.routeWebSocket` does intercept one, so the hub below speaks the
 * Phoenix protocol `@supabase/realtime-js` actually sends: `phx_join` with the
 * client's `postgres_changes` bindings, a `phx_reply` echoing them back with
 * server ids, `heartbeat` replies, and `postgres_changes` frames carrying those
 * ids. The application's own `useLiveOperations` runs unmodified against it and
 * reports `LIVE`, which is the state the assertions require - a test that
 * accepted `POLLING` would pass with the socket broken.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 * ---------------------------------------------------------------------------
 *
 * **It is not the hosted project and does not enforce authorisation.** The
 * visibility rule below is a deliberately small imitation of one policy, and it
 * proves something about the CLIENT: that a change notice is never treated as
 * permission to display anything. Row level security itself is proved against a
 * real PostgreSQL in `db-tests/`, and the hosted project is a separate,
 * credentialed check that CI cannot make.
 *
 * Nothing here contacts a real host. `fixture-not-a-real-project.supabase.co`
 * is not a project anybody owns, there are no credentials in this file, and
 * every name in it is fictional.
 */

import type { BrowserContext, Route } from '@playwright/test';

export const PROJECT_HOST = 'fixture-not-a-real-project.supabase.co';
const PROJECT_REF = 'fixture-not-a-real-project';

export const COMMANDER_MEMBER = '11111111-1111-4111-8111-111111111111';
export const FIREFIGHTER_MEMBER = '22222222-2222-4222-8222-222222222222';
export const OUTSIDER_MEMBER = '33333333-3333-4333-8333-333333333333';

export const COMMANDER_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const FIREFIGHTER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const VEHICLE_ID = '55555555-5555-4555-8555-555555555555';

/** An intervention the firefighter is NOT invited to. Used by the isolation test. */
export const PRIVATE_INTERVENTION = '77777777-7777-4777-8777-777777777777';

export type FixtureRole = 'OWNER' | 'ADMIN' | 'COMMANDER' | 'FIREFIGHTER';

export interface Identity {
  readonly userId: string;
  readonly email: string;
  readonly memberId: string;
  readonly role: FixtureRole;
  readonly name: string;
}

export const COMMANDER: Identity = {
  userId: COMMANDER_USER,
  email: 'komandir@example.invalid',
  memberId: COMMANDER_MEMBER,
  role: 'COMMANDER',
  name: 'Komandir Smjene',
};

export const FIREFIGHTER: Identity = {
  userId: FIREFIGHTER_USER,
  email: 'vatrogasac@example.invalid',
  memberId: FIREFIGHTER_MEMBER,
  role: 'FIREFIGHTER',
  name: 'Ivo Vatrogasac',
};

type Row = Record<string, unknown>;

interface Store {
  interventions: Row[];
  intervention_recipients: Row[];
  intervention_acknowledgements: Row[];
  intervention_responses: Row[];
  intervention_journey: Row[];
  attendance_intervals: Row[];
  vehicle_movements: Row[];
  vehicles: Row[];
  member_availability: Row[];
  members: Row[];
  groups: Row[];
  group_members: Row[];
  profiles: Row[];
  audit: Row[];
}

/**
 * A clock that always moves forward.
 *
 * Two commands in the same millisecond would otherwise produce identical
 * timestamps, and the assertions about ordering and about durations would then
 * be testing `Date.now()`'s resolution rather than the application. It also
 * makes every duration in the test a known number of milliseconds.
 */
function makeClock() {
  let at = Date.parse('2026-09-13T08:00:00.000Z');
  return {
    now(): string {
      at += 1000;
      return new Date(at).toISOString();
    },
    peek(): string {
      return new Date(at).toISOString();
    },
  };
}

let counter = 0;
const id = (prefix: string): string =>
  `${prefix}${(counter += 1).toString().padStart(8, '0')}-0000-4000-8000-000000000000`.slice(0, 36);

export interface LiveProject {
  /** Installs the project into one browser context, signed in as `who`. */
  install(context: BrowserContext, who: Identity): Promise<void>;
  /** How many sockets are currently joined. Pins "one channel, not two". */
  socketCount(): number;
  /**
   * Takes Realtime away, as a proxy or a lost network would.
   *
   * Closes every open socket AND refuses the joins that follow, so the
   * application genuinely falls back rather than reconnecting within the
   * second and hiding the gap the test is about.
   */
  cutRealtime(): void;
  /** Lets joins succeed again. The client reconnects on its own timer. */
  restoreRealtime(): void;
  /**
   * Pushes a change notice for a row the receiver must not be shown.
   *
   * Deliberately crafted to carry a marker string in its payload, so the test
   * can assert the marker never reaches the screen - the client must re-read
   * through the policy-checked query rather than render what arrived.
   */
  leakAttempt(marker: string): void;
  /** Read the store from the test, to assert on what the commands wrote. */
  read<K extends keyof Store>(table: K): readonly Row[];
}

export function createLiveProject(): LiveProject {
  const clock = makeClock();

  const store: Store = {
    interventions: [
      {
        id: PRIVATE_INTERVENTION,
        kind: 'TEHNICKA',
        other_kind_note: null,
        title: 'Interna priprema (izmisljeno)',
        instructions: 'Samo za komandni sastav.',
        incident_location: 'Baza DVD Tivat',
        assembly_point: null,
        latitude: null,
        longitude: null,
        // CLOSED and OLDER than anything the tests create, so it is never the
        // intervention a console happens to focus. Its whole job is to exist
        // and be invisible to an account that was not invited to it.
        status: 'CLOSED',
        version: 3,
        published_at: '2026-09-13T06:00:00.000Z',
        closed_at: '2026-09-13T06:30:00.000Z',
        close_reason: 'Zavrseno.',
        created_at: '2026-09-13T05:00:00.000Z',
      },
    ],
    intervention_recipients: [
      {
        intervention_id: PRIVATE_INTERVENTION,
        member_id: COMMANDER_MEMBER,
        member_name_at_publication: 'Komandir Smjene',
      },
    ],
    intervention_acknowledgements: [],
    intervention_responses: [],
    intervention_journey: [],
    attendance_intervals: [],
    vehicle_movements: [],
    vehicles: [
      { id: VEHICLE_ID, callsign: 'NV-1', name: 'Navalno vozilo', kind: 'Navalno', active: true },
    ],
    member_availability: [],
    members: [
      { id: COMMANDER_MEMBER, full_name: 'Komandir Smjene', specialties: [], active: true, user_id: COMMANDER_USER },
      { id: FIREFIGHTER_MEMBER, full_name: 'Ivo Vatrogasac', specialties: ['Nosilac IDA aparata'], active: true, user_id: FIREFIGHTER_USER },
      { id: OUTSIDER_MEMBER, full_name: 'Pero Vatrogasac', specialties: [], active: true, user_id: null },
    ],
    groups: [],
    group_members: [],
    profiles: [
      { user_id: COMMANDER_USER, email: COMMANDER.email, full_name: COMMANDER.name, profile_complete: true },
      { user_id: FIREFIGHTER_USER, email: FIREFIGHTER.email, full_name: FIREFIGHTER.name, profile_complete: true },
    ],
    audit: [],
  };

  // -------------------------------------------------------------------------
  // The Realtime hub
  // -------------------------------------------------------------------------

  interface Socket {
    readonly who: Identity;
    /** Server-assigned binding ids, in the order the client sent its filters. */
    bindings: { id: number; table: string }[];
    topic: string | null;
    send(frame: unknown): void;
    close(): void;
  }

  const sockets = new Set<Socket>();
  let nextBindingId = 1;
  /** While true, every join is refused - the outage the recovery test needs. */
  let realtimeDown = false;

  /**
   * Whether a given account may be told that a row in this table moved.
   *
   * A small imitation of one policy, not a re-implementation of the schema. The
   * only thing it needs to get right for these tests is the case the review
   * named: an account that is not a recipient of an intervention must not be
   * told about its rows. The real rule is enforced by PostgreSQL and proved in
   * `db-tests/`; the point HERE is that even when a notice does arrive, the
   * client renders nothing from it.
   */
  function mayHear(who: Identity, interventionId: string | null): boolean {
    if (who.role !== 'FIREFIGHTER') return true;
    if (interventionId === null) return true;
    return store.intervention_recipients.some(
      (row) => row['intervention_id'] === interventionId && row['member_id'] === who.memberId,
    );
  }

  /** One `postgres_changes` frame, in the shape realtime-js parses. */
  function broadcast(table: string, record: Row, interventionId: string | null): void {
    for (const socket of sockets) {
      if (socket.topic === null) continue;
      if (!mayHear(socket.who, interventionId)) continue;
      const ids = socket.bindings.filter((b) => b.table === table).map((b) => b.id);
      if (ids.length === 0) continue;
      socket.send({
        topic: socket.topic,
        event: 'postgres_changes',
        ref: null,
        payload: {
          ids,
          data: {
            type: 'UPDATE',
            schema: 'public',
            table,
            commit_timestamp: clock.peek(),
            record,
            old_record: {},
            columns: [],
            errors: null,
          },
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  function audit(type: string, who: Identity, detail: Row): void {
    store.audit.push({
      event_id: id('ee'),
      occurred_at: clock.now(),
      event_type: type,
      detail,
      actor_name: who.name,
      actor_is_you: false,
      intervention_id: detail['intervention_id'] ?? null,
    });
  }

  function intervention(target: unknown): Row | undefined {
    return store.interventions.find((row) => row['id'] === target);
  }

  /** Every command, keyed by the RPC name the client calls. */
  const COMMANDS: Record<string, (args: Row, who: Identity) => unknown> = {
    create_intervention_draft(args, who) {
      const newId = id('11');
      store.interventions.push({
        id: newId,
        kind: args['requested_kind'],
        other_kind_note: args['requested_other_kind_note'] ?? null,
        title: args['requested_title'],
        instructions: args['requested_instructions'],
        incident_location: args['requested_location'],
        assembly_point: args['requested_assembly_point'] ?? null,
        latitude: null,
        longitude: null,
        status: 'DRAFT',
        version: 1,
        published_at: null,
        closed_at: null,
        close_reason: null,
        created_at: clock.now(),
      });
      audit('INTERVENTION_DRAFTED', who, { intervention_id: newId });
      broadcast('interventions', { id: newId }, newId);
      return newId;
    },

    publish_intervention(args, who) {
      const row = intervention(args['target_intervention']);
      if (row === undefined) return null;
      const at = clock.now();
      row['status'] = 'PUBLISHED';
      row['published_at'] = at;
      row['version'] = Number(row['version'] ?? 1) + 1;
      for (const memberId of (args['recipient_member_ids'] as string[]) ?? []) {
        const member = store.members.find((m) => m['id'] === memberId);
        store.intervention_recipients.push({
          intervention_id: row['id'],
          member_id: memberId,
          member_name_at_publication: member?.['full_name'] ?? 'Nepoznat clan',
        });
      }
      audit('INTERVENTION_PUBLISHED', who, {
        intervention_id: row['id'],
        recipient_count: (args['recipient_member_ids'] as string[])?.length ?? 0,
      });
      broadcast('interventions', { id: row['id'], status: 'PUBLISHED' }, row['id'] as string);
      broadcast('intervention_recipients', { intervention_id: row['id'] }, row['id'] as string);
      return row['id'];
    },

    acknowledge_intervention(args, who) {
      const target = args['target_intervention'] as string;
      const already = store.intervention_acknowledgements.find(
        (r) => r['intervention_id'] === target && r['member_id'] === who.memberId,
      );
      // Opening is a FIRST-time fact. Re-opening the screen must not move it.
      if (already !== undefined) return null;
      store.intervention_acknowledgements.push({
        intervention_id: target,
        member_id: who.memberId,
        opened_at: clock.now(),
      });
      audit('INTERVENTION_ACKNOWLEDGED', who, { intervention_id: target, member_id: who.memberId });
      broadcast('intervention_acknowledgements', { intervention_id: target }, target);
      return null;
    },

    submit_response(args, who) {
      const target = args['target_intervention'] as string;
      const at = clock.now();
      const existing = store.intervention_responses.find(
        (r) => r['intervention_id'] === target && r['member_id'] === who.memberId,
      );
      const next = {
        intervention_id: target,
        member_id: who.memberId,
        answer: args['requested_answer'],
        eta_minutes: args['requested_eta'] ?? null,
        responded_at: existing?.['responded_at'] ?? at,
        updated_at: at,
      };
      if (existing === undefined) store.intervention_responses.push(next);
      else Object.assign(existing, next);
      audit('RESPONSE_SUBMITTED', who, {
        intervention_id: target, member_id: who.memberId, answer: args['requested_answer'],
      });
      broadcast('intervention_responses', { intervention_id: target }, target);
      return null;
    },

    set_journey_progress(args, who) {
      const target = args['target_intervention'] as string;
      const at = clock.now();
      const existing = store.intervention_journey.find(
        (r) => r['intervention_id'] === target && r['member_id'] === who.memberId,
      );
      const from = existing?.['progress'] ?? null;
      if (existing === undefined) {
        store.intervention_journey.push({
          intervention_id: target, member_id: who.memberId,
          progress: args['requested_progress'], updated_at: at,
        });
      } else {
        existing['progress'] = args['requested_progress'];
        existing['updated_at'] = at;
      }
      // Every step is audited. The current-state row holds only the latest, which
      // is exactly why the archive reads the audit instead.
      audit('JOURNEY_PROGRESS_SET', who, {
        intervention_id: target, member_id: who.memberId,
        from, to: args['requested_progress'],
      });
      broadcast('intervention_journey', { intervention_id: target }, target);
      return null;
    },

    attendance_check_in(args, who) {
      const target = args['target_intervention'] as string;
      const member = (args['target_member'] as string | null) ?? who.memberId;
      const intervalId = id('44');
      store.attendance_intervals.push({
        id: intervalId,
        intervention_id: target,
        member_id: member,
        started_at: clock.now(),
        ended_at: null,
        source: 'SELF_DECLARED',
        verified: false,
        rejected_at: null,
        rejection_reason: null,
      });
      audit('ATTENDANCE_CHECK_IN', who, { intervention_id: target, member_id: member });
      broadcast('attendance_intervals', { intervention_id: target }, target);
      return intervalId;
    },

    attendance_check_out(args, who) {
      const target = args['target_intervention'] as string;
      const member = (args['target_member'] as string | null) ?? who.memberId;
      const open = store.attendance_intervals.find(
        (r) => r['intervention_id'] === target && r['member_id'] === member && r['ended_at'] === null,
      );
      if (open === undefined) return null;
      open['ended_at'] = clock.now();
      audit('ATTENDANCE_CHECK_OUT', who, { intervention_id: target, member_id: member });
      broadcast('attendance_intervals', { intervention_id: target }, target);
      return null;
    },

    attendance_confirm(args, who) {
      const interval = store.attendance_intervals.find((r) => r['id'] === args['target_interval']);
      if (interval === undefined) return null;
      interval['verified'] = true;
      audit('ATTENDANCE_CONFIRMED', who, {
        intervention_id: interval['intervention_id'],
        member_id: interval['member_id'],
        note: args['requested_note'] ?? null,
      });
      broadcast('attendance_intervals', { id: interval['id'] }, interval['intervention_id'] as string);
      return null;
    },

    attendance_confirm_many(args, who) {
      const ids = (args['target_intervals'] as string[]) ?? [];
      for (const target of ids) COMMANDS['attendance_confirm']?.({ target_interval: target, requested_note: args['requested_note'] }, who);
      return ids.map((interval_id) => ({ interval_id, outcome: 'CONFIRMED' }));
    },

    record_vehicle_departure(args, who) {
      const movementId = id('66');
      store.vehicle_movements.push({
        id: movementId,
        vehicle_id: args['target_vehicle'],
        intervention_id: args['target_intervention'] ?? null,
        purpose: args['requested_purpose'] ?? null,
        departed_at: clock.now(),
        returned_at: null,
      });
      audit('VEHICLE_DEPARTED', who, {
        intervention_id: args['target_intervention'] ?? null,
        movement_id: movementId,
        vehicle_id: args['target_vehicle'],
      });
      broadcast('vehicle_movements', { id: movementId }, (args['target_intervention'] as string) ?? null);
      return movementId;
    },

    record_vehicle_return(args, who) {
      const movement = store.vehicle_movements.find((r) => r['id'] === args['target_movement']);
      if (movement === undefined) return null;
      movement['returned_at'] = clock.now();
      audit('VEHICLE_RETURNED', who, {
        intervention_id: movement['intervention_id'],
        movement_id: movement['id'],
      });
      broadcast('vehicle_movements', { id: movement['id'] }, movement['intervention_id'] as string | null);
      return null;
    },

    set_intervention_status(args, who) {
      const row = intervention(args['target_intervention']);
      if (row === undefined) return null;
      const from = row['status'];
      row['status'] = args['requested_status'];
      row['version'] = Number(row['version'] ?? 1) + 1;
      audit('INTERVENTION_STATUS_CHANGED', who, {
        intervention_id: row['id'], from, to: args['requested_status'],
      });
      broadcast('interventions', { id: row['id'] }, row['id'] as string);
      return null;
    },

    close_intervention(args, who) {
      const row = intervention(args['target_intervention']);
      if (row === undefined) return null;
      const from = row['status'];
      row['status'] = args['requested_status'];
      row['closed_at'] = clock.now();
      row['close_reason'] = args['requested_reason'];
      row['version'] = Number(row['version'] ?? 1) + 1;
      audit('INTERVENTION_STATUS_CHANGED', who, {
        intervention_id: row['id'], from, to: args['requested_status'],
      });
      audit('INTERVENTION_CLOSED', who, {
        intervention_id: row['id'], reason: args['requested_reason'], open_attendance: 0,
      });
      broadcast('interventions', { id: row['id'] }, row['id'] as string);
      return null;
    },

    set_own_availability(args, who) {
      const existing = store.member_availability.find((r) => r['member_id'] === who.memberId);
      const next = {
        member_id: who.memberId,
        available: args['requested_available'],
        note: args['requested_note'] ?? null,
        changed_at: clock.now(),
      };
      if (existing === undefined) store.member_availability.push(next);
      else Object.assign(existing, next);
      broadcast('member_availability', { member_id: who.memberId }, null);
      return null;
    },
  };

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** What this account is allowed to read, table by table. */
  function visible(table: keyof Store, who: Identity): Row[] {
    const rows = store[table];
    if (who.role !== 'FIREFIGHTER') return rows;

    const mine = new Set(
      store.intervention_recipients
        .filter((r) => r['member_id'] === who.memberId)
        .map((r) => r['intervention_id']),
    );
    if (table === 'interventions') return rows.filter((r) => mine.has(r['id']));
    if (
      table === 'intervention_recipients' || table === 'intervention_acknowledgements' ||
      table === 'intervention_responses' || table === 'intervention_journey' ||
      table === 'attendance_intervals'
    ) {
      return rows.filter((r) => mine.has(r['intervention_id']));
    }
    return rows;
  }

  /**
   * The `?column=eq.value`, `?order=` and `?limit=` PostgREST sends.
   *
   * Ordering is not decoration. `fetchInterventions` asks for
   * `created_at.desc` and the console focuses `interventions[0]` when nothing
   * else is selected, so a fixture that ignored `order` would hand the screen a
   * different intervention than the server would - and every assertion about
   * "the newest call-out" would be testing insertion order.
   */
  function applyQuery(rows: Row[], params: URLSearchParams): Row[] {
    let out = rows;
    for (const [key, raw] of params.entries()) {
      if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') continue;
      if (!raw.startsWith('eq.')) continue;
      const wanted = raw.slice(3);
      out = out.filter((row) => String(row[key] ?? '') === wanted);
    }

    const order = params.get('order');
    if (order !== null) {
      const [column, direction] = order.split('.');
      if (column !== undefined) {
        const sign = direction === 'desc' ? -1 : 1;
        out = [...out].sort((a, b) => {
          const left = String(a[column] ?? '');
          const right = String(b[column] ?? '');
          // A stable secondary key, for the same reason the application has
          // one: two rows written in one transaction share a timestamp.
          return left === right
            ? String(a['id'] ?? '').localeCompare(String(b['id'] ?? ''))
            : sign * left.localeCompare(right);
        });
      }
    }

    const limit = Number(params.get('limit') ?? '');
    return Number.isFinite(limit) && limit > 0 ? out.slice(0, limit) : out;
  }

  function json(route: Route, body: unknown, status = 200): Promise<void> {
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });
  }

  function rpcRead(name: string, args: Row, who: Identity): unknown {
    switch (name) {
      case 'current_dvd_role':
        return who.role;
      case 'current_account_status':
        return 'ACTIVE';
      case 'current_member_id':
        return who.memberId;
      case 'eligible_recipients':
        return store.members
          .filter((m) => m['active'] === true && m['user_id'] !== null)
          .map((m) => ({
            member_id: m['id'], full_name: m['full_name'],
            role: m['id'] === COMMANDER_MEMBER ? 'COMMANDER' : 'FIREFIGHTER', specialties: [],
          }));
      case 'intervention_audit': {
        const target = args['target_intervention'];
        if (!mayHear(who, target as string)) return [];
        return store.audit
          .filter((row) => row['intervention_id'] === target)
          .map((row) => ({
            event_id: row['event_id'],
            occurred_at: row['occurred_at'],
            event_type: row['event_type'],
            detail: row['detail'],
            actor_name: row['actor_name'],
            actor_is_you: row['actor_name'] === who.name,
          }));
      }
      case 'attendance_totals': {
        const totals = new Map<string, { c: number; s: number; u: number; us: number; o: number }>();
        for (const row of store.attendance_intervals) {
          const key = String(row['member_id']);
          const entry = totals.get(key) ?? { c: 0, s: 0, u: 0, us: 0, o: 0 };
          const started = Date.parse(String(row['started_at']));
          const ended = row['ended_at'] === null ? null : Date.parse(String(row['ended_at']));
          if (ended === null) entry.o += 1;
          else if (row['verified'] === true) {
            entry.c += 1;
            // Exact seconds, as `attendance_totals()` returns them. The client
            // converts once; nothing rounds on the way.
            entry.s += (ended - started) / 1000;
          } else {
            entry.u += 1;
            entry.us += (ended - started) / 1000;
          }
          totals.set(key, entry);
        }
        return [...totals.entries()].map(([memberId, entry]) => ({
          member_id: memberId,
          full_name: store.members.find((m) => m['id'] === memberId)?.['full_name'] ?? '?',
          confirmed_intervals: entry.c,
          confirmed_seconds: entry.s,
          unverified_intervals: entry.u,
          unverified_seconds: entry.us,
          open_intervals: entry.o,
          rejected_intervals: 0,
        }));
      }
      default:
        return undefined;
    }
  }

  // -------------------------------------------------------------------------

  async function install(context: BrowserContext, who: Identity): Promise<void> {
    /*
     * The socket, before anything navigates.
     *
     * `connectToServer()` is deliberately never called: there is no server to
     * connect to and this route IS the server. Everything below is the subset
     * of the Phoenix protocol `@supabase/realtime-js` sends.
     */
    await context.routeWebSocket(`wss://${PROJECT_HOST}/realtime/v1/**`, (ws) => {
      const socket: Socket = {
        who,
        bindings: [],
        topic: null,
        send: (frame) => ws.send(JSON.stringify(frame)),
        close: () => void ws.close({ code: 1006, reason: 'network' }),
      };
      sockets.add(socket);

      ws.onClose(() => {
        sockets.delete(socket);
      });

      ws.onMessage((raw) => {
        let message: {
          topic?: string; event?: string; ref?: string | number;
          payload?: { config?: { postgres_changes?: { event: string; schema: string; table: string }[] } };
        };
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }

        // The keep-alive. Without a reply the client decides the connection is
        // dead and tears it down mid-test.
        if (message.event === 'heartbeat') {
          socket.send({
            topic: 'phoenix', event: 'phx_reply', ref: message.ref,
            payload: { status: 'ok', response: {} },
          });
          return;
        }

        if (message.event === 'phx_join') {
          if (realtimeDown) {
            // What a blocked or unreachable Realtime looks like from the
            // client: the join is answered, and answered with a refusal. The
            // application must then say POLLING rather than claiming "uzivo".
            socket.send({
              topic: message.topic, event: 'phx_reply', ref: message.ref,
              payload: { status: 'error', response: { reason: 'unavailable' } },
            });
            return;
          }
          socket.topic = message.topic ?? null;
          const filters = message.payload?.config?.postgres_changes ?? [];
          /*
           * The reply must echo each filter back UNCHANGED with an added id.
           * realtime-js compares event, schema, table and filter one by one and
           * errors the channel on any mismatch - which is how a plausible-looking
           * fixture ends up testing the polling fallback without saying so.
           */
          socket.bindings = filters.map((filter) => ({
            id: (nextBindingId += 1),
            table: filter.table,
          }));
          socket.send({
            topic: message.topic,
            event: 'phx_reply',
            ref: message.ref,
            payload: {
              status: 'ok',
              response: {
                postgres_changes: filters.map((filter, index) => ({
                  ...filter,
                  id: socket.bindings[index]?.id,
                })),
              },
            },
          });
          return;
        }

        if (message.event === 'phx_leave') {
          socket.topic = null;
          socket.bindings = [];
          socket.send({
            topic: message.topic, event: 'phx_reply', ref: message.ref,
            payload: { status: 'ok', response: {} },
          });
        }
      });
    });

    await context.route(`**://${PROJECT_HOST}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;

      if (request.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': '*',
          },
        });
      }

      if (path.startsWith('/auth/v1/user')) {
        return json(route, { id: who.userId, email: who.email, aud: 'authenticated' });
      }
      if (path.startsWith('/auth/v1/')) {
        return json(route, {
          access_token: `fixture-${who.role}`,
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: `fixture-${who.role}`,
          user: { id: who.userId, email: who.email },
        });
      }

      if (path.startsWith('/rest/v1/rpc/')) {
        const name = path.replace('/rest/v1/rpc/', '');
        let args: Row = {};
        try {
          args = JSON.parse(request.postData() ?? '{}') as Row;
        } catch {
          args = {};
        }
        const read = rpcRead(name, args, who);
        if (read !== undefined) return json(route, read);
        const command = COMMANDS[name];
        if (command !== undefined) return json(route, command(args, who) ?? null);
        // An unimplemented command answers "fine" rather than failing the test
        // for a path it is not about. Anything these tests assert on is above.
        return json(route, null);
      }

      if (path.startsWith('/rest/v1/')) {
        const table = (path.replace('/rest/v1/', '').split('?')[0] ?? '') as keyof Store;
        if (request.method() !== 'GET') return json(route, []);
        if (!(table in store)) return json(route, []);

        const rows = applyQuery(visible(table, who), url.searchParams);
        const wantsObject = (request.headers()['accept'] ?? '').includes(
          'application/vnd.pgrst.object+json',
        );
        if (wantsObject) {
          return rows.length > 0
            ? json(route, rows[0])
            : json(route, { code: 'PGRST116', message: 'no rows' }, 406);
        }
        return json(route, rows);
      }

      return json(route, {}, 404);
    });

    await context.addInitScript(
      ([ref, userId, email, role]) => {
        window.localStorage.setItem(
          `sb-${ref}-auth-token`,
          JSON.stringify({
            access_token: `fixture-${role}`,
            token_type: 'bearer',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expires_in: 3600,
            refresh_token: `fixture-${role}`,
            user: { id: userId, email, aud: 'authenticated', app_metadata: {}, user_metadata: {} },
          }),
        );
      },
      [PROJECT_REF, who.userId, who.email, who.role] as const,
    );
  }

  return {
    install,
    socketCount: () => [...sockets].filter((s) => s.topic !== null).length,
    cutRealtime: () => {
      realtimeDown = true;
      for (const socket of sockets) {
        socket.topic = null;
        socket.bindings = [];
        socket.close();
      }
      sockets.clear();
    },
    restoreRealtime: () => {
      realtimeDown = false;
    },
    leakAttempt: (marker: string) => {
      for (const socket of sockets) {
        if (socket.topic === null) continue;
        const ids = socket.bindings.filter((b) => b.table === 'interventions').map((b) => b.id);
        if (ids.length === 0) continue;
        socket.send({
          topic: socket.topic,
          event: 'postgres_changes',
          ref: null,
          payload: {
            ids,
            data: {
              type: 'UPDATE',
              schema: 'public',
              table: 'interventions',
              commit_timestamp: clock.peek(),
              // A whole row this account may not read, delivered straight down
              // the socket. If any of it reaches the screen, the client has
              // treated a change notice as an authorisation decision.
              record: { id: PRIVATE_INTERVENTION, title: marker, incident_location: marker },
              old_record: {},
              columns: [],
              errors: null,
            },
          },
        });
      }
    },
    read: (table) => store[table],
  };
}
