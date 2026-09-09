/**
 * ABANDONED RESEARCH - not part of the product.
 *
 * The owner decided on 9 September 2026 that DVD Tivat is an INTERNAL
 * mobilisation and intervention-record system, and explicitly not a replacement
 * for calling the official fire service. Citizen reporting is therefore out of
 * the production promise and out of the operational navigation groups.
 *
 * The screen is retained only so reviewed work (map picker, coordinate
 * provenance, review flow) can be reused, and it stays behind an explicitly
 * experimental heading. It has no network client, no notification channel and
 * no emergency-service integration, so it cannot become an operational
 * reporting path. Do not promote it back into the product without a new,
 * explicit owner decision.
 */

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { CitizenReportKind, ReportCoordinates } from '@/domain/types';
import { CITIZEN_REPORT_KIND_LABEL, formatTime, NOT_AN_EMERGENCY_CHANNEL } from '@/i18n/labels';
import { makeId, useApp, useStableCommandId } from '@/state/AppStateContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IncidentMapPicker, ReportMap } from '../components/IncidentMap';
import { Chip, EmptyState, Field, Notice } from '../components/primitives';
import { hrefFor } from '../router';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type PhotoPreview = { url: string; name: string };
type LocationStatus = 'idle' | 'locating' | 'ready' | 'error';

function coordinateText(coordinates: ReportCoordinates): string {
  const accuracy = coordinates.accuracyMeters === null
    ? ''
    : `, tacnost oko ${Math.round(coordinates.accuracyMeters)} m`;
  return `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}${accuracy}`;
}

function coordinateSourceText(coordinates: ReportCoordinates): string {
  if (coordinates.source === 'DEVICE') return 'Polozaj uredjaja potvrden kao mjesto dogadjaja';
  if (coordinates.source === 'MAP_PIN') return 'Rucno postavljena oznaka na mapi';
  return 'Izvor nije zabiljezen u starijoj probnoj prijavi';
}

export function CitizenReportView() {
  const { state, run, check, announce } = useApp();
  const [kind, setKind] = useState<CitizenReportKind>('POZAR_ILI_DIM');
  const [description, setDescription] = useState('');
  const [incidentLocation, setIncidentLocation] = useState('');
  const [coordinates, setCoordinates] = useState<ReportCoordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');
  const [locationMessage, setLocationMessage] = useState('');
  const [photo, setPhoto] = useState<PhotoPreview | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const commandId = useStableCommandId(draftVersion);

  useEffect(() => {
    return () => {
      if (photo) URL.revokeObjectURL(photo.url);
    };
  }, [photo]);

  const command = {
    type: 'SUBMIT_CITIZEN_REPORT' as const,
    commandId,
    kind,
    description,
    incidentLocation,
    coordinates,
    photoIncluded: photo !== null,
  };

  function focusField(field: string | undefined) {
    if (!field) return;
    window.setTimeout(() => document.getElementById(field)?.focus(), 0);
  }

  function openReview(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    const result = check(command);
    if (!result.ok) {
      setErrors({ [result.error.field ?? 'form']: result.error.message });
      focusField(result.error.field);
      announce(result.error.message, 'error');
      return;
    }
    setReviewOpen(true);
  }

  function saveReport() {
    const result = run(command);
    if (!result.ok) {
      setReviewOpen(false);
      setErrors({ [result.error.field ?? 'form']: result.error.message });
      focusField(result.error.field);
      announce(result.error.message, 'error');
      return;
    }
    setReviewOpen(false);
    setDescription('');
    setIncidentLocation('');
    setCoordinates(null);
    setLocationStatus('idle');
    setLocationMessage('');
    setPhoto(null);
    setPhotoError('');
    setDraftVersion((value) => value + 1);
    announce('Probna prijava je sacuvana samo u ovom pregledacu. Nije poslata nikome.');
  }

  function requestLocation() {
    if (!('geolocation' in navigator)) {
      const message = 'Ovaj uredjaj ne podrzava citanje lokacije. Unesite mjesto rucno.';
      setLocationStatus('error');
      setLocationMessage(message);
      announce(message, 'error');
      return;
    }
    setLocationStatus('locating');
    setLocationMessage('Ceka se dozvola uredjaja...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
          source: 'DEVICE' as const,
          capturedAt: new Date(position.timestamp).toISOString(),
        };
        setCoordinates(next);
        setLocationStatus('ready');
        setLocationMessage(`Lokacija je dodata: ${coordinateText(next)}.`);
        setErrors((current) => ({ ...current, reportLocation: '' }));
        announce('Lokacija uredjaja je dodata probnoj prijavi.');
      },
      () => {
        const message = 'Lokacija nije dostupna ili dozvola nije data. Unesite mjesto rucno.';
        setCoordinates(null);
        setLocationStatus('error');
        setLocationMessage(message);
        announce(message, 'error');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPhotoError('');
    if (!file) {
      setPhoto(null);
      return;
    }
    if (!PHOTO_TYPES.has(file.type)) {
      setPhoto(null);
      setPhotoError('Izaberite JPG, PNG ili WebP fotografiju.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhoto(null);
      setPhotoError('Fotografija moze imati najvise 8 MB.');
      event.target.value = '';
      return;
    }
    setPhoto({ url: URL.createObjectURL(file), name: file.name });
  }

  function reviewReport(reportId: string) {
    const result = run({
      type: 'REVIEW_CITIZEN_REPORT',
      commandId: makeId(),
      reportId,
    });
    if (!result.ok) {
      announce(result.error.message, 'error');
      return;
    }
    announce('Prijava je oznacena kao pregledana samo u simulaciji. Niko nije upucen na teren.');
  }

  return (
    <>
      <h1 className="sr-only">Prijava gradjana - napusteni istrazivacki prototip</h1>

      <Notice tone="error">
        <strong>Ovo nije kanal za hitne slucajeve.</strong> {NOT_AN_EMERGENCY_CHANNEL}
      </Notice>

      <Notice tone="warn">
        <strong>Napusteno istrazivanje.</strong> Vlasnik je 9. septembra 2026. odlucio da DVD Tivat
        aplikacija bude interni sistem za mobilizaciju i evidenciju intervencija, a ne zamjena za
        pozivanje zvanicne vatrogasne sluzbe. Ovaj ekran se cuva samo kao istrazivacki materijal i
        nije dio proizvoda.
      </Notice>

      <div className="report-layout">
        <form className="card report-form" onSubmit={openReview} noValidate>
          <div className="card__head card__head--step">
            <span className="step-number" aria-hidden="true">01</span>
            <div>
              <p className="card__kicker">Probna prijava gradjanina</p>
              <h2>Sta se desava?</h2>
            </div>
          </div>

          {errors.form ? <Notice tone="error">{errors.form}</Notice> : null}

          <Field label="Vrsta dogadjaja" required>
            {(props) => (
              <select {...props} value={kind} onChange={(event) => setKind(event.target.value as CitizenReportKind)}>
                {Object.entries(CITIZEN_REPORT_KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            )}
          </Field>

          <Field
            controlId="reportDescription"
            label="Opis"
            hint="Kratko opisite sta vidite, koliko je veliko i da li su ljudi ugrozeni."
            error={errors.reportDescription}
            required
          >
            {(props) => (
              <textarea
                {...props}
                rows={5}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Primjer: Vidim gust dim sa terase..."
              />
            )}
          </Field>

          <Field
            controlId="reportLocation"
            label="Mjesto dogadjaja"
            hint="Unesite ulicu, objekat ili orijentir. Mozete i izricito dodati lokaciju uredjaja."
            error={errors.reportLocation}
            required={coordinates === null}
          >
            {(props) => (
              <input
                {...props}
                type="text"
                value={incidentLocation}
                onChange={(event) => setIncidentLocation(event.target.value)}
                placeholder="Ulica, objekat ili orijentir"
              />
            )}
          </Field>

          <div className="report-location" data-status={locationStatus}>
            <div>
              <strong>Koristi polozaj uredjaja kao mjesto dogadjaja</strong>
              <p>
                Koristite samo ako ste na mjestu dogadjaja. Pristup se trazi tek kada pritisnete dugme.
              </p>
              {locationMessage ? <p className="report-location__result" role="status">{locationMessage}</p> : null}
            </div>
            <div className="report-location__actions">
              <button
                className="btn"
                type="button"
                onClick={requestLocation}
                disabled={locationStatus === 'locating'}
                data-testid="use-location"
              >
                {locationStatus === 'locating' ? 'Citam lokaciju...' : coordinates?.source === 'DEVICE' ? 'Osvjezi polozaj' : 'Koristi moj polozaj kao mjesto'}
              </button>
              {coordinates ? (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setCoordinates(null);
                    setLocationStatus('idle');
                    setLocationMessage('');
                    announce('Lokacija uredjaja je uklonjena iz prijave.');
                  }}
                >
                  Ukloni
                </button>
              ) : null}
            </div>
          </div>

          <div className="map-picker-section">
            <div className="map-picker-section__head">
              <div>
                <strong>Oznacite mjesto na mapi</strong>
                <p className="muted small">Oznaka predstavlja dogadjaj, ne automatski polozaj prijavioca.</p>
              </div>
              {coordinates ? (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setCoordinates(null);
                    setLocationStatus('idle');
                    setLocationMessage('');
                  }}
                >
                  Ukloni oznaku
                </button>
              ) : null}
            </div>
            <IncidentMapPicker
              coordinates={coordinates}
              onPick={(next) => {
                setCoordinates(next);
                setLocationStatus('ready');
                setLocationMessage(`Mjesto dogadjaja je oznaceno: ${coordinateText(next)}.`);
                setErrors((current) => ({ ...current, reportLocation: '' }));
                announce('Mjesto dogadjaja je oznaceno na mapi.');
              }}
            />
          </div>

          <Field
            controlId="reportPhoto"
            label="Fotografija"
            hint="JPG, PNG ili WebP, do 8 MB. Prikazuje se samo u ovoj sesiji i bajtovi se ne cuvaju."
            error={photoError}
          >
            {(props) => (
              <input
                {...props}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={choosePhoto}
              />
            )}
          </Field>

          {photo ? (
            <figure className="report-photo">
              <img src={photo.url} alt="Pregled izabrane fotografije" />
              <figcaption>Pregled u ovoj sesiji. Naziv datoteke se ne cuva.</figcaption>
            </figure>
          ) : null}

          <div className="composer-action">
            <p><strong>Nista se ne salje.</strong> Prvo provjeravate tacno sta ce simulacija sacuvati.</p>
            <button className="btn btn--primary" type="submit" data-testid="review-citizen-report">
              Pregledaj probnu prijavu
            </button>
          </div>
        </form>

        <section className="card report-inbox" aria-labelledby="report-inbox-h">
          <div className="card__head card__head--step">
            <span className="step-number" aria-hidden="true">02</span>
            <div>
              <p className="card__kicker">Lokalni prijem DVD Tivat-a</p>
              <h2 id="report-inbox-h">Probne prijave ({state.citizenReports.length})</h2>
            </div>
          </div>

          <ReportMap
            reports={state.citizenReports.map((report) => ({
              id: report.id,
              coordinates: report.coordinates,
              label: report.incidentLocation || 'Oznacena lokacija',
              reviewed: report.status === 'PREGLEDANA_U_SIMULACIJI',
            }))}
          />

          <Notice tone="warn">
            Prijave se vide ovdje samo zato sto su oba prikaza u istom pregledacu. To nije dokaz
            isporuke, prijema alarma niti izlaska ekipe.
          </Notice>

          {state.citizenReports.length === 0 ? (
            <EmptyState title="Nema probnih prijava">
              Popunite formu i sacuvajte lokalnu simulaciju da biste demonstrirali prijem.
            </EmptyState>
          ) : (
            <ul className="report-list" data-testid="citizen-report-list">
              {state.citizenReports.map((report) => (
                <li className="report-item" key={report.id}>
                  <div className="report-item__head">
                    <div>
                      <p className="card__kicker">{formatTime(report.createdAt)}</p>
                      <h3>{CITIZEN_REPORT_KIND_LABEL[report.kind]}</h3>
                    </div>
                    {report.status === 'PREGLEDANA_U_SIMULACIJI' ? (
                      <Chip tone="accent" symbol="OK">Pregledana u simulaciji</Chip>
                    ) : (
                      <Chip tone="unknown" symbol="?">Sacuvana lokalno</Chip>
                    )}
                  </div>
                  <p>{report.description}</p>
                  <dl className="report-facts">
                    <div><dt>Mjesto</dt><dd>{report.incidentLocation || 'Nije rucno uneseno'}</dd></div>
                    <div><dt>GPS</dt><dd>{report.coordinates ? coordinateText(report.coordinates) : 'Nije dodat'}</dd></div>
                    <div><dt>Izvor oznake</dt><dd>{report.coordinates ? coordinateSourceText(report.coordinates) : 'Nije dodat'}</dd></div>
                    <div><dt>Fotografija</dt><dd>{report.photoIncluded ? 'Bila ukljucena; bajtovi nijesu sacuvani' : 'Nije ukljucena'}</dd></div>
                  </dl>
                  {report.status === 'SACUVANA_LOKALNO' ? (
                    <button className="btn" type="button" onClick={() => reviewReport(report.id)}>
                      Oznaci kao pregledanu u simulaciji
                    </button>
                  ) : (
                    <div className="report-item__next">
                      <p className="small muted">Ovo ne znaci da je prijava prihvacena niti da je ekipa krenula.</p>
                      <a
                        className="btn btn--primary"
                        href={`${hrefFor('dezurni')}?dojava=${encodeURIComponent(report.id)}`}
                        data-testid="prepare-call-from-report"
                      >
                        Pripremi poziv iz prijave
                      </a>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={reviewOpen}
        title="Provjerite probnu prijavu"
        confirmLabel="Sacuvaj lokalnu simulaciju"
        onConfirm={saveReport}
        onCancel={() => setReviewOpen(false)}
      >
        <div className="report-review">
          <Notice tone="error">Ova radnja ne kontaktira DVD Tivat niti bilo koju hitnu sluzbu.</Notice>
          <dl className="report-facts">
            <div><dt>Vrsta</dt><dd>{CITIZEN_REPORT_KIND_LABEL[kind]}</dd></div>
            <div><dt>Opis</dt><dd>{description.trim()}</dd></div>
            <div><dt>Mjesto</dt><dd>{incidentLocation.trim() || 'Nije rucno uneseno'}</dd></div>
            <div><dt>GPS</dt><dd>{coordinates ? coordinateText(coordinates) : 'Nije dodat'}</dd></div>
            <div><dt>Izvor oznake</dt><dd>{coordinates ? coordinateSourceText(coordinates) : 'Nije dodat'}</dd></div>
            <div><dt>Fotografija</dt><dd>{photo ? 'Ukljucena samo u ovom pregledu' : 'Nije ukljucena'}</dd></div>
          </dl>
          {photo ? <img className="report-review__photo" src={photo.url} alt="Fotografija u pregledu prijave" /> : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
