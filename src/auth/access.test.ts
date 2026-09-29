import { describe, expect, it } from 'vitest';
import {
  accessObstacle,
  asOperationalRole,
  hasOperationalAccess,
  loadAccess,
  sameAccess,
  type Access,
  type AccessGateway,
  type LoadAccessOptions,
  type SignedInAccess,
} from './access';
import { organizationCodeOf, organizationIdOf } from './serviceContext';

const FIXED_NOW = () => new Date('2026-09-11T08:00:00.000Z');

type GatewayOverrides = Partial<AccessGateway>;

function gateway(overrides: GatewayOverrides = {}): AccessGateway {
  return {
    currentUser: async () => ({ id: 'user-1', email: 'probni@example.invalid' }),
    fetchProfile: async () => ({ fullName: 'Probni Korisnik', profileComplete: true }),
    fetchRole: async () => 'FIREFIGHTER',
    fetchAccountStatus: async () => 'ACTIVE',
    ...overrides,
  };
}

const load = (overrides: GatewayOverrides = {}): Promise<Access> =>
  loadAccess(gateway(overrides), { now: FIXED_NOW });

describe('loading the access snapshot', () => {
  it('reports a signed-out visitor without asking the server anything else', async () => {
    let profileReads = 0;
    const access = await load({
      currentUser: async () => null,
      fetchProfile: async () => {
        profileReads += 1;
        return null;
      },
    });
    expect(access.kind).toBe('SIGNED_OUT');
    expect(profileReads).toBe(0);
  });

  it('asks for the profile by id rather than trusting the query to return one row', async () => {
    // The owner's `profiles_owner_read` policy lets them read EVERY profile, so
    // an unfiltered single-row read works for everybody except the one account
    // that matters most - and only once a second account exists, which is the
    // worst possible time to find out.
    let askedFor: string | null = null;
    await load({
      fetchProfile: async (userId) => {
        askedFor = userId;
        return { fullName: 'Probni Korisnik', profileComplete: true };
      },
    });
    expect(askedFor).toBe('user-1');
  });

  it('loads role and status from the server for an approved account', async () => {
    const access = await load();
    expect(access).toEqual({
      kind: 'SIGNED_IN',
      userId: 'user-1',
      email: 'probni@example.invalid',
      fullName: 'Probni Korisnik',
      profileComplete: true,
      accountStatus: 'ACTIVE',
      // The legacy DVD gateway resolves the DVD service the DVD way: a role means
      // a DVD membership, so the person acts as DVD and DVD is their only service.
      service: 'DVD',
      availableServices: ['DVD'],
      role: 'FIREFIGHTER',
      loadedAt: '2026-09-11T08:00:00.000Z',
    });
    expect(hasOperationalAccess(access)).toBe(true);
    expect(accessObstacle(access)).toBeNull();
  });
});

describe('an account the server gives no DVD role', () => {
  it('signs a citizen account in without operational authority', async () => {
    const access = await load({ fetchRole: async () => null });
    expect(hasOperationalAccess(access)).toBe(false);
    expect(accessObstacle(access)).toBe('NO_SERVICE_ROLE');
  });

  it('tells a SUSPENDED account it is suspended, not merely without a DVD role', async () => {
    // Both have no role. Only one of them is a state the owner put them in, and
    // showing the ordinary citizen state after suspension would be a lie the
    // interface tells on the server's behalf.
    const access = await load({
      fetchRole: async () => null,
      fetchAccountStatus: async () => 'SUSPENDED',
    });
    expect(accessObstacle(access)).toBe('SUSPENDED');
  });

  it('sends a half-registered account to finish its profile', async () => {
    const access = await load({
      fetchProfile: async () => ({ fullName: null, profileComplete: false }),
      fetchRole: async () => null,
      fetchAccountStatus: async () => 'PROFILE_REQUIRED',
    });
    expect(accessObstacle(access)).toBe('PROFILE_REQUIRED');
  });

  it('refuses a role string it does not recognise', async () => {
    // If the server ever grows a fifth role, an unknown value must not be
    // treated as authority. Failing towards "no access" is the safe direction.
    const access = await load({ fetchRole: async () => 'SUPERUSER' });
    expect(hasOperationalAccess(access)).toBe(false);
    expect(accessObstacle(access)).toBe('NO_SERVICE_ROLE');
  });

  it('still refuses a stale role when the account has since been suspended', async () => {
    // current_dvd_role() returns NULL for a suspended account, so this pairing
    // should not occur; the guard exists because an interface must not grant
    // access on a role alone when the status contradicts it.
    const access = await load({
      fetchRole: async () => 'COMMANDER',
      fetchAccountStatus: async () => 'SUSPENDED',
    });
    expect(accessObstacle(access)).toBe('SUSPENDED');
  });
});

describe('failing closed', () => {
  const failing = (): never => {
    throw new Error('network');
  };

  it('does not turn an unreachable server into "you have no role"', async () => {
    const access = await load({ fetchRole: failing });
    expect(access).toEqual({ kind: 'UNAVAILABLE', reason: 'NETWORK' });
    expect(hasOperationalAccess(access)).toBe(false);
    expect(accessObstacle(access)).toBe('SERVER_UNREACHABLE');
  });

  it('fails closed when the session itself cannot be read', async () => {
    const access = await load({ currentUser: failing });
    expect(access).toEqual({ kind: 'UNAVAILABLE', reason: 'NETWORK' });
  });

  it('fails closed when the status read fails', async () => {
    expect(await load({ fetchAccountStatus: failing })).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'NETWORK',
    });
  });

  it('reports a session with no profile row as a broken account', async () => {
    const access = await load({ fetchProfile: async () => null });
    expect(access).toEqual({ kind: 'UNAVAILABLE', reason: 'NO_PROFILE' });
    expect(accessObstacle(access)).toBe('ACCOUNT_BROKEN');
  });

  it('refuses a status value it does not recognise', async () => {
    expect(await load({ fetchAccountStatus: async () => 'WHATEVER' })).toEqual({
      kind: 'UNAVAILABLE',
      reason: 'NETWORK',
    });
  });

  it('grants nothing while still loading, or without configuration', () => {
    expect(hasOperationalAccess({ kind: 'LOADING' })).toBe(false);
    expect(hasOperationalAccess({ kind: 'SIGNED_OUT' })).toBe(false);
    expect(hasOperationalAccess({ kind: 'NOT_CONFIGURED' })).toBe(false);
    expect(accessObstacle({ kind: 'LOADING' })).toBe('LOADING');
    expect(accessObstacle({ kind: 'NOT_CONFIGURED' })).toBe('NOT_CONFIGURED');
    expect(accessObstacle({ kind: 'SIGNED_OUT' })).toBe('SIGN_IN_REQUIRED');
  });
});

/**
 * P6: the acting service.
 *
 * A service-aware gateway carries `fetchServiceContext` and `fetchRoleIn`, so
 * loadAccess resolves WHICH service the person is acting as and reads the role
 * FOR THAT SERVICE. The single rule these tests exist to hold: the acting service
 * only selects which service the server is asked about - it is never authority, so
 * a person who prefers a service they hold nothing in cannot reach it.
 */
describe('the acting service', () => {
  interface ServiceConfig {
    readonly memberships: readonly string[];
    readonly isOwner?: boolean;
    readonly roleByService?: Readonly<Record<string, string | null>>;
    readonly preferred?: string | null;
    readonly status?: string;
    readonly onRoleQuery?: (organizationId: string) => void;
  }

  function serviceGateway(config: ServiceConfig): {
    gateway: AccessGateway;
    options: LoadAccessOptions;
  } {
    const gateway: AccessGateway = {
      currentUser: async () => ({ id: 'user-1', email: 'probni@example.invalid' }),
      fetchProfile: async () => ({ fullName: 'Probni Korisnik', profileComplete: true }),
      // The legacy shim must never be consulted once the service methods exist.
      fetchRole: async () => {
        throw new Error('fetchRole must not be called on the service-aware path');
      },
      fetchAccountStatus: async () => config.status ?? 'ACTIVE',
      fetchServiceContext: async () => ({
        memberships: config.memberships,
        isOwner: config.isOwner ?? false,
      }),
      fetchRoleIn: async (organizationId) => {
        config.onRoleQuery?.(organizationId);
        const code = organizationCodeOf(organizationId);
        return code ? (config.roleByService?.[code] ?? null) : null;
      },
    };
    return {
      gateway,
      options: { now: FIXED_NOW, preferredService: () => config.preferred ?? null },
    };
  }

  const loadService = (config: ServiceConfig): Promise<Access> => {
    const { gateway, options } = serviceGateway(config);
    return loadAccess(gateway, options);
  };

  it('gives a DVD-only member the DVD role, and DVD as their only service', async () => {
    const access = await loadService({
      memberships: ['DVD'],
      roleByService: { DVD: 'FIREFIGHTER' },
    });
    expect(access).toMatchObject({
      kind: 'SIGNED_IN',
      service: 'DVD',
      availableServices: ['DVD'],
      role: 'FIREFIGHTER',
    });
  });

  it('reaches the SZS path for an SZS-only member with no DVD membership', async () => {
    const access = await loadService({
      memberships: ['SZS'],
      roleByService: { SZS: 'FIREFIGHTER', DVD: null },
    });
    expect(access).toMatchObject({
      service: 'SZS',
      availableServices: ['SZS'],
      role: 'FIREFIGHTER',
    });
  });

  it('defaults a dual-service member to DVD and reads the DVD role there', async () => {
    const access = await loadService({
      memberships: ['SZS', 'DVD'],
      roleByService: { DVD: 'ADMIN', SZS: 'COMMANDER' },
    });
    expect(access).toMatchObject({
      service: 'DVD',
      availableServices: ['DVD', 'SZS'],
      role: 'ADMIN',
    });
  });

  it('honours a remembered SZS choice and reads the SZS role for it', async () => {
    const access = await loadService({
      memberships: ['DVD', 'SZS'],
      roleByService: { DVD: 'ADMIN', SZS: 'COMMANDER' },
      preferred: 'SZS',
    });
    expect(access).toMatchObject({ service: 'SZS', role: 'COMMANDER' });
  });

  it('gives the installation owner both services and OWNER, with no membership row', async () => {
    const access = await loadService({
      memberships: [],
      isOwner: true,
      roleByService: { DVD: 'OWNER', SZS: 'OWNER' },
    });
    expect(access).toMatchObject({
      service: 'DVD',
      availableServices: ['DVD', 'SZS'],
      role: 'OWNER',
    });
    // The same owner, having switched, is OWNER in SZS too.
    const asSzs = await loadService({
      memberships: [],
      isOwner: true,
      roleByService: { DVD: 'OWNER', SZS: 'OWNER' },
      preferred: 'SZS',
    });
    expect(asSzs).toMatchObject({ service: 'SZS', role: 'OWNER' });
  });

  it('gives a citizen no service and never asks the server for a role', async () => {
    let roleQueries = 0;
    const access = await loadService({
      memberships: [],
      isOwner: false,
      onRoleQuery: () => {
        roleQueries += 1;
      },
    });
    expect(access).toMatchObject({ service: null, availableServices: [], role: null });
    expect(accessObstacle(access)).toBe('NO_SERVICE_ROLE');
    expect(roleQueries).toBe(0);
  });

  it('ignores a remembered service that is no longer available and never asks about it', async () => {
    // The SZS membership was withdrawn, so only DVD remains. A stale "SZS" choice
    // must resolve to DVD, and the server must never even be asked about SZS.
    const asked: string[] = [];
    const access = await loadService({
      memberships: ['DVD'],
      roleByService: { DVD: 'FIREFIGHTER' },
      preferred: 'SZS',
      onRoleQuery: (organizationId) => asked.push(organizationId),
    });
    expect(access).toMatchObject({ service: 'DVD', availableServices: ['DVD'], role: 'FIREFIGHTER' });
    expect(asked).toEqual([organizationIdOf('DVD')]);
  });

  it('never lets a preferred service the person lacks become the acting service', async () => {
    // A DVD-only member asking to act as SZS: the choice is dropped, SZS never
    // appears in the services they may act in, and the role read is DVD's.
    const access = await loadService({
      memberships: ['DVD'],
      roleByService: { DVD: 'FIREFIGHTER', SZS: 'COMMANDER' },
      preferred: 'SZS',
    });
    expect(access).toMatchObject({ service: 'DVD', role: 'FIREFIGHTER' });
    if (access.kind !== 'SIGNED_IN') throw new Error('expected SIGNED_IN');
    expect(access.availableServices).not.toContain('SZS');
  });

  it('tells a suspended dual-service member it is suspended, not roleless', async () => {
    const access = await loadService({
      memberships: ['DVD', 'SZS'],
      status: 'SUSPENDED',
      roleByService: { DVD: null, SZS: null },
    });
    expect(accessObstacle(access)).toBe('SUSPENDED');
  });

  it('fails closed when the service context cannot be read', async () => {
    const { options } = serviceGateway({ memberships: ['DVD'] });
    const gateway: AccessGateway = {
      currentUser: async () => ({ id: 'user-1', email: 'probni@example.invalid' }),
      fetchProfile: async () => ({ fullName: 'Probni Korisnik', profileComplete: true }),
      fetchRole: async () => 'FIREFIGHTER',
      fetchAccountStatus: async () => 'ACTIVE',
      fetchServiceContext: async () => {
        throw new Error('network');
      },
      fetchRoleIn: async () => 'FIREFIGHTER',
    };
    expect(await loadAccess(gateway, options)).toEqual({ kind: 'UNAVAILABLE', reason: 'NETWORK' });
  });

  it('fails closed when the role for the acting service cannot be read', async () => {
    const access = await loadAccess(
      {
        currentUser: async () => ({ id: 'user-1', email: 'probni@example.invalid' }),
        fetchProfile: async () => ({ fullName: 'Probni Korisnik', profileComplete: true }),
        fetchRole: async () => 'FIREFIGHTER',
        fetchAccountStatus: async () => 'ACTIVE',
        fetchServiceContext: async () => ({ memberships: ['DVD'], isOwner: false }),
        fetchRoleIn: async () => {
          throw new Error('network');
        },
      },
      { now: FIXED_NOW },
    );
    expect(access).toEqual({ kind: 'UNAVAILABLE', reason: 'NETWORK' });
  });
});

describe('narrowing what the wire returns', () => {
  it('accepts exactly the four operational roles', () => {
    expect(asOperationalRole('OWNER')).toBe('OWNER');
    expect(asOperationalRole('ADMIN')).toBe('ADMIN');
    expect(asOperationalRole('COMMANDER')).toBe('COMMANDER');
    expect(asOperationalRole('FIREFIGHTER')).toBe('FIREFIGHTER');
  });

  it('rejects the roles the server deliberately resolves to nothing', () => {
    // PENDING and CITIZEN both mean "no internal access". The server already
    // returns NULL for them; this is the second place that must agree.
    expect(asOperationalRole('PENDING')).toBeNull();
    expect(asOperationalRole('CITIZEN')).toBeNull();
    expect(asOperationalRole(null)).toBeNull();
    expect(asOperationalRole(undefined)).toBeNull();
    expect(asOperationalRole('')).toBeNull();
  });
});

/**
 * `sameAccess` decides whether a re-read is worth telling anybody about.
 *
 * It is the reason returning to the tab no longer resets the screen: the
 * provider keeps the previous snapshot object when the answer has not changed,
 * so nothing downstream sees "the account changed". Getting it wrong in either
 * direction is bad - too loose and a real suspension goes unnoticed, too strict
 * and the churn comes back.
 */
describe('two snapshots say the same thing', () => {
  const signedIn = (over: Partial<SignedInAccess> = {}): SignedInAccess => ({
    kind: 'SIGNED_IN',
    userId: 'user-1',
    email: 'komandir@example.invalid',
    fullName: 'Komandir Smjene',
    profileComplete: true,
    accountStatus: 'ACTIVE',
    service: 'DVD',
    availableServices: ['DVD'],
    role: 'COMMANDER',
    loadedAt: '2026-09-13T10:00:00.000Z',
    ...over,
  });

  it('ignores when it was read', () => {
    // The whole point. `loadedAt` differs on every single read and says nothing
    // about the answer; comparing it would make the function always return
    // false and restore the bug it exists to prevent.
    expect(sameAccess(signedIn(), signedIn({ loadedAt: '2026-09-13T11:22:33.000Z' }))).toBe(true);
  });

  it('is true for two separately built but identical snapshots', () => {
    expect(sameAccess(signedIn(), signedIn())).toBe(true);
  });

  it.each([
    ['a different account', { userId: 'user-2' }],
    ['a different role', { role: 'FIREFIGHTER' as const }],
    ['a withdrawn account', { accountStatus: 'WITHDRAWN' as const }],
    ['a role taken away', { role: null }],
    ['a completed profile', { profileComplete: false }],
    ['a changed name', { fullName: 'Neko Drugi' }],
    ['a changed address', { email: 'drugi@example.invalid' }],
    // Switching the acting service, or gaining/losing a service to switch to, is a
    // real change: the screens below must re-read the role and member for it.
    ['a switched acting service', { service: 'SZS' as const, availableServices: ['DVD', 'SZS'] as const }],
    ['a widened service list', { availableServices: ['DVD', 'SZS'] as const }],
  ])('is false for %s', (_label, over) => {
    expect(sameAccess(signedIn(), signedIn(over as Partial<SignedInAccess>))).toBe(false);
  });

  it('separates the states that carry nothing else', () => {
    expect(sameAccess({ kind: 'LOADING' }, { kind: 'LOADING' })).toBe(true);
    expect(sameAccess({ kind: 'SIGNED_OUT' }, { kind: 'SIGNED_OUT' })).toBe(true);
    expect(sameAccess({ kind: 'LOADING' }, { kind: 'SIGNED_OUT' })).toBe(false);
    expect(sameAccess({ kind: 'SIGNED_OUT' }, signedIn())).toBe(false);
  });

  it('distinguishes why the server could not be asked', () => {
    expect(
      sameAccess({ kind: 'UNAVAILABLE', reason: 'NETWORK' }, { kind: 'UNAVAILABLE', reason: 'NETWORK' }),
    ).toBe(true);
    expect(
      sameAccess({ kind: 'UNAVAILABLE', reason: 'NETWORK' }, { kind: 'UNAVAILABLE', reason: 'NO_PROFILE' }),
    ).toBe(false);
  });
});
