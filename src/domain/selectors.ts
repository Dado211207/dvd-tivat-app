/**
 * Derived reads. Pure functions over state; no caching, no side effects.
 *
 * Note the signature of vehicleStateFrom: it takes only movements. It is not
 * given responses, so no future edit can accidentally make a member's answer
 * move a vehicle. The separation is structural, not a comment asking for care.
 */

import {
  OPEN_STATUSES,
  type AppState,
  type Call,
  type DeliveryAttempt,
  type Exercise,
  type Id,
  type Member,
  type MemberResponse,
  type Vehicle,
  type VehicleMovement,
  type VehicleState,
} from './types';

// ---------------------------------------------------------------------------
// Exercises and calls
// ---------------------------------------------------------------------------

export const getOpenExercise = (state: AppState): Exercise | undefined =>
  state.exercises.find((e) => OPEN_STATUSES.includes(e.status));

export const getExerciseById = (state: AppState, id: Id): Exercise | undefined =>
  state.exercises.find((e) => e.id === id);

export const getCallsForExercise = (state: AppState, exerciseId: Id): Call[] =>
  state.calls.filter((c) => c.exerciseId === exerciseId);

/** The live call of the open exercise, if there is one. */
export function getActiveCall(state: AppState): Call | undefined {
  const exercise = getOpenExercise(state);
  if (!exercise) return undefined;
  return state.calls.find((c) => c.exerciseId === exercise.id && c.status === 'POSLAT');
}

/** Only calls this member was actually a recipient of. Newest first. */
export const getCallsForMember = (state: AppState, memberId: Id): Call[] =>
  state.calls.filter((c) => c.recipientIds.includes(memberId));

/** The call a member should be answering right now, if any. */
export function getActiveCallForMember(state: AppState, memberId: Id): Call | undefined {
  const call = getActiveCall(state);
  if (!call) return undefined;
  return call.recipientIds.includes(memberId) ? call : undefined;
}

/** Exercises no longer open, newest first. */
export const getHistory = (state: AppState): Exercise[] =>
  state.exercises
    .filter((e) => !OPEN_STATUSES.includes(e.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const isExerciseOpen = (exercise: Exercise | undefined): boolean =>
  exercise !== undefined && OPEN_STATUSES.includes(exercise.status);

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const getResponse = (
  state: AppState,
  callId: Id,
  memberId: Id,
): MemberResponse | undefined =>
  state.responses.find((r) => r.callId === callId && r.memberId === memberId);

export const getResponsesForCall = (state: AppState, callId: Id): MemberResponse[] =>
  state.responses.filter((r) => r.callId === callId);

export interface ResponseTotals {
  recipients: number;
  dolazim: number;
  kasnije: number;
  neMogu: number;
  bezOdgovora: number;
  /** How many of those coming are going straight to the incident. */
  direktnoNaLokaciju: number;
}

export function getResponseTotals(state: AppState, callId: Id): ResponseTotals {
  const call = state.calls.find((c) => c.id === callId);
  if (!call) {
    return { recipients: 0, dolazim: 0, kasnije: 0, neMogu: 0, bezOdgovora: 0, direktnoNaLokaciju: 0 };
  }

  const responses = getResponsesForCall(state, callId);
  const dolazim = responses.filter((r) => r.answer === 'DOLAZIM').length;
  const kasnije = responses.filter((r) => r.answer === 'DOLAZIM_KASNIJE').length;
  const neMogu = responses.filter((r) => r.answer === 'NE_MOGU').length;

  return {
    recipients: call.recipientIds.length,
    dolazim,
    kasnije,
    neMogu,
    // Everyone called who has not answered. Silence is a state, not a "no".
    bezOdgovora: call.recipientIds.length - (dolazim + kasnije + neMogu),
    direktnoNaLokaciju: responses.filter((r) => r.directToLocation && r.answer !== 'NE_MOGU').length,
  };
}

export interface RecipientRow {
  member: Member;
  response: MemberResponse | undefined;
  delivery: DeliveryAttempt | undefined;
}

/** One row per recipient of a call, in roster order, answered or not. */
export function getRecipientRows(state: AppState, callId: Id): RecipientRow[] {
  const call = state.calls.find((c) => c.id === callId);
  if (!call) return [];

  return call.recipientIds
    .map((memberId) => {
      const member = state.members.find((m) => m.id === memberId);
      if (!member) return undefined;
      return {
        member,
        response: getResponse(state, callId, memberId),
        delivery: state.deliveryAttempts.find(
          (d) => d.callId === callId && d.memberId === memberId,
        ),
      } satisfies RecipientRow;
    })
    .filter((row): row is RecipientRow => row !== undefined);
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export const getDeliveryAttempts = (state: AppState, callId: Id): DeliveryAttempt[] =>
  state.deliveryAttempts.filter((d) => d.callId === callId);

/**
 * True when no attempt on this call claims anything beyond "not attempted".
 * The interface uses this to state the limitation rather than to hide it.
 */
export const isDeliveryUnattempted = (state: AppState, callId: Id): boolean =>
  getDeliveryAttempts(state, callId).every((d) => d.state === 'NIJE_POKUSANO');

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/**
 * Derived from movements ALONE. Responses are not a parameter and cannot be.
 * "Dolazim" must never imply that a vehicle has left the station.
 */
export function vehicleStateFrom(movements: VehicleMovement[], vehicleId: Id): VehicleState {
  const open = movements.some((m) => m.vehicleId === vehicleId && m.returnedAt === null);
  return open ? 'NA_ZADATKU' : 'U_DOMU';
}

export interface VehicleRow {
  vehicle: Vehicle;
  state: VehicleState;
  currentMovement: VehicleMovement | undefined;
}

export function getVehicleBoard(state: AppState): VehicleRow[] {
  return state.vehicles.map((vehicle) => ({
    vehicle,
    state: vehicleStateFrom(state.vehicleMovements, vehicle.id),
    currentMovement: state.vehicleMovements.find(
      (m) => m.vehicleId === vehicle.id && m.returnedAt === null,
    ),
  }));
}

export const getMovementsForExercise = (state: AppState, exerciseId: Id): VehicleMovement[] =>
  state.vehicleMovements.filter((m) => m.exerciseId === exerciseId);

// ---------------------------------------------------------------------------
// People and activity
// ---------------------------------------------------------------------------

export const getMember = (state: AppState, id: Id): Member | undefined =>
  state.members.find((m) => m.id === id);

export const getSimulatedMember = (state: AppState): Member | undefined =>
  getMember(state, state.simulation.actorId);

export const getActivityForExercise = (state: AppState, exerciseId: Id) =>
  state.activity.filter((a) => a.exerciseId === exerciseId);

export const getGroupMemberCount = (state: AppState, groupId: Id): number =>
  state.groups.find((g) => g.id === groupId)?.memberIds.filter((id) =>
    state.members.some((m) => m.id === id && m.active),
  ).length ?? 0;
