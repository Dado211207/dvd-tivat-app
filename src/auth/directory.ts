/**
 * The owner's view of real accounts, and the two commands that change them.
 *
 * Every one of these is refused by the server unless `current_dvd_role()` says
 * `OWNER`. The interface hides the screen from everybody else, but that is
 * courtesy, not enforcement: hiding a button has never stopped anybody, and the
 * refusals below are the actual control.
 *
 * The reads work because of the owner-only `SELECT` policies
 * (`profiles_owner_read`, `grants_owner_read`, `audit_owner_read`,
 * `status_audit_owner_read`); for anybody else they return zero rows rather than
 * an error, which is why an empty directory is shown as "no access", never as
 * "no accounts".
 */

import type { AccountRole, AccountStatus } from '@/access/policy';
import { accountBackend } from './supabaseClient';

export interface DirectoryAccount {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly profileComplete: boolean;
  readonly role: AccountRole;
  readonly active: boolean;
  readonly grantedAt: string;
}

export interface RoleAuditEntry {
  readonly id: string;
  readonly targetUserId: string;
  readonly previousRole: string;
  readonly nextRole: string;
  readonly changedAt: string;
}

export interface StatusAuditEntry {
  readonly id: string;
  readonly targetUserId: string;
  readonly previousActive: boolean;
  readonly nextActive: boolean;
  readonly reason: string;
  readonly changedAt: string;
}

export interface CommandOutcome {
  readonly ok: boolean;
  readonly message?: string;
}

/** Display status, derived the same way `current_account_status()` derives it. */
export function statusOf(account: DirectoryAccount): AccountStatus {
  if (!account.active) return 'SUSPENDED';
  if (!account.profileComplete) return 'PROFILE_REQUIRED';
  return 'ACTIVE';
}

interface ProfileRow {
  user_id: string;
  email: string;
  full_name: string | null;
  profile_complete: boolean;
}

interface GrantRow {
  user_id: string;
  role: string;
  active: boolean;
  granted_at: string;
}

/**
 * Read every account.
 *
 * Two reads rather than a join: PostgREST embedding needs a declared foreign key
 * between `profiles` and `access_grants`, and there is none - both point at
 * `auth.users` instead. Joining them here keeps the schema honest about that.
 */
export async function loadDirectory(): Promise<DirectoryAccount[]> {
  const backend = accountBackend();
  const [profiles, grants] = await Promise.all([
    backend.from('profiles').select('user_id, email, full_name, profile_complete'),
    backend.from('access_grants').select('user_id, role, active, granted_at'),
  ]);
  if (profiles.error) throw profiles.error;
  if (grants.error) throw grants.error;

  const grantByUser = new Map<string, GrantRow>();
  for (const grant of (grants.data ?? []) as GrantRow[]) grantByUser.set(grant.user_id, grant);

  return ((profiles.data ?? []) as ProfileRow[])
    .map((profile): DirectoryAccount | null => {
      const grant = grantByUser.get(profile.user_id);
      // An account with no grant row cannot be acted on and must not be shown
      // with an invented role.
      if (!grant) return null;
      return {
        userId: profile.user_id,
        email: profile.email,
        fullName: profile.full_name,
        profileComplete: profile.profile_complete,
        role: grant.role as AccountRole,
        active: grant.active,
        grantedAt: grant.granted_at,
      };
    })
    .filter((account): account is DirectoryAccount => account !== null)
    .sort((a, b) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email, 'sr'));
}

export async function loadRoleAudit(limit = 25): Promise<RoleAuditEntry[]> {
  const { data, error } = await accountBackend()
    .from('role_audit')
    .select('id, target_user_id, previous_role, next_role, changed_at')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    targetUserId: row.target_user_id as string,
    previousRole: row.previous_role as string,
    nextRole: row.next_role as string,
    changedAt: row.changed_at as string,
  }));
}

export async function loadStatusAudit(limit = 25): Promise<StatusAuditEntry[]> {
  const { data, error } = await accountBackend()
    .from('account_status_audit')
    .select('id, target_user_id, previous_active, next_active, reason, changed_at')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    targetUserId: row.target_user_id as string,
    previousActive: row.previous_active as boolean,
    nextActive: row.next_active as boolean,
    reason: row.reason as string,
    changedAt: row.changed_at as string,
  }));
}

/**
 * Turn a server error code into something a person can act on.
 *
 * The server raises bare codes on purpose - they are stable, greppable, and not
 * written in anybody's language. Translating them here keeps the refusal honest:
 * the interface never invents a reason the server did not give.
 */
export function explainCommandError(raw: string): string {
  if (raw.includes('OWNER_REQUIRED')) {
    return 'Server je odbio zahtjev: samo vlasnik sistema moze mijenjati pristup.';
  }
  if (raw.includes('CANNOT_CHANGE_OWN_ROLE') || raw.includes('CANNOT_CHANGE_OWN_ACCESS')) {
    return 'Vlasnik ne moze mijenjati sopstveni nalog. Time bi mogao sam sebe zakljucati.';
  }
  if (raw.includes('OWNER_ACCOUNT_PROTECTED') || raw.includes('ACCOUNT_NOT_ASSIGNABLE')) {
    return 'Vlasnicki nalog je zasticen i ne moze se mijenjati iz aplikacije.';
  }
  if (raw.includes('ROLE_NOT_ASSIGNABLE')) {
    return 'Ta uloga se ne moze dodijeliti.';
  }
  if (raw.includes('REASON_REQUIRED')) {
    return 'Razlog je obavezan i mora imati najmanje dva znaka.';
  }
  if (raw.includes('ACCOUNT_NOT_FOUND')) {
    return 'Nalog vise ne postoji. Osvjezite spisak.';
  }
  return 'Server je odbio zahtjev. Promjena nije sacuvana.';
}

export async function setAccountRole(
  targetUserId: string,
  nextRole: AccountRole,
): Promise<CommandOutcome> {
  try {
    const { error } = await accountBackend().rpc('owner_set_role', {
      target_user: targetUserId,
      requested_role: nextRole,
    });
    return error ? { ok: false, message: explainCommandError(error.message) } : { ok: true };
  } catch (error) {
    return { ok: false, message: explainCommandError(String(error)) };
  }
}

export async function setAccountActive(
  targetUserId: string,
  active: boolean,
  reason: string,
): Promise<CommandOutcome> {
  try {
    const { error } = await accountBackend().rpc('owner_set_account_active', {
      target_user: targetUserId,
      requested_active: active,
      requested_reason: reason,
    });
    return error ? { ok: false, message: explainCommandError(error.message) } : { ok: true };
  } catch (error) {
    return { ok: false, message: explainCommandError(String(error)) };
  }
}
