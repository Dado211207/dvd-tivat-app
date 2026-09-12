/**
 * The administrator's view of the real roster: members, groups and vehicles.
 *
 * This is the screen the society's records are actually entered through, which
 * is why it exists at all - before this slice the database could publish a
 * call-out but nothing could create the people, groups or vehicles it refers to,
 * and the only way in was privileged SQL.
 *
 * Authority is ADMIN or OWNER, checked by the server on every command
 * (`ADMIN_REQUIRED`). A COMMANDER runs call-outs and deliberately cannot edit
 * who is in the society. As with the account directory, hiding the screen from
 * everybody else is courtesy; the server's refusals are the control.
 *
 * The pure functions here are unit tested. The thin adapters below them are
 * exercised by the database suite, which runs the real policies and commands
 * against a real PostgreSQL rather than a mock that would agree with anything.
 */

import { accountBackend } from './supabaseClient';

export interface RosterMember {
  readonly id: string;
  readonly fullName: string;
  readonly specialties: readonly string[];
  readonly active: boolean;
  /** The linked account, or null when this person has no way to sign in yet. */
  readonly userId: string | null;
}

export interface RosterGroup {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly memberIds: readonly string[];
}

export interface RosterVehicle {
  readonly id: string;
  readonly callsign: string;
  readonly name: string;
  readonly kind: string;
  readonly active: boolean;
}

export interface CommandOutcome {
  readonly ok: boolean;
  readonly message?: string;
}

/**
 * Why a member cannot answer a call-out yet.
 *
 * Deliberately a single derived value rather than three booleans scattered
 * through the interface: an administrator looking at the roster needs to know
 * who would silently receive nothing, and that is the one question worth
 * answering on every row.
 */
export type MemberReadiness = 'READY' | 'NO_ACCOUNT' | 'INACTIVE';

export function memberReadiness(member: RosterMember): MemberReadiness {
  if (!member.active) return 'INACTIVE';
  if (member.userId === null) return 'NO_ACCOUNT';
  return 'READY';
}

/** Local-language, diacritic-free explanation of a readiness state. */
export const READINESS_LABEL: Record<MemberReadiness, string> = {
  READY: 'Moze primiti poziv',
  NO_ACCOUNT: 'Nema povezan nalog - nece primiti poziv',
  INACTIVE: 'Van sastava - nece primiti poziv',
};

/**
 * Sort a roster the way a person reads it: by name, in the local collation.
 *
 * Inactive members sink to the bottom rather than disappearing, because "who
 * used to be in the society" is a real question and hiding them would make the
 * list look wrong rather than filtered.
 */
export function sortRoster(members: readonly RosterMember[]): RosterMember[] {
  return [...members].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.fullName.localeCompare(b.fullName, 'sr');
  });
}

/**
 * Turn a server error code into something an administrator can act on.
 *
 * The server raises bare, stable codes on purpose. Translating them here keeps
 * the refusal honest: the interface never invents a reason the server did not
 * give, and an unrecognised code says only that the change was not saved.
 */
export function explainRosterError(raw: string): string {
  if (raw.includes('ADMIN_REQUIRED')) {
    return 'Server je odbio zahtjev: samo administrator ili vlasnik moze mijenjati evidenciju.';
  }
  if (raw.includes('COMMAND_REQUIRED')) {
    return 'Server je odbio zahtjev: potrebna su komandna prava.';
  }
  if (raw.includes('MEMBER_ALREADY_LINKED')) {
    return 'Taj clan vec ima povezan nalog. Prvo razvezite postojeci.';
  }
  if (raw.includes('ACCOUNT_ALREADY_LINKED')) {
    return 'Taj nalog je vec povezan sa drugim clanom.';
  }
  if (raw.includes('MEMBER_NOT_FOUND')) {
    return 'Clan vise ne postoji. Osvjezite spisak.';
  }
  if (raw.includes('GROUP_NOT_FOUND')) {
    return 'Grupa vise ne postoji. Osvjezite spisak.';
  }
  if (raw.includes('VEHICLE_NOT_FOUND')) {
    return 'Vozilo vise ne postoji. Osvjezite spisak.';
  }
  if (raw.includes('ACCOUNT_NOT_FOUND')) {
    return 'Nalog vise ne postoji. Osvjezite spisak.';
  }
  if (raw.includes('GROUP_NAME_TAKEN')) {
    return 'Grupa sa tim imenom vec postoji.';
  }
  if (raw.includes('CALLSIGN_TAKEN')) {
    return 'Vozilo sa tom oznakom vec postoji.';
  }
  if (raw.includes('CALLSIGN_REQUIRED')) {
    return 'Oznaka vozila je obavezna.';
  }
  if (raw.includes('FULL_NAME_REQUIRED')) {
    return 'Ime i prezime moraju imati najmanje dva znaka.';
  }
  if (raw.includes('NAME_REQUIRED')) {
    return 'Naziv je obavezan i mora imati najmanje dva znaka.';
  }
  if (raw.includes('REASON_REQUIRED')) {
    return 'Razlog je obavezan i mora imati najmanje dva znaka.';
  }
  return 'Server je odbio zahtjev. Promjena nije sacuvana.';
}

/** Runs a command and translates any refusal. Never throws. */
async function command(
  name: string,
  args: Record<string, unknown>,
): Promise<CommandOutcome> {
  try {
    const { error } = await accountBackend().rpc(name, args);
    return error ? { ok: false, message: explainRosterError(error.message) } : { ok: true };
  } catch (error) {
    return { ok: false, message: explainRosterError(String(error)) };
  }
}

interface MemberRow {
  id: string;
  full_name: string;
  specialties: string[] | null;
  active: boolean;
  user_id: string | null;
}

export async function loadRoster(): Promise<RosterMember[]> {
  const { data, error } = await accountBackend()
    .from('members')
    .select('id, full_name, specialties, active, user_id');
  if (error) throw error;
  return sortRoster(
    ((data ?? []) as MemberRow[]).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      specialties: row.specialties ?? [],
      active: row.active,
      userId: row.user_id,
    })),
  );
}

export async function loadGroups(): Promise<RosterGroup[]> {
  const backend = accountBackend();
  // Two reads joined here rather than a PostgREST embed, for the same reason the
  // account directory does it: the join is expressed in the interface, not
  // assumed from a foreign key the API happens to expose.
  const [groups, links] = await Promise.all([
    backend.from('groups').select('id, name, active'),
    backend.from('group_members').select('group_id, member_id'),
  ]);
  if (groups.error) throw groups.error;
  if (links.error) throw links.error;

  const byGroup = new Map<string, string[]>();
  for (const link of (links.data ?? []) as { group_id: string; member_id: string }[]) {
    const existing = byGroup.get(link.group_id);
    if (existing) existing.push(link.member_id);
    else byGroup.set(link.group_id, [link.member_id]);
  }

  return ((groups.data ?? []) as { id: string; name: string; active: boolean }[])
    .map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      memberIds: byGroup.get(row.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sr'));
}

export async function loadVehicles(): Promise<RosterVehicle[]> {
  const { data, error } = await accountBackend()
    .from('vehicles')
    .select('id, callsign, name, kind, active');
  if (error) throw error;
  return ((data ?? []) as RosterVehicle[])
    .map((row) => ({ ...row }))
    .sort((a, b) => a.callsign.localeCompare(b.callsign, 'sr'));
}

export const createMember = (fullName: string, specialties: readonly string[]) =>
  command('admin_create_member', {
    requested_full_name: fullName,
    requested_specialties: specialties,
  });

export const updateMember = (id: string, fullName: string, specialties: readonly string[]) =>
  command('admin_update_member', {
    target_member: id,
    requested_full_name: fullName,
    requested_specialties: specialties,
  });

export const setMemberActive = (id: string, active: boolean, reason: string) =>
  command('admin_set_member_active', {
    target_member: id,
    requested_active: active,
    requested_reason: reason,
  });

export const linkMemberAccount = (memberId: string, userId: string) =>
  command('admin_link_member_account', { target_member: memberId, target_user: userId });

export const unlinkMemberAccount = (memberId: string, reason: string) =>
  command('admin_unlink_member_account', { target_member: memberId, requested_reason: reason });

export const createGroup = (name: string) =>
  command('admin_create_group', { requested_name: name });

export const renameGroup = (id: string, name: string) =>
  command('admin_rename_group', { target_group: id, requested_name: name });

export const setGroupActive = (id: string, active: boolean, reason: string) =>
  command('admin_set_group_active', {
    target_group: id,
    requested_active: active,
    requested_reason: reason,
  });

export const setGroupMembers = (id: string, memberIds: readonly string[]) =>
  command('admin_set_group_members', { target_group: id, member_ids: memberIds });

export const createVehicle = (callsign: string, name: string, kind: string) =>
  command('admin_create_vehicle', {
    requested_callsign: callsign,
    requested_name: name,
    requested_kind: kind,
  });

export const updateVehicle = (id: string, callsign: string, name: string, kind: string) =>
  command('admin_update_vehicle', {
    target_vehicle: id,
    requested_callsign: callsign,
    requested_name: name,
    requested_kind: kind,
  });

export const setVehicleActive = (id: string, active: boolean, reason: string) =>
  command('admin_set_vehicle_active', {
    target_vehicle: id,
    requested_active: active,
    requested_reason: reason,
  });
