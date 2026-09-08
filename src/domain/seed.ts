/**
 * Fictional demonstration data.
 *
 * EVERY person, contact label, vehicle and location in this file is invented for
 * a demonstration. The repository is public, so it contains no real member of
 * DVD Tivat, no real phone number or address, and no record of a real incident.
 * Names are ordinary regional names chosen to make the demonstration readable;
 * each carries a visible demo identifier so nobody can mistake the roster for a
 * real one. Any resemblance to a real person is coincidence and carries no data
 * about them.
 *
 * Ids and timestamps are fixed constants rather than generated, so the seed is
 * identical on every machine and screenshots are reproducible.
 */

import type { AppState, Group, Member, Vehicle } from './types';
import { SCHEMA_VERSION } from './types';

/** Fixed reference day for the seeded history entry. */
const D = (time: string): string => `2026-09-05T${time}:00.000Z`;

export const GROUPS: Group[] = [
  { id: 'g-komanda', name: 'Komandni kadar', memberIds: ['m-01', 'm-02', 'm-03'] },
  { id: 'g-vozaci', name: 'Vozaci C kategorije', memberIds: ['m-03', 'm-05', 'm-08', 'm-11'] },
  { id: 'g-ida', name: 'Nosioci IDA aparata', memberIds: ['m-04', 'm-05', 'm-09', 'm-12'] },
  { id: 'g-prva-pomoc', name: 'Prva pomoc', memberIds: ['m-06', 'm-10', 'm-13'] },
  { id: 'g-tehnicka', name: 'Tehnicko spasavanje', memberIds: ['m-04', 'm-07', 'm-11'] },
  {
    id: 'g-svi',
    name: 'Svi operativni clanovi',
    memberIds: [
      'm-01', 'm-02', 'm-03', 'm-04', 'm-05', 'm-06', 'm-07',
      'm-08', 'm-09', 'm-10', 'm-11', 'm-12', 'm-13', 'm-14',
    ],
  },
];

export const MEMBERS: Member[] = [
  {
    id: 'm-01',
    name: 'Marko Perovic',
    roleProposed: 'ADMIN',
    specialties: ['KOMANDNI_KADAR'],
    groupIds: ['g-komanda', 'g-svi'],
    contactLabel: 'demo-kontakt-01',
    active: true,
  },
  {
    id: 'm-02',
    name: 'Ana Vukovic',
    roleProposed: 'DEZURNI',
    specialties: ['KOMANDNI_KADAR', 'PRVA_POMOC'],
    groupIds: ['g-komanda', 'g-svi'],
    contactLabel: 'demo-kontakt-02',
    active: true,
  },
  {
    id: 'm-03',
    name: 'Nikola Djukic',
    roleProposed: 'DEZURNI',
    specialties: ['KOMANDNI_KADAR', 'VOZAC_C'],
    groupIds: ['g-komanda', 'g-vozaci', 'g-svi'],
    contactLabel: 'demo-kontakt-03',
    active: true,
  },
  {
    id: 'm-04',
    name: 'Ivan Radulovic',
    roleProposed: 'CLAN',
    specialties: ['IDA', 'TEHNICKO_SPASAVANJE'],
    groupIds: ['g-ida', 'g-tehnicka', 'g-svi'],
    contactLabel: 'demo-kontakt-04',
    active: true,
  },
  {
    id: 'm-05',
    name: 'Petar Krivokapic',
    roleProposed: 'CLAN',
    specialties: ['IDA', 'VOZAC_C'],
    groupIds: ['g-ida', 'g-vozaci', 'g-svi'],
    contactLabel: 'demo-kontakt-05',
    active: true,
  },
  {
    id: 'm-06',
    name: 'Jelena Boskovic',
    roleProposed: 'CLAN',
    specialties: ['PRVA_POMOC'],
    groupIds: ['g-prva-pomoc', 'g-svi'],
    contactLabel: 'demo-kontakt-06',
    active: true,
  },
  {
    id: 'm-07',
    name: 'Milos Scepanovic',
    roleProposed: 'CLAN',
    specialties: ['TEHNICKO_SPASAVANJE', 'SUMSKI_POZAR'],
    groupIds: ['g-tehnicka', 'g-svi'],
    contactLabel: 'demo-kontakt-07',
    active: true,
  },
  {
    id: 'm-08',
    name: 'Stefan Lekic',
    roleProposed: 'CLAN',
    specialties: ['VOZAC_C', 'SUMSKI_POZAR'],
    groupIds: ['g-vozaci', 'g-svi'],
    contactLabel: 'demo-kontakt-08',
    active: true,
  },
  {
    id: 'm-09',
    name: 'Vuk Mitrovic',
    roleProposed: 'CLAN',
    specialties: ['IDA'],
    groupIds: ['g-ida', 'g-svi'],
    contactLabel: 'demo-kontakt-09',
    active: true,
  },
  {
    id: 'm-10',
    name: 'Milica Popovic',
    roleProposed: 'CLAN',
    specialties: ['PRVA_POMOC'],
    groupIds: ['g-prva-pomoc', 'g-svi'],
    contactLabel: 'demo-kontakt-10',
    active: true,
  },
  {
    id: 'm-11',
    name: 'Bojan Adzic',
    roleProposed: 'CLAN',
    specialties: ['VOZAC_C', 'TEHNICKO_SPASAVANJE'],
    groupIds: ['g-vozaci', 'g-tehnicka', 'g-svi'],
    contactLabel: 'demo-kontakt-11',
    active: true,
  },
  {
    id: 'm-12',
    name: 'Luka Jovanovic',
    roleProposed: 'CLAN',
    specialties: ['IDA', 'SUMSKI_POZAR'],
    groupIds: ['g-ida', 'g-svi'],
    contactLabel: 'demo-kontakt-12',
    active: true,
  },
  {
    id: 'm-13',
    name: 'Sara Nikolic',
    roleProposed: 'CLAN',
    specialties: ['PRVA_POMOC'],
    groupIds: ['g-prva-pomoc', 'g-svi'],
    contactLabel: 'demo-kontakt-13',
    active: true,
  },
  {
    id: 'm-14',
    name: 'Danilo Kovacevic',
    roleProposed: 'CLAN',
    specialties: ['SUMSKI_POZAR'],
    groupIds: ['g-svi'],
    contactLabel: 'demo-kontakt-14',
    active: true,
  },
];

export const VEHICLES: Vehicle[] = [
  { id: 'v-01', callsign: 'NV-1', name: 'Navalno vozilo', type: 'Navalno' },
  { id: 'v-02', callsign: 'AC-1', name: 'Auto-cisterna', type: 'Cisterna' },
  { id: 'v-03', callsign: 'TV-1', name: 'Tehnicko vozilo', type: 'Tehnicko' },
  { id: 'v-04', callsign: 'SV-1', name: 'Sumsko vozilo', type: 'Terensko' },
  { id: 'v-05', callsign: 'KV-1', name: 'Komandno vozilo', type: 'Komandno' },
];

/**
 * One already-closed exercise so that History, the activity log and the "closed
 * exercise" rules are demonstrable on first load.
 *
 * This is seeded demonstration data, not something the application produced.
 * Note that even here every delivery attempt is NIJE_POKUSANO - the prototype
 * has never had a channel to send anything on, and the seed does not pretend
 * otherwise.
 */
function seededHistory(): Pick<
  AppState,
  'exercises' | 'calls' | 'deliveryAttempts' | 'responses' | 'vehicleMovements' | 'activity'
> {
  const exerciseId = 'e-seed-01';
  const callId = 'c-seed-01';
  const recipientIds = ['m-01', 'm-03', 'm-04', 'm-05', 'm-09', 'm-12'];

  return {
    exercises: [
      {
        id: exerciseId,
        kind: 'VJEZBA',
        title: 'Vjezba: dimna komora, rad sa IDA aparatima',
        instructions: 'Okupljanje u domu. Ponijeti licnu zastitnu opremu i IDA aparate.',
        incidentLocation: 'Poligon za vjezbe (izmisljena lokacija)',
        reporterLocation: '',
        status: 'ZAVRSENA',
        createdAt: D('18:05'),
        createdBy: 'm-02',
        closedAt: D('19:40'),
        closedBy: 'm-02',
        closeReason: 'Vjezba zavrsena po planu.',
      },
    ],
    calls: [
      {
        id: callId,
        exerciseId,
        messageText: [
          '[VJEZBA] Vjezba: dimna komora, rad sa IDA aparatima',
          'Uputstvo: Okupljanje u domu. Ponijeti licnu zastitnu opremu i IDA aparate.',
          'Lokacija dogadjaja: Poligon za vjezbe (izmisljena lokacija)',
          'Napomena: simulacija u prototipu. Poruka nije poslata nikome.',
        ].join('\n'),
        recipientIds,
        sourceSelection: { memberIds: ['m-01', 'm-03'], groupIds: ['g-ida'] },
        status: 'POSLAT',
        createdAt: D('18:05'),
        createdBy: 'm-02',
        cancelledAt: null,
        cancelledBy: null,
      },
    ],
    deliveryAttempts: recipientIds.map((memberId, index) => ({
      id: `d-seed-${index + 1}`,
      callId,
      memberId,
      channel: 'NEMA' as const,
      state: 'NIJE_POKUSANO' as const,
      updatedAt: D('18:05'),
      note: 'Prototip ne salje obavjestenja. Isporuka nije pokusana.',
    })),
    responses: [
      {
        id: 'r-seed-1', callId, memberId: 'm-01', answer: 'DOLAZIM', etaMinutes: null,
        directToLocation: false, respondedAt: D('18:07'), updatedAt: D('18:07'), revision: 1,
      },
      {
        id: 'r-seed-2', callId, memberId: 'm-04', answer: 'DOLAZIM', etaMinutes: null,
        directToLocation: false, respondedAt: D('18:08'), updatedAt: D('18:08'), revision: 1,
      },
      {
        id: 'r-seed-3', callId, memberId: 'm-05', answer: 'DOLAZIM_KASNIJE', etaMinutes: 30,
        directToLocation: false, respondedAt: D('18:09'), updatedAt: D('18:12'), revision: 2,
      },
      {
        id: 'r-seed-4', callId, memberId: 'm-09', answer: 'NE_MOGU', etaMinutes: null,
        directToLocation: false, respondedAt: D('18:11'), updatedAt: D('18:11'), revision: 1,
      },
      {
        id: 'r-seed-5', callId, memberId: 'm-12', answer: 'DOLAZIM', etaMinutes: null,
        directToLocation: true, respondedAt: D('18:14'), updatedAt: D('18:14'), revision: 1,
      },
      // m-03 deliberately never answered: "bez odgovora" is a real state and the
      // demonstration should show it rather than a full board.
    ],
    vehicleMovements: [
      {
        id: 'vm-seed-1',
        exerciseId,
        vehicleId: 'v-01',
        purpose: 'Vjezba - dovoz opreme',
        departedAt: D('18:25'),
        departedBy: 'm-03',
        returnedAt: D('19:35'),
        returnedBy: 'm-03',
      },
    ],
    activity: [
      { id: 'a-seed-7', at: D('19:40'), actorId: 'm-02', actorName: 'Ana Vukovic', kind: 'VJEZBA_ZATVORENA', summary: 'Vjezba zatvorena: Vjezba zavrsena po planu.', exerciseId },
      { id: 'a-seed-6', at: D('19:35'), actorId: 'm-03', actorName: 'Nikola Djukic', kind: 'VOZILO_VRACENO', summary: 'Vozilo NV-1 evidentirano kao vraceno.', exerciseId },
      { id: 'a-seed-5', at: D('18:25'), actorId: 'm-03', actorName: 'Nikola Djukic', kind: 'VOZILO_IZASLO', summary: 'Vozilo NV-1 evidentirano kao izaslo.', exerciseId },
      { id: 'a-seed-4', at: D('18:12'), actorId: 'm-05', actorName: 'Petar Krivokapic', kind: 'ODGOVOR_PROMIJENJEN', summary: 'Odgovor promijenjen: DOLAZIM -> DOLAZIM_KASNIJE.', exerciseId },
      { id: 'a-seed-3', at: D('18:09'), actorId: 'm-05', actorName: 'Petar Krivokapic', kind: 'ODGOVOR_DAT', summary: 'Odgovor: DOLAZIM.', exerciseId },
      { id: 'a-seed-2', at: D('18:05'), actorId: 'm-02', actorName: 'Ana Vukovic', kind: 'POZIV_POSLAT', summary: 'Poziv upucen za 6 clanova. Isporuka nije pokusana.', exerciseId },
      { id: 'a-seed-1', at: D('18:05'), actorId: 'm-02', actorName: 'Ana Vukovic', kind: 'VJEZBA_KREIRANA', summary: 'Kreirana vjezba "Vjezba: dimna komora, rad sa IDA aparatima" (VJEZBA).', exerciseId },
    ],
  };
}

export function createSeedState(): AppState {
  const history = seededHistory();
  return {
    schemaVersion: SCHEMA_VERSION,
    members: MEMBERS.map((m) => ({ ...m, specialties: [...m.specialties], groupIds: [...m.groupIds] })),
    groups: GROUPS.map((g) => ({ ...g, memberIds: [...g.memberIds] })),
    vehicles: VEHICLES.map((v) => ({ ...v })),
    ...history,
    // The demonstration starts as the duty officer, because that is the screen
    // the application is for.
    simulation: { actorId: 'm-02', viewRole: 'DEZURNI' },
    appliedCommandIds: [],
  };
}
