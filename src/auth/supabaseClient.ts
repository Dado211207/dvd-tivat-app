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
 * "The server never answered" is a different thing, and safe to say.
 *
 * Reported from the device test: signing in through Brave failed with the
 * message above, so the person spent their time checking a password that was
 * perfectly correct. The request had never left the browser - the shield
 * blocked it.
 *
 * Telling somebody the server was unreachable leaks NOTHING about whether an
 * address has an account, because the request never reached the server to be
 * judged. That is the whole distinction: a refusal is an answer and stays
 * generic; a failure to reach anybody is not an answer at all.
 *
 * A rate-limit refusal stays generic too. It IS an answer from the server, and
 * a distinct message for it would tell somebody probing addresses which ones
 * are worth probing harder.
 */
export const NETWORK_UNREACHABLE_ERROR =
  'Server nije dostupan. Zahtjev nije stigao do servera, pa prijava nije ni pokusana. Provjerite internet vezu i pokusajte ponovo.';

/**
 * The same thing said again, after it has happened more than once.
 *
 * The first failure is usually a passing network. A repeated one on a device
 * that is otherwise online is very often a content blocker, a privacy shield or
 * a work network - which is what the report describes. Naming that as ONE
 * POSSIBLE cause saves the evening; asserting it as the cause would be a guess,
 * and telling anybody to turn their protection off would be worse than useless
 * advice.
 */
export const NETWORK_BLOCKED_HINT =
  'Server i dalje nije dostupan. Ako ste inace na internetu, zahtjev mozda blokira dodatak za blokiranje sadrzaja, zastita privatnosti u pregledacu (na primjer Brave Shields) ili mreza na kojoj ste. Mozete pokusati sa drugog pregledaca ili druge mreze, ili pitati vlasnika sistema.';

/**
 * Whether a failure means "could not reach the server" rather than "refused".
 *
 * Kept to the shapes a fetch actually produces when nothing answered: the
 * browser's own `TypeError: Failed to fetch` (which is also what a blocked
 * request looks like - deliberately indistinguishable, by design), an aborted
 * or timed-out request, and supabase-js's own wrapper for the same.
 *
 * Anything else - including every message the SERVER sent - is treated as a
 * refusal and gets the generic sentence. Guessing wrongly in that direction
 * would turn the sign-in form into the membership oracle this whole design
 * avoids, so the test is deliberately narrow.
 */
export function isUnreachable(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : '';

  return (
    /failed to fetch/i.test(message) ||
    /networkerror|network error/i.test(message) ||
    /load failed/i.test(message) ||
    /fetch failed/i.test(message) ||
    /aborterror|signal is aborted|timed? ?out/i.test(message) ||
    /err_(blocked|connection|internet|network|name_not_resolved)/i.test(message)
  );
}

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
  /** Present only when `ok` is false. Always one of the fixed messages above. */
  readonly message?: string;
  /**
   * True when the request never reached the server.
   *
   * Separate from `message` on purpose: the CALLER decides what to say, because
   * the right sentence depends on how many times this has now happened, and
   * that is something only the screen is counting.
   */
  readonly unreachable?: boolean;
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
    if (error === null) return { ok: true };
    // The server answered and said no. Which "no" it was stays private.
    return unreachable(error) ? { ok: false, unreachable: true } : { ok: false };
  } catch (thrown) {
    return unreachable(thrown) ? { ok: false, unreachable: true } : { ok: false };
  }
}

/**
 * One place that decides which sentence a failed sign-in gets.
 *
 * Never builds the message from the error. A raw Supabase message, a request
 * URL, a key or a JWT must never reach the screen, and the surest way to
 * guarantee that is for no code path to be able to put one there: the caller
 * chooses between two fixed strings.
 */
function unreachable(error: unknown): boolean {
  return isUnreachable(error);
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
    if (error) {
      return { ok: false, sessionStarted: false, unreachable: unreachable(error) };
    }
    return { ok: true, sessionStarted: data.session !== null };
  } catch (thrown) {
    return { ok: false, sessionStarted: false, unreachable: unreachable(thrown) };
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

  async fetchProfile(userId: string) {
    // Filtered on the id rather than left to row level security: the owner can
    // read every profile, so an unfiltered `maybeSingle()` would fail for the
    // one account that matters most as soon as a second account exists.
    const { data, error } = await accountBackend()
      .from('profiles')
      .select('full_name, profile_complete')
      .eq('user_id', userId)
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
