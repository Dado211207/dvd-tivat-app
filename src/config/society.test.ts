import { describe, expect, it } from 'vitest';
import { GROUPS, MEMBERS, VEHICLES } from '@/domain/seed';
import { composeMessage } from '@/domain/message';
import { SOCIETY_PROFILE } from './society';

describe('public-safe DVD Tivat operating profile', () => {
  it('models the owner-reported scale without storing real identities', () => {
    expect(SOCIETY_PROFILE.reportedMemberCount).toBe(52);
    expect(MEMBERS).toHaveLength(52);
    expect(GROUPS.find((group) => group.id === 'g-svi')?.memberIds).toHaveLength(52);
    expect(MEMBERS.slice(14).every((member) => /^Probni clan \d{2}$/.test(member.name))).toBe(true);
    expect(MEMBERS.every((member) => !/[+@]/.test(member.contactLabel))).toBe(true);
  });

  it('contains only the two owner-reported vehicle categories with fictional callsigns', () => {
    expect(VEHICLES).toEqual([
      { id: 'v-01', callsign: 'MAN-1', name: 'MAN vatrogasno vozilo', type: 'Vatrogasno vozilo' },
      { id: 'v-02', callsign: 'TERENAC-1', name: 'Vatrogasni terenac', type: 'Terensko vozilo' },
    ]);
  });

  it('puts the base assembly point on every previewed and recorded message', () => {
    const message = composeMessage({
      kind: 'VJEZBA',
      title: 'Provjera',
      instructions: 'Ponijeti opremu.',
      incidentLocation: 'Izmisljena lokacija',
      reporterLocation: '',
    });
    expect(message).toContain(`Mjesto okupljanja: ${SOCIETY_PROFILE.assemblyPoint}`);
    expect(message.indexOf('Mjesto okupljanja')).toBeLessThan(message.indexOf('Lokacija dogadjaja'));
  });
});
