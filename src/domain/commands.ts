/**
 * The command union: every state change the application can make.
 *
 * This is deliberately shaped like a server API. In Phase 2 each variant becomes
 * an endpoint and the same validation runs server-side against an AUTHENTICATED
 * actor rather than a simulated one. Nothing about the rules has to be
 * rediscovered at that point.
 *
 * Every command carries `commandId` so a repeat is a no-op - the double-tap on a
 * half-awake member's phone, and the double-click on "Posalji poziv".
 */

import type {
  EtaMinutes,
  ExerciseKind,
  ExerciseStatus,
  Id,
  ResponseAnswer,
  RoleId,
} from './types';

interface Base {
  commandId: string;
  /** The simulated actor. NOT an authenticated identity. */
  actorId: Id;
}

/** Create the exercise and send the first call in one confirmed act. */
export interface CreateExerciseAndCall extends Base {
  type: 'CREATE_EXERCISE_AND_CALL';
  kind: ExerciseKind;
  title: string;
  instructions: string;
  incidentLocation: string;
  reporterLocation: string;
  /** Individually ticked members. */
  memberIds: Id[];
  /** Ticked groups; expanded and merged with memberIds, deduplicated. */
  groupIds: Id[];
}

export interface CancelCall extends Base {
  type: 'CANCEL_CALL';
  callId: Id;
}

export interface SubmitResponse extends Base {
  type: 'SUBMIT_RESPONSE';
  callId: Id;
  /** Who is answering. In the prototype this is the simulated member. */
  memberId: Id;
  answer: ResponseAnswer;
  etaMinutes: EtaMinutes | null;
  directToLocation: boolean;
}

export interface SetExerciseStatus extends Base {
  type: 'SET_EXERCISE_STATUS';
  exerciseId: Id;
  status: ExerciseStatus;
}

export interface CloseExercise extends Base {
  type: 'CLOSE_EXERCISE';
  exerciseId: Id;
  reason: string;
}

export interface CancelExercise extends Base {
  type: 'CANCEL_EXERCISE';
  exerciseId: Id;
  reason: string;
}

export interface DepartVehicle extends Base {
  type: 'DEPART_VEHICLE';
  exerciseId: Id;
  vehicleId: Id;
  purpose: string;
}

export interface ReturnVehicle extends Base {
  type: 'RETURN_VEHICLE';
  vehicleId: Id;
}

/** Switches which fictional person the screen is pretending to be. Grants nothing. */
export interface SetSimulatedActor extends Base {
  type: 'SET_SIMULATED_ACTOR';
  memberId: Id;
  viewRole: RoleId;
}

/** Clears only this prototype's own demo data and restores the fictional seed. */
export interface ResetDemoData extends Base {
  type: 'RESET_DEMO_DATA';
}

export type Command =
  | CreateExerciseAndCall
  | CancelCall
  | SubmitResponse
  | SetExerciseStatus
  | CloseExercise
  | CancelExercise
  | DepartVehicle
  | ReturnVehicle
  | SetSimulatedActor
  | ResetDemoData;

/**
 * Time and identity are injected. The domain never reads a global clock or a
 * random source, so a given (state, command, ctx) always produces exactly the
 * same result - which is what makes the tests meaningful.
 */
export interface Ctx {
  now: () => string;
  id: () => string;
}
