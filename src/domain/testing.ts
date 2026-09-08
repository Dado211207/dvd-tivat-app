/**
 * Test helpers. Deterministic ids and a controllable clock, so a test asserts
 * on the rules rather than on whatever the machine's clock happened to say.
 */

import type { Command, Ctx } from './commands';
import { applyCommand } from './reducer';
import type { AppState } from './types';
import { createSeedState } from './seed';

export function makeCtx(startIso = '2026-09-07T10:00:00.000Z') {
  let counter = 0;
  let clock = new Date(startIso).getTime();

  const ctx: Ctx = {
    now: () => new Date(clock).toISOString(),
    id: () => `t-${++counter}`,
  };

  return {
    ctx,
    /** Moves the test clock forward, for asserting on ordering and timestamps. */
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** A clean state with no seeded history, so counts in tests are unambiguous. */
export function emptyState(): AppState {
  return {
    ...createSeedState(),
    exercises: [],
    calls: [],
    deliveryAttempts: [],
    responses: [],
    vehicleMovements: [],
    citizenReports: [],
    activity: [],
  };
}

/** Applies a command and fails loudly if the domain refused it. */
export function must(state: AppState, command: Command, ctx: Ctx): AppState {
  const result = applyCommand(state, command, ctx);
  if (!result.ok) {
    throw new Error(`Command ${command.type} unexpectedly rejected: ${result.error.code}`);
  }
  return result.value;
}

let seq = 0;
export const cid = (): string => `cmd-${++seq}`;
