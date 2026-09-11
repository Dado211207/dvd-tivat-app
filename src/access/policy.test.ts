import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_ROLES,
  canAssignRole,
  defaultRegistrationRole,
  hasPermission,
  isPlausibleFullName,
  normalizeFullName,
  reportAlertRecipientIds,
  type AccountSummary,
} from './policy';

const account = (
  id: string,
  role: AccountSummary['role'],
  status: AccountSummary['status'] = 'ACTIVE',
): AccountSummary => ({ id, role, status, fullName: `Probni Korisnik ${id}` });

describe('account access policy', () => {
  it('gives every new registration no access at all', () => {
    // PENDING is what the database trigger writes. The client saying CITIZEN
    // here would have contradicted the server, which is the one mistake this
    // display-only module must never make.
    expect(defaultRegistrationRole()).toBe('PENDING');
  });

  it('gives neither no-access role a single operational permission', () => {
    for (const role of ['PENDING', 'CITIZEN'] as const) {
      expect(hasPermission(account(role, role), 'RESPOND_TO_CALLOUT')).toBe(false);
      expect(hasPermission(account(role, role), 'SEND_CALLOUT')).toBe(false);
      expect(hasPermission(account(role, role), 'VIEW_ACCOUNT_DIRECTORY')).toBe(false);
      expect(hasPermission(account(role, role), 'VIEW_UNVERIFIED_REPORTS')).toBe(false);
    }
  });

  it('does not let anybody but the owner grant roles', () => {
    for (const role of ['PENDING', 'CITIZEN', 'FIREFIGHTER', 'COMMANDER', 'ADMIN'] as const) {
      expect(canAssignRole(account(role, role), 'FIREFIGHTER')).toBe(false);
    }
  });

  it('lets only an active owner assign non-owner roles', () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(canAssignRole(account('owner', 'OWNER'), role)).toBe(true);
    }
    expect(canAssignRole(account('owner', 'OWNER'), 'OWNER')).toBe(false);
    expect(canAssignRole(account('owner', 'OWNER', 'SUSPENDED'), 'FIREFIGHTER')).toBe(false);
  });

  it('does not mistake hidden navigation for authorization', () => {
    expect(hasPermission(account('pending', 'PENDING'), 'VIEW_ACCOUNT_DIRECTORY')).toBe(false);
    expect(hasPermission(account('admin', 'ADMIN'), 'MANAGE_ROLES')).toBe(false);
    expect(hasPermission(account('owner', 'OWNER'), 'MANAGE_ROLES')).toBe(true);
  });

  it('alerts every active operational account about an unverified report', () => {
    const recipients = reportAlertRecipientIds([
      account('pending', 'PENDING'),
      account('firefighter', 'FIREFIGHTER'),
      account('commander', 'COMMANDER'),
      account('admin', 'ADMIN'),
      account('owner', 'OWNER'),
      account('suspended', 'FIREFIGHTER', 'SUSPENDED'),
      account('unfinished', 'COMMANDER', 'PROFILE_REQUIRED'),
    ]);

    expect(recipients).toEqual(['firefighter', 'commander', 'admin', 'owner']);
  });

  it('keeps an unverified report distinct from a call-out', () => {
    expect(hasPermission(account('firefighter', 'FIREFIGHTER'), 'VIEW_UNVERIFIED_REPORTS')).toBe(true);
    expect(hasPermission(account('firefighter', 'FIREFIGHTER'), 'SEND_CALLOUT')).toBe(false);
    expect(hasPermission(account('commander', 'COMMANDER'), 'SEND_CALLOUT')).toBe(true);
  });

  it('normalizes a display name without using it as identity', () => {
    expect(normalizeFullName('  Probni   Korisnik  ')).toBe('Probni Korisnik');
    expect(isPlausibleFullName('Probni Korisnik')).toBe(true);
    expect(isPlausibleFullName('Jednoime')).toBe(false);
  });
});
