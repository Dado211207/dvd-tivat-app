import { createRecoveryBackend, isUnreachable } from './supabaseClient';

export type RecoveryResult = 'ok' | 'invalid-code' | 'update-failed' | 'unreachable';

/** Server refusals deliberately reveal neither account existence nor mail delivery. */
export async function requestRecoveryCode(email: string): Promise<'received' | 'unreachable'> {
  try {
    const { error } = await createRecoveryBackend().auth.resetPasswordForEmail(email.trim().toLowerCase());
    return error && isUnreachable(error) ? 'unreachable' : 'received';
  } catch (error) {
    return isUnreachable(error) ? 'unreachable' : 'received';
  }
}

/** The code authorises one password change, never an operational sign-in. */
export async function resetPasswordWithCode(email: string, token: string, password: string): Promise<RecoveryResult> {
  if (password.length < 12 || !/^\d{6,10}$/.test(token.trim())) return 'invalid-code';
  const normalizedEmail = email.trim().toLowerCase();
  let recovery: ReturnType<typeof createRecoveryBackend> | undefined;
  let verified = false;
  try {
    recovery = createRecoveryBackend();
    const { data, error } = await recovery.auth.verifyOtp({ email: normalizedEmail, token: token.trim(), type: 'recovery' });
    if (error) return isUnreachable(error) ? 'unreachable' : 'invalid-code';
    if (!data.session || !data.user || data.session.user.id !== data.user.id ||
        data.user.email?.toLowerCase() !== normalizedEmail) return 'invalid-code';
    verified = true;
    const changed = await recovery.auth.updateUser({ password });
    return changed.error || !changed.data.user ? 'update-failed' : 'ok';
  } catch (error) {
    // Once verification consumed the code, a lost update response is ambiguous.
    // Tell the person to try signing in or request a fresh code, never "success".
    return verified ? 'update-failed' : isUnreachable(error) ? 'unreachable' : 'invalid-code';
  } finally {
    // Best-effort revocation of only this temporary session. Nothing persisted,
    // no auto-refresh and no shared auth listeners, even if sign-out is offline.
    if (recovery) {
      try { await recovery.auth.signOut({ scope: 'local' }); } catch { /* discard in-memory client */ }
    }
  }
}
