/**
 * The firefighter's screen: my availability, and the call-outs addressed to me.
 *
 * Designed for one hand, in the dark, in a hurry. The call-out's operational
 * detail is at the top because that is what somebody woken at 03:00 needs
 * first - what, where, and where to gather - and the actions are large targets
 * below it.
 *
 * **Every button here writes exactly one fact.** Opening is not answering.
 * Answering is not setting off. Setting off is not arriving. Arriving is not
 * attendance. Attendance is not confirmed attendance. The screen shows all of
 * them at once, separately, so a member can see what they have and have not
 * told the commander - and so nothing the member taps can quietly assert
 * something they did not mean.
 *
 * In particular, `Na licu mjesta` does NOT check anybody in. Check-in is its
 * own button, and even then it produces a record marked "prijavio se sam" that
 * a commander must confirm before it counts as participation. That chain is the
 * whole point of the schema and the screen states it in plain words rather than
 * implying it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acknowledgeIntervention,
  attendanceState,
  checkIn,
  checkOut,
  ETA_BANDS,
  fetchAttendance,
  fetchAvailability,
  fetchInterventions,
  fetchRecipientFacts,
  formatDuration,
  isOpenStatus,
  JOURNEY_STEPS,
  participationSeconds,
  setJourneyProgress,
  setOwnAvailability,
  submitResponse,
  type AttendanceInterval,
  type Intervention,
  type JourneyStep,
  type RecipientFacts,
  type ResponseAnswer,
} from '@/auth/operations';
import { loadRoster } from '@/auth/roster';
import { OperationalGate, type OperationalContext } from '../components/OperationalGate';
import { Chip, EmptyState, Field, Notice } from '../components/primitives';
import {
  ATTENDANCE_SOURCE_LABEL,
  INTERVENTION_KIND_LABEL,
  INTERVENTION_STATUS_LABEL,
  JOURNEY_LABEL,
  JOURNEY_SYMBOL,
  SERVER_ANSWER_LABEL,
} from '@/i18n/labels';

export function MobilisationView() {
  return (
    <OperationalGate allow={['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER']} requiresMember>
      {/* The gate's `requiresMember` already refuses to render without one, so
          this branch is unreachable - which is exactly why it is a check and
          not a `!`. This is the screen whose whole argument is that nothing may
          claim a fact that was not established; asserting one here would be the
          same mistake in miniature. Narrowed at the boundary, where there are
          no hooks to call conditionally. */}
      {(context) =>
        context.memberId === null ? (
          <Notice tone="error">
            <strong>Vas nalog nije povezan sa clanom drustva.</strong> Bez toga vas server ne moze
            staviti na spisak pozvanih.
          </Notice>
        ) : (
          <Mobilisation context={context} memberId={context.memberId} />
        )
      }
    </OperationalGate>
  );
}

interface MyData {
  interventions: readonly Intervention[];
  facts: readonly RecipientFacts[];
  attendance: readonly AttendanceInterval[];
  available: boolean | null;
  availabilityNote: string | null;
  availabilityChangedAt: string | null;
}

const EMPTY: MyData = {
  interventions: [],
  facts: [],
  attendance: [],
  available: null,
  availabilityNote: null,
  availabilityChangedAt: null,
};

function Mobilisation({ memberId }: { context: OperationalContext; memberId: string }) {
  const [data, setData] = useState<MyData>(EMPTY);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (keepId?: string | null) => {
      const ticket = ++generation.current;
      setLoading(true);
      try {
        const [interventions, availability, members] = await Promise.all([
          fetchInterventions(),
          fetchAvailability(),
          loadRoster(),
        ]);
        // Row level security already limits this to call-outs this member was
        // sent, so there is nothing to filter client-side - and filtering here
        // would imply the list could contain somebody else's.
        const open = interventions.filter((i) => isOpenStatus(i.status));
        const focusId = keepId ?? open[0]?.id ?? interventions[0]?.id ?? null;
        const [facts, attendance] = focusId
          ? await Promise.all([
              fetchRecipientFacts(focusId),
              fetchAttendance(focusId, new Map(members.map((m) => [m.id, m.fullName] as const))),
            ])
          : [[], []];
        const mine = availability.find((a) => a.memberId === memberId);
        if (!mounted.current || ticket !== generation.current) return;
        setData({
          interventions,
          facts,
          attendance,
          available: mine?.available ?? null,
          availabilityNote: mine?.note ?? null,
          availabilityChangedAt: mine?.changedAt ?? null,
        });
        setActiveId(focusId);
        setOffline(false);
      } catch {
        if (!mounted.current || ticket !== generation.current) return;
        setOffline(true);
      } finally {
        if (mounted.current && ticket === generation.current) setLoading(false);
      }
    },
    [memberId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = useMemo(
    () => data.interventions.find((i) => i.id === activeId) ?? null,
    [data.interventions, activeId],
  );
  const myFacts = useMemo(
    () => data.facts.find((f) => f.memberId === memberId) ?? null,
    [data.facts, memberId],
  );
  const myIntervals = useMemo(
    () => data.attendance.filter((a) => a.memberId === memberId),
    [data.attendance, memberId],
  );
  const openInterval = myIntervals.find((a) => a.endedAt === null && a.rejectedAt === null) ?? null;

  const act = async (
    run: () => Promise<{ ok: boolean; message?: string }>,
    successText: string,
  ) => {
    setBusy(true);
    const outcome = await run();
    if (outcome.ok) {
      setMessage({ tone: 'info', text: successText });
      await refresh(activeId);
    } else {
      setMessage({ tone: 'error', text: outcome.message ?? 'Nije sacuvano.' });
    }
    setBusy(false);
  };

  return (
    <div className="stack">
      {offline ? (
        <Notice tone="error">
          <strong>Nema veze sa serverom.</strong> Prikazano stanje moze biti zastarjelo, a radnje
          nece biti sacuvane dok se veza ne vrati.{' '}
          <button type="button" className="btn btn--ghost" onClick={() => void refresh(activeId)}>
            Pokusaj ponovo
          </button>
        </Notice>
      ) : null}
      {message ? (
        <div role="status">
          <Notice tone={message.tone === 'error' ? 'error' : 'info'}>{message.text}</Notice>
        </div>
      ) : null}
      {loading ? <p role="status" className="muted small">Ucitavanje...</p> : null}

      <AvailabilityPanel data={data} busy={busy} onAct={act} />

      {data.interventions.length > 1 ? (
        <Field label="Poziv" controlId="my-intervention">
          {(props) => (
            <select
              {...props}
              data-testid="my-intervention"
              value={activeId ?? ''}
              onChange={(event) => {
                setActiveId(event.target.value);
                void refresh(event.target.value);
              }}
            >
              {data.interventions.map((i) => (
                <option key={i.id} value={i.id}>
                  {INTERVENTION_STATUS_LABEL[i.status] ?? i.status} - {i.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}

      {active === null ? (
        <EmptyState title="Nema poziva za vas">
          Kada vas komandir pozove na intervenciju, pojavice se ovdje. Ovaj spisak pokazuje samo
          pozive na kojima ste vi na spisku.
        </EmptyState>
      ) : (
        <CallOutCard
          intervention={active}
          facts={myFacts}
          intervals={myIntervals}
          openInterval={openInterval}
          busy={busy}
          onAct={act}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AvailabilityPanel({
  data,
  busy,
  onAct,
}: {
  data: MyData;
  busy: boolean;
  onAct: (run: () => Promise<{ ok: boolean; message?: string }>, text: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  useEffect(() => {
    setNote(data.availabilityNote ?? '');
  }, [data.availabilityNote]);

  return (
    <section className="panel">
      <h2 className="panel__title">Moja opsta dostupnost</h2>
      <p className="muted small">
        Ovo nije odgovor ni na jedan poziv. Govori samo da li ste uopste na raspolaganju ovih dana -
        komandir to vidi i prije nego sto intervencija postoji.
      </p>

      <div className="row-actions">
        <button
          type="button"
          className={`btn btn--big ${data.available === true ? 'btn--primary' : 'btn--ghost'}`}
          data-testid="available-yes"
          aria-pressed={data.available === true}
          disabled={busy}
          onClick={() =>
            void onAct(
              () => setOwnAvailability(true, note.trim() === '' ? null : note.trim()),
              'Zabiljezeno: dostupni ste.',
            )
          }
        >
          Dostupan sam
        </button>
        <button
          type="button"
          className={`btn btn--big ${data.available === false ? 'btn--primary' : 'btn--ghost'}`}
          data-testid="available-no"
          aria-pressed={data.available === false}
          disabled={busy}
          onClick={() =>
            void onAct(
              () => setOwnAvailability(false, note.trim() === '' ? null : note.trim()),
              'Zabiljezeno: niste dostupni.',
            )
          }
        >
          Nisam dostupan
        </button>
      </div>

      <Field label="Kratka napomena" hint="Na primjer: na godisnjem do 20.09." controlId="availability-note">
        {(props) => (
          <input
            {...props}
            data-testid="availability-note"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>

      <p className="muted small" data-testid="availability-state">
        {data.available === null
          ? 'Jos se niste izjasnili.'
          : `${data.available ? 'Dostupni ste' : 'Niste dostupni'}${
              data.availabilityChangedAt
                ? ` od ${new Date(data.availabilityChangedAt).toLocaleString('sr-Latn')}`
                : ''
            }.`}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function CallOutCard({
  intervention,
  facts,
  intervals,
  openInterval,
  busy,
  onAct,
}: {
  intervention: Intervention;
  facts: RecipientFacts | null;
  intervals: readonly AttendanceInterval[];
  openInterval: AttendanceInterval | null;
  busy: boolean;
  onAct: (run: () => Promise<{ ok: boolean; message?: string }>, text: string) => Promise<void>;
}) {
  const [answer, setAnswer] = useState<ResponseAnswer | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const open = isOpenStatus(intervention.status);

  return (
    <>
      <section className="panel panel--callout">
        <p className="eyebrow">
          {INTERVENTION_KIND_LABEL[intervention.kind] ?? intervention.kind}
          {intervention.otherKindNote ? ` - ${intervention.otherKindNote}` : ''}
        </p>
        <h2 className="callout__title" data-testid="callout-title">
          {intervention.title}
        </h2>
        <p className="callout__where" data-testid="callout-location">
          {intervention.incidentLocation}
        </p>
        {intervention.assemblyPoint ? (
          <p className="callout__assembly">
            Okupljanje: <strong>{intervention.assemblyPoint}</strong>
          </p>
        ) : null}
        <p className="callout__instructions">{intervention.instructions}</p>
        <p className="muted small">
          {INTERVENTION_STATUS_LABEL[intervention.status] ?? intervention.status}
          {intervention.publishedAt
            ? ` - objavljeno ${new Date(intervention.publishedAt).toLocaleString('sr-Latn')}`
            : ''}
        </p>
        {!open ? (
          <Notice tone="info">
            Ova intervencija je zatvorena. Ostaje vidljiva zbog evidencije, ali se vise ne mijenja.
          </Notice>
        ) : null}
      </section>

      <section className="panel">
        <h3 className="panel__title">1. Jeste li vidjeli poziv</h3>
        {facts?.acknowledgedAt ? (
          <p data-testid="ack-state">
            <Chip tone="yes" symbol="+">
              Otvorili ste ga {new Date(facts.acknowledgedAt).toLocaleString('sr-Latn')}
            </Chip>
          </p>
        ) : (
          <>
            <p className="muted small">
              Komandiru je vazno da zna da je poziv uopste stigao do vas - to nije isto sto i
              odgovor.
            </p>
            <button
              type="button"
              className="btn btn--big btn--primary"
              data-testid="acknowledge"
              disabled={busy || !open}
              onClick={() =>
                void onAct(
                  () => acknowledgeIntervention(intervention.id),
                  'Zabiljezeno je da ste vidjeli poziv. To jos nije odgovor.',
                )
              }
            >
              Vidio sam poziv
            </button>
          </>
        )}
      </section>

      <section className="panel">
        <h3 className="panel__title">2. Vas odgovor</h3>
        {facts?.answer ? (
          <p data-testid="answer-state">
            <Chip
              tone={
                facts.answer === 'DOLAZIM' ? 'yes' : facts.answer === 'DOLAZIM_KASNIJE' ? 'later' : 'no'
              }
              symbol="="
            >
              {SERVER_ANSWER_LABEL[facts.answer] ?? facts.answer}
              {facts.etaMinutes ? ` (${facts.etaMinutes} min)` : ''}
            </Chip>{' '}
            <span className="muted small">Mozete ga promijeniti ispod.</span>
          </p>
        ) : null}

        <div className="row-actions">
          {(['DOLAZIM', 'DOLAZIM_KASNIJE', 'NE_MOGU'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`btn btn--big ${answer === option ? 'btn--primary' : 'btn--ghost'}`}
              data-testid={`answer-${option}`}
              aria-pressed={answer === option}
              disabled={busy || !open}
              onClick={() => {
                setAnswer(option);
                if (option !== 'DOLAZIM_KASNIJE') setEta(null);
              }}
            >
              {SERVER_ANSWER_LABEL[option] ?? option}
            </button>
          ))}
        </div>

        {answer === 'DOLAZIM_KASNIJE' ? (
          <>
            <p className="muted small">Za koliko stizete?</p>
            <div className="row-actions">
              {ETA_BANDS.map((band) => (
                <button
                  key={band}
                  type="button"
                  className={`btn btn--big ${eta === band ? 'btn--primary' : 'btn--ghost'}`}
                  data-testid={`eta-${band}`}
                  aria-pressed={eta === band}
                  disabled={busy}
                  onClick={() => setEta(band)}
                >
                  {band} min
                </button>
              ))}
            </div>
          </>
        ) : null}

        <button
          type="button"
          className="btn btn--big btn--primary"
          data-testid="submit-answer"
          disabled={busy || !open || answer === null || (answer === 'DOLAZIM_KASNIJE' && eta === null)}
          onClick={() =>
            void onAct(
              () => submitResponse(intervention.id, answer!, eta, false),
              'Odgovor je zabiljezen na serveru.',
            )
          }
        >
          Posalji odgovor
        </button>
        <p className="muted small">
          Odgovor je obecanje, ne evidencija prisustva. Prisustvo se biljezi posebno, nize.
        </p>
      </section>

      <section className="panel">
        <h3 className="panel__title">3. Gdje ste sada</h3>
        <p className="muted small">
          Ovo je samo vasa pozicija za ovaj poziv. <strong>Ne prijavljuje prisustvo</strong> - ni
          "Na licu mjesta".
        </p>
        {facts?.journey ? (
          <p data-testid="journey-state">
            <Chip tone={facts.journey === 'ODUSTAJEM' ? 'no' : 'accent'} symbol={JOURNEY_SYMBOL[facts.journey] ?? '?'}>
              {JOURNEY_LABEL[facts.journey] ?? facts.journey}
            </Chip>
          </p>
        ) : null}
        <div className="row-actions">
          {JOURNEY_STEPS.map((step: JourneyStep) => (
            <button
              key={step}
              type="button"
              className={`btn btn--big ${facts?.journey === step ? 'btn--primary' : 'btn--ghost'}`}
              data-testid={`journey-${step}`}
              aria-pressed={facts?.journey === step}
              disabled={busy || !open}
              onClick={() =>
                void onAct(
                  () => setJourneyProgress(intervention.id, step),
                  `Zabiljezeno: ${JOURNEY_LABEL[step] ?? step}. Prisustvo time nije prijavljeno.`,
                )
              }
            >
              {JOURNEY_LABEL[step] ?? step}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3 className="panel__title">4. Prisustvo</h3>
        <p className="muted small">
          Prijava biljezi da ste na zadatku od tog trenutka. Zapis nosi oznaku{' '}
          <strong>prijavio se sam</strong> i <strong>ceka potvrdu komandira</strong> - do tada se ne
          racuna kao ucesce.
        </p>

        {intervals.length > 0 ? (
          <ul className="stack" data-testid="my-intervals">
            {intervals.map((interval) => {
              const state = attendanceState(interval);
              return (
                <li key={interval.id} className="card">
                  <p>
                    <Chip
                      tone={state === 'CONFIRMED' ? 'yes' : state === 'REJECTED' ? 'no' : 'later'}
                      symbol={state === 'CONFIRMED' ? '+' : state === 'REJECTED' ? '-' : '~'}
                    >
                      {state === 'CONFIRMED'
                        ? 'Potvrdjeno'
                        : state === 'REJECTED'
                          ? 'Odbijeno'
                          : 'Ceka potvrdu'}
                    </Chip>{' '}
                    <span className="muted small">
                      {ATTENDANCE_SOURCE_LABEL[interval.source] ?? interval.source}
                    </span>
                  </p>
                  <p className="muted small">
                    {new Date(interval.startedAt).toLocaleString('sr-Latn')} -{' '}
                    {interval.endedAt
                      ? new Date(interval.endedAt).toLocaleString('sr-Latn')
                      : 'jos traje'}
                    {state === 'CONFIRMED' && interval.endedAt
                      ? ` (${formatDuration(participationSeconds(interval))})`
                      : ''}
                  </p>
                  {interval.rejectionReason ? (
                    <p className="muted small">Razlog odbijanja: {interval.rejectionReason}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {openInterval ? (
          <button
            type="button"
            className="btn btn--big btn--primary"
            data-testid="check-out"
            disabled={busy || !open}
            onClick={() =>
              void onAct(
                () => checkOut(intervention.id, null),
                'Odjava je zabiljezena. Zapis i dalje ceka potvrdu komandira.',
              )
            }
          >
            Odjavi se
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--big btn--primary"
            data-testid="check-in"
            disabled={busy || !open}
            onClick={() =>
              void onAct(
                async () => {
                  const result = await checkIn(intervention.id, null);
                  return result.ok ? { ok: true } : { ok: false, message: result.message };
                },
                'Prijava je zabiljezena. Ceka potvrdu komandira da bi se racunala kao ucesce.',
              )
            }
          >
            Prijavi prisustvo
          </button>
        )}
      </section>
    </>
  );
}
