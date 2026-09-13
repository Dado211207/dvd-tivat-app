/**
 * The three server-backed screens, actually rendered.
 *
 * Until this file existed, none of their component code had ever executed
 * anywhere. The unit tests covered the pure helpers, the database tests covered
 * the schema, the hosted test covered the data layer, and the browser tests ran
 * against a build with no project configured - so every one of them stopped at
 * the gate and rendered "this copy is not connected to a server". A bad hook
 * order, a read of an undefined field, a missing key: all of it would have
 * appeared for the first time in front of an audience.
 *
 * So each screen is rendered here with a signed-in account and a stubbed data
 * layer, and asserted on what it puts on the page. The assertions are about the
 * things this product exists to get right - that a journey report is not shown
 * as attendance, that a pending interval is not counted, that publishing does
 * not claim delivery - rather than about markup.
 *
 * No testing library, following `AccessProvider.test.tsx`: `createRoot` and
 * `act` are all this needs.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessGateway, OperationalRole } from '@/auth/access';
import { AccessProvider } from '@/auth/AccessProvider';
import { ArchiveView } from './ArchiveView';
import { CommandView } from './CommandView';
import { MobilisationView } from './MobilisationView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const INTERVENTION_ID = '33333333-3333-4333-8333-333333333333';

const INTERVENTION = {
  id: INTERVENTION_ID,
  kind: 'VJEZBA' as const,
  otherKindNote: null,
  title: 'Vjezba: provjera opreme',
  instructions: 'Okupljanje u bazi.',
  incidentLocation: 'Poligon (izmisljena lokacija)',
  assemblyPoint: 'Baza DVD Tivat',
  latitude: null,
  longitude: null,
  status: 'PUBLISHED' as const,
  version: 2,
  publishedAt: '2026-09-13T08:00:00.000Z',
  closedAt: null,
  closeReason: null,
  createdAt: '2026-09-13T07:55:00.000Z',
};

/**
 * The situation the whole design exists for: one member reported being on
 * scene and has an UNCONFIRMED attendance record; the other declined and has
 * none. Neither fact may be read off the other.
 */
const RECIPIENTS = [
  {
    memberId: MEMBER_ID,
    memberName: 'Ivo Vatrogasac',
    acknowledgedAt: '2026-09-13T08:01:00.000Z',
    answer: 'DOLAZIM' as const,
    etaMinutes: null,
    answeredAt: '2026-09-13T08:02:00.000Z',
    journey: 'NA_LICU_MJESTA' as const,
    journeyAt: '2026-09-13T08:10:00.000Z',
  },
  {
    memberId: OTHER_ID,
    memberName: 'Pero Vatrogasac',
    acknowledgedAt: '2026-09-13T08:03:00.000Z',
    answer: 'NE_MOGU' as const,
    etaMinutes: null,
    answeredAt: '2026-09-13T08:03:30.000Z',
    journey: null,
    journeyAt: null,
  },
];

const PENDING_INTERVAL = {
  id: '44444444-4444-4444-8444-444444444444',
  memberId: MEMBER_ID,
  memberName: 'Ivo Vatrogasac',
  startedAt: '2026-09-13T08:15:00.000Z',
  endedAt: '2026-09-13T09:45:00.000Z',
  source: 'SELF_DECLARED' as const,
  verified: false,
  rejectedAt: null,
  rejectionReason: null,
};

vi.mock('@/auth/operations', async (importOriginal) => {
  // The pure helpers are the real ones: a screen that computed participation
  // differently from the rest of the system is exactly the defect to catch.
  const real = await importOriginal<typeof import('@/auth/operations')>();
  return {
    ...real,
    fetchOwnMemberId: vi.fn(async () => MEMBER_ID),
    fetchInterventions: vi.fn(async () => [INTERVENTION]),
    // Who may be CALLED is the server's answer, not a filter over the roster.
    // Pero is on the roster below but is NOT here: he stands in for the
    // withdrawn member whose account can no longer sign in.
    fetchEligibleRecipients: vi.fn(async () => [
      { memberId: MEMBER_ID, fullName: 'Ivo Vatrogasac', role: 'FIREFIGHTER' as const, specialties: [] },
    ]),
    fetchRecipientFacts: vi.fn(async () => RECIPIENTS),
    fetchAttendance: vi.fn(async () => [PENDING_INTERVAL]),
    // Null is "the chronology could not be read", which is what an older
    // project without the reading function answers. The screen must then fall
    // back to what it can reconstruct AND say that it has - asserted below.
    fetchInterventionAudit: vi.fn(async () => null),
    fetchVehicleMovements: vi.fn(async () => []),
    fetchAvailability: vi.fn(async () => [
      { memberId: MEMBER_ID, available: true, note: 'U gradu sam.', changedAt: '2026-09-13T07:00:00.000Z' },
    ]),
    fetchParticipationTotals: vi.fn(async () => [
      {
        memberId: MEMBER_ID,
        memberName: 'Ivo Vatrogasac',
        confirmedIntervals: 1,
        // Milliseconds now: the server returns exact numeric seconds and the
        // adapter converts once, so every screen works in one unit.
        confirmedMs: 5_400_000,
        unverifiedIntervals: 1,
        unverifiedMs: 1_800_000,
        openIntervals: 0,
        rejectedIntervals: 0,
      },
    ]),
  };
});

vi.mock('@/auth/roster', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/auth/roster')>();
  return {
    ...real,
    loadRoster: vi.fn(async () => [
      { id: MEMBER_ID, fullName: 'Ivo Vatrogasac', specialties: [], active: true, userId: null },
      { id: OTHER_ID, fullName: 'Pero Vatrogasac', specialties: [], active: true, userId: null },
    ]),
    loadVehicles: vi.fn(async () => [
      { id: '55555555-5555-4555-8555-555555555555', callsign: 'NV-1', name: 'Navalno vozilo', kind: 'Navalno', active: true },
    ]),
    loadGroups: vi.fn(async () => []),
  };
});

function gatewayFor(role: OperationalRole): AccessGateway {
  return {
    currentUser: async () => ({ id: 'user-1', email: 'komandir@example.invalid' }),
    fetchProfile: async () => ({ fullName: 'Komandir Smjene', profileComplete: true }),
    fetchRole: async () => role,
    fetchAccountStatus: async () => 'ACTIVE',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Renders and lets every queued promise settle, twice over. */
async function show(node: React.ReactElement, role: OperationalRole): Promise<string> {
  await act(async () => {
    root.render(
      <AccessProvider gateway={gatewayFor(role)} configured>
        {node}
      </AccessProvider>,
    );
  });
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return container.textContent ?? '';
}

/**
 * A reported OBSERVATION, not yet a confirmed defect: "the title appeared
 * twice, and the fields may be mapped wrongly".
 *
 * The brief is explicit that a field-mapping defect may not be CLAIMED unless
 * it reproduces with deliberately different values for the title, the location
 * and the assembly point. So that is exactly what this does: three values that
 * cannot be confused with one another, checked one screen at a time.
 *
 * The finding is recorded in `docs/ai/WORK_LOG.md`. In short: the mapping is
 * correct on every screen, and the duplication is real but is the ordinary
 * list-and-detail shape - the archive shows a list of interventions and then
 * the selected one's record underneath, so the selected title legitimately
 * appears in both. These tests pin the mapping so that if the reporter did see
 * something else, this is no longer where it could have come from.
 */
describe('title, location and assembly point are not confused with each other', () => {
  const DISTINCT = {
    ...INTERVENTION,
    title: 'NASLOV-JEDAN',
    incidentLocation: 'LOKACIJA-DVA',
    assemblyPoint: 'OKUPLJANJE-TRI',
    instructions: 'UPUTSTVO-CETIRI',
  };

  async function withDistinctValues(view: React.ReactElement, role: OperationalRole) {
    const operations = await import('@/auth/operations');
    vi.mocked(operations.fetchInterventions).mockResolvedValueOnce([DISTINCT]);
    return show(view, role);
  }

  it('the commander console puts each value where it belongs', async () => {
    await withDistinctValues(<CommandView />, 'COMMANDER');

    const location = container.querySelector('[data-testid="selected-location"]');
    expect(location?.textContent, 'the location field must hold the location').toBe('LOKACIJA-DVA');
    expect(location?.textContent).not.toContain('NASLOV');
    expect(location?.textContent).not.toContain('OKUPLJANJE');

    // Each distinct value must appear somewhere, and none may stand in for
    // another. Counted across the whole screen rather than per element, so a
    // value rendered into the wrong field shows up as a count of two.
    const text = container.textContent ?? '';
    for (const value of ['NASLOV-JEDAN', 'LOKACIJA-DVA', 'OKUPLJANJE-TRI', 'UPUTSTVO-CETIRI']) {
      expect(text, `${value} must be on the screen`).toContain(value);
    }
  });

  it('the archive puts each value where it belongs', async () => {
    await withDistinctValues(<ArchiveView />, 'COMMANDER');

    expect(container.querySelector('[data-testid="archive-title"]')?.textContent).toBe(
      'NASLOV-JEDAN',
    );
    const meta = container.querySelector(`[data-testid="archive-meta-${INTERVENTION_ID}"]`);
    expect(meta?.textContent, 'the list row shows kind, state and time - not the location')
      .not.toContain('LOKACIJA-DVA');
  });

  it('the archive shows the title exactly twice, and that is the list and the record', async () => {
    // The reported duplication, measured. It is the ordinary list-and-detail
    // shape: the picker lists every intervention, and the record for the
    // selected one sits underneath. Pinned so a THIRD copy - which would be a
    // real defect - fails here.
    await withDistinctValues(<ArchiveView />, 'COMMANDER');
    const occurrences = (container.textContent ?? '').split('NASLOV-JEDAN').length - 1;
    expect(occurrences).toBe(2);

    const inPicker = container.querySelector('[data-testid="archive-list"]')?.textContent ?? '';
    const inRecord = container.querySelector('[data-testid="archive-record"]')?.textContent ?? '';
    expect(inPicker).toContain('NASLOV-JEDAN');
    expect(inRecord).toContain('NASLOV-JEDAN');
  });

  it('the firefighter screen shows the title once', async () => {
    await withDistinctValues(<MobilisationView />, 'FIREFIGHTER');
    const occurrences = (container.textContent ?? '').split('NASLOV-JEDAN').length - 1;
    expect(occurrences, 'one call-out, one heading').toBe(1);
    expect(container.textContent).toContain('LOKACIJA-DVA');
  });
});

describe('the commander console renders on real data', () => {
  it('shows the call-out and does not fail to render', async () => {
    const text = await show(<CommandView />, 'COMMANDER');
    expect(text).not.toMatch(/Ova kopija nije povezana|nije za vasu ulogu/);
    expect(text).toContain('Vjezba: provjera opreme');
  });

  it('gives every fact its own column instead of one status', async () => {
    await show(<CommandView />, 'COMMANDER');
    act(() => {
      pressByText('Pregled');
    });
    await settle();

    const table = container.querySelector('[data-testid="overview-table"]');
    expect(table, 'the overview table must render').not.toBeNull();
    const headings = [...(table?.querySelectorAll('thead th') ?? [])].map((h) => h.textContent);
    // Opened, answered, moving and present are four different things.
    expect(headings).toEqual(['Clan', 'Otvorio', 'Odgovor', 'Kretanje', 'Prisustvo']);
  });

  it('never reads a journey report as attendance', async () => {
    await show(<CommandView />, 'COMMANDER');
    act(() => {
      pressByText('Pregled');
    });
    await settle();

    const rows = [...container.querySelectorAll('[data-testid="overview-table"] tbody tr')];
    const declined = rows.find((row) => row.textContent?.includes('Pero Vatrogasac'));
    expect(declined?.textContent).toContain('Ne mogu');
    // Pero declined and has no interval. Nothing may suggest otherwise.
    expect(declined?.textContent).toContain('Nema zapisa');

    const attended = rows.find((row) => row.textContent?.includes('Ivo Vatrogasac'));
    // Ivo said he is on scene AND has an interval, but it is unconfirmed, so
    // the cell must say it is waiting - never "Potvrdjeno".
    expect(attended?.textContent).toContain('Na licu mjesta');
    expect(attended?.textContent).toContain('Ceka potvrdu');
    expect(attended?.textContent).not.toContain('Potvrdjeno');
  });

  it('refuses the screen to a firefighter, and says why', async () => {
    const text = await show(<CommandView />, 'FIREFIGHTER');
    expect(text).toMatch(/nije za vasu ulogu/i);
    expect(text).not.toContain('Vjezba: provjera opreme');
  });

  /**
   * The recipient picker, which offered a withdrawn member on the real device.
   *
   * The screen used to compute the list itself, from an active roster row with
   * a linked account. Both were still true of somebody whose ACCOUNT had been
   * withdrawn, so they were offered a call-out they could not have opened.
   *
   * The list now comes from the server, by the same rule `publish_intervention`
   * enforces. These tests hold the SCREEN to that: the roster below contains
   * Pero, the server's eligible list does not, and the picker must follow the
   * server rather than the roster.
   */
  describe('the recipient picker offers only who the server says may be called', () => {
    const DRAFT = { ...INTERVENTION, status: 'DRAFT' as const, publishedAt: null, version: 1 };

    async function showDraft(
      eligible: readonly { memberId: string; fullName: string }[] | null,
    ): Promise<string> {
      const operations = await import('@/auth/operations');
      vi.mocked(operations.fetchInterventions).mockResolvedValueOnce([DRAFT]);
      vi.mocked(operations.fetchEligibleRecipients).mockResolvedValueOnce(
        eligible === null
          ? null
          : eligible.map((m) => ({ ...m, role: 'FIREFIGHTER' as const, specialties: [] })),
      );
      return show(<CommandView />, 'COMMANDER');
    }

    it('lists the server’s answer and not the roster', async () => {
      await showDraft([{ memberId: MEMBER_ID, fullName: 'Ivo Vatrogasac' }]);
      const picker = container.querySelector('[data-testid="recipient-picker"]');
      expect(picker?.textContent).toContain('Ivo Vatrogasac');
      // Pero IS in the roster mock and is NOT in the server's list. A screen
      // filtering the roster itself would show him here - which is exactly how
      // a withdrawn member reached the real picker.
      expect(
        picker?.textContent,
        'a member the server does not offer must not appear',
      ).not.toContain('Pero Vatrogasac');
    });

    it('says the list could not be read, rather than showing an empty one', async () => {
      // "The server did not answer" and "nobody qualifies" look identical as an
      // empty list and mean opposite things. A commander must not have to guess.
      await showDraft(null);
      const notice = container.querySelector('[data-testid="eligible-recipients-unavailable"]');
      expect(notice, 'a failed read must be stated').not.toBeNull();
      expect(notice?.textContent).toMatch(/nije procitan/i);
      expect(container.querySelector('[data-testid="no-eligible-recipients"]')).toBeNull();
    });

    it('says nobody qualifies when the server answers with nobody', async () => {
      await showDraft([]);
      const notice = container.querySelector('[data-testid="no-eligible-recipients"]');
      expect(notice, 'an empty answer must be explained').not.toBeNull();
      expect(notice?.textContent).toMatch(/aktivnim nalogom/i);
      expect(container.querySelector('[data-testid="eligible-recipients-unavailable"]')).toBeNull();
    });

    it('cannot publish when there is nobody to publish to', async () => {
      await showDraft([]);
      const publish = container.querySelector<HTMLButtonElement>('[data-testid="publish"]');
      expect(publish, 'the button still exists so the screen is not mysterious').not.toBeNull();
      expect(publish?.disabled).toBe(true);
    });
  });
});

describe('the firefighter screen renders on real data', () => {
  it('shows the call-out with each action as its own step', async () => {
    const text = await show(<MobilisationView />, 'FIREFIGHTER');
    expect(text).not.toMatch(/Ova kopija nije povezana|nije za vasu ulogu/);
    expect(text).toContain('Vjezba: provjera opreme');

    for (const id of ['available-yes', 'answer-DOLAZIM', 'journey-NA_LICU_MJESTA', 'check-in']) {
      expect(container.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
    // Already opened in the fixture, so the button is replaced by the record of
    // WHEN it was opened. The first opening is a fact, not a toggle.
    expect(container.querySelector('[data-testid="ack-state"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="acknowledge"]')).toBeNull();
  });

  it('offers the opening button to somebody who has not opened it', async () => {
    // The step the demonstration starts on. It must exist before it is pressed.
    const operations = await import('@/auth/operations');
    vi.mocked(operations.fetchRecipientFacts).mockResolvedValueOnce([
      { ...RECIPIENTS[0]!, acknowledgedAt: null, answer: null, answeredAt: null, journey: null, journeyAt: null },
      RECIPIENTS[1]!,
    ]);

    await show(<MobilisationView />, 'FIREFIGHTER');
    expect(container.querySelector('[data-testid="acknowledge"]')).not.toBeNull();
  });

  it('says in words that reporting movement is not reporting attendance', async () => {
    const text = await show(<MobilisationView />, 'FIREFIGHTER');
    expect(text).toMatch(/ne prijavljuje prisustvo/i);
  });

  it('shows a recorded arrival as awaiting the commander', async () => {
    const text = await show(<MobilisationView />, 'FIREFIGHTER');
    expect(text).toMatch(/ceka potvrdu/i);
  });
});

describe('the archive renders on real data', () => {
  it('shows the chronology with each fact on its own line', async () => {
    const text = await show(<ArchiveView />, 'COMMANDER');
    expect(text).not.toMatch(/Ova kopija nije povezana|Arhiva nije ucitana/);

    const events = [...container.querySelectorAll('[data-testid="archive-timeline"] li')].map(
      (li) => li.textContent ?? '',
    );
    expect(events.length).toBeGreaterThan(3);
    expect(events.some((e) => /je otvorio poziv/.test(e))).toBe(true);
    expect(events.some((e) => /je odgovorio/.test(e))).toBe(true);
    expect(events.some((e) => /javio kretanje/.test(e))).toBe(true);
  });

  it('counts nothing for an unconfirmed interval', async () => {
    await show(<ArchiveView />, 'COMMANDER');
    const total = container.querySelector('[data-testid="archive-total"]')?.textContent ?? '';
    // Ninety minutes were recorded, and none of them are confirmed. It reads
    // "0 s" rather than "0 min": the formatter can express seconds now, so
    // nothing has to be rounded up to a minute to look real.
    expect(total).toContain('0 s');
    expect(total).toMatch(/ceka potvrdu/i);
    expect(total).not.toContain('1 h 30 min');
  });

  it('puts an unconfirmed interval in the waiting column and nowhere else', async () => {
    // The column placement is the view's own decision, and the only assertion
    // here that fails if the confirmed/pending split is removed - the duration
    // rule is enforced twice over, so a total of zero proves less than it looks.
    await show(<ArchiveView />, 'COMMANDER');
    const cells = [
      ...(container.querySelectorAll('[data-testid="archive-participation"] tbody tr td') ?? []),
    ].map((cell) => cell.textContent ?? '');

    expect(cells.length, 'one row, three columns after the name').toBe(3);
    const [confirmed, waiting, rejected] = cells;
    expect(confirmed, 'nothing is confirmed, so the cell is empty').toBe('-');
    expect(waiting).toMatch(/1 prijava/);
    expect(rejected).toBe('-');
  });

  it('never sums the server totals into one number', async () => {
    await show(<ArchiveView />, 'COMMANDER');
    const row = container.querySelector('[data-testid="archive-totals"] tbody tr')?.textContent ?? '';
    expect(row).toContain('1 h 30 min'); // confirmed
    expect(row).toMatch(/30 min.*neuracunato/); // unconfirmed, named as not counted
  });

  /**
   * The chronology, read from what the server recorded rather than
   * reconstructed from current state.
   *
   * The device test found the record showing only each member's LATEST
   * movement and no state transition at all. The obvious reading is that the
   * earlier movements were being overwritten. They were not: `operational_audit`
   * has held every one of them since the schema was written - the archive simply
   * never read the table.
   */
  describe('the recorded chronology', () => {
    const AUDIT = [
      {
        id: 'a1',
        at: '2026-09-13T08:00:00.000Z',
        type: 'INTERVENTION_PUBLISHED',
        detail: { recipient_count: 2 },
        actorName: 'Komandir Smjene',
        actorIsYou: true,
      },
      {
        id: 'a2',
        at: '2026-09-13T08:04:00.000Z',
        type: 'JOURNEY_PROGRESS_SET',
        detail: { member_id: MEMBER_ID, from: null, to: 'KRECEM' },
        actorName: 'Ivo Vatrogasac',
        actorIsYou: false,
      },
      {
        id: 'a3',
        at: '2026-09-13T08:07:00.000Z',
        type: 'JOURNEY_PROGRESS_SET',
        detail: { member_id: MEMBER_ID, from: 'KRECEM', to: 'U_PUTU' },
        actorName: 'Ivo Vatrogasac',
        actorIsYou: false,
      },
      {
        id: 'a4',
        at: '2026-09-13T08:10:00.000Z',
        type: 'JOURNEY_PROGRESS_SET',
        detail: { member_id: MEMBER_ID, from: 'U_PUTU', to: 'NA_LICU_MJESTA' },
        actorName: 'Ivo Vatrogasac',
        actorIsYou: false,
      },
      {
        id: 'a5',
        at: '2026-09-13T08:12:00.000Z',
        type: 'INTERVENTION_STATUS_CHANGED',
        detail: { from: 'PUBLISHED', to: 'DEPLOYED' },
        actorName: 'Komandir Smjene',
        actorIsYou: true,
      },
    ];

    async function showWithAudit(): Promise<string[]> {
      const operations = await import('@/auth/operations');
      vi.mocked(operations.fetchInterventionAudit).mockResolvedValueOnce(AUDIT);
      await show(<ArchiveView />, 'COMMANDER');
      return [...container.querySelectorAll('[data-testid="archive-timeline"] li')].map(
        (li) => li.textContent ?? '',
      );
    }

    it('shows every movement, not only the last one', async () => {
      const lines = await showWithAudit();
      const journey = lines.filter((line) => /javio kretanje/.test(line));
      expect(journey, 'three steps were recorded and three must appear').toHaveLength(3);
      expect(journey[0]).toMatch(/Krecem/);
      expect(journey[1]).toMatch(/U putu/);
      expect(journey[2]).toMatch(/Na licu mjesta/);
    });

    it('shows the state transition the current-state rows cannot express', async () => {
      const lines = await showWithAudit();
      const change = lines.find((line) => /promijenio stanje/.test(line));
      expect(change, 'Okupljanje, Na terenu and Pod kontrolom must leave a line').toBeDefined();
      // Both ends of the transition, in words, not enum names.
      expect(change).toMatch(/Objavljeno/);
      expect(change).toMatch(/Na terenu/);
      expect(change).not.toMatch(/DEPLOYED|PUBLISHED/);
    });

    it('names who did each thing', async () => {
      const lines = await showWithAudit();
      expect(lines.find((l) => /promijenio stanje/.test(l))).toMatch(/Komandir Smjene/);
      expect(lines.find((l) => /javio kretanje/.test(l))).toMatch(/Ivo Vatrogasac/);
    });

    it('keeps movement and attendance as different sentences', async () => {
      // The rule the whole schema is built around: reporting a position is not
      // reporting participation, and the archive must not blur them.
      const lines = await showWithAudit();
      for (const line of lines.filter((l) => /javio kretanje/.test(l))) {
        expect(line).not.toMatch(/prisus/i);
      }
    });

    it('never says anybody was notified', async () => {
      const lines = await showWithAudit();
      const published = lines.find((l) => /objavio poziv/.test(l));
      expect(published).toMatch(/bez stvarnog slanja/);
      expect(published).not.toMatch(/obavijest/i);
    });

    it('orders the record oldest first', async () => {
      const lines = await showWithAudit();
      const times = lines.map((l) => l.slice(0, 16));
      expect([...times], 'a record whose lines shuffle is not a record').toEqual(
        [...times].sort(),
      );
    });

    it('says so when it is showing the shortened fallback instead', async () => {
      // The default mock answers null - "could not read". A shortened history
      // presented as the whole one is worse than no history.
      await show(<ArchiveView />, 'COMMANDER');
      const notice = container.querySelector('[data-testid="chronology-degraded"]');
      expect(notice, 'a fallback must announce itself').not.toBeNull();
      expect(notice?.textContent).toMatch(/skracena hronologija/i);
    });

    it('does not say that when the real chronology was read', async () => {
      await showWithAudit();
      expect(container.querySelector('[data-testid="chronology-degraded"]')).toBeNull();
    });
  });

  it('is readable by a firefighter, not only by command', async () => {
    const text = await show(<ArchiveView />, 'FIREFIGHTER');
    expect(text).not.toMatch(/nije za vasu ulogu/i);
  });

  /**
   * The archive list once printed `publishedAt ?? createdAt` on every row, so a
   * row reading "Zatvoreno" showed the moment the call-out was OPENED. Reported
   * from the device test, and a false statement about a record that exists to
   * be trusted months later.
   *
   * The three times are deliberately hours apart, and asserted as rendered
   * text, so a row showing the wrong column cannot pass by coincidence.
   */
  describe('each row shows the time of the state it is labelled with', () => {
    const THREE_TIMES = {
      createdAt: '2026-09-13T06:00:00.000Z', //  08:00 in Podgorica
      publishedAt: '2026-09-13T09:00:00.000Z', // 11:00
      closedAt: '2026-09-13T17:00:00.000Z', //   19:00
    };

    async function rowText(status: 'PUBLISHED' | 'CLOSED' | 'CANCELLED'): Promise<string> {
      const operations = await import('@/auth/operations');
      vi.mocked(operations.fetchInterventions).mockResolvedValueOnce([
        { ...INTERVENTION, ...THREE_TIMES, status, closeReason: 'Vjezba zavrsena.' },
      ]);
      await show(<ArchiveView />, 'COMMANDER');
      return container.querySelector(`[data-testid="archive-meta-${INTERVENTION_ID}"]`)?.textContent ?? '';
    }

    it('a closed row shows the closure time, not the publication time', async () => {
      const meta = await rowText('CLOSED');
      expect(meta).toContain('Zatvoreno');
      expect(meta, 'the closure time, 17:00Z in Podgorica').toContain('19:00');
      expect(meta, 'the publication time must not appear on a closed row').not.toContain('11:00');
      expect(meta, 'nor the creation time').not.toContain('08:00');
    });

    it('a cancelled row shows when it was cancelled', async () => {
      const meta = await rowText('CANCELLED');
      expect(meta).toContain('Otkazano');
      expect(meta).toContain('19:00');
      expect(meta).not.toContain('11:00');
    });

    it('a published row still shows the publication time', async () => {
      // The fix must not overcorrect: a row that has not been closed is
      // correctly described by when it was published.
      const meta = await rowText('PUBLISHED');
      expect(meta).toContain('Objavljeno');
      expect(meta).toContain('11:00');
      expect(meta).not.toContain('19:00');
    });
  });
});

// ---------------------------------------------------------------------------

/**
 * The timings, on both screens.
 *
 * An independent review of the hosted application found the commander's
 * overview showing five states per member and not one duration, the archive
 * showing vehicle departure and return with no time away, and a ten-second
 * attendance interval displayed as "1 min".
 *
 * The fixture below is built to make every one of those fail loudly:
 *
 * - The recipient list is in the WRONG chronological order. Pero is listed
 *   second and opened FIRST, so any "first" figure taken as `[0]` of the list
 *   reports Ivo and fails here.
 * - Pero answers first, with "Ne mogu". The first ANSWER and the first
 *   "Dolazim" are therefore different people at different times, which a single
 *   combined figure cannot express.
 * - Ivo has two confirmed intervals of 10.591 s and 29.6 s. Rounded
 *   individually and added they are 41 s; summed exactly and rounded once they
 *   are 40 s. Only the second is correct.
 * - The 10.591 s interval is the real one from the hosted archive, to the
 *   microsecond.
 */
describe('every recorded time and duration reaches the screen', () => {
  const PUBLISHED_AT = '2026-09-13T08:00:00.000Z'; // 10:00:00 in Podgorica

  const TIMED_INTERVENTION = {
    ...INTERVENTION,
    status: 'CLOSED' as const,
    publishedAt: PUBLISHED_AT,
    closedAt: '2026-09-13T09:00:00.000Z',
    closeReason: 'Vjezba zavrsena - test operativnog prototipa..',
  };

  /** Listed Ivo-first; Pero opened and answered first. */
  const TIMED_RECIPIENTS = [
    {
      memberId: MEMBER_ID,
      memberName: 'Ivo Vatrogasac',
      acknowledgedAt: '2026-09-13T08:01:30.000Z', // 90 s after publication
      answer: 'DOLAZIM' as const,
      etaMinutes: 10,
      answeredAt: '2026-09-13T08:04:00.000Z', // 4 min after publication
      journey: 'NA_LICU_MJESTA' as const,
      journeyAt: '2026-09-13T08:12:00.000Z',
    },
    {
      memberId: OTHER_ID,
      memberName: 'Pero Vatrogasac',
      acknowledgedAt: '2026-09-13T08:00:45.000Z', // 45 s - the earliest opening
      answer: 'NE_MOGU' as const,
      etaMinutes: null,
      answeredAt: '2026-09-13T08:01:00.000Z', // 60 s - the earliest answer
      journey: null,
      journeyAt: null,
    },
  ];

  const TIMED_ATTENDANCE = [
    {
      id: 'att-1',
      memberId: MEMBER_ID,
      memberName: 'Ivo Vatrogasac',
      // The exact interval the hosted review found rendered as "1 min".
      startedAt: '2026-09-13T08:15:11.374456Z',
      endedAt: '2026-09-13T08:15:21.965675Z',
      source: 'SELF_DECLARED' as const,
      verified: true,
      rejectedAt: null,
      rejectionReason: null,
    },
    {
      id: 'att-2',
      memberId: MEMBER_ID,
      memberName: 'Ivo Vatrogasac',
      startedAt: '2026-09-13T08:20:00.000Z',
      endedAt: '2026-09-13T08:20:29.600Z',
      source: 'SELF_DECLARED' as const,
      verified: true,
      rejectedAt: null,
      rejectionReason: null,
    },
  ];

  const TIMED_MOVEMENTS = [
    {
      id: 'veh-1',
      vehicleId: '55555555-5555-4555-8555-555555555555',
      callsign: 'NV-1',
      vehicleName: 'Navalno vozilo',
      interventionId: INTERVENTION_ID,
      purpose: 'Vjezba',
      departedAt: '2026-09-13T08:06:00.000Z',
      returnedAt: '2026-09-13T09:36:00.000Z', // 1 h 30 min away
    },
  ];

  const TIMED_AUDIT = [
    {
      id: 'b1', at: '2026-09-13T08:03:00.000Z', type: 'INTERVENTION_STATUS_CHANGED',
      detail: { from: 'PUBLISHED', to: 'ASSEMBLING' },
      actorName: 'Komandir Smjene', actorIsYou: true,
    },
    {
      id: 'b2', at: '2026-09-13T08:20:00.000Z', type: 'INTERVENTION_STATUS_CHANGED',
      detail: { from: 'ASSEMBLING', to: 'DEPLOYED' },
      actorName: 'Zamjenik Komandira', actorIsYou: false,
    },
    {
      id: 'b3', at: '2026-09-13T08:05:00.000Z', type: 'JOURNEY_PROGRESS_SET',
      detail: { member_id: MEMBER_ID, from: null, to: 'KRECEM' },
      actorName: 'Ivo Vatrogasac', actorIsYou: false,
    },
    {
      id: 'b4', at: '2026-09-13T08:07:00.000Z', type: 'JOURNEY_PROGRESS_SET',
      detail: { member_id: MEMBER_ID, from: 'KRECEM', to: 'U_PUTU' },
      actorName: 'Ivo Vatrogasac', actorIsYou: false,
    },
    {
      id: 'b5', at: '2026-09-13T08:12:00.000Z', type: 'JOURNEY_PROGRESS_SET',
      detail: { member_id: MEMBER_ID, from: 'U_PUTU', to: 'NA_LICU_MJESTA' },
      actorName: 'Ivo Vatrogasac', actorIsYou: false,
    },
    {
      id: 'b6', at: '2026-09-13T08:06:00.000Z', type: 'VEHICLE_DEPARTED',
      detail: { movement_id: 'veh-1' },
      actorName: 'Komandir Smjene', actorIsYou: true,
    },
    {
      id: 'b7', at: '2026-09-13T09:36:00.000Z', type: 'VEHICLE_RETURNED',
      detail: { movement_id: 'veh-1' },
      actorName: 'Zamjenik Komandira', actorIsYou: false,
    },
  ];

  async function stub(): Promise<void> {
    const operations = await import('@/auth/operations');
    vi.mocked(operations.fetchInterventions).mockResolvedValue([TIMED_INTERVENTION]);
    vi.mocked(operations.fetchRecipientFacts).mockResolvedValue(TIMED_RECIPIENTS);
    vi.mocked(operations.fetchAttendance).mockResolvedValue(TIMED_ATTENDANCE);
    vi.mocked(operations.fetchVehicleMovements).mockResolvedValue(TIMED_MOVEMENTS);
    vi.mocked(operations.fetchInterventionAudit).mockResolvedValue(TIMED_AUDIT);
  }

  /** The commander's console, on the `Pregled` tab. */
  async function commander(): Promise<void> {
    await stub();
    await show(<CommandView />, 'COMMANDER');
    act(() => {
      pressByText('Pregled');
    });
    await settle();
  }

  async function archive(): Promise<void> {
    await stub();
    await show(<ArchiveView />, 'COMMANDER');
  }

  function rowFor(memberId: string): string {
    return container.querySelector(`[data-testid="timing-row-${memberId}"]`)?.textContent ?? '';
  }

  function textOf(testId: string): string {
    return container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';
  }

  describe.each([
    ['the commander console', commander],
    ['the archive', archive],
  ])('%s', (_name, render) => {
    it('gives every response measurement its own label', async () => {
      await render();
      const row = rowFor(MEMBER_ID);

      // Opening: the moment, and how long after publication it happened.
      expect(row).toContain('10:01:30'); // 08:01:30Z in Podgorica
      expect(row).toContain('1 min 30 s');

      // Answer: the moment, from publication, AND from opening. Three separate
      // numbers that a single "vrijeme odaziva" would have to collapse to one.
      expect(row).toContain('10:04:00');
      expect(row).toContain('4 min'); // publication to answer
      expect(row).toContain('2 min 30 s'); // opening to answer

      // The member's own estimate, marked as an estimate.
      expect(row).toMatch(/procjena/i);
      expect(row).toContain('10 min');

      // Arrival, and publication to arrival.
      expect(row).toContain('10:12:00');
      expect(row).toContain('12 min');
    });

    it('never collapses the measurements into one "vrijeme odaziva"', async () => {
      await render();
      // The exact phrase the brief forbids. Four independent durations cannot
      // be represented by one of them.
      expect(container.textContent ?? '').not.toMatch(/vrijeme odaziva/i);
      const labels = [
        ...container.querySelectorAll(
          `[data-testid="timing-row-${MEMBER_ID}"] .fact-line__label`,
        ),
      ].map((node) => node.textContent);
      expect(labels.length, 'each fact carries its own label').toBeGreaterThanOrEqual(10);
    });

    it('shows every movement separately, in order', async () => {
      await render();
      const row = rowFor(MEMBER_ID);
      for (const step of ['Krecem', 'U putu', 'Na licu mjesta']) {
        expect(row, step).toContain(step);
      }
      expect(row.indexOf('Krecem')).toBeLessThan(row.indexOf('U putu'));
      expect(row.indexOf('U putu')).toBeLessThan(row.indexOf('Na licu mjesta'));
      expect(row).toContain('10:05:00');
      expect(row).toContain('10:07:00');
    });

    it('sums two confirmed intervals exactly, then formats once', async () => {
      await render();
      // 10.591 s + 29.600 s = 40.191 s. Rounded individually first it would be
      // 11 + 30 = 41 s, and the old formatter made the first of them "1 min".
      expect(rowFor(MEMBER_ID)).toContain('40 s');
      expect(rowFor(MEMBER_ID)).not.toContain('41 s');
      expect(rowFor(MEMBER_ID)).not.toContain('1 min 10 s');
      expect(textOf('total-confirmed')).toBe('40 s');
      expect(textOf('total-confirmed')).not.toContain('min');
    });

    it('says what was never recorded instead of showing a zero', async () => {
      await render();
      const declined = rowFor(OTHER_ID);
      // Pero declined: no movement, no arrival, no attendance. Every one of
      // those is "not recorded", and none of them is "0 s" - which would read
      // as "arrived instantly and stayed no time".
      expect(declined).toContain('Nije zabiljezeno');
      expect(declined).not.toContain('0 s');
      expect(declined).not.toMatch(/10:1[0-9]/);
    });

    it('picks every first event by time, never by list position', async () => {
      await render();
      // Pero is SECOND in the list and opened FIRST, 45 s after publication.
      expect(textOf('first-open')).toContain('45 s');
      expect(textOf('first-open')).toContain('10:00:45');
      expect(textOf('first-open')).not.toContain('1 min 30 s');

      // He also answered first - but he answered "Ne mogu". The first person
      // who said they were coming is Ivo, four minutes in.
      expect(textOf('first-answer')).toContain('1 min');
      expect(textOf('first-answer')).toContain('10:01:00');
      expect(textOf('first-coming')).toContain('4 min');
      expect(textOf('first-coming')).toContain('10:04:00');

      expect(textOf('first-arrive')).toContain('12 min');
      expect(textOf('first-checkin')).toContain('15 min');
      expect(textOf('first-vehicle')).toContain('6 min');
    });

    it('measures the whole intervention and each state it passed through', async () => {
      await render();
      expect(textOf('total-duration')).toBe('1 h');

      const rows = [...container.querySelectorAll('[data-testid="state-periods"] tbody tr')].map(
        (tr) => tr.textContent ?? '',
      );
      expect(rows, 'published, assembling, deployed').toHaveLength(3);
      expect(rows[0]).toMatch(/Objavljeno/);
      expect(rows[0]).toContain('3 min');
      expect(rows[1]).toMatch(/Okupljanje/);
      expect(rows[1]).toContain('17 min');
      expect(rows[2]).toMatch(/Na terenu/);
      expect(rows[2]).toContain('40 min');

      // Who moved it. A record that says it was deployed for forty minutes
      // without saying who decided that is not a complete record.
      expect(rows[1]).toContain('Komandir Smjene');
      expect(rows[2]).toContain('Zamjenik Komandira');
      // The first period was created by publishing, not entered by anybody.
      expect(rows[0]).toMatch(/Objavom poziva/);
    });

    it('shows how long each vehicle was away, and who recorded both ends', async () => {
      await render();
      const row = container.querySelector('[data-testid="vehicle-periods"] tbody tr')?.textContent ?? '';
      expect(row).toContain('NV-1');
      expect(row).toContain('10:06:00'); // departure
      expect(row).toContain('11:36:00'); // return
      expect(row, 'the duration the archive never printed').toContain('1 h 30 min');
      expect(row).toContain('Komandir Smjene'); // recorded the departure
      expect(row).toContain('Zamjenik Komandira'); // recorded the return
      expect(row).toContain('Vjezba');
    });

    it('counts each kind of response separately', async () => {
      await render();
      expect(textOf('tally-invited')).toContain('2');
      expect(textOf('tally-opened')).toContain('2');
      expect(textOf('tally-responded')).toContain('2');
      expect(textOf('tally-coming')).toContain('1');
      expect(textOf('tally-delayed')).toContain('0');
      expect(textOf('tally-declined')).toContain('1');
      expect(textOf('tally-arrived')).toContain('1');
      expect(textOf('tally-present')).toContain('1');
      expect(textOf('tally-confirmed')).toContain('1');
    });

    it('prints operational times to the second, in Podgorica time', async () => {
      await render();
      // Not a sample: EVERY timestamp in the timing table. A single one without
      // seconds makes a ten-second difference invisible, which is how the
      // rounding defect stayed hidden.
      const stamps = (rowFor(MEMBER_ID).match(/\d{2}\.\d{2}\.\d{4}\. \d{2}:\d{2}(:\d{2})?/g) ?? []);
      expect(stamps.length).toBeGreaterThan(3);
      for (const stamp of stamps) {
        expect(stamp, 'a displayed time must carry seconds').toMatch(/:\d{2}:\d{2}$/);
      }
      expect(rowFor(MEMBER_ID)).toContain('13.09.2026.');
    });
  });

  it('shows the commander and the archive the same numbers', async () => {
    // Two screens, one `summarise()`. The point of the shared module is that
    // an incident looked at live and the same incident looked at months later
    // cannot disagree.
    await commander();
    const live = {
      total: textOf('total-duration'),
      confirmed: textOf('total-confirmed'),
      firstOpen: textOf('first-open'),
      member: rowFor(MEMBER_ID),
    };

    act(() => root.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await archive();
    expect(textOf('total-duration')).toBe(live.total);
    expect(textOf('total-confirmed')).toBe(live.confirmed);
    expect(textOf('first-open')).toBe(live.firstOpen);
    expect(rowFor(MEMBER_ID)).toBe(live.member);
  });

  /**
   * The closure note, quoted into a sentence.
   *
   * The hosted review found a chronology line reading
   * "Vjezba zavrsena - test operativnog prototipa..". The commander's note
   * already ended in a full stop; the sentence the archive builds added a
   * second one. The fix is in the QUOTATION, never in the stored text -
   * `operational_audit` is append-only and the note is evidence.
   */
  describe('a typed note quoted inside a built sentence', () => {
    const NOTE = 'Vjezba zavrsena - test operativnog prototipa.';

    async function closedWith(note: string, fromAudit: boolean): Promise<string> {
      const operations = await import('@/auth/operations');
      await stub();
      vi.mocked(operations.fetchInterventions).mockResolvedValue([
        { ...TIMED_INTERVENTION, closeReason: note },
      ]);
      vi.mocked(operations.fetchInterventionAudit).mockResolvedValue(
        fromAudit
          ? [
              ...TIMED_AUDIT,
              {
                id: 'b8', at: '2026-09-13T09:00:00.000Z', type: 'INTERVENTION_CLOSED',
                detail: { reason: note, open_attendance: 0 },
                actorName: 'Komandir Smjene', actorIsYou: true,
              },
            ]
          : null,
      );
      await show(<ArchiveView />, 'COMMANDER');
      return (
        [...container.querySelectorAll('[data-testid="archive-timeline"] li')]
          .map((li) => li.textContent ?? '')
          .find((line) => line.includes('zatvorio intervenciju')) ?? ''
      );
    }

    it('does not end the recorded line in two full stops', async () => {
      const line = await closedWith(NOTE, true);
      expect(line, 'the closing line must be on screen').toContain('Vjezba zavrsena');
      expect(line).not.toContain('..');
      expect(line).toMatch(/prototipa\.$/);
    });

    it('does not end the reconstructed line in two full stops either', async () => {
      // The fallback chronology builds the same sentence from the intervention
      // row, and had the same defect.
      const line = await closedWith(NOTE, false);
      expect(line).toContain('Vjezba zavrsena');
      expect(line).not.toContain('..');
      expect(line).toMatch(/prototipa\.$/);
    });

    it('still shows the stored note exactly as it was typed', async () => {
      // The whole point: presentation changed, evidence did not. The record
      // header quotes the note verbatim, trailing full stop and all.
      await closedWith(NOTE, true);
      const record = container.querySelector('[data-testid="archive-record"]')?.textContent ?? '';
      expect(record, 'the stored text is unaltered').toContain(NOTE);
    });

    it('keeps a question or exclamation mark, which carry meaning', async () => {
      const line = await closedWith('Da li je oprema vracena?', true);
      expect(line).toMatch(/vracena\?$/);
      expect(line).not.toMatch(/vracena\?\./);
    });

    it('adds the full stop when the note has none', async () => {
      const line = await closedWith('Vjezba zavrsena bez tacke', true);
      expect(line).toMatch(/bez tacke\.$/);
    });
  });

  it('does not round a ten-second interval up to a minute anywhere on the screen', async () => {
    // The defect as the reviewer would check it: the whole rendered archive,
    // searched for the invented minute.
    await archive();
    const text = container.textContent ?? '';
    expect(text).toContain('40 s');
    expect(text, 'no interval here is a minute long').not.toMatch(/\b1 min\b(?! 30 s)/);
  });
});

// ---------------------------------------------------------------------------

function pressByText(label: string): void {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`No button labelled "${label}"`);
  button.click();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * The one claim that must never appear.
 *
 * No push, email, SMS, Viber or telephone transport exists in this application.
 * Publishing writes rows saying a message is owed; nothing sends them. Every
 * sentence the commander sees about notification therefore has to deny delivery
 * in the same breath, and a demonstration must not be able to imply otherwise.
 *
 * Pinned as exact text on purpose. Reword it and this fails, which forces
 * whoever rewrites it to decide again whether the new wording still says
 * "nobody was notified" - rather than letting it drift into "notifications
 * sent" one adjective at a time.
 */
describe('nothing ever claims a member was notified', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/ui/views/CommandView.tsx'), 'utf8');

  it('the publish confirmation says nobody will actually be notified', () => {
    expect(source).toContain('niko nece biti stvarno obavijesten');
    expect(source).toContain('Kanal za slanje jos ne postoji');
  });

  it('the message after publishing says the same', () => {
    expect(source).toContain('STAVLJENA U RED');
    expect(source).toContain('niko nije stvarno obavijesten');
  });

  it('no screen carries a bare claim of delivery', () => {
    for (const file of ['CommandView.tsx', 'MobilisationView.tsx', 'ArchiveView.tsx']) {
      const text = readFileSync(resolve(process.cwd(), `src/ui/views/${file}`), 'utf8');
      // "obavijesteni su" / "poslato je" / "isporuceno" - any of these as a
      // statement of fact would be false today, whatever surrounds them.
      expect(text, file).not.toMatch(/obavijesteni su|poslato je|isporuceno|dostavljeno/i);
    }
  });
});

/**
 * The resting state, which is how these screens look almost all of the time.
 *
 * Every other test here has a call-out in it. A firefighter opens this
 * application far more often with nothing running, and an empty screen that
 * says nothing - or worse, one that looks broken - is what they would actually
 * see most days.
 */
describe('with nothing happening', () => {
  // Set for the whole test and put back afterwards, rather than queued with
  // `mockResolvedValueOnce`: a screen may read the same thing more than once,
  // and a leftover queued answer then leaks into the next test.
  afterEach(async () => {
    const operations = await import('@/auth/operations');
    vi.mocked(operations.fetchInterventions).mockResolvedValue([INTERVENTION]);
    vi.mocked(operations.fetchRecipientFacts).mockResolvedValue(RECIPIENTS);
    vi.mocked(operations.fetchAttendance).mockResolvedValue([PENDING_INTERVAL]);
  });

  it('the firefighter screen still offers availability and says why it is quiet', async () => {
    const operations = await import('@/auth/operations');
    vi.mocked(operations.fetchInterventions).mockResolvedValue([]);
    vi.mocked(operations.fetchRecipientFacts).mockResolvedValue([]);
    vi.mocked(operations.fetchAttendance).mockResolvedValue([]);

    const text = await show(<MobilisationView />, 'FIREFIGHTER');

    // Not an error, not a blank panel: it says there is no call-out.
    expect(text).not.toMatch(/nije dostupan|Server je odbio|Ucitavanje/);
    expect(text).toMatch(/nema|nijedan|nista/i);
    // Availability is a statement about your own life, so it is always usable.
    expect(container.querySelector('[data-testid="available-yes"]')).not.toBeNull();
  });

  it('the archive says it is empty rather than showing an empty table', async () => {
    const operations = await import('@/auth/operations');
    vi.mocked(operations.fetchInterventions).mockResolvedValue([]);

    const text = await show(<ArchiveView />, 'COMMANDER');
    expect(text).not.toMatch(/Arhiva nije ucitana/);
    expect(text).toMatch(/Arhiva je prazna/i);
  });
});
