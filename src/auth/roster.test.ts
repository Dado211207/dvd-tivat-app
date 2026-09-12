import { describe, expect, it } from 'vitest';
import {
  explainRosterError,
  memberReadiness,
  READINESS_LABEL,
  sortRoster,
  type RosterMember,
} from './roster';

const member = (overrides: Partial<RosterMember> = {}): RosterMember => ({
  id: 'm-1',
  fullName: 'Ime Prezime',
  specialties: [],
  active: true,
  userId: 'u-1',
  ...overrides,
});

describe('who on the roster could actually be called out', () => {
  it('is ready only with an account and an active record', () => {
    expect(memberReadiness(member())).toBe('READY');
  });

  it('names the missing account, because that member would silently get nothing', () => {
    // This is the state every member is in until an administrator links them:
    // `current_member_id()` returns NULL, so the server refuses their response
    // with MEMBER_RECORD_REQUIRED. Showing it on the row is the point of the
    // screen.
    expect(memberReadiness(member({ userId: null }))).toBe('NO_ACCOUNT');
  });

  it('reports being out of the roster ahead of having no account', () => {
    // Both are true for somebody who left; only one of them is the reason, and
    // telling an administrator to link an account to a member who is out of the
    // society would be advice that does not help.
    expect(memberReadiness(member({ active: false, userId: null }))).toBe('INACTIVE');
  });

  it('says plainly on every state that the member will not be called', () => {
    expect(READINESS_LABEL.NO_ACCOUNT).toContain('nece primiti poziv');
    expect(READINESS_LABEL.INACTIVE).toContain('nece primiti poziv');
    expect(READINESS_LABEL.READY).not.toContain('nece');
  });
});

describe('ordering the roster', () => {
  it('sorts by name and sinks former members to the bottom without hiding them', () => {
    const sorted = sortRoster([
      member({ id: 'c', fullName: 'Cvijeta Petrovic' }),
      member({ id: 'x', fullName: 'Ana Ex', active: false }),
      member({ id: 'a', fullName: 'Ana Markovic' }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(['a', 'c', 'x']);
  });

  it('does not mutate what it was given', () => {
    const original = [member({ id: 'b', fullName: 'B' }), member({ id: 'a', fullName: 'A' })];
    sortRoster(original);
    expect(original.map((row) => row.id)).toEqual(['b', 'a']);
  });
});

describe('explaining a refusal', () => {
  it('distinguishes the two linking collisions, which need different corrections', () => {
    expect(explainRosterError('MEMBER_ALREADY_LINKED')).toContain('vec ima povezan nalog');
    expect(explainRosterError('ACCOUNT_ALREADY_LINKED')).toContain('vec povezan sa drugim clanom');
  });

  it('names the authority the server actually demanded', () => {
    expect(explainRosterError('ADMIN_REQUIRED')).toContain('administrator');
    expect(explainRosterError('COMMAND_REQUIRED')).toContain('komandna');
  });

  it('does not mistake CALLSIGN_REQUIRED for the generic name rule', () => {
    // 'NAME_REQUIRED' is a substring of neither, but 'CALLSIGN_REQUIRED' being
    // checked after a looser rule would have been an easy way to tell somebody
    // the wrong field was wrong.
    expect(explainRosterError('CALLSIGN_REQUIRED')).toContain('Oznaka vozila');
    expect(explainRosterError('NAME_REQUIRED')).toContain('Naziv');
  });

  it('admits it does not know, rather than inventing a reason', () => {
    const message = explainRosterError('SOMETHING_NOBODY_HAS_SEEN');
    expect(message).toBe('Server je odbio zahtjev. Promjena nije sacuvana.');
  });

  it('never claims a change was saved', () => {
    for (const code of [
      'ADMIN_REQUIRED',
      'MEMBER_NOT_FOUND',
      'GROUP_NAME_TAKEN',
      'CALLSIGN_TAKEN',
      'REASON_REQUIRED',
      'WHATEVER',
    ]) {
      expect(explainRosterError(code).length).toBeGreaterThan(10);
    }
  });
});
