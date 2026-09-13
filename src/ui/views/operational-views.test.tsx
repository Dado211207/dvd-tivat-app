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
    fetchRecipientFacts: vi.fn(async () => RECIPIENTS),
    fetchAttendance: vi.fn(async () => [PENDING_INTERVAL]),
    fetchVehicleMovements: vi.fn(async () => []),
    fetchAvailability: vi.fn(async () => [
      { memberId: MEMBER_ID, available: true, note: 'U gradu sam.', changedAt: '2026-09-13T07:00:00.000Z' },
    ]),
    fetchParticipationTotals: vi.fn(async () => [
      {
        memberId: MEMBER_ID,
        memberName: 'Ivo Vatrogasac',
        confirmedIntervals: 1,
        confirmedSeconds: 5400,
        unverifiedIntervals: 1,
        unverifiedSeconds: 1800,
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
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return container.textContent ?? '';
}

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
    // Ninety minutes were recorded, and none of them are confirmed.
    expect(total).toContain('0 min');
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

  it('is readable by a firefighter, not only by command', async () => {
    const text = await show(<ArchiveView />, 'FIREFIGHTER');
    expect(text).not.toMatch(/nije za vasu ulogu/i);
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
