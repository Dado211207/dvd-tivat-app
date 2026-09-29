/**
 * Which service a person is "acting as", for P6.
 *
 * A person can serve in DVD, SZS, or both (D13: one member record per service).
 * The installation owner administers both services even with no membership row
 * (D9). Everything operational - role, member record, own availability, registry,
 * the lists a screen shows - is read for ONE service at a time; this module is the
 * pure logic that decides which services a person may act in and which one is
 * selected. The owner's D14 decision: an explicit "acting as DVD / acting as SZS"
 * choice, never a silent switch.
 *
 * This is deliberately pure and free of React and storage, so the rules are unit
 * tested without a browser. The client selects a service here; it is NEVER
 * authority by itself - the database still derives and checks every role and
 * membership from stored rows via `current_role_in(org)` / `current_member_id_in(org)`.
 * A person who selects SZS but holds no SZS authority simply gets SZS's
 * no-role/no-member states from the server.
 */

import { ORGANIZATION_CODES, type OrganizationCode } from './directory';

/**
 * The fixed identity of each service.
 *
 * These two uuids are not configuration - they are frozen into the schema. Every
 * DVD compatibility wrapper hardcodes the DVD uuid (`current_dvd_role()` is
 * literally `current_role_in('…0001')`, 202609240023), `members.organization_id`
 * defaults to it and is frozen by `refuse_organization_change`, and 202609240015
 * seeds SZS at `…0002`. The client passes one of these to the service-aware
 * server functions (`current_role_in`, `current_member_id_in`) and to the
 * service-scoped registry reads; it is only ever a SELECTOR of which stored rows
 * to ask about, never authority in itself - the server derives and checks every
 * role and membership from its own rows.
 */
export const ORGANIZATION_IDS: Readonly<Record<OrganizationCode, string>> = {
  DVD: '00000000-0000-4000-8000-000000000001',
  SZS: '00000000-0000-4000-8000-000000000002',
};

export function organizationIdOf(code: OrganizationCode): string {
  return ORGANIZATION_IDS[code];
}

/** The service a uuid names, or null for any value that is not one of the two. */
export function organizationCodeOf(id: string): OrganizationCode | null {
  return ORGANIZATION_CODES.find((code) => ORGANIZATION_IDS[code] === id) ?? null;
}

/**
 * The services a person may act in: every service they hold an active membership
 * in, plus BOTH services when they are the installation owner (who administers
 * both without needing a membership row). Returned in the fixed DVD, SZS order so
 * the default is stable and a DVD-capable person always defaults to DVD - which
 * keeps a DVD-only account byte-identical to P5.
 */
export function availableServices(
  membershipServices: readonly OrganizationCode[],
  isOwner: boolean,
): OrganizationCode[] {
  const set = new Set<OrganizationCode>(isOwner ? ORGANIZATION_CODES : []);
  for (const service of membershipServices) set.add(service);
  return ORGANIZATION_CODES.filter((code) => set.has(code));
}

/**
 * The service to act as: the remembered one if it is still available, otherwise
 * the first available (DVD, by the order above). `null` only when the person can
 * act in no service at all - a citizen with no membership and no ownership - which
 * is the existing no-operational-role state, now named per service.
 */
export function resolveActingService(
  available: readonly OrganizationCode[],
  remembered: string | null,
): OrganizationCode | null {
  if (available.length === 0) return null;
  if (remembered !== null && (available as readonly string[]).includes(remembered)) {
    return remembered as OrganizationCode;
  }
  return available[0]!;
}

/** True when the person can act in more than one service - i.e. the switch shows. */
export function canSwitchService(available: readonly OrganizationCode[]): boolean {
  return available.length > 1;
}

/**
 * Per-account, per-device memory of the last acting-as choice.
 *
 * Keyed by user id so switching accounts on a shared device never inherits the
 * previous person's choice. Every access is wrapped: storage can be absent,
 * cleared, or throw in a private window, and the selection must still resolve
 * (to the default) rather than break the app. This is a per-viewer convenience,
 * not authority - losing it only resets the default service, it grants nothing.
 */
const STORAGE_PREFIX = 'dvd-tivat.acting-service:';

export function rememberedServiceKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function readRememberedService(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  userId: string,
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(rememberedServiceKey(userId));
  } catch {
    return null;
  }
}

export function writeRememberedService(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  userId: string,
  service: OrganizationCode,
): void {
  if (!storage) return;
  try {
    storage.setItem(rememberedServiceKey(userId), service);
  } catch {
    /* Per-viewer convenience only; a write that cannot happen is not an error. */
  }
}
