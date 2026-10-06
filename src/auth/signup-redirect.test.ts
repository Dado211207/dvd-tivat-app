// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signUp: vi.fn(), resend: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fixture-not-a-real-project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture_only_never_a_real_key');
  auth.signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  auth.resend.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('registration confirmation when app origin changes', () => {
  it.each(['https://boka-operativa-phone-test.netlify.app', 'https://firenexa-app.netlify.app'])(
    'sends sign-up and resend links back to %s', async (origin) => {
      vi.stubGlobal('window', { location: { origin } });
      const { registerWithEmail, resendSignupConfirmation } = await import('./supabaseClient');
      await registerWithEmail('clan@example.invalid', 'some-long-password', {
        fullName: 'Clan Primjer', phone: '+38267000000', dateOfBirth: '1990-01-01',
      });
      await resendSignupConfirmation('clan@example.invalid');

      expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
        options: expect.objectContaining({ emailRedirectTo: `${origin}/` }),
      }));
      expect(auth.resend).toHaveBeenCalledWith({
        type: 'signup', email: 'clan@example.invalid',
        options: { emailRedirectTo: `${origin}/` },
      });
    },
  );
});
