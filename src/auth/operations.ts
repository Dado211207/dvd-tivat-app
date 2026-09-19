/**
 * The operational data layer: real interventions, responses, journeys,
 * attendance and vehicle movements, read from and written to the server.
 *
 * Everything here goes through the `security definer` commands. There is no
 * direct INSERT or UPDATE anywhere in this file, and there cannot be: no client
 * role holds a write privilege on any operational table, so a mistake here
 * fails at the database rather than corrupting a record.
 *
 * **The one rule this module exists to keep visible.** Six facts about one
 * member on one call-out are six separate reads and six separate writes:
 *
 *   1. were they sent it            `intervention_recipients`
 *   2. did they open it             `intervention_acknowledgements`
 *   3. what did they answer         `intervention_responses`
 *   4. where are they now           `intervention_journey`
 *   5. were they present            `attendance_intervals`
 *   6. does command stand behind it `attendance_intervals.verified`
 *
 * The types below keep them apart deliberately. A single `status: string` per
 * member would be smaller and would be a lie, because it would force the
 * interface to pick one of six answers and discard five.
 *
 * The pure helpers are unit tested. The adapters are exercised by the database
 * suite against real policies, and by the browser suite against a real build.
 */

import { activeText } from '@/i18n/useText';
import { between } from './duration';
import { accountBackend } from './supabaseClient';

// ---------------------------------------------------------------------------
// Vocabulary, matching the database check constraints exactly.
// ---------------------------------------------------------------------------

export const INTERVENTION_KINDS = [
  'POZAR',
  'SAOBRACAJNA_NEZGODA',
  'TEHNICKA_POMOC',
  'VJEZBA',
  'TEST',
  'DRUGO',
] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export const INTERVENTION_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'ASSEMBLING',
  'DEPLOYED',
  'CONTAINED',
  'CLOSED',
  'CANCELLED',
] as const;
export type InterventionStatus = (typeof INTERVENTION_STATUSES)[number];

/** The statuses `set_intervention_status` will accept. CLOSED/CANCELLED need their own command. */
export const SETTABLE_STATUSES = ['PUBLISHED', 'ASSEMBLING', 'DEPLOYED', 'CONTAINED'] as const;

export const RESPONSE_ANSWERS = ['DOLAZIM', 'DOLAZIM_KASNIJE', 'NE_MOGU'] as const;
export type ResponseAnswer = (typeof RESPONSE_ANSWERS)[number];

/** Only these three arrival bands exist; the database refuses anything else. */
export const ETA_BANDS = [15, 30, 60] as const;

export const JOURNEY_STEPS = ['KRECEM', 'U_PUTU', 'NA_LICU_MJESTA', 'ODUSTAJEM'] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

export type AttendanceSource = 'SELF_DECLARED' | 'COMMAND_RECORDED' | 'UNKNOWN';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface Intervention {
  readonly id: string;
  readonly kind: InterventionKind;
  readonly otherKindNote: string | null;
  readonly title: string;
  readonly instructions: string;
  readonly incidentLocation: string;
  readonly assemblyPoint: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly status: InterventionStatus;
  readonly version: number;
  readonly publishedAt: string | null;
  readonly closedAt: string | null;
  readonly closeReason: string | null;
  readonly createdAt: string;
}

/**
 * The timestamp that belongs to the state a row is showing.
 *
 * Found during the device test: the archive list printed
 * "Pozar - Zatvoreno - 18:40" where 18:40 was the PUBLICATION time. A reader
 * has every reason to read the time as the time of the state next to it, so
 * that row said the intervention was closed at the moment it was opened.
 *
 * Each state has exactly one timestamp that means it, and the database
 * guarantees the matching column is present:
 *
 *   DRAFT                                     `created_at`
 *   PUBLISHED/ASSEMBLING/DEPLOYED/CONTAINED   `published_at`  (constraint
 *                                             `intervention_published_fields`)
 *   CLOSED/CANCELLED                          `closed_at`     (constraint
 *                                             `intervention_closed_fields`)
 *
 * Returns null rather than falling back to a different column when the
 * matching one is missing. A fallback is how this defect happened in the first
 * place: it produces a plausible time that means something else. The caller
 * says "Nije zabiljezeno" instead, which is true.
 */
export function stateTimestamp(record: Intervention): string | null {
  switch (record.status) {
    case 'DRAFT':
      return record.createdAt;
    case 'PUBLISHED':
    case 'ASSEMBLING':
    case 'DEPLOYED':
    case 'CONTAINED':
      return record.publishedAt;
    case 'CLOSED':
    case 'CANCELLED':
      return record.closedAt;
  }
}

/**
 * One recorded event in an intervention's chronology.
 *
 * Read from `operational_audit`, which the commands have been writing since the
 * schema was created. The archive used to assemble its chronology from
 * CURRENT-STATE rows instead, which is why only a member's latest movement
 * appeared and no state transition did at all - not because anything was being
 * overwritten, but because nothing read the table that had it.
 */
export interface AuditEvent {
  readonly id: string;
  readonly at: string;
  readonly type: string;
  /** Whatever the writing command recorded. Shapes differ by event type. */
  readonly detail: Record<string, unknown>;
  /** Null when the acting account has no profile name on the server. */
  readonly actorName: string | null;
  readonly actorIsYou: boolean;
}

/** One member the server confirms may be called out, with the role it counted. */
export type OperationalRoleName = 'OWNER' | 'ADMIN' | 'COMMANDER' | 'FIREFIGHTER';

export interface EligibleRecipient {
  readonly memberId: string;
  readonly fullName: string;
  readonly role: OperationalRoleName;
  readonly specialties: readonly string[];
}

export interface RecipientFacts {
  readonly memberId: string;
  readonly memberName: string;
  /** Null when they have not opened it. The FIRST opening, never moved. */
  readonly acknowledgedAt: string | null;
  readonly answer: ResponseAnswer | null;
  readonly etaMinutes: number | null;
  readonly answeredAt: string | null;
  readonly journey: JourneyStep | null;
  readonly journeyAt: string | null;
}

export interface AttendanceInterval {
  readonly id: string;
  readonly memberId: string;
  readonly memberName: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly source: AttendanceSource;
  readonly verified: boolean;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
}

export interface VehicleMovement {
  readonly id: string;
  readonly vehicleId: string;
  readonly callsign: string;
  readonly vehicleName: string;
  readonly interventionId: string | null;
  readonly purpose: string | null;
  readonly departedAt: string;
  readonly returnedAt: string | null;
}

export interface AvailabilityRow {
  readonly memberId: string;
  readonly available: boolean;
  readonly note: string | null;
  readonly changedAt: string;
}

export interface CommandOutcome {
  readonly ok: boolean;
  readonly message?: string;
}

/**
 * The three states an attendance interval can be in.
 *
 * Derived rather than stored, because the database keeps them as two columns
 * (`verified`, `rejected_at`) with a constraint forbidding the contradictory
 * fourth combination. One function computing it means the board, the totals and
 * the history cannot disagree about what a row means.
 */
export type AttendanceState = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export function attendanceState(interval: AttendanceInterval): AttendanceState {
  if (interval.rejectedAt !== null) return 'REJECTED';
  return interval.verified ? 'CONFIRMED' : 'PENDING';
}

/**
 * Exact milliseconds of participation. Only a confirmed, closed interval counts.
 *
 * This used to return SECONDS, floored at 1 so that a sub-second interval could
 * not render as "0 min" - which on a board reads as "did not attend". The floor
 * was a workaround for a formatter that could not say "seconds" at all, and it
 * is gone: `formatDurationMs` can say "0 s", so nothing has to be inflated to
 * look real. See `src/auth/duration.ts`.
 *
 * Returns 0, not null, for an interval that legitimately counts nothing - an
 * open one, a rejected one, one awaiting confirmation. Those are answers, not
 * absences of measurement, and they sum correctly.
 */
export function participationMs(interval: AttendanceInterval): number {
  if (attendanceState(interval) !== 'CONFIRMED') return 0;
  if (interval.endedAt === null) return 0;
  return Math.max(0, between(interval.startedAt, interval.endedAt) ?? 0);
}

/*
 * `formatDuration` is deliberately NOT re-exported from here.
 *
 * It used to live in this file and round every sub-minute duration up to
 * "1 min". Screens import `formatDurationMs` from `./duration` instead, so a
 * call site that was not migrated fails to compile rather than quietly keeping
 * the old contract under a familiar name.
 */

/**
 * What a member still owes an answer on, for one call-out.
 *
 * Deliberately returns every outstanding item rather than "the next step": a
 * commander scanning twenty rows wants to see that somebody opened it and never
 * answered, which a single "next step" label would hide behind the newest fact.
 */
export function outstandingFor(facts: RecipientFacts): readonly ('OPEN' | 'ANSWER')[] {
  const missing: ('OPEN' | 'ANSWER')[] = [];
  if (facts.acknowledgedAt === null) missing.push('OPEN');
  if (facts.answer === null) missing.push('ANSWER');
  return missing;
}

/** True when the call-out can still be acted on at all. */
export function isOpenStatus(status: InterventionStatus): boolean {
  return status !== 'DRAFT' && status !== 'CLOSED' && status !== 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Error translation
//
// The server speaks in stable codes so the interface can be translated without
// the database knowing about language. An unrecognised code must never be shown
// raw: it would leak internals and mean nothing to a firefighter at 03:00.
// ---------------------------------------------------------------------------

export function explainRefusal(raw: string | null | undefined): string {
  const messages = activeText().serverErrors;
  const text = String(raw ?? '');
  for (const [code, message] of Object.entries(messages.operations)) {
    if (text.includes(code)) return message;
  }
  if (/permission denied/i.test(text)) {
    return messages.permissionDenied;
  }
  if (/fetch|network|failed to/i.test(text)) {
    return messages.unavailable;
  }
  return messages.generic;
}

// ---------------------------------------------------------------------------
// Wire shapes.
//
// The Supabase client is untyped here (no generated database types in this
// build), so `data` widens to a union that includes an error shape. Each read
// below narrows to one of these explicitly rather than reaching into an
// unchecked value - the same pattern `roster.ts` uses.
// ---------------------------------------------------------------------------

interface InterventionRow {
  id: string; kind: string; other_kind_note: string | null; title: string;
  instructions: string; incident_location: string; assembly_point: string | null;
  latitude: number | null; longitude: number | null; status: string; version: number;
  published_at: string | null; closed_at: string | null; close_reason: string | null;
  created_at: string;
}
interface RecipientRow { member_id: string; member_name_at_publication: string }
interface AuditRow {
  event_id: string; occurred_at: string; event_type: string;
  detail: unknown; actor_name: string | null; actor_is_you: boolean;
}
interface EligibleRecipientRow {
  member_id: string; full_name: string; role: string; specialties: string[] | null;
}
interface AcknowledgementRow { member_id: string; opened_at: string }
interface ResponseRow {
  member_id: string; answer: string; eta_minutes: number | null;
  updated_at: string | null; responded_at: string;
}
interface JourneyRow { member_id: string; progress: string; updated_at: string }
interface AttendanceRow {
  id: string; member_id: string; started_at: string; ended_at: string | null;
  source: string; verified: boolean; rejected_at: string | null; rejection_reason: string | null;
}
interface MovementRow {
  id: string; vehicle_id: string; intervention_id: string | null; purpose: string | null;
  departed_at: string; returned_at: string | null;
}
interface VehicleRow { id: string; callsign: string; name: string }
interface AvailabilityWireRow {
  member_id: string; available: boolean; note: string | null; changed_at: string;
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

async function command(name: string, args: Record<string, unknown>): Promise<CommandOutcome> {
  try {
    const { error } = await accountBackend().rpc(name, args);
    return error ? { ok: false, message: explainRefusal(error.message) } : { ok: true };
  } catch (error) {
    return { ok: false, message: explainRefusal(String(error)) };
  }
}

async function commandReturning<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    const { data, error } = await accountBackend().rpc(name, args);
    if (error) return { ok: false, message: explainRefusal(error.message) };
    return { ok: true, value: data as T };
  } catch (error) {
    return { ok: false, message: explainRefusal(String(error)) };
  }
}

/**
 * The members a call-out may actually be sent to.
 *
 * Read from the server rather than filtered here. The screen used to apply its
 * own rule - active member row with a linked account - and that rule was wrong
 * in a way nobody noticed until a withdrawn member appeared in the picker
 * during the device test: their roster row was still active and still linked,
 * but the account behind it had been withdrawn, so they could not have opened
 * the call-out or answered it.
 *
 * `eligible_recipients()` applies the identical conditions `publish_intervention`
 * enforces, so the list cannot offer somebody the server will refuse. The
 * server refusing regardless is what makes a modified client harmless; this
 * read only stops a commander being shown a name that would fail.
 *
 * Returns NULL when the list could not be read, and an empty array when the
 * server read fine and nobody qualifies. Those are different sentences on the
 * screen and a commander needs to know which one they are looking at: an empty
 * picker that silently means "the server did not answer" is how somebody stands
 * in front of a console at 03:00 believing the roster is empty.
 *
 * It never falls back to a client-side rule. Doing so would reintroduce the
 * defect at exactly the worst moment, and quietly.
 *
 * A failure here does not take the rest of the console down with it: the other
 * reads answer questions this one cannot, and a commander can still see a
 * running intervention while the picker says it is unavailable.
 */
export async function fetchEligibleRecipients(): Promise<readonly EligibleRecipient[] | null> {
  try {
    const { data, error } = await accountBackend().rpc('eligible_recipients');
    if (error || !data) return null;
    return (data as unknown as EligibleRecipientRow[]).map((row) => ({
      memberId: row.member_id,
      fullName: row.full_name,
      role: row.role as OperationalRoleName,
      specialties: row.specialties ?? [],
    }));
  } catch {
    return null;
  }
}

/**
 * The recorded chronology of one intervention.
 *
 * Returns an empty list when the server refuses or is unreachable, and the
 * screen says which of the two it is rather than presenting "no events" - an
 * empty chronology and an unread one look identical and mean opposite things.
 * Null is "could not read".
 */
export async function fetchInterventionAudit(
  interventionId: string,
): Promise<readonly AuditEvent[] | null> {
  try {
    const { data, error } = await accountBackend().rpc('intervention_audit', {
      target_intervention: interventionId,
    });
    if (error || !data) return null;
    return (data as unknown as AuditRow[]).map((row) => ({
      id: row.event_id,
      at: row.occurred_at,
      type: row.event_type,
      detail: (row.detail ?? {}) as Record<string, unknown>,
      actorName: row.actor_name ?? null,
      actorIsYou: row.actor_is_you === true,
    }));
  } catch {
    return null;
  }
}

/** Which member the signed-in account is, or null. Read from the server, never guessed. */
export async function fetchOwnMemberId(): Promise<string | null> {
  const { data, error } = await accountBackend().rpc('current_member_id');
  if (error) return null;
  return (data as string | null) ?? null;
}

export async function fetchInterventions(): Promise<readonly Intervention[]> {
  const { data, error } = await accountBackend()
    .from('interventions')
    .select(
      'id, kind, other_kind_note, title, instructions, incident_location, assembly_point,' +
        ' latitude, longitude, status, version, published_at, closed_at, close_reason, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !data) return [];
  return (data as unknown as InterventionRow[]).map((row) => ({
    id: row.id,
    kind: row.kind as InterventionKind,
    otherKindNote: (row.other_kind_note as string | null) ?? null,
    title: row.title as string,
    instructions: row.instructions as string,
    incidentLocation: row.incident_location as string,
    assemblyPoint: (row.assembly_point as string | null) ?? null,
    latitude: (row.latitude as number | null) ?? null,
    longitude: (row.longitude as number | null) ?? null,
    status: row.status as InterventionStatus,
    version: row.version as number,
    publishedAt: (row.published_at as string | null) ?? null,
    closedAt: (row.closed_at as string | null) ?? null,
    closeReason: (row.close_reason as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

/**
 * Every fact about every recipient of one intervention, kept apart.
 *
 * Four reads rather than one join, because row level security answers each of
 * them differently: a commander sees all four in full, a member sees the crew's
 * responses and journeys but is not shown the recipient list as an admin list.
 * Merging server-side would hide which part a refusal came from.
 */
export async function fetchRecipientFacts(
  interventionId: string,
): Promise<readonly RecipientFacts[]> {
  const backend = accountBackend();
  const [recipients, acknowledgements, responses, journeys] = await Promise.all([
    backend
      .from('intervention_recipients')
      .select('member_id, member_name_at_publication')
      .eq('intervention_id', interventionId),
    backend
      .from('intervention_acknowledgements')
      .select('member_id, opened_at')
      .eq('intervention_id', interventionId),
    backend
      .from('intervention_responses')
      .select('member_id, answer, eta_minutes, updated_at, responded_at')
      .eq('intervention_id', interventionId),
    backend
      .from('intervention_journey')
      .select('member_id, progress, updated_at')
      .eq('intervention_id', interventionId),
  ]);

  const ackBy = new Map<string, string>();
  for (const row of (acknowledgements.data ?? []) as unknown as AcknowledgementRow[]) {
    ackBy.set(row.member_id, row.opened_at);
  }
  const responseBy = new Map<string, { answer: ResponseAnswer; eta: number | null; at: string }>();
  for (const row of (responses.data ?? []) as unknown as ResponseRow[]) {
    responseBy.set(row.member_id, {
      answer: row.answer as ResponseAnswer,
      eta: row.eta_minutes,
      at: row.updated_at ?? row.responded_at,
    });
  }
  const journeyBy = new Map<string, { step: JourneyStep; at: string }>();
  for (const row of (journeys.data ?? []) as unknown as JourneyRow[]) {
    journeyBy.set(row.member_id, {
      step: row.progress as JourneyStep,
      at: row.updated_at,
    });
  }

  return ((recipients.data ?? []) as unknown as RecipientRow[]).map((row) => {
    const memberId = row.member_id;
    const response = responseBy.get(memberId);
    const journey = journeyBy.get(memberId);
    return {
      memberId,
      memberName: row.member_name_at_publication,
      acknowledgedAt: ackBy.get(memberId) ?? null,
      answer: response?.answer ?? null,
      etaMinutes: response?.eta ?? null,
      answeredAt: response?.at ?? null,
      journey: journey?.step ?? null,
      journeyAt: journey?.at ?? null,
    };
  });
}

export async function fetchAttendance(
  interventionId: string,
  memberNames: ReadonlyMap<string, string>,
): Promise<readonly AttendanceInterval[]> {
  const { data, error } = await accountBackend()
    .from('attendance_intervals')
    .select('id, member_id, started_at, ended_at, source, verified, rejected_at, rejection_reason')
    .eq('intervention_id', interventionId)
    .order('started_at', { ascending: true });
  if (error || !data) return [];
  return (data as unknown as AttendanceRow[]).map((row) => ({
    id: row.id,
    memberId: row.member_id,
    memberName: memberNames.get(row.member_id) ?? 'Nepoznat clan',
    startedAt: row.started_at,
    endedAt: row.ended_at,
    source: row.source as AttendanceSource,
    verified: row.verified,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
  }));
}

export async function fetchVehicleMovements(): Promise<readonly VehicleMovement[]> {
  const backend = accountBackend();
  const [movements, vehicles] = await Promise.all([
    backend
      .from('vehicle_movements')
      .select('id, vehicle_id, intervention_id, purpose, departed_at, returned_at')
      .order('departed_at', { ascending: false })
      .limit(100),
    backend.from('vehicles').select('id, callsign, name'),
  ]);
  const byId = new Map<string, { callsign: string; name: string }>();
  for (const row of (vehicles.data ?? []) as unknown as VehicleRow[]) {
    byId.set(row.id, { callsign: row.callsign, name: row.name });
  }
  return ((movements.data ?? []) as unknown as MovementRow[]).map((row) => {
    const vehicle = byId.get(row.vehicle_id);
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      callsign: vehicle?.callsign ?? '?',
      vehicleName: vehicle?.name ?? 'Nepoznato vozilo',
      interventionId: row.intervention_id,
      purpose: row.purpose,
      departedAt: row.departed_at,
      returnedAt: row.returned_at,
    };
  });
}

export async function fetchAvailability(): Promise<readonly AvailabilityRow[]> {
  const { data, error } = await accountBackend()
    .from('member_availability')
    .select('member_id, available, note, changed_at');
  if (error || !data) return [];
  return (data as unknown as AvailabilityWireRow[]).map((row) => ({
    memberId: row.member_id,
    available: row.available,
    note: row.note,
    changedAt: row.changed_at,
  }));
}

/**
 * Participation per member, computed by the server.
 *
 * The client can compute the same figures from intervals it already has -
 * `participationSeconds()` applies the identical rule - and the history screen
 * does exactly that for one intervention. This reads the server's own answer
 * across every intervention, which is the figure a yearly record would be built
 * from, and which must never be assembled in the browser.
 *
 * Note for whoever changes `attendance_totals()` next: this is an application
 * caller selecting NAMED columns. Changing its result columns is now a breaking
 * change to the history screen, not only to the test suite.
 */
export interface ParticipationTotal {
  readonly memberId: string;
  readonly memberName: string;
  readonly confirmedIntervals: number;
  /**
   * Exact confirmed participation in milliseconds.
   *
   * `attendance_totals()` returns NUMERIC seconds and has always summed them
   * exactly on the server - the fractional part was being thrown away here, not
   * there. Converted once, at the boundary, so the rest of the application has
   * one unit.
   */
  readonly confirmedMs: number;
  readonly unverifiedIntervals: number;
  readonly unverifiedMs: number;
  readonly openIntervals: number;
  readonly rejectedIntervals: number;
}

interface TotalsRow {
  member_id: string; full_name: string;
  confirmed_intervals: number | string; confirmed_seconds: number | string;
  unverified_intervals: number | string; unverified_seconds: number | string;
  open_intervals: number | string; rejected_intervals: number | string;
}

/** `bigint` and `numeric` can arrive as strings; a total must never be `NaN`. */
const count = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function fetchParticipationTotals(): Promise<readonly ParticipationTotal[]> {
  const { data, error } = await accountBackend().rpc('attendance_totals', {});
  if (error || !data) return [];
  return (data as unknown as TotalsRow[]).map((row) => ({
    memberId: row.member_id,
    memberName: row.full_name,
    confirmedIntervals: count(row.confirmed_intervals),
    confirmedMs: count(row.confirmed_seconds) * 1000,
    unverifiedIntervals: count(row.unverified_intervals),
    unverifiedMs: count(row.unverified_seconds) * 1000,
    openIntervals: count(row.open_intervals),
    rejectedIntervals: count(row.rejected_intervals),
  }));
}

// --- Commands -------------------------------------------------------------

export const createDraft = (input: {
  kind: InterventionKind;
  title: string;
  instructions: string;
  location: string;
  idempotencyKey: string;
  otherKindNote?: string | null;
  assemblyPoint?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  coordinateSource?: 'MAP_PIN' | 'TYPED' | 'DEVICE' | null;
}) =>
  commandReturning<string>('create_intervention_draft', {
    requested_kind: input.kind,
    requested_title: input.title,
    requested_instructions: input.instructions,
    requested_location: input.location,
    requested_idempotency_key: input.idempotencyKey,
    requested_other_kind_note: input.otherKindNote ?? null,
    requested_latitude: input.latitude ?? null,
    requested_longitude: input.longitude ?? null,
    requested_coordinate_source: input.coordinateSource ?? null,
    requested_assembly_point: input.assemblyPoint ?? null,
  });

export const updateDraft = (input: {
  interventionId: string;
  title: string;
  instructions: string;
  location: string;
  expectedVersion: number;
  assemblyPoint?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  coordinateSource?: 'MAP_PIN' | 'TYPED' | 'DEVICE' | null;
}) =>
  command('update_intervention_draft', {
    target_intervention: input.interventionId,
    requested_title: input.title,
    requested_instructions: input.instructions,
    requested_location: input.location,
    expected_version: input.expectedVersion,
    requested_latitude: input.latitude ?? null,
    requested_longitude: input.longitude ?? null,
    requested_coordinate_source: input.coordinateSource ?? null,
    requested_assembly_point: input.assemblyPoint ?? null,
  });

export const discardDraft = (interventionId: string, reason: string) =>
  command('discard_intervention_draft', {
    target_intervention: interventionId,
    requested_reason: reason,
  });

export const publishIntervention = (interventionId: string, memberIds: readonly string[]) =>
  commandReturning<string>('publish_intervention', {
    target_intervention: interventionId,
    recipient_member_ids: memberIds,
  });

export const setInterventionStatus = (
  interventionId: string,
  status: (typeof SETTABLE_STATUSES)[number],
  expectedVersion: number,
) =>
  command('set_intervention_status', {
    target_intervention: interventionId,
    requested_status: status,
    expected_version: expectedVersion,
  });

export const closeIntervention = (
  interventionId: string,
  status: 'CLOSED' | 'CANCELLED',
  reason: string,
  allowOpenAttendance: boolean,
) =>
  command('close_intervention', {
    target_intervention: interventionId,
    requested_status: status,
    requested_reason: reason,
    allow_open_attendance: allowOpenAttendance,
  });

export const acknowledgeIntervention = (interventionId: string) =>
  command('acknowledge_intervention', { target_intervention: interventionId });

export const submitResponse = (
  interventionId: string,
  answer: ResponseAnswer,
  etaMinutes: number | null,
  directToScene: boolean,
) =>
  command('submit_response', {
    target_intervention: interventionId,
    requested_answer: answer,
    requested_eta: etaMinutes,
    requested_direct: directToScene,
  });

export const setJourneyProgress = (interventionId: string, progress: JourneyStep) =>
  command('set_journey_progress', {
    target_intervention: interventionId,
    requested_progress: progress,
  });

export const setOwnAvailability = (available: boolean, note: string | null) =>
  command('set_own_availability', {
    requested_available: available,
    requested_note: note,
  });

export const checkIn = (interventionId: string, memberId?: string | null) =>
  commandReturning<string>('attendance_check_in', {
    target_intervention: interventionId,
    target_member: memberId ?? null,
  });

export const checkOut = (interventionId: string, memberId?: string | null) =>
  command('attendance_check_out', {
    target_intervention: interventionId,
    target_member: memberId ?? null,
  });

export const confirmAttendance = (intervalId: string, note: string | null) =>
  command('attendance_confirm', { target_interval: intervalId, requested_note: note });

export const confirmAttendanceMany = (intervalIds: readonly string[], note: string | null) =>
  commandReturning<readonly { interval_id: string; outcome: string }[]>(
    'attendance_confirm_many',
    { target_intervals: intervalIds, requested_note: note },
  );

export const rejectAttendance = (intervalId: string, reason: string) =>
  command('attendance_reject', { target_interval: intervalId, requested_reason: reason });

export const unconfirmAttendance = (intervalId: string, reason: string) =>
  command('attendance_unconfirm', { target_interval: intervalId, requested_reason: reason });

export const correctAttendance = (
  intervalId: string,
  startedAt: string | null,
  endedAt: string | null,
  reason: string,
) =>
  command('attendance_correct', {
    target_interval: intervalId,
    new_started_at: startedAt,
    new_ended_at: endedAt,
    requested_reason: reason,
  });

export const recordVehicleDeparture = (
  vehicleId: string,
  interventionId: string | null,
  purpose: string | null,
) =>
  commandReturning<string>('record_vehicle_departure', {
    target_vehicle: vehicleId,
    target_intervention: interventionId,
    requested_purpose: purpose,
  });

export const recordVehicleReturn = (movementId: string) =>
  command('record_vehicle_return', { target_movement: movementId });
