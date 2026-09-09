/**
 * Production access model for DVD Tivat accounts.
 *
 * The current browser prototype does not authenticate people. These pure rules
 * are the contract the production API and database policies must enforce. They
 * deliberately use an immutable account id; a self-entered name is display
 * data and can never grant access.
 */

export type AccountRole = 'OWNER' | 'ADMIN' | 'COMMANDER' | 'FIREFIGHTER' | 'CITIZEN';

export type AccountStatus =
  | 'EMAIL_UNVERIFIED'
  | 'PROFILE_REQUIRED'
  | 'ACTIVE'
  | 'SUSPENDED';

export type Permission =
  | 'SUBMIT_REPORT'
  | 'VIEW_OWN_REPORTS'
  | 'VIEW_UNVERIFIED_REPORTS'
  | 'RESPOND_TO_CALLOUT'
  | 'CONFIRM_INCIDENT'
  | 'SEND_CALLOUT'
  | 'MANAGE_OPERATIONS'
  | 'MANAGE_CONTENT'
  | 'VIEW_ACCOUNT_DIRECTORY'
  | 'MANAGE_ROLES'
  | 'VIEW_ROLE_AUDIT';

export interface AccountSummary {
  id: string;
  fullName: string;
  role: AccountRole;
  status: AccountStatus;
}

const ROLE_PERMISSIONS: Record<AccountRole, ReadonlySet<Permission>> = {
  CITIZEN: new Set(['SUBMIT_REPORT', 'VIEW_OWN_REPORTS']),
  FIREFIGHTER: new Set([
    'SUBMIT_REPORT',
    'VIEW_OWN_REPORTS',
    'VIEW_UNVERIFIED_REPORTS',
    'RESPOND_TO_CALLOUT',
  ]),
  COMMANDER: new Set([
    'SUBMIT_REPORT',
    'VIEW_OWN_REPORTS',
    'VIEW_UNVERIFIED_REPORTS',
    'RESPOND_TO_CALLOUT',
    'CONFIRM_INCIDENT',
    'SEND_CALLOUT',
    'MANAGE_OPERATIONS',
  ]),
  ADMIN: new Set([
    'SUBMIT_REPORT',
    'VIEW_OWN_REPORTS',
    'VIEW_UNVERIFIED_REPORTS',
    'RESPOND_TO_CALLOUT',
    'CONFIRM_INCIDENT',
    'SEND_CALLOUT',
    'MANAGE_OPERATIONS',
    'MANAGE_CONTENT',
  ]),
  OWNER: new Set([
    'SUBMIT_REPORT',
    'VIEW_OWN_REPORTS',
    'VIEW_UNVERIFIED_REPORTS',
    'RESPOND_TO_CALLOUT',
    'CONFIRM_INCIDENT',
    'SEND_CALLOUT',
    'MANAGE_OPERATIONS',
    'MANAGE_CONTENT',
    'VIEW_ACCOUNT_DIRECTORY',
    'MANAGE_ROLES',
    'VIEW_ROLE_AUDIT',
  ]),
};

export const ASSIGNABLE_ROLES: readonly Exclude<AccountRole, 'OWNER'>[] = [
  'CITIZEN',
  'FIREFIGHTER',
  'COMMANDER',
  'ADMIN',
];

export function hasPermission(
  account: Pick<AccountSummary, 'role' | 'status'>,
  permission: Permission,
): boolean {
  return account.status === 'ACTIVE' && ROLE_PERMISSIONS[account.role].has(permission);
}

/** Every verified registration starts with the least privileged role. */
export function defaultRegistrationRole(): AccountRole {
  return 'CITIZEN';
}

/** Only the immutable owner account can change roles; OWNER is never delegated. */
export function canAssignRole(
  actor: Pick<AccountSummary, 'role' | 'status'>,
  nextRole: AccountRole,
): boolean {
  return hasPermission(actor, 'MANAGE_ROLES') && nextRole !== 'OWNER';
}

/**
 * A new citizen report produces an informational, unverified-report alert for
 * approved operational accounts. It is not a call-out or a claim that anyone
 * has been dispatched.
 */
export function reportAlertRecipientIds(accounts: readonly AccountSummary[]): string[] {
  return accounts
    .filter((account) => hasPermission(account, 'VIEW_UNVERIFIED_REPORTS'))
    .map((account) => account.id);
}

export function normalizeFullName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function isPlausibleFullName(value: string): boolean {
  const normalized = normalizeFullName(value);
  const parts = normalized.split(' ');
  return normalized.length >= 4 && normalized.length <= 100 && parts.length >= 2;
}
