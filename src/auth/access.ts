/**
 * The access snapshot: who the server says you are, and what it says you may do.
 *
 * Every field here is READ FROM THE SERVER. Nothing is derived from the JWT, from
 * anything the browser stored, or from anything the person typed. The role in
 * particular comes from `public.current_role_in(service)` for the service the
 * person is acting as, which returns a role only for an account that is active,
 * has a complete profile, and holds an operational membership IN THAT SERVICE -
 * so a suspended or half-registered account, or one asked about a service it does
 * not serve, resolves to no role on the very next request.
 *
 * The acting service (P6, D14) is the ONE thing here that the person chooses. It
 * is not authority: it only selects which service the reads above ask the server
 * about. A person who picks a service they hold nothing in gets that service's
 * no-role / no-member answer from the server, never access to it. The set of
 * services they may pick from is itself read from the server (their memberships,
 * plus both services for the installation owner).
 *
 * This module is pure and takes an injected gateway, so the rules below are
 * exercised by unit tests without a network, a browser or a project.
 */

import { ORGANIZATION_CODES, type OrganizationCode } from './directory';
import { availableServices, organizationIdOf, resolveActingService } from './serviceContext';

/** The four roles the authority functions can return. PENDING and CITIZEN are NULL there. */
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
  /**
   * The service the person is acting as (P6, D14), or NULL when they can act in
   * no service at all. Every operational read below - `role`, the member record,
   * the registry a screen shows - is for THIS service. It is a selector, never a
   * grant: `role` is still resolved by the server for this exact service.
   */
  readonly service: OrganizationCode | null;
  /**
   * Every service this person may act as, in the fixed DVD, SZS order. The switch
   * offers exactly these; `service` is always one of them, or NULL when the list
   * is empty. Read from the server (memberships + installation ownership), so it
   * shrinks the moment a membership is withdrawn.
   */
  readonly availableServices: readonly OrganizationCode[];
  /**
   * The role in the ACTING service. NULL means "no operational role in this
   * service", which is not the same as "not loaded" and not the same as "no role
   * anywhere" - the same person may hold a role in the other service.
   */
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

/**
 * Whether two snapshots say the same thing.
 *
 * `loadAccess` builds a new object every time it runs, and it runs often - a
 * token refresh, a tab regaining focus, any `onAuthStateChange` event. Handing
 * consumers a new object that means exactly what the old one meant is not free:
 * anything keyed on the snapshot's identity re-runs, and a screen that drops to
 * a loading state while it re-reads will throw away whatever the person was
 * doing. So the provider keeps the previous object when nothing changed, and
 * this is the comparison it uses.
 *
 * `loadedAt` is deliberately NOT compared. It is the one field guaranteed to
 * differ on every read, and it says when we asked - never what the answer was.
 */
/** Two service lists are the same when they hold the same codes in the same order. */
function sameServiceList(a: readonly OrganizationCode[], b: readonly OrganizationCode[]): boolean {
  return a.length === b.length && a.every((code, index) => code === b[index]);
}

export function sameAccess(a: Access, b: Access): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'UNAVAILABLE' && b.kind === 'UNAVAILABLE') return a.reason === b.reason;
  if (a.kind === 'SIGNED_IN' && b.kind === 'SIGNED_IN') {
    return (
      a.userId === b.userId &&
      a.email === b.email &&
      a.fullName === b.fullName &&
      a.profileComplete === b.profileComplete &&
      a.accountStatus === b.accountStatus &&
      a.role === b.role &&
      // The acting service is part of what the snapshot means: switching it must
      // look like a change downstream, or the screens would keep the old service's
      // role and member. So must the set that can be switched between - a
      // withdrawn membership shrinks it and has to propagate.
      a.service === b.service &&
      sameServiceList(a.availableServices, b.availableServices)
    );
  }
  return true; // NOT_CONFIGURED, LOADING and SIGNED_OUT carry nothing else.
}

export interface AccessGateway {
  /** The authenticated user, or null when there is no session. */
  currentUser(): Promise<{ id: string; email: string } | null>;
  /**
   * The caller's own profile row.
   *
   * Takes the id explicitly and filters on it. Relying on row level security to
   * narrow this to one row would work for everybody except the owner, whose
   * `profiles_owner_read` policy lets them read EVERY profile - so "the only row
   * I can see" stops being one row the moment a second account exists.
   */
  fetchProfile(userId: string): Promise<{ fullName: string | null; profileComplete: boolean } | null>;
  /**
   * `public.current_dvd_role()` - raw, because the server may return anything.
   *
   * The DVD-only legacy path. A gateway that also implements `fetchServiceContext`
   * and `fetchRoleIn` is service-aware and this is not called; kept so a gateway
   * that predates P6 (and every test that builds one) still resolves the DVD role
   * exactly as before. `current_dvd_role()` is itself `current_role_in(DVD)`
   * (202609240023), so the two paths give the identical DVD answer.
   */
  fetchRole(): Promise<string | null>;
  /** `public.current_account_status()` - raw, for the same reason. */
  fetchAccountStatus(): Promise<string | null>;
  /**
   * The services this account may act in: its active memberships, and whether it
   * is the installation owner (who may act in both without a membership). Present
   * only on a service-aware gateway (P6); its absence selects the DVD-only legacy
   * path above. Raw membership codes, because the server may return anything.
   */
  fetchServiceContext?(): Promise<{ memberships: readonly string[]; isOwner: boolean }>;
  /**
   * `public.current_role_in(service)` - the caller's role in one service, raw.
   * Present only on a service-aware gateway; paired with `fetchServiceContext`.
   */
  fetchRoleIn?(organizationId: string): Promise<string | null>;
}

/** Options for {@link loadAccess}. */
export interface LoadAccessOptions {
  /** Injectable clock, so `loadedAt` is deterministic in tests. */
  readonly now?: () => Date;
  /**
   * The service the person last chose to act as, looked up by their id once it is
   * known. Returns the remembered code or null; loadAccess resolves it against
   * what they may actually act in, so a stale or forged value cannot select a
   * service they hold nothing in. Only consulted on the service-aware path.
   */
  readonly preferredService?: (userId: string) => string | null;
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
 * The independent server reads are issued together, but the snapshot is only
 * produced when all of them answer. A partial answer is `UNAVAILABLE`, never a
 * signed-in state with pieces missing.
 *
 * A service-aware gateway (one carrying `fetchServiceContext` and `fetchRoleIn`)
 * resolves the acting service and the role within it. A gateway without those -
 * every pre-P6 gateway, and the ones the unit tests build - takes the DVD-only
 * legacy path, which resolves the identical DVD answer through `current_dvd_role`.
 */
export async function loadAccess(
  gateway: AccessGateway,
  options: LoadAccessOptions = {},
): Promise<Access> {
  const now = options.now ?? (() => new Date());
  let user: { id: string; email: string } | null;
  try {
    user = await gateway.currentUser();
  } catch {
    return { kind: 'UNAVAILABLE', reason: 'NETWORK' };
  }
  if (user === null) return { kind: 'SIGNED_OUT' };

  return gateway.fetchServiceContext && gateway.fetchRoleIn
    ? loadServiceAware(gateway, user, options, now)
    : loadDvdLegacy(gateway, user, now);
}

/**
 * The DVD-only path, byte-for-byte the pre-P6 behaviour plus the two service
 * fields set the DVD way. A role IS a DVD membership since 202609250038, so the
 * person can act in DVD exactly when the server gives them a role there.
 */
async function loadDvdLegacy(
  gateway: AccessGateway,
  user: { id: string; email: string },
  now: () => Date,
): Promise<Access> {
  let profile: Awaited<ReturnType<AccessGateway['fetchProfile']>>;
  let rawRole: string | null;
  let rawStatus: string | null;
  try {
    [profile, rawRole, rawStatus] = await Promise.all([
      gateway.fetchProfile(user.id),
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

  const role = asOperationalRole(rawRole);
  return {
    kind: 'SIGNED_IN',
    userId: user.id,
    email: user.email,
    fullName: profile.fullName,
    profileComplete: profile.profileComplete,
    accountStatus,
    service: role !== null ? 'DVD' : null,
    availableServices: role !== null ? ['DVD'] : [],
    role,
    loadedAt: now().toISOString(),
  };
}

/**
 * The P6 path. The person's services and ownership are read, the acting service
 * is resolved against what they may actually act in, and the role is read FOR
 * THAT SERVICE. The acting service selects which service the server is asked
 * about; it never stands in for the server's answer, so a person who prefers a
 * service they hold nothing in simply gets that service's null role.
 */
async function loadServiceAware(
  gateway: AccessGateway,
  user: { id: string; email: string },
  options: LoadAccessOptions,
  now: () => Date,
): Promise<Access> {
  let profile: Awaited<ReturnType<AccessGateway['fetchProfile']>>;
  let rawStatus: string | null;
  let context: { memberships: readonly string[]; isOwner: boolean };
  try {
    [profile, rawStatus, context] = await Promise.all([
      gateway.fetchProfile(user.id),
      gateway.fetchAccountStatus(),
      gateway.fetchServiceContext!(),
    ]);
  } catch {
    return { kind: 'UNAVAILABLE', reason: 'NETWORK' };
  }

  if (profile === null) return { kind: 'UNAVAILABLE', reason: 'NO_PROFILE' };

  const accountStatus = asAccountStatus(rawStatus);
  if (accountStatus === null) return { kind: 'UNAVAILABLE', reason: 'NETWORK' };

  // An unrecognised service code from the wire is not a service. Narrowing here
  // means a fifth organisation the client has not been taught about cannot become
  // a selectable acting service.
  const memberships = context.memberships.filter((code): code is OrganizationCode =>
    (ORGANIZATION_CODES as readonly string[]).includes(code),
  );
  const available = availableServices(memberships, context.isOwner);
  const service = resolveActingService(available, options.preferredService?.(user.id) ?? null);

  // Only ask for a role in a service the person may act in. A citizen with no
  // service asks for nothing and is told, honestly, that they have no role.
  let role: OperationalRole | null = null;
  if (service !== null) {
    let rawRole: string | null;
    try {
      rawRole = await gateway.fetchRoleIn!(organizationIdOf(service));
    } catch {
      return { kind: 'UNAVAILABLE', reason: 'NETWORK' };
    }
    role = asOperationalRole(rawRole);
  }

  return {
    kind: 'SIGNED_IN',
    userId: user.id,
    email: user.email,
    fullName: profile.fullName,
    profileComplete: profile.profileComplete,
    accountStatus,
    service,
    availableServices: available,
    role,
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
  | 'NO_SERVICE_ROLE'
  | null;

/**
 * The single place that decides why somebody is being kept out.
 *
 * Order matters: a suspended account is told it is suspended rather than shown
 * the ordinary no-DVD-role state, because both have no role and only one of
 * them is a restriction the owner put in place.
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
      if (access.role === null) return 'NO_SERVICE_ROLE';
      return null;
  }
}
