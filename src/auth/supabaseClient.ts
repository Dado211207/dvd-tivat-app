import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const anonymousKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

let client: SupabaseClient | null = null;

export function isAccountBackendConfigured(): boolean {
  return /^https:\/\//.test(url) && anonymousKey.length > 20;
}

export function accountBackend(): SupabaseClient {
  if (!isAccountBackendConfigured()) {
    throw new Error('Account backend is not configured.');
  }
  client ??= createClient(url, anonymousKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

export async function registerWithEmail(email: string, password: string): Promise<void> {
  const result = await accountBackend().auth.signUp({ email: email.trim(), password });
  if (result.error) throw result.error;
}

export async function verifyRegistrationCode(email: string, token: string): Promise<void> {
  const result = await accountBackend().auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'signup',
  });
  if (result.error) throw result.error;
}

export async function completeOwnProfile(fullName: string): Promise<void> {
  const result = await accountBackend().rpc('complete_own_profile', {
    requested_full_name: fullName.trim(),
  });
  if (result.error) throw result.error;
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const result = await accountBackend().auth.signInWithPassword({ email: email.trim(), password });
  if (result.error) throw result.error;
}

export async function signOut(): Promise<void> {
  const result = await accountBackend().auth.signOut();
  if (result.error) throw result.error;
}
