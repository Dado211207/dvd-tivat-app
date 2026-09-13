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
}

const AccessContext = createContext<AccessContextValue | null>(null);

export interface AccessProviderProps {
  readonly children: ReactNode;
  /** Injected in tests. Production uses the Supabase gateway. */
  readonly gateway?: AccessGateway;
  /** Injected in tests, so the provider can run without a project. */
  readonly configured?: boolean;
}

export function AccessProvider({ children, gateway, configured }: AccessProviderProps) {
  const isConfigured = configured ?? isAccountBackendConfigured();
  const activeGateway = gateway ?? supabaseAccessGateway;

  const [access, setAccess] = useState<Access>(
    isConfigured ? { kind: 'LOADING' } : { kind: 'NOT_CONFIGURED' },
  );

  // Guards against a slow earlier load overwriting a newer one, and against
  // setting state after unmount.
  const mounted = useRef(true);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    if (!isConfigured) return;
    const ticket = ++generation.current;
    const next = await loadAccess(activeGateway);
    if (!mounted.current || ticket !== generation.current) return;
    // Keep the previous object when the answer is unchanged. Every consumer
    // downstream is keyed on this value, and a token refresh or a tab regaining
    // focus must not look like "the account changed" to any of them.
    setAccess((current) => (sameAccess(current, next) ? current : next));
  }, [activeGateway, isConfigured]);

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

  const value = useMemo<AccessContextValue>(
    () => ({ access, reload, signOut }),
    [access, reload, signOut],
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
