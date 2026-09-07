/**
 * Domain types for the DVD Tivat exercise prototype.
 *
 * The whole point of this file is the SEPARATION described in
 * docs/PRODUCT_PLAN.md section C. Six things happen during a call-out and they
 * are six different records:
 *
 *   Call            - a human decided to call people
 *   DeliveryAttempt - a request left our system / a device acknowledged
 *   MemberResponse  - a human made a commitment
 *   VehicleMovement - equipment is physically out
 *   Exercise.status - an authorised person declared the state of the incident
 *   ActivityEntry   - the timestamped record of all of the above
 *
 * Nothing derives one of these from another. That is enforced by the reducer
 * and asserted by the tests in ./reducer.test.ts.
 *
 * This module is pure: no React, no browser API, no clock, no randomness.
 */

export type Id = string;
/** ISO 8601 timestamp. Always supplied by Ctx.now(), never read from a global clock. */
export type Timestamp = string;

// ---------------------------------------------------------------------------
// People, groups, vehicles
// ---------------------------------------------------------------------------

/**
 * Roles as PROPOSED in docs/PRODUCT_PLAN.md section B. In the prototype these
 * label a fictional person; they authorise nothing. Real authorisation is a
 * server concern (Phase 2) and does not exist here.
 */
export type RoleId = 'ADMIN' | 'DEZURNI' | 'CLAN' | 'PRIKAZ';

export type SpecialtyId =
  | 'KOMANDNI_KADAR'
  | 'VOZAC_C'
  | 'IDA'
  | 'PRVA_POMOC'
  | 'TEHNICKO_SPASAVANJE'
  | 'SUMSKI_POZAR';

export interface Member {
  id: Id;
  /** Fictional. The repository is public; no real person is ever entered here. */
  name: string;
  /** Proposed role, not an enforced permission. */
  roleProposed: RoleId;
  specialties: SpecialtyId[];
  groupIds: Id[];
  /**
   * A placeholder label such as "kontakt-01". Never a phone number, never an
   * email address. The prototype has no channel to send anything on.
   */
  contactLabel: string;
  active: boolean;
}

export interface Group {
  id: Id;
  name: string;
  memberIds: Id[];
}

export interface Vehicle {
  id: Id;
  /** Fictional call sign. */
  callsign: string;
  name: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Exercise (the incident itself)
// ---------------------------------------------------------------------------

/**
 * SIMULIRANA_INTERVENCIJA exists so the model can carry an incident type. It is
 * still a simulation and is labelled as one on every screen. The prototype has
 * no real intervention type, deliberately.
 */
export type ExerciseKind = 'VJEZBA' | 'TEST' | 'SIMULIRANA_INTERVENCIJA';

/**
 * Operational status. Changed ONLY by an explicit SetExerciseStatus command from
 * a person. Never derived from responses and never derived from vehicles.
 */
export type ExerciseStatus =
  | 'OTVORENA'
  | 'EKIPA_KRENULA'
  | 'NA_TERENU'
  | 'ZAVRSENA'
  | 'OTKAZANA';

/** Statuses in which members may still answer and the dispatcher may still act. */
export const OPEN_STATUSES: readonly ExerciseStatus[] = ['OTVORENA', 'EKIPA_KRENULA', 'NA_TERENU'];

export interface Exercise {
  id: Id;
  kind: ExerciseKind;
  title: string;
  instructions: string;
  /** Where the event is. Required. */
  incidentLocation: string;
  /**
   * Where the report came from. Optional, always displayed separately, and never
   * used as a substitute for incidentLocation.
   */
  reporterLocation: string;
  status: ExerciseStatus;
  createdAt: Timestamp;
  createdBy: Id;
  closedAt: Timestamp | null;
  closedBy: Id | null;
  closeReason: string | null;
}

// ---------------------------------------------------------------------------
// Call
// ---------------------------------------------------------------------------

export type CallStatus = 'POSLAT' | 'OTKAZAN';

export interface Call {
  id: Id;
  exerciseId: Id;
  /** Exactly the text shown in the confirmation preview. */
  messageText: string;
  /**
   * Frozen at send time. Deliberately NOT recomputed from groups: if a member
   * joins a group afterwards, the record of who was called must not change.
   */
  recipientIds: Id[];
  /** What was ticked, kept so the record explains how the list was built. */
  sourceSelection: { memberIds: Id[]; groupIds: Id[] };
  status: CallStatus;
  createdAt: Timestamp;
  createdBy: Id;
  cancelledAt: Timestamp | null;
  cancelledBy: Id | null;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * The full set a real system needs. THE PROTOTYPE ONLY EVER PRODUCES
 * 'NIJE_POKUSANO'. There is no notification service, so claiming anything else
 * would be a lie told by software during an emergency drill.
 *
 * Guarded by a test: see "never fabricates delivery" in reducer.test.ts.
 */
export type DeliveryState =
  | 'NIJE_POKUSANO'
  | 'NA_CEKANJU'
  | 'PRIHVACENO_OD_SERVISA'
  | 'POTVRDA_UREDJAJA'
  | 'GRESKA'
  | 'NEPOZNATO';

/** 'NEMA' = no channel implemented. The only value the prototype produces. */
export type DeliveryChannel = 'NEMA' | 'PUSH' | 'SMS';

export interface DeliveryAttempt {
  id: Id;
  callId: Id;
  memberId: Id;
  channel: DeliveryChannel;
  state: DeliveryState;
  updatedAt: Timestamp;
  note: string;
}

// ---------------------------------------------------------------------------
// Member response
// ---------------------------------------------------------------------------

export type ResponseAnswer = 'DOLAZIM' | 'DOLAZIM_KASNIJE' | 'NE_MOGU';

/**
 * Arrival bands taken from the reference product's documentation. Unconfirmed
 * for Tivat - see PRODUCT_PLAN.md question 8.
 */
export type EtaMinutes = 15 | 30 | 60;
export const ETA_OPTIONS: readonly EtaMinutes[] = [15, 30, 60];

export interface MemberResponse {
  id: Id;
  callId: Id;
  memberId: Id;
  answer: ResponseAnswer;
  /** Only meaningful with DOLAZIM_KASNIJE; null otherwise. */
  etaMinutes: EtaMinutes | null;
  /** Going straight to the incident instead of to the station. Independent of `answer`. */
  directToLocation: boolean;
  respondedAt: Timestamp;
  updatedAt: Timestamp;
  /** 1 on first answer, incremented on every change. Changes are recorded, not overwritten. */
  revision: number;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/** Derived from movements only. A member's answer can never reach this. */
export type VehicleState = 'U_DOMU' | 'NA_ZADATKU';

export interface VehicleMovement {
  id: Id;
  exerciseId: Id;
  vehicleId: Id;
  purpose: string;
  departedAt: Timestamp;
  departedBy: Id;
  returnedAt: Timestamp | null;
  returnedBy: Id | null;
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export type ActivityKind =
  | 'VJEZBA_KREIRANA'
  | 'POZIV_POSLAT'
  | 'POZIV_OTKAZAN'
  | 'ODGOVOR_DAT'
  | 'ODGOVOR_PROMIJENJEN'
  | 'STATUS_PROMIJENJEN'
  | 'VJEZBA_ZATVORENA'
  | 'VJEZBA_OTKAZANA'
  | 'VOZILO_IZASLO'
  | 'VOZILO_VRACENO'
  | 'PODACI_RESETOVANI';

export interface ActivityEntry {
  id: Id;
  at: Timestamp;
  /** The SIMULATED actor. In production this would be the authenticated actor. */
  actorId: Id;
  actorName: string;
  kind: ActivityKind;
  /** Local language, no diacritics. */
  summary: string;
  exerciseId: Id | null;
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

/** Which fictional person the interface is pretending to be. NOT authentication. */
export interface SimulationState {
  actorId: Id;
  /** The role being demonstrated. Grants nothing. */
  viewRole: RoleId;
}

export const SCHEMA_VERSION = 1;

export interface AppState {
  schemaVersion: number;
  members: Member[];
  groups: Group[];
  vehicles: Vehicle[];
  exercises: Exercise[];
  calls: Call[];
  deliveryAttempts: DeliveryAttempt[];
  responses: MemberResponse[];
  vehicleMovements: VehicleMovement[];
  activity: ActivityEntry[];
  simulation: SimulationState;
  /** Bounded ring of applied command ids, for idempotency. See reducer.ts. */
  appliedCommandIds: string[];
}
