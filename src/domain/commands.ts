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
  CitizenReportKind,
  EtaMinutes,
  ExerciseKind,
  ExerciseStatus,
  Id,
  ResponseAnswer,
  RoleId,
  SpecialtyId,
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

/** Saves a citizen report in this browser only. It sends nothing. */
export interface SubmitCitizenReport extends Base {
  type: 'SUBMIT_CITIZEN_REPORT';
  kind: CitizenReportKind;
  description: string;
  incidentLocation: string;
  coordinates: {
    latitude: number;
    longitude: number;
    accuracyMeters: number | null;
    source?: 'DEVICE' | 'MAP_PIN';
    capturedAt?: string;
  } | null;
  photoIncluded: boolean;
}

/** Marks the locally visible report as reviewed in the simulation. */
export interface ReviewCitizenReport extends Base {
  type: 'REVIEW_CITIZEN_REPORT';
  reportId: Id;
}

/** Creates or updates a fictional member and keeps group membership symmetric. */
export interface SaveDemoMember extends Base {
  type: 'SAVE_DEMO_MEMBER';
  memberId: Id | null;
  name: string;
  roleProposed: RoleId;
  specialties: SpecialtyId[];
  groupIds: Id[];
  active: boolean;
}

/** Creates or renames a fictional group. Membership is edited through members. */
export interface SaveDemoGroup extends Base {
  type: 'SAVE_DEMO_GROUP';
  groupId: Id | null;
  name: string;
}

/** Creates or updates a fictional vehicle. Existing movement records keep its id. */
export interface SaveDemoVehicle extends Base {
  type: 'SAVE_DEMO_VEHICLE';
  vehicleId: Id | null;
  callsign: string;
  name: string;
  vehicleType: string;
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
  | SubmitCitizenReport
  | ReviewCitizenReport
  | SaveDemoMember
  | SaveDemoGroup
  | SaveDemoVehicle
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
