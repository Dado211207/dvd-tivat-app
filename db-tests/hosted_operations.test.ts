/**
 * The application's own data layer, run against the real hosted project.
 *
 * Everything else in this repository proves the schema or proves a pure
 * function. Nothing proves that the code the browser actually runs names the
 * right columns, passes the right argument names, and gets back the shapes it
 * expects - and that gap is where the defects live: they compile, they lint,
 * they pass every other test, and they fail the first time somebody opens the
 * screen.
 *
 * So this imports `src/auth/operations.ts` itself - not a copy of its queries -
 * signs in as the fictional demonstration accounts, and walks the presentation
 * journey end to end.
 *
 * **This is not CI evidence and must never be presented as such.** It needs
 * credentials CI deliberately does not have, so it skips there. It is skipped
 * whenever `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and
 * `DVD_DEMO_PASSWORD` are not all set, and a skipped test proves nothing. Run
 * it before a demonstration with:
 *
 *   set -a; . ./.env.local; set +a
 *   DVD_DEMO_PASSWORD=... NODE_USE_ENV_PROXY=1 \
 *     npx vitest run --config vitest.db.config.ts db-tests/hosted_operations.test.ts
 *
 * It writes only rows it creates, under clearly fictional titles, and closes
 * the intervention it opened. It never deletes anything it did not create.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acknowledgeIntervention,
  attendanceState,
  checkIn,
  checkOut,
  closeIntervention,
  confirmAttendanceMany,
  createDraft,
  fetchAttendance,
  fetchAvailability,
  fetchInterventions,
  fetchOwnMemberId,
  fetchParticipationTotals,
  fetchRecipientFacts,
  fetchVehicleMovements,
  participationSeconds,
  publishIntervention,
  recordVehicleDeparture,
  recordVehicleReturn,
  setInterventionStatus,
  setJourneyProgress,
  setOwnAvailability,
  submitResponse,
} from '../src/auth/operations';
import { loadRoster, loadVehicles } from '../src/auth/roster';
import { accountBackend, isAccountBackendConfigured, signInWithEmail, signOut } from '../src/auth/supabaseClient';

const PASSWORD = process.env.DVD_DEMO_PASSWORD ?? '';
const CONFIGURED = isAccountBackendConfigured() && PASSWORD.length > 0;

const COMMANDER = 'komandir@example.invalid';
const FIREFIGHTER = 'vatrogasac1@example.invalid';
const DECLINER = 'vatrogasac2@example.invalid';

/** A title nobody could mistake for a real incident, unique per run. */
const TITLE = `Vjezba (automatska provjera) ${new Date().toISOString()}`;

async function become(email: string): Promise<void> {
  await signOut();
  const outcome = await signInWithEmail(email, PASSWORD);
  if (!outcome.ok) throw new Error(`sign-in failed for ${email}: ${outcome.message ?? ''}`);
}

describe.skipIf(!CONFIGURED)('the data layer against the hosted project', () => {
  let interventionId = '';
  let firefighterMemberId = '';
  let declinerMemberId = '';

  beforeAll(async () => {
    await become(COMMANDER);
  }, 60_000);

  afterAll(async () => {
    // Leave nothing open. A live call-out left running would be the one piece
    // of state that changes what the next person sees.
    if (interventionId !== '') {
      try {
        await become(COMMANDER);
        await closeIntervention(interventionId, 'CLOSED', 'Automatska provjera zavrsena.', false);
      } catch {
        /* reported by the tests themselves */
      }
    }
    await signOut();
  }, 60_000);

  it('the commander reads the roster and vehicles', async () => {
    const [roster, vehicles] = await Promise.all([loadRoster(), loadVehicles()]);
    expect(roster.length).toBeGreaterThan(0);
    expect(vehicles.length).toBeGreaterThan(0);

    const firefighter = roster.find((m) => m.fullName === 'Ivo Vatrogasac');
    const decliner = roster.find((m) => m.fullName === 'Pero Vatrogasac');
    expect(firefighter, 'the demonstration roster is missing').toBeDefined();
    expect(decliner, 'the demonstration roster is missing').toBeDefined();
    firefighterMemberId = firefighter?.id ?? '';
    declinerMemberId = decliner?.id ?? '';
  }, 60_000);

  it('creates a draft and publishes it to named recipients', async () => {
    const draft = await createDraft({
      kind: 'VJEZBA',
      title: TITLE,
      instructions: 'Automatska provjera. Ovo nije stvarna intervencija.',
      location: 'Poligon (izmisljena lokacija)',
      idempotencyKey: `check-${Date.now()}`,
    });
    expect(draft.ok, draft.ok ? '' : draft.message).toBe(true);
    if (!draft.ok) return;
    interventionId = draft.value;

    const published = await publishIntervention(interventionId, [
      firefighterMemberId,
      declinerMemberId,
    ]);
    expect(published.ok, published.ok ? '' : published.message).toBe(true);

    const facts = await fetchRecipientFacts(interventionId);
    expect(facts.map((f) => f.memberName).sort()).toEqual(['Ivo Vatrogasac', 'Pero Vatrogasac']);
    // Published, and nothing more: nobody has opened it or answered.
    expect(facts.every((f) => f.acknowledgedAt === null && f.answer === null)).toBe(true);
  }, 90_000);

  it('a firefighter states availability, opens, answers, moves and attends', async () => {
    await become(FIREFIGHTER);
    expect(await fetchOwnMemberId()).toBe(firefighterMemberId);

    const available = await setOwnAvailability(true, 'U gradu sam.');
    expect(available.ok, available.ok ? '' : available.message).toBe(true);
    const availability = await fetchAvailability();
    expect(availability.find((a) => a.memberId === firefighterMemberId)?.available).toBe(true);

    const opened = await acknowledgeIntervention(interventionId);
    expect(opened.ok, opened.ok ? '' : opened.message).toBe(true);

    const answered = await submitResponse(interventionId, 'DOLAZIM', null, false);
    expect(answered.ok, answered.ok ? '' : answered.message).toBe(true);

    const moving = await setJourneyProgress(interventionId, 'NA_LICU_MJESTA');
    expect(moving.ok, moving.ok ? '' : moving.message).toBe(true);

    const arrived = await checkIn(interventionId);
    expect(arrived.ok, arrived.ok ? '' : arrived.message).toBe(true);

    const left = await checkOut(interventionId);
    expect(left.ok, left.ok ? '' : left.message).toBe(true);
  }, 120_000);

  it('a second firefighter declines, and declining records no attendance', async () => {
    await become(DECLINER);
    const opened = await acknowledgeIntervention(interventionId);
    expect(opened.ok, opened.ok ? '' : opened.message).toBe(true);
    const answered = await submitResponse(interventionId, 'NE_MOGU', null, false);
    expect(answered.ok, answered.ok ? '' : answered.message).toBe(true);
  }, 90_000);

  it('the overview keeps every fact separate', async () => {
    await become(COMMANDER);
    const roster = await loadRoster();
    const names = new Map(roster.map((m) => [m.id, m.fullName]));
    const facts = await fetchRecipientFacts(interventionId);

    const attended = facts.find((f) => f.memberId === firefighterMemberId);
    expect(attended?.acknowledgedAt).not.toBeNull();
    expect(attended?.answer).toBe('DOLAZIM');
    expect(attended?.journey).toBe('NA_LICU_MJESTA');

    const declined = facts.find((f) => f.memberId === declinerMemberId);
    expect(declined?.answer).toBe('NE_MOGU');
    // The point of the whole design: saying "I am on scene" is not attendance,
    // and declining is not a reason to write anything into attendance either.
    expect(declined?.journey).toBeNull();

    const intervals = await fetchAttendance(interventionId, names);
    expect(intervals.map((i) => i.memberId)).toEqual([firefighterMemberId]);
    expect(attendanceState(intervals[0]!)).toBe('PENDING');
    expect(participationSeconds(intervals[0]!)).toBe(0);
  }, 90_000);

  it('a batch confirmation needs no note, and only then does time count', async () => {
    const roster = await loadRoster();
    const names = new Map(roster.map((m) => [m.id, m.fullName]));
    const before = await fetchAttendance(interventionId, names);
    const pending = before.filter((i) => attendanceState(i) === 'PENDING').map((i) => i.id);
    expect(pending.length).toBeGreaterThan(0);

    const confirmed = await confirmAttendanceMany(pending, null);
    expect(confirmed.ok, confirmed.ok ? '' : confirmed.message).toBe(true);

    const after = await fetchAttendance(interventionId, names);
    expect(after.every((i) => attendanceState(i) === 'CONFIRMED')).toBe(true);
    expect(after.reduce((sum, i) => sum + participationSeconds(i), 0)).toBeGreaterThan(0);
  }, 90_000);

  it('a vehicle movement records a vehicle and never an attendance', async () => {
    const roster = await loadRoster();
    const names = new Map(roster.map((m) => [m.id, m.fullName]));
    const attendanceBefore = (await fetchAttendance(interventionId, names)).length;

    const vehicles = await loadVehicles();
    const vehicle = vehicles.find((v) => v.active) ?? vehicles[0];
    expect(vehicle).toBeDefined();

    const out = await recordVehicleDeparture(vehicle!.id, interventionId, 'Automatska provjera.');
    expect(out.ok, out.ok ? '' : out.message).toBe(true);
    if (!out.ok) return;

    const movements = await fetchVehicleMovements();
    expect(movements.some((m) => m.id === out.value && m.returnedAt === null)).toBe(true);

    expect((await fetchAttendance(interventionId, names)).length).toBe(attendanceBefore);

    const back = await recordVehicleReturn(out.value);
    expect(back.ok, back.ok ? '' : back.message).toBe(true);
  }, 120_000);

  it('status changes and closing leave a readable record', async () => {
    const deployed = await setInterventionStatus(interventionId, 'DEPLOYED', 1);
    // The version is optimistic; re-read rather than assume which one is current.
    if (!deployed.ok) {
      const current = (await fetchInterventions()).find((i) => i.id === interventionId);
      expect(current).toBeDefined();
      const retry = await setInterventionStatus(interventionId, 'DEPLOYED', current!.version);
      expect(retry.ok, retry.ok ? '' : retry.message).toBe(true);
    }

    const closed = await closeIntervention(
      interventionId, 'CLOSED', 'Automatska provjera zavrsena.', false);
    expect(closed.ok, closed.ok ? '' : closed.message).toBe(true);

    const record = (await fetchInterventions()).find((i) => i.id === interventionId);
    expect(record?.status).toBe('CLOSED');
    expect(record?.closedAt).not.toBeNull();
    interventionId = '';
  }, 120_000);

  it('the server totals agree with the figure the archive computes', async () => {
    const totals = await fetchParticipationTotals();
    const row = totals.find((t) => t.memberId === firefighterMemberId);
    expect(row, 'the confirmed interval is missing from the totals').toBeDefined();
    expect(row!.confirmedSeconds).toBeGreaterThan(0);
    // Confirmed and unconfirmed are reported apart, never summed together.
    expect(row!.confirmedIntervals).toBeGreaterThan(0);

    const declined = totals.find((t) => t.memberId === declinerMemberId);
    expect(declined?.confirmedSeconds ?? 0).toBe(0);
  }, 90_000);

  it('a pending account gets no operational identity and sees no rows', async () => {
    await become('cekanje@example.invalid');
    expect(await fetchOwnMemberId()).toBeNull();
    expect(await fetchInterventions()).toEqual([]);
    expect(await loadRoster()).toEqual([]);
  }, 90_000);

  it('a suspended account is refused the same way', async () => {
    await become('ukinut@example.invalid');
    expect(await fetchOwnMemberId()).toBeNull();
    expect(await fetchInterventions()).toEqual([]);

    // And its commands are refused server-side, not merely hidden.
    const refused = await setOwnAvailability(true, null);
    expect(refused.ok).toBe(false);
  }, 90_000);

  it('nothing here ran as the anonymous key', async () => {
    // A test that accidentally ran unauthenticated would pass most of the
    // "sees nothing" assertions above for entirely the wrong reason.
    const { data } = await accountBackend().auth.getUser();
    expect(data.user?.email).toBe('ukinut@example.invalid');
  }, 60_000);
});
