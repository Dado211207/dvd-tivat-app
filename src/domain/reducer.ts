/**
 * The single place where application state changes.
 *
 * applyCommand is pure: same (state, command, ctx) always gives the same result.
 * Every rule that matters lives here rather than in a component, so it can be
 * tested without a browser and so it cannot be bypassed by a careless edit to
 * the user interface.
 *
 * The rules this file exists to enforce:
 *   - Sending a call creates NO responses and NO delivery confirmations.
 *   - A member's answer never touches a vehicle or the exercise status.
 *   - A vehicle movement never touches a response or the exercise status.
 *   - Exercise status changes only by explicit human command.
 *   - Changing an answer updates one row and affects nobody else.
 *   - A repeated command is a no-op.
 */

import type { Command, Ctx } from './commands';
import { err, ok, type Result } from './errors';
import { composeMessage } from './message';
import {
  OPEN_STATUSES,
  ETA_OPTIONS,
  type ActivityEntry,
  type ActivityKind,
  type AppState,
  type Call,
  type CitizenReport,
  type DeliveryAttempt,
  type Exercise,
  type Id,
  type MemberResponse,
  type VehicleMovement,
} from './types';
import { createSeedState } from './seed';

/** How many recent command ids are remembered for idempotency. */
const APPLIED_COMMAND_HISTORY = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isBlank = (value: string): boolean => value.trim().length === 0;

const actorName = (state: AppState, actorId: Id): string =>
  state.members.find((m) => m.id === actorId)?.name ?? 'Nepoznat ucesnik';

function logEntry(
  state: AppState,
  ctx: Ctx,
  actorId: Id,
  kind: ActivityKind,
  summary: string,
  exerciseId: Id | null,
): ActivityEntry {
  return {
    id: ctx.id(),
    at: ctx.now(),
    actorId,
    actorName: actorName(state, actorId),
    kind,
    summary,
    exerciseId,
  };
}

function remember(state: AppState, commandId: string): string[] {
  return [...state.appliedCommandIds, commandId].slice(-APPLIED_COMMAND_HISTORY);
}

/** The one exercise members and the display are currently concerned with. */
export function findOpenExercise(state: AppState): Exercise | undefined {
  return state.exercises.find((e) => OPEN_STATUSES.includes(e.status));
}

/**
 * Expands the ticked members and groups into the frozen recipient list.
 * Deduplicated, inactive members excluded, order stable (roster order).
 */
export function resolveRecipients(state: AppState, memberIds: Id[], groupIds: Id[]): Id[] {
  const wanted = new Set<Id>(memberIds);
  for (const groupId of groupIds) {
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) continue;
    for (const memberId of group.memberIds) wanted.add(memberId);
  }
  return state.members.filter((m) => m.active && wanted.has(m.id)).map((m) => m.id);
}

const openMovementFor = (state: AppState, vehicleId: Id): VehicleMovement | undefined =>
  state.vehicleMovements.find((m) => m.vehicleId === vehicleId && m.returnedAt === null);

function coordinatesAreValid(
  coordinates: { latitude: number; longitude: number; accuracyMeters: number | null },
): boolean {
  return (
    Number.isFinite(coordinates.latitude) &&
    Number.isFinite(coordinates.longitude) &&
    coordinates.latitude >= -90 &&
    coordinates.latitude <= 90 &&
    coordinates.longitude >= -180 &&
    coordinates.longitude <= 180 &&
    (coordinates.accuracyMeters === null ||
      (Number.isFinite(coordinates.accuracyMeters) && coordinates.accuracyMeters >= 0))
  );
}

// ---------------------------------------------------------------------------
// applyCommand
// ---------------------------------------------------------------------------

export function applyCommand(state: AppState, command: Command, ctx: Ctx): Result<AppState> {
  // Idempotency. A repeated command changes nothing and is not an error - the
  // user pressed twice, they did not do something wrong.
  if (state.appliedCommandIds.includes(command.commandId)) {
    return ok(state);
  }

  switch (command.type) {
    // -----------------------------------------------------------------------
    case 'CREATE_EXERCISE_AND_CALL': {
      if (isBlank(command.title)) return err('NEDOSTAJE_NASLOV', 'title');
      if (isBlank(command.instructions)) return err('NEDOSTAJE_UPUTSTVO', 'instructions');
      if (isBlank(command.incidentLocation)) return err('NEDOSTAJE_LOKACIJA', 'incidentLocation');

      if (findOpenExercise(state)) return err('VEC_POSTOJI_OTVORENA_VJEZBA');

      for (const memberId of command.memberIds) {
        if (!state.members.some((m) => m.id === memberId)) {
          return err('NEPOZNAT_PRIMALAC', 'recipients');
        }
      }

      const recipientIds = resolveRecipients(state, command.memberIds, command.groupIds);
      if (recipientIds.length === 0) return err('NEMA_PRIMALACA', 'recipients');

      const at = ctx.now();

      const exercise: Exercise = {
        id: ctx.id(),
        kind: command.kind,
        title: command.title.trim(),
        instructions: command.instructions.trim(),
        incidentLocation: command.incidentLocation.trim(),
        reporterLocation: command.reporterLocation.trim(),
        status: 'OTVORENA',
        createdAt: at,
        createdBy: command.actorId,
        closedAt: null,
        closedBy: null,
        closeReason: null,
      };

      const call: Call = {
        id: ctx.id(),
        exerciseId: exercise.id,
        messageText: composeMessage(command),
        recipientIds,
        sourceSelection: { memberIds: [...command.memberIds], groupIds: [...command.groupIds] },
        status: 'POSLAT',
        createdAt: at,
        createdBy: command.actorId,
        cancelledAt: null,
        cancelledBy: null,
      };

      // One attempt per recipient, all in the only state this prototype is
      // entitled to claim. No notification service exists, so nothing here may
      // ever say "delivered". Asserted by test.
      const attempts: DeliveryAttempt[] = recipientIds.map((memberId) => ({
        id: ctx.id(),
        callId: call.id,
        memberId,
        channel: 'NEMA',
        state: 'NIJE_POKUSANO',
        updatedAt: at,
        note: 'Prototip ne salje obavjestenja. Isporuka nije pokusana.',
      }));

      return ok({
        ...state,
        exercises: [exercise, ...state.exercises],
        calls: [call, ...state.calls],
        deliveryAttempts: [...state.deliveryAttempts, ...attempts],
        // Note what is NOT here: no responses are created. The dispatcher sees
        // an empty answer list until real people answer.
        activity: [
          logEntry(
            state,
            ctx,
            command.actorId,
            'VJEZBA_KREIRANA',
            `Kreirana vjezba "${exercise.title}" (${exercise.kind}).`,
            exercise.id,
          ),
          logEntry(
            state,
            ctx,
            command.actorId,
            'POZIV_POSLAT',
            `Poziv upucen za ${recipientIds.length} clanova. Isporuka nije pokusana.`,
            exercise.id,
          ),
          ...state.activity,
        ],
        appliedCommandIds: remember(state, command.commandId),
      });
    }

    // -----------------------------------------------------------------------
    case 'CANCEL_CALL': {
      const call = state.calls.find((c) => c.id === command.callId);
      if (!call) return err('POZIV_NE_POSTOJI');
      if (call.status !== 'POSLAT') return err('POZIV_NIJE_AKTIVAN');

      const at = ctx.now();
      return ok({
        ...state,
        calls: state.calls.map((c) =>
          c.id === call.id
            ? { ...c, status: 'OTKAZAN' as const, cancelledAt: at, cancelledBy: command.actorId }
            : c,
        ),
        activity: [
          logEntry(
            state,
            ctx,
            command.actorId,
            'POZIV_OTKAZAN',
            'Poziv je otkazan. Ranije dati odgovori ostaju u evidenciji.',
            call.exerciseId,
          ),
          ...state.activity,
        ],
        appliedCommandIds: remember(state, command.commandId),
      });
    }

    // -----------------------------------------------------------------------
    case 'SUBMIT_RESPONSE': {
      const call = state.calls.find((c) => c.id === command.callId);
      if (!call) return err('POZIV_NE_POSTOJI');
      if (call.status !== 'POSLAT') return err('POZIV_NIJE_AKTIVAN');

      const exercise = state.exercises.find((e) => e.id === call.exerciseId);
      if (!exercise) return err('VJEZBA_NE_POSTOJI');
      if (!OPEN_STATUSES.includes(exercise.status)) return err('VJEZBA_NIJE_OTVORENA');

      if (!state.members.some((m) => m.id === command.memberId)) return err('CLAN_NE_POSTOJI');
      if (!call.recipientIds.includes(command.memberId)) return err('NIJE_PRIMALAC');

      const later = command.answer === 'DOLAZIM_KASNIJE';
      if (later && (command.etaMinutes === null || !ETA_OPTIONS.includes(command.etaMinutes))) {
        return err('NEISPRAVNO_VRIJEME_DOLASKA', 'etaMinutes');
      }
      // An arrival band only means something with "dolazim kasnije".
      const etaMinutes = later ? command.etaMinutes : null;
      // Nobody arrives directly at a location they said they are not going to.
      const directToLocation = command.answer === 'NE_MOGU' ? false : command.directToLocation;

      const at = ctx.now();
      const existing = state.responses.find(
        (r) => r.callId === call.id && r.memberId === command.memberId,
      );

      if (existing) {
        const unchanged =
          existing.answer === command.answer &&
          existing.etaMinutes === etaMinutes &&
          existing.directToLocation === directToLocation;

        // Re-submitting the same answer is not a change. It must not bump the
        // revision or write a history entry, or the record fills with noise.
        if (unchanged) {
          return ok({ ...state, appliedCommandIds: remember(state, command.commandId) });
        }

        const updated: MemberResponse = {
          ...existing,
          answer: command.answer,
          etaMinutes,
          directToLocation,
          updatedAt: at,
          revision: existing.revision + 1,
        };

        return ok({
          ...state,
          // Exactly one row changes. Every other member's answer is untouched.
          responses: state.responses.map((r) => (r.id === existing.id ? updated : r)),
          activity: [
            logEntry(
              state,
              ctx,
              command.memberId,
              'ODGOVOR_PROMIJENJEN',
              `Odgovor promijenjen: ${existing.answer} -> ${command.answer}.`,
              exercise.id,
            ),
            ...state.activity,
          ],
          appliedCommandIds: remember(state, command.commandId),
        });
      }

      const response: MemberResponse = {
        id: ctx.id(),
        callId: call.id,
        memberId: command.memberId,
        answer: command.answer,
        etaMinutes,
        directToLocation,
        respondedAt: at,
        updatedAt: at,
        revision: 1,
      };

      return ok({
        ...state,
        responses: [...state.responses, response],
        activity: [
          logEntry(
            state,
            ctx,
            command.memberId,
            'ODGOVOR_DAT',
            `Odgovor: ${command.answer}${etaMinutes ? ` (${etaMinutes} min)` : ''}${
              directToLocation ? ', direktno na lokaciju' : ''
            }.`,
            exercise.id,
          ),
          ...state.activity,
        ],
        appliedCommandIds: remember(state, command.commandId),
      });
    }

    // -----------------------------------------------------------------------
    case 'SET_EXERCISE_STATUS': {
      const exercise = state.exercises.find((e) => e.id === command.exerciseId);
      if (!exercise) return err('VJEZBA_NE_POSTOJI');
      if (!OPEN_STATUSES.includes(exercise.status)) return err('VJEZBA_NIJE_OTVORENA');
      // Closing and cancelling are separate, confirmed commands. They are not
      // reachable through a status dropdown.
      if (!OPEN_STATUSES.includes(command.status)) return err('NEISPRAVAN_STATUS');
      if (exercise.status === command.status) {
        return ok({ ...state, appliedCommandIds: remember(state, command.commandId) });
      }

      return ok({
        ...state,
        exercises: state.exercises.map((e) =>
          e.id === exercise.id ? { ...e, status: command.status } : e,
        ),
        activity: [
          logEntry(
            state,
            ctx,
            command.actorId,
            'STATUS_PROMIJENJEN',
            `Status vjezbe: ${exercise.status} -> ${command.status}.`,
            exercise.id,
          ),
          ...state.activity,
        ],
        appliedCommandIds: remember(state, command.commandId),
      });
    }

    // -----------------------------------------------------------------------
    case 'CLOSE_EXERCISE':
    case 'CANCEL_EXERCISE': {
      const exercise = state.exercises.find((e) => e.id === command.exerciseId);
      if (!exercise) return err('VJEZBA_NE_POSTOJI');
      if (!OPEN_STATUSES.includes(exercise.status)) return err('VJEZBA_NIJE_OTVORENA');
      if (isBlank(command.reason)) return err('NEDOSTAJE_RAZLOG', 'reason');

      const closing = command.type === 'CLOSE_EXERCISE';
      const at = ctx.now();

      return ok({
        ...state,
        exercises: state.exercises.map((e) =>
          e.id === exercise.id
            ? {
                ...e,
                status: closing ? ('ZAVRSENA' as const) : ('OTKAZANA' as const),
                closedAt: at,
                closedBy: command.actorId,
                closeReason: command.reason.trim(),
              }
            : e,
        ),
        // Calls, responses, delivery rows and vehicle movements are deliberately
        // left as they are. They are the record of what happened.
        activity: [
          logEntry(
            state,
            ctx,
            command.actorId,
            closing ? 'VJEZBA_ZATVORENA' : 'VJEZBA_OTKAZANA',
            `${closing ? 'Vjezba zatvorena' : 'Vjezba otkazana'}: ${command.reason.trim()}`,
            exercise.id,
          ),
          ...state.activity,
        ],
        appliedCommandIds: remember(state, command.commandId),
      });
    }

    // -----------------------------------------------------------------------
    case 'DEPART_VEHICLE': {
      const exercise = state.exercises.find((e) => e.id === command.exerciseId);
      if (!exercise) return err('VJEZBA_NE_POSTOJI');
      if (!OPEN_STATUSES.includes(exercise.status)) return err('VJEZBA_NIJE_OTVORENA');

      const vehicle = state.vehicles.find((v) => v.id === command.vehicleId);
      if (!vehicle) return err('VOZILO_NE_POSTOJI');
      if (openMovementFor(state, vehicle.id)) return err('VOZILO_VEC_IZASLO');

      const movement: VehicleMovement = {
        id: ctx.id(),
        exerciseId: exercise.id,
        vehicleId: vehicle.id,
        purpose: command.purpose.trim(),
        departedAt: ctx.now(),
        departedBy: command.actorId,
        returnedAt: null,
        returnedBy: null,
      };

      return ok({
        ...state,
        vehicleMovements: [movement, ...state.vehicleMovements],
        // No response is created or altered here. A vehicle leaving says nothing
        // about who answered.
        activity: [
          logEntry(
            state,
            ctx,
            command.actorId,
            'VOZILO_IZASLO',
            `Vozilo ${vehicle.callsign} evidentirano kao izaslo.`,
            exercise.id,
          ),
          ...state.activity,
        ],
        appliedCommandIds: remember(state, command.commandId),
      });
    }

    // -----------------------------------------------------------------------
    case 'RETURN_VEHICLE': {
      const vehicle = state.vehicles.find((v) => v.id === command.vehicleId);
      if (!vehicle) return err('VOZILO_NE_POSTOJI');

      const movement = openMovementFor(state, vehicle.id);
      // Deliberately allowed after the exercise is closed: a forgotten return
      // has to be closable, which is how it works on a real station board.
      if (!movement) return err('VOZILO_NIJE_IZASLO');

      const at = ctx.now();
      return ok({
        ...state,
        vehicleMovements: state.vehicleMovements.map((m) =>
          m.id === movement.id ? { ...m, returnedAt: at, returnedBy: command.actorId } : m,
        ),
        activity: [
          logEntry(
            state,
            ctx,
            command.actorId,
            'VOZILO_VRACENO',
            `Vozilo ${vehicle.callsign} evidentirano kao vraceno.`,
            movement.exerciseId,
          ),
          ...state.activity,
        ],
        appliedCommandIds: remember(state, command.commandId),
      });
    }

    // -----------------------------------------------------------------------
    case 'SUBMIT_CITIZEN_REPORT': {
      if (isBlank(command.description)) return err('NEDOSTAJE_OPIS_PRIJAVE', 'reportDescription');
      if (isBlank(command.incidentLocation) && command.coordinates === null) {
        return err('NEDOSTAJE_LOKACIJA_PRIJAVE', 'reportLocation');
      }
      if (command.coordinates !== null && !coordinatesAreValid(command.coordinates)) {
        return err('NEISPRAVNE_KOORDINATE', 'reportLocation');
      }

      const report: CitizenReport = {
        id: ctx.id(),
        kind: command.kind,
        description: command.description.trim(),
        incidentLocation: command.incidentLocation.trim(),
        coordinates: command.coordinates ? { ...command.coordinates } : null,
        photoIncluded: command.photoIncluded,
        status: 'SACUVANA_LOKALNO',
        createdAt: ctx.now(),
        reviewedAt: null,
        reviewedBy: null,
      };

      return ok({
        ...state,
        citizenReports: [report, ...state.citizenReports],
        // A report is intake data only. It creates no exercise, call, delivery
        // attempt, response or vehicle movement.
        appliedCommandIds: remember(state, command.commandId),
      });
    }

    // -----------------------------------------------------------------------
    case 'REVIEW_CITIZEN_REPORT': {
      const report = state.citizenReports.find((item) => item.id === command.reportId);
      if (!report) return err('PRIJAVA_NE_POSTOJI');
      if (report.status === 'PREGLEDANA_U_SIMULACIJI') {
        return ok({ ...state, appliedCommandIds: remember(state, command.commandId) });
      }
      const at = ctx.now();
      return ok({
        ...state,
        citizenReports: state.citizenReports.map((item) =>
          item.id === report.id
            ? {
                ...item,
                status: 'PREGLEDANA_U_SIMULACIJI' as const,
                reviewedAt: at,
                reviewedBy: command.actorId,
              }
            : item,
        ),
        // Reviewing is not accepting an incident and does not dispatch anyone.
        appliedCommandIds: remember(state, command.commandId),
      });
    }

    // -----------------------------------------------------------------------
    case 'SET_SIMULATED_ACTOR': {
      const member = state.members.find((m) => m.id === command.memberId);
      if (!member) return err('CLAN_NE_POSTOJI');

      // No activity entry: this is a demo control, not an operational fact.
      return ok({
        ...state,
        simulation: { actorId: member.id, viewRole: command.viewRole },
        appliedCommandIds: remember(state, command.commandId),
      });
    }

    // -----------------------------------------------------------------------
    case 'RESET_DEMO_DATA': {
      const fresh = createSeedState();
      return ok({
        ...fresh,
        activity: [
          {
            id: ctx.id(),
            at: ctx.now(),
            actorId: command.actorId,
            actorName: actorName(state, command.actorId),
            kind: 'PODACI_RESETOVANI',
            summary: 'Probni podaci ovog pregledaca su vraceni na pocetno stanje.',
            exerciseId: null,
          },
        ],
        // Keep this command remembered so a repeat does not reset twice.
        appliedCommandIds: [command.commandId],
      });
    }
  }
}
