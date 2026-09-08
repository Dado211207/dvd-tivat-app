/**
 * React binding for the pure domain.
 *
 * This layer does the three impure things the domain refuses to do: read the
 * clock, generate ids, and touch localStorage. Everything else is delegated to
 * applyCommand so that the rules live in one testable place.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Command, Ctx } from '@/domain/commands';
import type { DomainError } from '@/domain/errors';
import { applyCommand } from '@/domain/reducer';
import type { AppState } from '@/domain/types';
import { clearStoredState, loadState, saveState } from '@/storage/persistence';

/**
 * Command fields the caller supplies; `actorId` defaults to the simulated actor.
 * Distributes over the union so the discriminant still narrows correctly.
 */
type WithoutActor<C> = C extends Command
  ? Omit<C, 'actorId'> & { actorId?: string }
  : never;
export type CommandInput = WithoutActor<Command>;

export type RunResult = { ok: true } | { ok: false; error: DomainError };

export interface Notice {
  text: string;
  tone: 'info' | 'error';
  /** Bumped on every notice so the live region re-announces repeats. */
  seq: number;
}

interface AppApi {
  state: AppState;
  run: (input: CommandInput) => RunResult;
  /**
   * Validates a command without committing it, using the same reducer. The
   * confirmation preview must not open on input the domain would reject, and
   * duplicating the rules in the interface is how the two drift apart.
   */
  check: (input: CommandInput) => RunResult;
  notice: Notice | null;
  announce: (text: string, tone?: 'info' | 'error') => void;
  /** Non-null when this browser refused to store data. */
  storageWarning: string | null;
}

const AppContext = createContext<AppApi | null>(null);

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const ctx: Ctx = { now: () => new Date().toISOString(), id: makeId };

export function AppStateProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadState(), []);
  const [state, setState] = useState<AppState>(initial.state);
  const [storageWarning, setStorageWarning] = useState<string | null>(initial.warning);
  const [notice, setNotice] = useState<Notice | null>(null);
  const seq = useRef(0);

  const announce = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    seq.current += 1;
    setNotice({ text, tone, seq: seq.current });
  }, []);

  // The authoritative copy between renders. Keeping it in a ref lets `run` be
  // synchronous - the caller gets the domain error back immediately and can
  // move focus to the offending field - and keeps side effects out of the
  // setState updater, which React may call more than once.
  const stateRef = useRef(state);
  stateRef.current = state;

  const run = useCallback((input: CommandInput): RunResult => {
    const current = stateRef.current;
    const command = {
      ...input,
      actorId: input.actorId ?? current.simulation.actorId,
    } as Command;

    const result = applyCommand(current, command, ctx);
    if (!result.ok) return { ok: false, error: result.error };

    // A reset must also drop the stored copy, not only the in-memory one.
    if (command.type === 'RESET_DEMO_DATA') clearStoredState();

    const saved = saveState(result.value);
    setStorageWarning(saved.ok ? null : saved.warning);

    // Updated before setState so two commands in the same tick compose.
    stateRef.current = result.value;
    setState(result.value);
    return { ok: true };
  }, []);

  // Announce a storage problem once it appears, so it is not only visual.
  useEffect(() => {
    if (storageWarning) announce(storageWarning, 'error');
  }, [storageWarning, announce]);

  const check = useCallback((input: CommandInput): RunResult => {
    const current = stateRef.current;
    const command = {
      ...input,
      actorId: input.actorId ?? current.simulation.actorId,
    } as Command;
    const result = applyCommand(current, command, ctx);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }, []);

  const value = useMemo<AppApi>(
    () => ({ state, run, check, notice, announce, storageWarning }),
    [state, run, check, notice, announce, storageWarning],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppApi {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppStateProvider');
  return value;
}

/**
 * A command id that stays stable until `resetKey` changes.
 *
 * This is what makes duplicate submission harmless in practice: a confirmation
 * dialog holds one id, so clicking "confirm" and pressing Enter at the same
 * moment produce the same command, and the second application is a no-op.
 */
export function useStableCommandId(resetKey: unknown): string {
  const ref = useRef<{ key: unknown; id: string }>({ key: resetKey, id: makeId() });
  if (ref.current.key !== resetKey) {
    ref.current = { key: resetKey, id: makeId() };
  }
  return ref.current.id;
}

export { makeId };
