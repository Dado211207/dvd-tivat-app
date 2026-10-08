// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth }) }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fixture-not-a-real-project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture_only_never_a_real_key');
  vi.stubEnv('VITE_PASSWORD_RESET_ENABLED', 'true');
  vi.stubGlobal('crypto', { randomUUID: () => 'fixture-recovery-client' });
  auth.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  auth.verifyOtp.mockReset();
  auth.updateUser.mockReset();
  auth.signOut.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('password recovery privacy and session boundaries', () => {
  it('normalizes the address and gives the same answer for an unknown account', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: new Error('User not found') });
    const { requestRecoveryCode } = await import('./passwordRecovery');
    await expect(requestRecoveryCode('  CLAN@EXAMPLE.INVALID ')).resolves.toBe('received');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('clan@example.invalid');
  });

  it('reports only a genuine transport failure as unreachable', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: new TypeError('Failed to fetch') });
    const { requestRecoveryCode } = await import('./passwordRecovery');
    await expect(requestRecoveryCode('clan@example.invalid')).resolves.toBe('unreachable');
  });

  it('changes the password only for a matching recovery session and signs it out', async () => {
    const user = { id: 'user-1', email: 'clan@example.invalid' };
    auth.verifyOtp.mockResolvedValue({ data: { session: { user }, user }, error: null });
    auth.updateUser.mockResolvedValue({ data: { user }, error: null });
    const { resetPasswordWithCode } = await import('./passwordRecovery');

    await expect(resetPasswordWithCode('CLAN@example.invalid', '123456', 'a-secure-password')).resolves.toBe('ok');
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'clan@example.invalid', token: '123456', type: 'recovery' });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a-secure-password' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('rejects a session for a different address without changing anything', async () => {
    const user = { id: 'user-1', email: 'other@example.invalid' };
    auth.verifyOtp.mockResolvedValue({ data: { session: { user }, user }, error: null });
    const { resetPasswordWithCode } = await import('./passwordRecovery');

    await expect(resetPasswordWithCode('clan@example.invalid', '123456', 'a-secure-password')).resolves.toBe('invalid-code');
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('never verifies obviously invalid input', async () => {
    const { resetPasswordWithCode } = await import('./passwordRecovery');
    await expect(resetPasswordWithCode('clan@example.invalid', 'abc', 'short')).resolves.toBe('invalid-code');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
});
