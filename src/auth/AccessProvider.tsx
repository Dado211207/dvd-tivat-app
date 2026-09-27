/**
 * Global authentication and access state.
 *
 * The rule this exists to enforce: **nothing protected renders until the server
 * has said who you are and what you may do.** The previous flow switched to a
 * local `READY` step as soon as `signInWithPassword` resolved, which proved only
 * that a password was correct - not that the account was approved, not that its
 * profile was complete, and not that it had not been suspended five minutes
 * earlier.
 *
 * So the provider holds `LOADING` until `loadAccess()` returns, reloads on every
 * auth-state change, and reloads on demand. A suspended account keeps a
 * syntactically valid JWT until it expires, but `current_dvd_role()` returns
 * NULL for it, so the next reload takes its access away.
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
import { loadAccess, sameAccess, type Access, type AccessGateway } from './access';
import type { OrganizationCode } from './directory';
import {
  canSwitchService as canSwitchAmong,
  readRememberedService,
  writeRememberedService,
} from './serviceContext';
import {
  accountBackend,
  isAccountBackendConfigured,
  signOut as backendSignOut,
  supabaseAccessGateway,
} from './supabaseClient';

export interface AccessContextValue {
  readonly access: Access;
  /** Re-reads role and status from the server. */
  readonly reload: () => Promise<void>;
  readonly signOut: () => Promise<void>;
  /**
   * The service the person is acting as (P6), or null. Mirrors `access.service`,
   * surfaced here so a screen can read it without narrowing the snapshot union.
   */
  readonly actingService: OrganizationCode | null;
  /** Every service they may act as, in the fixed DVD, SZS order. */
  readonly availableServices: readonly OrganizationCode[];
  /** True when more than one service is available - i.e. the switch is offered. */
  readonly canSwitchService: boolean;
  /**
   * Act as a different service. A no-op unless signed in and the service is one
   * the server says they may act in: the choice is remembered per account on this
   * device and the snapshot is reloaded, so the new service's role and member come
   * from the server, never from the click. Never fires during a load.
   */
  readonly setActingService: (service: OrganizationCode) => Promise<void>;
}

/** A stable empty list, so the context value does not churn while signed out. */
const NO_SERVICES: readonly OrganizationCode[] = [];

/** window.localStorage, or null wherever it is absent or blocked. Read once. */
function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const AccessContext = createContext<AccessContextValue | null>(null);

export interface AccessProviderProps {
  readonly children: ReactNode;
  /** Injected in tests. Production uses the Supabase gateway. */
  readonly gateway?: AccessGateway;
  /** Injected in tests, so the provider can run without a project. */
  readonly configured?: boolean;
  /** Injected in tests; production remembers the acting service in localStorage. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export function AccessProvider({ children, gateway, configured, storage }: AccessProviderProps) {
  const isConfigured = configured ?? isAccountBackendConfigured();
  const activeGateway = gateway ?? supabaseAccessGateway;
  const activeStorage = useMemo(
    () => (storage === undefined ? defaultStorage() : storage),
    [storage],
  );

  const [access, setAccess] = useState<Access>(
    isConfigured ? { kind: 'LOADING' } : { kind: 'NOT_CONFIGURED' },
  );

  // Guards against a slow earlier load overwriting a newer one, and against
  // setting state after unmount.
  const mounted = useRef(true);
  const generation = useRef(0);
  // The latest snapshot, read inside setActingService without making that callback
  // change identity on every reload.
  const accessRef = useRef(access);
  accessRef.current = access;

  // The remembered acting service is looked up by user id, which loadAccess only
  // knows after it has read the session. Passing the lookup rather than a value
  // lets loadAccess resolve it against the services the person may actually act
  // in, so a stale or absent choice safely falls back to the default.
  const readPreferred = useCallback(
    (userId: string) => readRememberedService(activeStorage, userId),
    [activeStorage],
  );

  const reload = useCallback(async () => {
    if (!isConfigured) return;
    const ticket = ++generation.current;
    const next = await loadAccess(activeGateway, { preferredService: readPreferred });
    if (!mounted.current || ticket !== generation.current) return;
    // Keep the previous object when the answer is unchanged. Every consumer
    // downstream is keyed on this value, and a token refresh or a tab regaining
    // focus must not look like "the account changed" to any of them.
    setAccess((current) => (sameAccess(current, next) ? current : next));
  }, [activeGateway, isConfigured, readPreferred]);

  const setActingService = useCallback(
    async (service: OrganizationCode) => {
      const current = accessRef.current;
      // Only a signed-in person switches, and only to a service the server says
      // they may act in. Writing the choice before reloading means the reload's
      // preferred-service lookup returns it; the role and member for the new
      // service still come from the server on that reload, never from this click.
      if (current.kind !== 'SIGNED_IN') return;
      if (current.service === service) return;
      if (!current.availableServices.includes(service)) return;
      writeRememberedService(activeStorage, current.userId, service);
      await reload();
    },
    [activeStorage, reload],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isConfigured) {
      setAccess({ kind: 'NOT_CONFIGURED' });
      return;
    }
    void reload();
  }, [isConfigured, reload]);

  // Sign-in, sign-out and token refresh all have to re-ask the server. A token
  // refresh matters as much as a sign-in: it is the moment a suspension that
  // happened while the tab was open becomes visible.
  useEffect(() => {
    if (!isConfigured || gateway) return;
    let subscription: { unsubscribe: () => void } | undefined;
    try {
      const result = accountBackend().auth.onAuthStateChange(() => {
        void reload();
      });
      subscription = result.data.subscription;
    } catch {
      /* Unconfigured or unavailable; `access` already reflects that. */
    }
    return () => subscription?.unsubscribe();
  }, [gateway, isConfigured, reload]);

  const signOut = useCallback(async () => {
    setAccess({ kind: 'LOADING' });
    await backendSignOut();
    await reload();
  }, [reload]);

  const actingService = access.kind === 'SIGNED_IN' ? access.service : null;
  const availableServices = access.kind === 'SIGNED_IN' ? access.availableServices : NO_SERVICES;
  const value = useMemo<AccessContextValue>(
    () => ({
      access,
      reload,
      signOut,
      actingService,
      availableServices,
      canSwitchService: canSwitchAmong(availableServices),
      setActingService,
    }),
    [access, reload, signOut, actingService, availableServices, setActingService],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const value = useContext(AccessContext);
  if (value === null) {
    throw new Error('useAccess must be used inside an AccessProvider.');
  }
  return value;
}
