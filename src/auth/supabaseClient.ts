/**
 * The one place that talks to Supabase.
 *
 * Configuration comes from two build-time variables and nothing else:
 *
 *   VITE_SUPABASE_URL              the project URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY  the publishable key
 *
 * The publishable key is designed to be public - it ends up in the browser
 * bundle of every Supabase application, and it grants nothing on its own: `anon`
 * holds no table privilege and no executable function in this schema. The SECRET
 * key is a different thing entirely and must never appear here, in any `VITE_*`
 * variable, in a tracked file, or in the bundle. Nothing this application does
 * needs it; if some future feature appears to, that is a design smell to raise
 * rather than a requirement to satisfy.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AccessGateway } from './access';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

let client: SupabaseClient | null = null;

export function isAccountBackendConfigured(): boolean {
  return /^https:\/\/[^\s]+\.supabase\.co\/?$/.test(url) && publishableKey.length > 20;
}

export function accountBackend(): SupabaseClient {
  if (!isAccountBackendConfigured()) {
    throw new Error('Account backend is not configured.');
  }
  client ??= createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // No magic-link or OAuth redirect flow is in use, so there is nothing in
      // the URL to detect. Leaving it on would have the client parse fragments
      // it should ignore.
      detectSessionInUrl: false,
    },
  });
  return client;
}

/**
 * One message for every failed credential attempt.
 *
 * Sign-in must not reveal whether an address has an account: a different message
 * for "no such user" and "wrong password" turns the sign-in form into a
 * membership oracle for a volunteer fire society. Supabase already answers
 * `Invalid login credentials` for both; this makes the client's behaviour match
 * regardless of what the server says, including for rate-limit and network
 * errors, which must not be distinguishable either.
 */
export const GENERIC_CREDENTIAL_ERROR =
  'Prijava nije uspjela. Provjerite email i lozinku, pa pokusajte ponovo.';

/**
 * Password reset is not offered, and the reason is stated rather than hidden.
 *
 * Supabase's default mail sender only delivers to addresses on the project team
 * and is heavily rate limited, so a reset form here would send nothing to an
 * ordinary member while looking as though it had. Until an SMTP provider is
 * configured (blocker B2), the owner resets a password from the dashboard.
 */
export const PASSWORD_RESET_AVAILABLE = false;

export interface AuthOutcome {
  readonly ok: boolean;
  /** Present only when `ok` is false. Always the generic message. */
  readonly message?: string;
}

export interface RegistrationOutcome extends AuthOutcome {
  /**
   * Whether registration produced a usable session straight away.
   *
   * False means one of two things that must stay indistinguishable: the address
   * already had an account, or the project still requires email confirmation.
   * Both lead to the same instruction, which is why this is a boolean and not a
   * reason.
   */
  readonly sessionStarted: boolean;
}

export async function signInWithEmail(email: string, password: string): Promise<AuthOutcome> {
  try {
    const { error } = await accountBackend().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    return error ? { ok: false, message: GENERIC_CREDENTIAL_ERROR } : { ok: true };
  } catch {
    return { ok: false, message: GENERIC_CREDENTIAL_ERROR };
  }
}

/**
 * Registration.
 *
 * Deliberately reports the same outcome whether the address was new or already
 * had an account - Supabase's own anti-enumeration behaviour, which the client
 * must not undo by inspecting the response. The person is told to sign in; if
 * the address was already registered, that is exactly the right instruction.
 */
export async function registerWithEmail(
  email: string,
  password: string,
): Promise<RegistrationOutcome> {
  try {
    const { data, error } = await accountBackend().auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) return { ok: false, sessionStarted: false, message: GENERIC_CREDENTIAL_ERROR };
    return { ok: true, sessionStarted: data.session !== null };
  } catch {
    return { ok: false, sessionStarted: false, message: GENERIC_CREDENTIAL_ERROR };
  }
}

export async function completeOwnProfile(fullName: string): Promise<AuthOutcome> {
  try {
    const { error } = await accountBackend().rpc('complete_own_profile', {
      requested_full_name: fullName.trim(),
    });
    return error
      ? { ok: false, message: 'Ime i prezime nijesu sacuvani. Pokusajte ponovo.' }
      : { ok: true };
  } catch {
    return { ok: false, message: 'Ime i prezime nijesu sacuvani. Pokusajte ponovo.' };
  }
}

export async function signOut(): Promise<void> {
  // A failed sign-out must still clear this browser. `scope: 'local'` is the
  // fallback so a network error cannot leave somebody looking signed in.
  try {
    const { error } = await accountBackend().auth.signOut();
    if (error) await accountBackend().auth.signOut({ scope: 'local' });
  } catch {
    try {
      await accountBackend().auth.signOut({ scope: 'local' });
    } catch {
      /* Nothing further is possible; the provider reloads the access state. */
    }
  }
}

/** The live gateway. Every read goes to the server; nothing is cached here. */
export const supabaseAccessGateway: AccessGateway = {
  async currentUser() {
    const { data, error } = await accountBackend().auth.getUser();
    if (error) {
      // No session at all is reported as an error by supabase-js. That is not a
      // failure to reach the server, it is the answer "nobody is signed in".
      if (isMissingSession(error)) return null;
      throw error;
    }
    const user = data.user;
    return user ? { id: user.id, email: user.email ?? '' } : null;
  },

  async fetchProfile() {
    const { data, error } = await accountBackend()
      .from('profiles')
      .select('full_name, profile_complete')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      fullName: (data as { full_name: string | null }).full_name,
      profileComplete: (data as { profile_complete: boolean }).profile_complete,
    };
  },

  async fetchRole() {
    const { data, error } = await accountBackend().rpc('current_dvd_role');
    if (error) throw error;
    return (data as string | null) ?? null;
  },

  async fetchAccountStatus() {
    const { data, error } = await accountBackend().rpc('current_account_status');
    if (error) throw error;
    return (data as string | null) ?? null;
  },
};

function isMissingSession(error: { name?: string; message?: string }): boolean {
  const text = `${error.name ?? ''} ${error.message ?? ''}`.toLowerCase();
  return text.includes('session') && (text.includes('missing') || text.includes('not found'));
}
