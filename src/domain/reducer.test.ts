/**
 * Tests for the rules that make this prototype honest.
 *
 * These are not incidental coverage. Each block corresponds to a promise made in
 * docs/PRODUCT_PLAN.md: sending fabricates nothing, one answer changes one row,
 * a vehicle is independent of attendance, a closed exercise stays closed, and a
 * reset touches only demo data.
 */

import { describe, expect, it } from 'vitest';
import type { Command, CreateExerciseAndCall, SubmitResponse } from './commands';
import { applyCommand, resolveRecipients } from './reducer';
import { getResponseTotals, getCallsForMember, getActiveCallForMember, vehicleStateFrom, getHistory } from './selectors';
import { cid, emptyState, makeCtx, must } from './testing';
import type { AppState } from './types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const IDA_MEMBERS = ['m-04', 'm-05', 'm-09', 'm-12'];

function createCall(
  state: AppState,
  ctx: ReturnType<typeof makeCtx>['ctx'],
  overrides: Partial<{ memberIds: string[]; groupIds: string[] }> = {},
): AppState {
  return must(
    state,
    {
      type: 'CREATE_EXERCISE_AND_CALL',
      commandId: cid(),
      actorId: 'm-02',
      kind: 'VJEZBA',
      title: 'Vjezba: provjera opreme',
      instructions: 'Okupljanje u domu.',
      incidentLocation: 'Poligon (izmisljena lokacija)',
      reporterLocation: '',
      memberIds: overrides.memberIds ?? [],
      groupIds: overrides.groupIds ?? ['g-ida'],
    },
    ctx,
  );
}

const firstCall = (state: AppState) => state.calls[0]!;
const firstExercise = (state: AppState) => state.exercises[0]!;

// ---------------------------------------------------------------------------

describe('recipient selection', () => {
  it('expands a group into its members', () => {
    const state = emptyState();
    expect(resolveRecipients(state, [], ['g-ida']).sort()).toEqual([...IDA_MEMBERS].sort());
  });

  it('merges individuals with groups and removes duplicates', () => {
    const state = emptyState();
    // m-04 is in g-ida and is also ticked individually.
    const result = resolveRecipients(state, ['m-01', 'm-04'], ['g-ida']);
    expect(new Set(result).size).toBe(result.length);
    expect(result.sort()).toEqual([...IDA_MEMBERS, 'm-01'].sort());
  });

  it('excludes inactive members', () => {
    const base = emptyState();
    const state: AppState = {
      ...base,
      members: base.members.map((m) => (m.id === 'm-04' ? { ...m, active: false } : m)),
    };
    expect(resolveRecipients(state, [], ['g-ida'])).not.toContain('m-04');
  });

  it('ignores an unknown group rather than failing', () => {
    const state = emptyState();
    expect(resolveRecipients(state, ['m-01'], ['g-does-not-exist'])).toEqual(['m-01']);
  });

  it('refuses a call with no recipients', () => {
    const { ctx } = makeCtx();
    const result = applyCommand(
      emptyState(),
      {
        type: 'CREATE_EXERCISE_AND_CALL',
        commandId: cid(),
        actorId: 'm-02',
        kind: 'VJEZBA',
        title: 'Naslov',
        instructions: 'Uputstvo',
        incidentLocation: 'Lokacija',
        reporterLocation: '',
        memberIds: [],
        groupIds: [],
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NEMA_PRIMALACA');
  });

  it('freezes the recipient list at send time', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx, { groupIds: ['g-ida'] });
    const before = [...firstCall(state).recipientIds];

    // A member joins the group afterwards. The record of who was called must
    // not change retroactively.
    state = {
      ...state,
      groups: state.groups.map((g) =>
        g.id === 'g-ida' ? { ...g, memberIds: [...g.memberIds, 'm-14'] } : g,
      ),
    };

    expect(firstCall(state).recipientIds).toEqual(before);
    expect(firstCall(state).recipientIds).not.toContain('m-14');
  });
});

// ---------------------------------------------------------------------------

describe('sending a call fabricates nothing', () => {
  it('creates no responses', () => {
    const { ctx } = makeCtx();
    const state = createCall(emptyState(), ctx);
    expect(state.responses).toHaveLength(0);
    expect(getResponseTotals(state, firstCall(state).id).bezOdgovora).toBe(IDA_MEMBERS.length);
  });

  it('records every delivery attempt as not attempted, on no channel', () => {
    const { ctx } = makeCtx();
    const state = createCall(emptyState(), ctx);

    expect(state.deliveryAttempts).toHaveLength(IDA_MEMBERS.length);
    for (const attempt of state.deliveryAttempts) {
      expect(attempt.state).toBe('NIJE_POKUSANO');
      expect(attempt.channel).toBe('NEMA');
    }
  });

  it('never reaches any other delivery state, whatever sequence of commands runs', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);
    const exercise = firstExercise(state);

    // Everything a user can do, in one go.
    for (const memberId of IDA_MEMBERS) {
      state = must(
        state,
        {
          type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: memberId, callId: call.id,
          memberId, answer: 'DOLAZIM', etaMinutes: null, directToLocation: false,
        },
        ctx,
      );
    }
    state = must(state, { type: 'DEPART_VEHICLE', commandId: cid(), actorId: 'm-02', exerciseId: exercise.id, vehicleId: 'v-01', purpose: '' }, ctx);
    state = must(state, { type: 'SET_EXERCISE_STATUS', commandId: cid(), actorId: 'm-02', exerciseId: exercise.id, status: 'NA_TERENU' }, ctx);
    state = must(state, { type: 'RETURN_VEHICLE', commandId: cid(), actorId: 'm-02', vehicleId: 'v-01' }, ctx);
    state = must(state, { type: 'CLOSE_EXERCISE', commandId: cid(), actorId: 'm-02', exerciseId: exercise.id, reason: 'Gotovo' }, ctx);

    expect(state.deliveryAttempts.every((d) => d.state === 'NIJE_POKUSANO')).toBe(true);
  });

  it('rejects missing required fields, naming the field', () => {
    const { ctx } = makeCtx();
    const base: Omit<CreateExerciseAndCall, 'type'> = {
      commandId: cid(), actorId: 'm-02', kind: 'VJEZBA', title: 'Naslov',
      instructions: 'Uputstvo', incidentLocation: 'Lokacija', reporterLocation: '',
      memberIds: [], groupIds: ['g-ida'],
    };

    const cases = [
      { patch: { title: '   ' }, code: 'NEDOSTAJE_NASLOV', field: 'title' },
      { patch: { instructions: '' }, code: 'NEDOSTAJE_UPUTSTVO', field: 'instructions' },
      { patch: { incidentLocation: '' }, code: 'NEDOSTAJE_LOKACIJA', field: 'incidentLocation' },
    ];

    for (const { patch, code, field } of cases) {
      const result = applyCommand(
        emptyState(),
        { type: 'CREATE_EXERCISE_AND_CALL', ...base, ...patch },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
        expect(result.error.field).toBe(field);
      }
    }
  });

  it('accepts a missing reporter location but never substitutes it for the incident location', () => {
    const { ctx } = makeCtx();
    const state = must(
      emptyState(),
      {
        type: 'CREATE_EXERCISE_AND_CALL', commandId: cid(), actorId: 'm-02', kind: 'VJEZBA',
        title: 'Naslov', instructions: 'Uputstvo', incidentLocation: 'Mjesto dogadjaja',
        reporterLocation: '', memberIds: [], groupIds: ['g-ida'],
      },
      ctx,
    );
    expect(firstExercise(state).reporterLocation).toBe('');
    expect(firstExercise(state).incidentLocation).toBe('Mjesto dogadjaja');
    expect(firstCall(state).messageText).not.toContain('Lokacija prijavioca');
  });
});

// ---------------------------------------------------------------------------

describe('call visibility', () => {
  it('shows a call only to its recipients', () => {
    const { ctx } = makeCtx();
    const state = createCall(emptyState(), ctx, { groupIds: ['g-ida'] });

    expect(getCallsForMember(state, 'm-04')).toHaveLength(1);
    // m-06 is first aid, not IDA, and was not called.
    expect(getCallsForMember(state, 'm-06')).toHaveLength(0);
    expect(getActiveCallForMember(state, 'm-06')).toBeUndefined();
    expect(getActiveCallForMember(state, 'm-04')).toBeDefined();
  });

  it('refuses an answer from someone who was not called', () => {
    const { ctx } = makeCtx();
    const state = createCall(emptyState(), ctx, { groupIds: ['g-ida'] });
    const result = applyCommand(
      state,
      {
        type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-06', callId: firstCall(state).id,
        memberId: 'm-06', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false,
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NIJE_PRIMALAC');
  });
});

// ---------------------------------------------------------------------------

describe('responses and totals', () => {
  it('records an answer and updates the totals', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);

    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);
    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-05', callId: call.id, memberId: 'm-05', answer: 'DOLAZIM_KASNIJE', etaMinutes: 30, directToLocation: false }, ctx);
    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-09', callId: call.id, memberId: 'm-09', answer: 'NE_MOGU', etaMinutes: null, directToLocation: false }, ctx);

    const totals = getResponseTotals(state, call.id);
    expect(totals).toMatchObject({ recipients: 4, dolazim: 1, kasnije: 1, neMogu: 1, bezOdgovora: 1 });
  });

  it('changing an answer updates one row and leaves everyone else alone', () => {
    const { ctx, advance } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);

    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);
    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-05', callId: call.id, memberId: 'm-05', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);

    const otherBefore = state.responses.find((r) => r.memberId === 'm-05');
    advance(60_000);

    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'NE_MOGU', etaMinutes: null, directToLocation: false }, ctx);

    const changed = state.responses.filter((r) => r.memberId === 'm-04');
    expect(changed).toHaveLength(1);
    expect(changed[0]!.answer).toBe('NE_MOGU');
    expect(changed[0]!.revision).toBe(2);
    expect(changed[0]!.updatedAt).not.toBe(changed[0]!.respondedAt);
    // Nobody else moved.
    expect(state.responses.find((r) => r.memberId === 'm-05')).toEqual(otherBefore);
    expect(getResponseTotals(state, call.id)).toMatchObject({ dolazim: 1, neMogu: 1 });
  });

  it('requires a valid arrival band for "dolazim kasnije" and drops it otherwise', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);

    const bad = applyCommand(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'DOLAZIM_KASNIJE', etaMinutes: null, directToLocation: false }, ctx);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('NEISPRAVNO_VRIJEME_DOLASKA');

    // An arrival band sent with a plain "dolazim" is meaningless and is dropped.
    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'DOLAZIM', etaMinutes: 60, directToLocation: false }, ctx);
    expect(state.responses[0]!.etaMinutes).toBeNull();
  });

  it('keeps "direct to location" independent of the answer, but not with "ne mogu"', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);

    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'DOLAZIM', etaMinutes: null, directToLocation: true }, ctx);
    expect(state.responses.find((r) => r.memberId === 'm-04')!.directToLocation).toBe(true);

    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-05', callId: call.id, memberId: 'm-05', answer: 'NE_MOGU', etaMinutes: null, directToLocation: true }, ctx);
    expect(state.responses.find((r) => r.memberId === 'm-05')!.directToLocation).toBe(false);
    expect(getResponseTotals(state, call.id).direktnoNaLokaciju).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('duplicate submissions', () => {
  it('a repeated command id changes nothing', () => {
    const { ctx } = makeCtx();
    const commandId = cid();
    const command: Command = {
      type: 'CREATE_EXERCISE_AND_CALL', commandId, actorId: 'm-02', kind: 'VJEZBA',
      title: 'Naslov', instructions: 'Uputstvo', incidentLocation: 'Lokacija',
      reporterLocation: '', memberIds: [], groupIds: ['g-ida'],
    };

    const once = must(emptyState(), command, ctx);
    const twice = must(once, command, ctx);

    expect(once.calls).toHaveLength(1);
    expect(twice.calls).toHaveLength(1);
    expect(twice.exercises).toHaveLength(1);
    expect(twice.deliveryAttempts).toHaveLength(IDA_MEMBERS.length);
  });

  it('re-sending an identical answer does not bump the revision or write history', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);

    const answer: Omit<SubmitResponse, 'commandId'> = {
      type: 'SUBMIT_RESPONSE', actorId: 'm-04', callId: call.id, memberId: 'm-04',
      answer: 'DOLAZIM', etaMinutes: null, directToLocation: false,
    };

    state = must(state, { ...answer, commandId: cid() }, ctx);
    const activityCount = state.activity.length;

    // Same answer, different command id - a genuine double tap.
    state = must(state, { ...answer, commandId: cid() }, ctx);

    expect(state.responses).toHaveLength(1);
    expect(state.responses[0]!.revision).toBe(1);
    expect(state.activity).toHaveLength(activityCount);
  });

  it('refuses a second exercise while one is open', () => {
    const { ctx } = makeCtx();
    const state = createCall(emptyState(), ctx);
    const result = applyCommand(
      state,
      {
        type: 'CREATE_EXERCISE_AND_CALL', commandId: cid(), actorId: 'm-02', kind: 'VJEZBA',
        title: 'Druga', instructions: 'Uputstvo', incidentLocation: 'Lokacija',
        reporterLocation: '', memberIds: [], groupIds: ['g-ida'],
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VEC_POSTOJI_OTVORENA_VJEZBA');
  });
});

// ---------------------------------------------------------------------------

describe('closed and cancelled exercises', () => {
  it('refuses an answer after the exercise is closed, keeping earlier answers', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);
    const exercise = firstExercise(state);

    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);
    state = must(state, { type: 'CLOSE_EXERCISE', commandId: cid(), actorId: 'm-02', exerciseId: exercise.id, reason: 'Zavrseno' }, ctx);

    const late = applyCommand(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-05', callId: call.id, memberId: 'm-05', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe('VJEZBA_NIJE_OTVORENA');

    // The answer given while it was open survives.
    expect(state.responses).toHaveLength(1);
  });

  it('refuses an answer to a cancelled call but keeps the record', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);

    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);
    state = must(state, { type: 'CANCEL_CALL', commandId: cid(), actorId: 'm-02', callId: call.id }, ctx);

    const result = applyCommand(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-05', callId: call.id, memberId: 'm-05', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('POZIV_NIJE_AKTIVAN');
    expect(state.responses).toHaveLength(1);
  });

  it('requires a reason to close or cancel', () => {
    const { ctx } = makeCtx();
    const state = createCall(emptyState(), ctx);
    const result = applyCommand(state, { type: 'CLOSE_EXERCISE', commandId: cid(), actorId: 'm-02', exerciseId: firstExercise(state).id, reason: '  ' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NEDOSTAJE_RAZLOG');
  });

  it('does not reach a closed status through the status command', () => {
    const { ctx } = makeCtx();
    const state = createCall(emptyState(), ctx);
    const result = applyCommand(state, { type: 'SET_EXERCISE_STATUS', commandId: cid(), actorId: 'm-02', exerciseId: firstExercise(state).id, status: 'ZAVRSENA' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NEISPRAVAN_STATUS');
  });

  it('does not change status because of responses', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);

    for (const memberId of IDA_MEMBERS) {
      state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: memberId, callId: call.id, memberId, answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);
    }
    // Everyone is coming; the exercise is still exactly where the officer left it.
    expect(firstExercise(state).status).toBe('OTVORENA');
  });
});

// ---------------------------------------------------------------------------

describe('vehicles are independent of attendance', () => {
  it('answering never moves a vehicle', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);

    for (const memberId of IDA_MEMBERS) {
      state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: memberId, callId: call.id, memberId, answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);
    }

    expect(state.vehicleMovements).toHaveLength(0);
    for (const vehicle of state.vehicles) {
      expect(vehicleStateFrom(state.vehicleMovements, vehicle.id)).toBe('U_DOMU');
    }
  });

  it('a vehicle departing creates no response and no status change', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const exercise = firstExercise(state);

    state = must(state, { type: 'DEPART_VEHICLE', commandId: cid(), actorId: 'm-02', exerciseId: exercise.id, vehicleId: 'v-01', purpose: 'Vjezba' }, ctx);

    expect(state.responses).toHaveLength(0);
    expect(firstExercise(state).status).toBe('OTVORENA');
    expect(vehicleStateFrom(state.vehicleMovements, 'v-01')).toBe('NA_ZADATKU');
    expect(vehicleStateFrom(state.vehicleMovements, 'v-02')).toBe('U_DOMU');
  });

  it('refuses a double departure and a return of a vehicle that is in', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const exercise = firstExercise(state);

    state = must(state, { type: 'DEPART_VEHICLE', commandId: cid(), actorId: 'm-02', exerciseId: exercise.id, vehicleId: 'v-01', purpose: '' }, ctx);

    const again = applyCommand(state, { type: 'DEPART_VEHICLE', commandId: cid(), actorId: 'm-02', exerciseId: exercise.id, vehicleId: 'v-01', purpose: '' }, ctx);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('VOZILO_VEC_IZASLO');

    const wrongReturn = applyCommand(state, { type: 'RETURN_VEHICLE', commandId: cid(), actorId: 'm-02', vehicleId: 'v-02' }, ctx);
    expect(wrongReturn.ok).toBe(false);
    if (!wrongReturn.ok) expect(wrongReturn.error.code).toBe('VOZILO_NIJE_IZASLO');
  });

  it('allows a forgotten return after the exercise is closed', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const exercise = firstExercise(state);

    state = must(state, { type: 'DEPART_VEHICLE', commandId: cid(), actorId: 'm-02', exerciseId: exercise.id, vehicleId: 'v-01', purpose: '' }, ctx);
    state = must(state, { type: 'CLOSE_EXERCISE', commandId: cid(), actorId: 'm-02', exerciseId: exercise.id, reason: 'Kraj' }, ctx);
    state = must(state, { type: 'RETURN_VEHICLE', commandId: cid(), actorId: 'm-01', vehicleId: 'v-01' }, ctx);

    expect(vehicleStateFrom(state.vehicleMovements, 'v-01')).toBe('U_DOMU');
  });

  it('refuses a departure when nothing is open', () => {
    const { ctx } = makeCtx();
    const state = emptyState();
    const result = applyCommand(state, { type: 'DEPART_VEHICLE', commandId: cid(), actorId: 'm-02', exerciseId: 'nema', vehicleId: 'v-01', purpose: '' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VJEZBA_NE_POSTOJI');
  });
});

// ---------------------------------------------------------------------------

describe('history and the activity log', () => {
  it('keeps a closed exercise with its responses', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);
    const exercise = firstExercise(state);

    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);
    state = must(state, { type: 'CLOSE_EXERCISE', commandId: cid(), actorId: 'm-02', exerciseId: exercise.id, reason: 'Zavrseno po planu' }, ctx);

    const history = getHistory(state);
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe('ZAVRSENA');
    expect(history[0]!.closeReason).toBe('Zavrseno po planu');
    expect(getResponseTotals(state, call.id).dolazim).toBe(1);
  });

  it('timestamps every change and names the simulated actor', () => {
    const { ctx, advance } = makeCtx('2026-09-07T10:00:00.000Z');
    let state = createCall(emptyState(), ctx);
    advance(120_000);
    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: firstCall(state).id, memberId: 'm-04', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);

    const newest = state.activity[0]!;
    expect(newest.kind).toBe('ODGOVOR_DAT');
    expect(newest.actorId).toBe('m-04');
    expect(newest.actorName).toBe('Ivan Radulovic');
    expect(newest.at).toBe('2026-09-07T10:02:00.000Z');
    // Newest first, and the send is still there underneath.
    expect(state.activity.map((a) => a.kind)).toContain('POZIV_POSLAT');
  });

  it('records a response change as its own entry, not by rewriting the first', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    const call = firstCall(state);

    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'DOLAZIM', etaMinutes: null, directToLocation: false }, ctx);
    state = must(state, { type: 'SUBMIT_RESPONSE', commandId: cid(), actorId: 'm-04', callId: call.id, memberId: 'm-04', answer: 'NE_MOGU', etaMinutes: null, directToLocation: false }, ctx);

    const kinds = state.activity.map((a) => a.kind);
    expect(kinds).toContain('ODGOVOR_DAT');
    expect(kinds).toContain('ODGOVOR_PROMIJENJEN');
  });
});

// ---------------------------------------------------------------------------

describe('reset', () => {
  it('restores the seed and leaves a single record of the reset', () => {
    const { ctx } = makeCtx();
    let state = createCall(emptyState(), ctx);
    state = must(state, { type: 'DEPART_VEHICLE', commandId: cid(), actorId: 'm-02', exerciseId: firstExercise(state).id, vehicleId: 'v-01', purpose: '' }, ctx);

    const after = must(state, { type: 'RESET_DEMO_DATA', commandId: cid(), actorId: 'm-02' }, ctx);

    // Back to the seeded demonstration data, not to nothing.
    expect(after.exercises.every((e) => e.status === 'ZAVRSENA')).toBe(true);
    expect(after.vehicleMovements.every((m) => m.returnedAt !== null)).toBe(true);
    expect(after.members).toHaveLength(state.members.length);
    expect(after.activity).toHaveLength(1);
    expect(after.activity[0]!.kind).toBe('PODACI_RESETOVANI');
  });

  it('a repeated reset command does not reset twice', () => {
    const { ctx } = makeCtx();
    const commandId = cid();
    const state = createCall(emptyState(), ctx);

    const once = must(state, { type: 'RESET_DEMO_DATA', commandId, actorId: 'm-02' }, ctx);
    const twice = must(once, { type: 'RESET_DEMO_DATA', commandId, actorId: 'm-02' }, ctx);
    expect(twice).toBe(once);
  });
});

// ---------------------------------------------------------------------------

describe('simulated actor', () => {
  it('switching actor changes nothing operational', () => {
    const { ctx } = makeCtx();
    const state = createCall(emptyState(), ctx);
    const after = must(state, { type: 'SET_SIMULATED_ACTOR', commandId: cid(), actorId: 'm-02', memberId: 'm-04', viewRole: 'CLAN' }, ctx);

    expect(after.simulation.actorId).toBe('m-04');
    expect(after.responses).toEqual(state.responses);
    expect(after.calls).toEqual(state.calls);
    // A demo control is not an operational event and does not enter the log.
    expect(after.activity).toEqual(state.activity);
  });

  it('refuses an unknown member', () => {
    const { ctx } = makeCtx();
    const result = applyCommand(emptyState(), { type: 'SET_SIMULATED_ACTOR', commandId: cid(), actorId: 'm-02', memberId: 'nema', viewRole: 'CLAN' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CLAN_NE_POSTOJI');
  });
});
