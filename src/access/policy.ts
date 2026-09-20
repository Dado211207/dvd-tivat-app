/**
 * The permission matrix, for DISPLAY ONLY.
 *
 * Authority lives in the database: `public.current_dvd_role()` decides what an
 * account may do, every policy is written against it, and every write goes
 * through a `security definer` command that checks it again. Nothing in this
 * file is consulted by the server, and a browser that lies about a role gains
 * nothing.
 *
 * What it is for is deciding what to *show*: which navigation entries make
 * sense, which controls to render, and what to say when somebody cannot do
 * something. Those decisions have to agree with the server or the interface
 * offers buttons that fail, so the role and status names here mirror the
 * server's exactly - including the two roles that resolve to no access.
 *
 * An immutable account id is used throughout; a self-entered name is display
 * data and can never grant access.
 */

/**
 * Every role the `access_grants` table can hold.
 *
 * `CITIZEN` is the default for a new account. `PENDING` is retained only for
 * compatibility with rows written before the citizen-first activation. Both
 * mean "no internal operational access", and `current_dvd_role()` returns NULL
 * for both.
 */
export type AccountRole =
  | 'OWNER'
  | 'ADMIN'
  | 'COMMANDER'
  | 'FIREFIGHTER'
  | 'PENDING'
  | 'CITIZEN';

/** Exactly the values `public.current_account_status()` returns. */
export type AccountStatus = 'UNKNOWN' | 'PROFILE_REQUIRED' | 'ACTIVE' | 'SUSPENDED';

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
  // Neither no-access role holds anything OPERATIONAL. They keep the two
  // citizen-report entries because that is what the server does: the
  // `reports_create_own` policy asks only that the account be ACTIVE and the
  // report be its own, never that it hold a role. (Citizen reporting is
  // abandoned research; the matrix mirrors the server rather than the product.)
  // Both are listed explicitly rather than defaulted, so adding a role to the
  // union forces a decision here instead of inheriting somebody else's rights.
  PENDING: new Set(['SUBMIT_REPORT', 'VIEW_OWN_REPORTS']),
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

/**
 * What the owner may set an account to, in the order the interface offers them.
 *
 * `PENDING` remains accepted by the legacy command, but nothing should newly
 * assign it. `OWNER` is never assignable by anybody:
 * the server refuses it, and a partial unique index refuses a second owner even
 * if the server were bypassed.
 */
export const ASSIGNABLE_ROLES: readonly Exclude<AccountRole, 'OWNER' | 'PENDING'>[] = [
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

/**
 * Every new registration starts as a citizen with no operational access.
 *
 * `CITIZEN` is what the database trigger writes. It can use only the limited,
 * non-operational account surface until the owner assigns DVD, SZS or both.
 */
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
