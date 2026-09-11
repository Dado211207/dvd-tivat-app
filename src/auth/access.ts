/**
 * The access snapshot: who the server says you are, and what it says you may do.
 *
 * Every field here is READ FROM THE SERVER. Nothing is derived from the JWT, from
 * anything the browser stored, or from anything the person typed. The role in
 * particular comes from `public.current_dvd_role()`, which returns a role only
 * for an account that is active, has a complete profile, and holds one of the
 * four operational grants - so a suspended or half-registered account resolves
 * to no role on the very next request.
 *
 * This module is pure and takes an injected gateway, so the rules below are
 * exercised by unit tests without a network, a browser or a project.
 */

/** The four roles `current_dvd_role()` can return. PENDING and CITIZEN are NULL there. */
export const OPERATIONAL_ROLES = ['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'] as const;
export type OperationalRole = (typeof OPERATIONAL_ROLES)[number];

/** Exactly the values `public.current_account_status()` can return. */
export const ACCOUNT_STATUSES = [
  'ANONYMOUS',
  'UNKNOWN',
  'SUSPENDED',
  'PROFILE_REQUIRED',
  'ACTIVE',
] as const;
export type ServerAccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface SignedInAccess {
  readonly kind: 'SIGNED_IN';
  readonly userId: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly profileComplete: boolean;
  readonly accountStatus: ServerAccountStatus;
  /** NULL means "no operational role", which is not the same as "not loaded". */
  readonly role: OperationalRole | null;
  readonly loadedAt: string;
}

export type Access =
  /** No project URL or publishable key is configured in this build. */
  | { readonly kind: 'NOT_CONFIGURED' }
  | { readonly kind: 'LOADING' }
  | { readonly kind: 'SIGNED_OUT' }
  /**
   * Signed in, but the server could not be asked what that means. Deliberately
   * NOT a signed-in state with a null role: "we could not ask" must never be
   * displayed, or acted on, as "you have no role". It grants nothing.
   */
  | { readonly kind: 'UNAVAILABLE'; readonly reason: 'NETWORK' | 'NO_PROFILE' }
  | SignedInAccess;

export interface AccessGateway {
  /** The authenticated user, or null when there is no session. */
  currentUser(): Promise<{ id: string; email: string } | null>;
  /** The caller's own profile row, read under `profiles_self_read`. */
  fetchProfile(): Promise<{ fullName: string | null; profileComplete: boolean } | null>;
  /** `public.current_dvd_role()` - raw, because the server may return anything. */
  fetchRole(): Promise<string | null>;
  /** `public.current_account_status()` - raw, for the same reason. */
  fetchAccountStatus(): Promise<string | null>;
}

/**
 * Narrow a role string from the wire.
 *
 * An unrecognised value is NOT authority. If the server ever grows a fifth role
 * this returns null and the person sees no operational screens until the client
 * is taught about it - which is the safe direction to fail.
 */
export function asOperationalRole(value: string | null | undefined): OperationalRole | null {
  return OPERATIONAL_ROLES.includes(value as OperationalRole) ? (value as OperationalRole) : null;
}

export function asAccountStatus(value: string | null | undefined): ServerAccountStatus | null {
  return ACCOUNT_STATUSES.includes(value as ServerAccountStatus)
    ? (value as ServerAccountStatus)
    : null;
}

/**
 * Load the whole access snapshot, or fail closed.
 *
 * The three server reads are issued together because they are independent, but
 * the snapshot is only produced when all of them answer. A partial answer is
 * `UNAVAILABLE`, never a signed-in state with pieces missing.
 */
export async function loadAccess(
  gateway: AccessGateway,
  now: () => Date = () => new Date(),
): Promise<Access> {
  let user: { id: string; email: string } | null;
  try {
    user = await gateway.currentUser();
  } catch {
    return { kind: 'UNAVAILABLE', reason: 'NETWORK' };
  }
  if (user === null) return { kind: 'SIGNED_OUT' };

  let profile: Awaited<ReturnType<AccessGateway['fetchProfile']>>;
  let rawRole: string | null;
  let rawStatus: string | null;
  try {
    [profile, rawRole, rawStatus] = await Promise.all([
      gateway.fetchProfile(),
      gateway.fetchRole(),
      gateway.fetchAccountStatus(),
    ]);
  } catch {
    return { kind: 'UNAVAILABLE', reason: 'NETWORK' };
  }

  // A session with no profile row means the account trigger did not run, or the
  // row was removed. It is a broken account, not a role-less one, and saying so
  // is more useful than showing an empty screen.
  if (profile === null) return { kind: 'UNAVAILABLE', reason: 'NO_PROFILE' };

  const accountStatus = asAccountStatus(rawStatus);
  if (accountStatus === null) return { kind: 'UNAVAILABLE', reason: 'NETWORK' };

  return {
    kind: 'SIGNED_IN',
    userId: user.id,
    email: user.email,
    fullName: profile.fullName,
    profileComplete: profile.profileComplete,
    accountStatus,
    role: asOperationalRole(rawRole),
    loadedAt: now().toISOString(),
  };
}

/** True only for a loaded, signed-in account that the server gave a role. */
export function hasOperationalAccess(access: Access): access is SignedInAccess {
  return access.kind === 'SIGNED_IN' && access.role !== null;
}

/** What the person must do next, when they cannot get in yet. */
export type AccessObstacle =
  | 'NOT_CONFIGURED'
  | 'LOADING'
  | 'SIGN_IN_REQUIRED'
  | 'SERVER_UNREACHABLE'
  | 'ACCOUNT_BROKEN'
  | 'PROFILE_REQUIRED'
  | 'SUSPENDED'
  | 'AWAITING_APPROVAL'
  | null;

/**
 * The single place that decides why somebody is being kept out.
 *
 * Order matters: a suspended account is told it is suspended rather than that it
 * is awaiting approval, because both have no role and only one of them is a
 * state the owner put them in.
 */
export function accessObstacle(access: Access): AccessObstacle {
  switch (access.kind) {
    case 'NOT_CONFIGURED':
      return 'NOT_CONFIGURED';
    case 'LOADING':
      return 'LOADING';
    case 'SIGNED_OUT':
      return 'SIGN_IN_REQUIRED';
    case 'UNAVAILABLE':
      return access.reason === 'NO_PROFILE' ? 'ACCOUNT_BROKEN' : 'SERVER_UNREACHABLE';
    case 'SIGNED_IN':
      if (access.accountStatus === 'SUSPENDED') return 'SUSPENDED';
      if (access.accountStatus === 'PROFILE_REQUIRED' || !access.profileComplete) {
        return 'PROFILE_REQUIRED';
      }
      if (access.role === null) return 'AWAITING_APPROVAL';
      return null;
  }
}
