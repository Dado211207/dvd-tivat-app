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
import { activeText } from '@/i18n/useText';
import { accountBackend, MULTI_SERVICE_ADMIN_AVAILABLE } from './supabaseClient';

export interface DirectoryAccount {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly dateOfBirth: string | null;
  readonly profileComplete: boolean;
  readonly memberId: string | null;
  readonly role: AccountRole;
  readonly active: boolean;
  readonly grantedAt: string;
  readonly memberships: Readonly<Partial<Record<OrganizationCode, MembershipRole>>>;
}

export const ORGANIZATION_CODES = ['DVD', 'SZS'] as const;
export type OrganizationCode = (typeof ORGANIZATION_CODES)[number];
export type MembershipRole = 'ADMIN' | 'COMMANDER' | 'FIREFIGHTER';
export const MEMBERSHIP_ROLES: readonly MembershipRole[] = [
  'FIREFIGHTER',
  'COMMANDER',
  'ADMIN',
];

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

export interface OrganizationMembershipAuditEntry {
  readonly id: string;
  readonly organization: OrganizationCode;
  readonly targetUserId: string;
  readonly previousRole: MembershipRole | null;
  readonly nextRole: MembershipRole | null;
  readonly nextActive: boolean;
  readonly changedAt: string;
}

export interface OwnOrganizationMembership {
  readonly organization: OrganizationCode;
  readonly displayName: string;
  readonly role: MembershipRole;
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

/**
 * The role labels an account should be found by in the directory search.
 *
 * Since P5 (202609250038) `access_grants.role` is an inert legacy value for the
 * operational roles: a firefighter who has been stood down can still carry
 * FIREFIGHTER in the grant while holding no active DVD membership. Searching for
 * an operational role must therefore follow the active service memberships, not
 * the grant, or the search would name people who no longer serve. The grant
 * contributes only the roles P5 keeps authoritative there - OWNER (still read by
 * `is_installation_owner()`), and the CITIZEN/PENDING baseline.
 */
export function roleSearchTerms(
  account: DirectoryAccount,
  roleLabel: Record<AccountRole, string>,
): string[] {
  const terms: string[] = [];
  if (!MEMBERSHIP_ROLES.includes(account.role as MembershipRole)) {
    terms.push(roleLabel[account.role]);
  }
  for (const code of ORGANIZATION_CODES) {
    const role = account.memberships[code];
    if (role) terms.push(roleLabel[role]);
  }
  return terms;
}

interface ProfileRow {
  user_id: string;
  email: string;
  full_name: string | null;
  phone_e164: string | null;
  date_of_birth: string | null;
  profile_complete: boolean;
}

interface MemberLinkRow {
  id: string;
  user_id: string | null;
}

interface GrantRow {
  user_id: string;
  role: string;
  active: boolean;
  granted_at: string;
}

interface OrganizationRow {
  id: string;
  code: string;
}

interface MembershipRow {
  organization_id: string;
  user_id: string;
  role: MembershipRole;
  active: boolean;
}

function asOrganizationCode(value: string): OrganizationCode | null {
  return ORGANIZATION_CODES.includes(value as OrganizationCode)
    ? (value as OrganizationCode)
    : null;
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
  const [profiles, grants, memberLinks] = await Promise.all([
    backend
      .from('profiles')
      .select('user_id, email, full_name, phone_e164, date_of_birth, profile_complete'),
    backend.from('access_grants').select('user_id, role, active, granted_at'),
    backend.from('members').select('id, user_id'),
  ]);
  if (profiles.error) throw profiles.error;
  if (grants.error) throw grants.error;
  if (memberLinks.error) throw memberLinks.error;

  const grantByUser = new Map<string, GrantRow>();
  for (const grant of (grants.data ?? []) as GrantRow[]) grantByUser.set(grant.user_id, grant);
  const memberByUser = new Map<string, string>();
  for (const member of (memberLinks.data ?? []) as MemberLinkRow[]) {
    if (member.user_id) memberByUser.set(member.user_id, member.id);
  }

  const membershipsByUser = new Map<
    string,
    Partial<Record<OrganizationCode, MembershipRole>>
  >();
  // Since P5 (202609250038) membership is the only statement of operational
  // authority, so the directory reads it directly for every service - the DVD
  // column no longer derives from the compatibility grant. This does not depend
  // on the multi-service flag; the flag gates only whether SZS can be *assigned*
  // (the write control in AccountsView), which stays P6's to open.
  {
    const [organizations, memberships] = await Promise.all([
      backend.from('organizations').select('id, code'),
      backend
        .from('organization_memberships')
        .select('organization_id, user_id, role, active'),
    ]);
    if (organizations.error) throw organizations.error;
    if (memberships.error) throw memberships.error;

    const organizationById = new Map<string, OrganizationCode>();
    for (const organization of (organizations.data ?? []) as OrganizationRow[]) {
      const code = asOrganizationCode(organization.code);
      if (code) organizationById.set(organization.id, code);
    }
    for (const membership of (memberships.data ?? []) as MembershipRow[]) {
      if (!membership.active) continue;
      const code = organizationById.get(membership.organization_id);
      if (!code) continue;
      const current = membershipsByUser.get(membership.user_id) ?? {};
      current[code] = membership.role;
      membershipsByUser.set(membership.user_id, current);
    }
  }

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
        phone: profile.phone_e164,
        dateOfBirth: profile.date_of_birth,
        profileComplete: profile.profile_complete,
        memberId: memberByUser.get(profile.user_id) ?? null,
        role: grant.role as AccountRole,
        active: grant.active,
        grantedAt: grant.granted_at,
        memberships: membershipsByUser.get(profile.user_id) ?? {},
      };
    })
    .filter((account): account is DirectoryAccount => account !== null)
    .sort((a, b) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email, 'sr'));
}

export async function loadOrganizationMembershipAudit(
  limit = 40,
): Promise<OrganizationMembershipAuditEntry[]> {
  // Not gated by the multi-service flag. Since P5 (202609250038) a DVD role is a
  // service membership, so a DVD assignment made on the Accounts screen is
  // recorded in `organization_membership_audit`, not `role_audit`. Gating this
  // read on the flag hid the owner's own DVD role changes from the audit list
  // whenever the flag was off - a client-only blind spot, since the server's
  // `membership_audit_owner_read` policy lets the owner read the table
  // regardless. The flag still gates whether SZS can be *assigned* (the write
  // control in AccountsView); it never governed what the owner may see here.
  const backend = accountBackend();
  const [audit, organizations] = await Promise.all([
    backend
      .from('organization_membership_audit')
      .select(
        'id, organization_id, target_user_id, previous_role, next_role, next_active, changed_at',
      )
      .order('changed_at', { ascending: false })
      .limit(limit),
    backend.from('organizations').select('id, code'),
  ]);
  if (audit.error) throw audit.error;
  if (organizations.error) throw organizations.error;

  const codes = new Map<string, OrganizationCode>();
  for (const organization of (organizations.data ?? []) as OrganizationRow[]) {
    const code = asOrganizationCode(organization.code);
    if (code) codes.set(organization.id, code);
  }

  return ((audit.data ?? []) as Record<string, unknown>[])
    .map((row): OrganizationMembershipAuditEntry | null => {
      const organization = codes.get(row.organization_id as string);
      if (!organization) return null;
      return {
        id: row.id as string,
        organization,
        targetUserId: row.target_user_id as string,
        previousRole: (row.previous_role as MembershipRole | null) ?? null,
        nextRole: (row.next_role as MembershipRole | null) ?? null,
        nextActive: row.next_active as boolean,
        changedAt: row.changed_at as string,
      };
    })
    .filter((entry): entry is OrganizationMembershipAuditEntry => entry !== null);
}

/**
 * Read the signed-in person's active service memberships.
 *
 * The server function includes an explicit `user_id = auth.uid()` predicate.
 * That matters for the owner account, whose table policy can otherwise read the
 * whole directory. This call can therefore be reused by every account without
 * turning the personal account card into an owner-only data endpoint.
 */
export async function loadOwnOrganizationMemberships(): Promise<OwnOrganizationMembership[]> {
  if (!MULTI_SERVICE_ADMIN_AVAILABLE) return [];
  const { data, error } = await accountBackend().rpc('current_organization_memberships');
  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[])
    .map((row): OwnOrganizationMembership | null => {
      const organization = asOrganizationCode(String(row.organization_code ?? ''));
      const role = row.membership_role as MembershipRole;
      if (!organization || !MEMBERSHIP_ROLES.includes(role)) return null;
      return {
        organization,
        displayName: String(row.organization_name ?? organization),
        role,
      };
    })
    .filter((membership): membership is OwnOrganizationMembership => membership !== null);
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
  const messages = activeText().accounts.commandErrors;
  if (raw.includes('OWNER_REQUIRED')) {
    return messages.ownerRequired;
  }
  if (raw.includes('CANNOT_CHANGE_OWN_ROLE') || raw.includes('CANNOT_CHANGE_OWN_ACCESS')) {
    return messages.ownAccount;
  }
  if (raw.includes('OWNER_ACCOUNT_PROTECTED') || raw.includes('ACCOUNT_NOT_ASSIGNABLE')) {
    return messages.protectedAccount;
  }
  if (raw.includes('ROLE_NOT_ASSIGNABLE')) {
    return messages.roleNotAssignable;
  }
  if (raw.includes('REASON_REQUIRED')) {
    return messages.reasonRequired;
  }
  if (raw.includes('ACCOUNT_NOT_FOUND')) {
    return messages.accountNotFound;
  }
  if (raw.includes('ORGANIZATION_NOT_FOUND')) {
    return messages.organizationNotFound;
  }
  return messages.generic;
}

export async function setOrganizationMembership(
  targetUserId: string,
  organization: OrganizationCode,
  role: MembershipRole | null,
): Promise<CommandOutcome> {
  try {
    const { error } = await accountBackend().rpc('owner_set_organization_membership', {
      target_user: targetUserId,
      organization_code: organization,
      requested_role: role ?? 'NONE',
    });
    return error ? { ok: false, message: explainCommandError(error.message) } : { ok: true };
  } catch (error) {
    return { ok: false, message: explainCommandError(String(error)) };
  }
}

// setAccountRole (owner_set_role) is no longer called from the client: since P5
// (202609250038) an operational role is a service membership, assigned through
// setOrganizationMembership, and owner_set_role is a baseline-only server command
// with no interface. It is left in the database, not wrapped here.

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
