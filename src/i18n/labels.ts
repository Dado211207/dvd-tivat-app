/**
 * Shared user-facing labels. View-specific explanatory copy lives with its view.
 *
 * Local language, WITHOUT diacritics, per the brief. Repository documentation
 * and code comments stay in English.
 */

import type {
  ActivityKind,
  DeliveryState,
  ExerciseStatus,
  ResponseAnswer,
  RoleId,
  SpecialtyId,
  VehicleState,
} from '@/domain/types';

export const APP_NAME = 'DVD Tivat';
/** Provisional text identity only. No official logo is used. */
export const APP_SUBTITLE = 'Prototip za vjezbe';

export const SIM_BANNER_TITLE = 'SIMULACIJA';
export const SIM_BANNER_TEXT =
  'Izmisljeni podaci. Nema push, SMS ni telefonskih poziva. Uloge su simulirane; ovo nije prijava na nalog.';

/**
 * The server-backed screens run against the real database, so the simulation
 * wording above would be false there - it would say roles are simulated on the
 * screens where they are not. A banner that is wrong in that direction is worse
 * than no banner, because it teaches people to ignore it everywhere else.
 *
 * It still has to carry the one thing that IS not real: there is no notification
 * transport. Publishing a call-out writes obligations to send; nothing sends
 * them. That must be visible on the screens where a call-out is published and
 * received, not buried in documentation.
 */
export const SERVER_BANNER_TITLE = 'STVARNI PODACI';
export const SERVER_BANNER_TEXT =
  'Ovaj ekran radi na serveru. Prijava, uloga i pristup su stvarni i provjeravaju se pri svakom zahtjevu. Obavjestenja se upisuju u red za slanje, ali se ne salju: nema push, SMS, Viber ni telefonskih poziva.';

export const LOCAL_DATA_NOTE =
  'Podaci se cuvaju samo u ovom pregledacu, na ovom uredjaju. Nista se ne sinhronizuje izmedju uredjaja niti se salje na server. Brisanje podataka pregledaca brise i ovo.';

export const SERVER_DATA_NOTE =
  'Podaci na ovom ekranu se citaju i upisuju na server, uz provjeru prava pri svakom zahtjevu. Za prikaz se koriste iskljucivo izmisljeni clanovi i izmisljeni podaci.';

export const NAV = {
  poziv: 'Poziv i intervencija',
  mobilizacija: 'Moj poziv',
  arhiva: 'Arhiva i ucesce',
  dezurni: 'Dezurni',
  clan: 'Clan',
  vozila: 'Vozila',
  prikaz: 'Prikaz u bazi',
  clanovi: 'Clanovi',
  evidencija: 'Evidencija drustva',
  nalozi: 'Nalozi i pristup',
  istorija: 'Istorija',
  dojava: 'Prijava gradjana',
} as const;

/**
 * Shown wherever the abandoned citizen-report research is reachable. The
 * application must never compete with the official emergency service, and the
 * exact number to display is an owner decision (see docs/ai/PROJECT_STATE.md),
 * so this wording does not invent one.
 */
export const NOT_AN_EMERGENCY_CHANNEL =
  'Ovo nije kanal za prijavu hitnih slucajeva. Kod pozara ili nesrece odmah pozovite zvanicnu vatrogasnu sluzbu telefonom. Ovaj ekran je napusteni istrazivacki prototip: nista se ne salje niti stize do DVD Tivat-a.';

export const CITIZEN_REPORT_KIND_LABEL = {
  POZAR_ILI_DIM: 'Pozar ili dim',
  SAOBRACAJNA_NEZGODA: 'Saobracajna nezgoda',
  TEHNICKA_POMOC: 'Tehnicka pomoc',
  DRUGO: 'Drugo',
} as const;

export const ROLE_LABEL: Record<RoleId, string> = {
  ADMIN: 'Administrator drustva',
  DEZURNI: 'Ovlasteni dezurni',
  CLAN: 'Operativni clan',
  PRIKAZ: 'Prikaz u bazi',
};

export const SPECIALTY_LABEL: Record<SpecialtyId, string> = {
  KOMANDNI_KADAR: 'Komandni kadar',
  VOZAC_C: 'Vozac C kategorije',
  IDA: 'IDA aparat',
  PRVA_POMOC: 'Prva pomoc',
  TEHNICKO_SPASAVANJE: 'Tehnicko spasavanje',
  SUMSKI_POZAR: 'Sumski pozar',
};

export const STATUS_LABEL: Record<ExerciseStatus, string> = {
  OTVORENA: 'Otvorena',
  EKIPA_KRENULA: 'Ekipa krenula',
  NA_TERENU: 'Na terenu',
  ZAVRSENA: 'Zavrsena',
  OTKAZANA: 'Otkazana',
};

/** Text symbol paired with every status, so meaning never rests on colour alone. */
export const STATUS_SYMBOL: Record<ExerciseStatus, string> = {
  OTVORENA: '!',
  EKIPA_KRENULA: '>',
  NA_TERENU: '#',
  ZAVRSENA: 'OK',
  OTKAZANA: 'X',
};

export const ANSWER_LABEL: Record<ResponseAnswer, string> = {
  DOLAZIM: 'Dolazim',
  DOLAZIM_KASNIJE: 'Dolazim kasnije',
  NE_MOGU: 'Ne mogu',
};

export const ANSWER_SYMBOL: Record<ResponseAnswer, string> = {
  DOLAZIM: '+',
  DOLAZIM_KASNIJE: '~',
  NE_MOGU: 'X',
};

export const NO_ANSWER_LABEL = 'Bez odgovora';
export const NO_ANSWER_SYMBOL = '?';

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  NIJE_POKUSANO: 'Isporuka nije pokusana',
  NA_CEKANJU: 'Na cekanju',
  PRIHVACENO_OD_SERVISA: 'Prihvaceno od servisa',
  POTVRDA_UREDJAJA: 'Potvrda uredjaja',
  GRESKA: 'Greska',
  NEPOZNATO: 'Nepoznato',
};

export const VEHICLE_STATE_LABEL: Record<VehicleState, string> = {
  U_DOMU: 'U bazi',
  NA_ZADATKU: 'Izaslo',
};

export const VEHICLE_STATE_SYMBOL: Record<VehicleState, string> = {
  U_DOMU: '=',
  NA_ZADATKU: '>',
};

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  VJEZBA_KREIRANA: 'Vjezba kreirana',
  POZIV_POSLAT: 'Poziv upucen',
  POZIV_OTKAZAN: 'Poziv otkazan',
  ODGOVOR_DAT: 'Odgovor dat',
  ODGOVOR_PROMIJENJEN: 'Odgovor promijenjen',
  STATUS_PROMIJENJEN: 'Status promijenjen',
  VJEZBA_ZATVORENA: 'Vjezba zatvorena',
  VJEZBA_OTKAZANA: 'Vjezba otkazana',
  VOZILO_IZASLO: 'Vozilo izaslo',
  VOZILO_VRACENO: 'Vozilo vraceno',
  PROBNI_CLAN_SACUVAN: 'Probni clan sacuvan',
  PROBNA_GRUPA_SACUVANA: 'Probna grupa sacuvana',
  PROBNO_VOZILO_SACUVANO: 'Probno vozilo sacuvano',
  PODACI_RESETOVANI: 'Podaci resetovani',
};

export const T = {
  // Dispatcher
  dispatcherTitle: 'Dezurni - upucivanje poziva',
  newExercise: 'Nova vjezba',
  fieldKind: 'Vrsta',
  fieldTitle: 'Naslov',
  fieldInstructions: 'Uputstvo za clanove',
  fieldIncidentLocation: 'Lokacija dogadjaja',
  fieldIncidentLocationHint: 'Mjesto na koje ekipa izlazi. Obavezno.',
  fieldReporterLocation: 'Lokacija prijavioca',
  fieldReporterLocationHint:
    'Odakle je dojava stigla, ako se razlikuje. Nije obavezno i ne zamjenjuje lokaciju dogadjaja.',
  recipients: 'Primaoci',
  recipientsGroups: 'Grupe',
  recipientsIndividuals: 'Pojedinacno',
  selectedCount: 'Izabrano primalaca',
  reviewAndSend: 'Pregledaj i posalji',
  previewTitle: 'Pregled prije slanja',
  previewMessage: 'Tekst poruke',
  previewRecipients: 'Primaoci poziva',
  confirmSend: 'Potvrdi i uputi poziv',
  cancel: 'Odustani',
  activeExercise: 'Aktivna vjezba',
  noActiveExercise: 'Nema otvorene vjezbe',
  noActiveExerciseHint: 'Kreirajte vjezbu da biste uputili poziv clanovima.',
  responses: 'Odzivi',
  changeStatus: 'Promijeni status',
  closeExercise: 'Zatvori vjezbu',
  cancelExercise: 'Otkazi vjezbu',
  cancelCall: 'Otkazi poziv',
  reason: 'Razlog',
  confirm: 'Potvrdi',

  // Member
  memberTitle: 'Prikaz clana',
  simulateMember: 'Simuliraj clana',
  simulateMemberHint: 'Demonstracija. Ovo nije prijava i ne daje nikakva prava.',
  yourCall: 'Poziv upucen vama',
  noCallForYou: 'Za vas trenutno nema otvorenog poziva',
  noCallForYouHint: 'Kada dezurni uputi poziv i vi budete medju primaocima, prikazace se ovdje.',
  yourAnswer: 'Vas odgovor',
  answerHint: 'Izaberite odgovor, provjerite detalje, pa ga posaljite.',
  sendAnswer: 'Posalji odgovor',
  changeAnswer: 'Promijeni odgovor',
  etaQuestion: 'Za koliko stizete?',
  etaMinutes: 'minuta',
  directToLocation: 'Naslijedjeno polje; DVD Tivat se prvo okuplja u bazi',
  answerRecorded: 'Odgovor je zabiljezen samo u ovom pregledacu.',
  openInMaps: 'Otvori lokaciju u mapama',
  openInMapsHint: 'Otvara vanjsku uslugu u novoj kartici.',

  // Vehicles
  vehiclesTitle: 'Vozila',
  vehiclesNote:
    'Stanje vozila je nezavisno od odziva clanova. Odgovor "Dolazim" ne znaci da je vozilo izaslo.',
  departVehicle: 'Evidentiraj izlazak',
  returnVehicle: 'Evidentiraj povratak',
  purpose: 'Svrha',

  // Display
  displayTitle: 'Prikaz u bazi',
  displayNote: 'Prikazuje samo ono sto je uneseno u simulaciju.',

  // Roster
  rosterTitle: 'Clanovi',
  rosterNote: 'Svi clanovi i kontakti su izmisljeni za potrebe demonstracije.',
  specialties: 'Specijalnosti',
  groups: 'Grupe',
  contactLabel: 'Oznaka kontakta',

  // History
  historyTitle: 'Istorija i evidencija',
  historyNote: 'Zavrsene i otkazane vjezbe ostaju zabiljezene.',
  activityLog: 'Hronologija',
  resetData: 'Resetuj probne podatke',
  resetConfirmTitle: 'Resetovati probne podatke?',
  resetConfirmText:
    'Ovo brise sve probne podatke ovog prototipa u ovom pregledacu i vraca pocetno stanje. Ne utice ni na sta drugo i ne salje nista.',
  noHistory: 'Jos nema zavrsenih vjezbi.',

  // Shared
  member: 'Clan',
  members: 'clanova',
  time: 'Vrijeme',
  actor: 'Ko',
  event: 'Dogadjaj',
  detail: 'Detalj',
  delivery: 'Isporuka',
  answer: 'Odgovor',
  status: 'Status',
  vehicle: 'Vozilo',
  instructions: 'Uputstvo',
  location: 'Lokacija',
  total: 'Ukupno',
  required: 'obavezno',
  optional: 'nije obavezno',
  close: 'Zatvori',
} as const;

// ---------------------------------------------------------------------------
// Time
//
// Every timestamp in this system is stored `timestamptz` and travels as UTC.
// It is displayed in EUROPE/PODGORICA, always - never in the timezone of the
// device doing the reading.
//
// That distinction is not pedantry. The record answers "when did this happen",
// and the answer has to be the same sentence for everybody: a commander
// reviewing an intervention from abroad, a laptop whose clock region was never
// set, and the phone that was at the fire. A device-local rendering makes the
// same stored fact print three different times, and nothing on the screen
// would say which one to believe.
//
// Montenegro observes summer time, so the offset is +1 or +2 depending on the
// date. The IANA database knows this and we do not, which is exactly why the
// zone is named rather than an offset being added by hand.
// ---------------------------------------------------------------------------

export const SOCIETY_TIME_ZONE = 'Europe/Podgorica';

/** What an unrecorded fact says. Never a zero, a dash, or a guessed value. */
export const NOT_RECORDED = 'Nije zabiljezeno';

/**
 * Builds a formatter, or null if the runtime has no timezone data.
 *
 * A runtime built without full ICU throws on a named zone. Falling back to
 * device-local time would then be silently wrong, so `zonedParts` reports the
 * failure to its callers instead of hiding it, and `timeZoneIsSupported()`
 * lets a test assert the real path is the one in use.
 */
function buildFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: SOCIETY_TIME_ZONE });
  } catch {
    return null;
  }
}

const DATE_AND_TIME = buildFormatter({
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const TIME_ONLY = buildFormatter({ hour: '2-digit', minute: '2-digit', hour12: false });

/** True when times really are being rendered in Podgorica rather than fallback. */
export function timeZoneIsSupported(): boolean {
  return DATE_AND_TIME !== null && TIME_ONLY !== null;
}

interface ZonedParts {
  readonly day: string;
  readonly month: string;
  readonly year: string;
  readonly hour: string;
  readonly minute: string;
}

/**
 * Null for an unusable timestamp or an unusable runtime. Also null if any
 * expected piece is missing, rather than composing "undefined.09.2026." out of
 * whatever did arrive - a visibly absent time is recoverable, a malformed one
 * that looks like data is not.
 */
function zonedParts(formatter: Intl.DateTimeFormat | null, iso: string): ZonedParts | null {
  if (formatter === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) found[part.type] = part.value;

  const { day = '', month = '', year = '', hour = '', minute = '' } = found;
  if (hour === '' || minute === '') return null;
  return { day, month, year, hour, minute };
}

/**
 * A full date and time, in Podgorica: "13.09.2026. 18:40".
 *
 * The year is present on purpose. An archive is read months and years later,
 * and "13.09." alone cannot tell last year's fire from this one's.
 */
export function formatTime(iso: string): string {
  const parts = zonedParts(DATE_AND_TIME, iso);
  if (parts === null) return '-';
  return `${parts.day}.${parts.month}.${parts.year}. ${parts.hour}:${parts.minute}`;
}

/** The full date and time with the zone named, for a record header. */
export function formatTimeWithZone(iso: string): string {
  const shown = formatTime(iso);
  return shown === '-' ? shown : `${shown} (lokalno vrijeme, Crna Gora)`;
}

/** Just the clock, in Podgorica: "18:40". For rows already dated by context. */
export function formatClock(iso: string): string {
  const parts = zonedParts(TIME_ONLY, iso);
  if (parts === null) return '-';
  return `${parts.hour}:${parts.minute}`;
}

/**
 * A time, or an honest statement that there isn't one.
 *
 * Use this wherever the timestamp may legitimately be absent. Printing a dash
 * or falling back to a different column would both read as an answer.
 */
export function formatTimeOrNotRecorded(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return NOT_RECORDED;
  return formatTime(iso);
}

// ---------------------------------------------------------------------------
// Server-side vocabulary.
//
// These label the values the DATABASE stores, not the local prototype's. They
// are kept apart from the simulation labels above on purpose: the two
// vocabularies look similar and mean different things, and one screen showing
// the other's words is exactly how a demonstration starts implying a server is
// involved when it is not.
//
// Local language, no diacritics, as the interface convention requires.
// ---------------------------------------------------------------------------

export const INTERVENTION_KIND_LABEL: Record<string, string> = {
  POZAR: 'Pozar',
  SAOBRACAJNA_NEZGODA: 'Saobracajna nezgoda',
  TEHNICKA_POMOC: 'Tehnicka pomoc',
  VJEZBA: 'Vjezba',
  TEST: 'Test',
  DRUGO: 'Drugo',
};

export const INTERVENTION_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nacrt',
  PUBLISHED: 'Objavljeno',
  ASSEMBLING: 'Okupljanje',
  DEPLOYED: 'Na terenu',
  CONTAINED: 'Pod kontrolom',
  CLOSED: 'Zatvoreno',
  CANCELLED: 'Otkazano',
};

export const SERVER_ANSWER_LABEL: Record<string, string> = {
  DOLAZIM: 'Dolazim',
  DOLAZIM_KASNIJE: 'Dolazim kasnije',
  NE_MOGU: 'Ne mogu',
};

export const SERVER_ANSWER_SYMBOL: Record<string, string> = {
  DOLAZIM: '+',
  DOLAZIM_KASNIJE: '~',
  NE_MOGU: '-',
};

/** Where a member is for one call-out. Never a statement about attendance. */
export const JOURNEY_LABEL: Record<string, string> = {
  KRECEM: 'Krecem',
  U_PUTU: 'U putu',
  NA_LICU_MJESTA: 'Na licu mjesta',
  ODUSTAJEM: 'Odustajem',
};

export const JOURNEY_SYMBOL: Record<string, string> = {
  KRECEM: '>',
  U_PUTU: '>>',
  NA_LICU_MJESTA: '#',
  ODUSTAJEM: '-',
};

/** Who asserted an attendance interval. Separate from whether command confirmed it. */
export const ATTENDANCE_SOURCE_LABEL: Record<string, string> = {
  SELF_DECLARED: 'Prijavio se sam',
  COMMAND_RECORDED: 'Upisala komanda',
  UNKNOWN: 'Nepoznato porijeklo',
};

export const ATTENDANCE_STATE_LABEL: Record<string, string> = {
  PENDING: 'Ceka potvrdu',
  CONFIRMED: 'Potvrdjeno',
  REJECTED: 'Odbijeno',
};

export const ATTENDANCE_STATE_SYMBOL: Record<string, string> = {
  PENDING: '~',
  CONFIRMED: '+',
  REJECTED: '-',
};

// ---------------------------------------------------------------------------
// The recorded chronology
//
// One sentence per event type in `operational_audit`. Written as sentences a
// member would say rather than as field names, because the archive is read by
// people who were at the incident, not by anybody debugging it.
//
// The distinctions the rest of the system keeps apart are kept apart here too.
// Reporting movement is never described as attendance; publishing is never
// described as notifying, because nothing is sent; a confirmation is always
// named as the commander's act, not as the member's.
// ---------------------------------------------------------------------------

export const AUDIT_EVENT_LABEL: Record<string, string> = {
  INTERVENTION_DRAFTED: 'je pripremio nacrt poziva',
  INTERVENTION_DRAFT_UPDATED: 'je izmijenio nacrt prije objave',
  INTERVENTION_DRAFT_DISCARDED: 'je odbacio nacrt',
  // Never "obavijestio". Publishing writes obligations; no channel sends them.
  INTERVENTION_PUBLISHED: 'je objavio poziv',
  INTERVENTION_STATUS_CHANGED: 'je promijenio stanje intervencije',
  INTERVENTION_CLOSED: 'je zatvorio intervenciju',
  INTERVENTION_CANCELLED: 'je otkazao intervenciju',
  JOURNEY_PROGRESS_SET: 'je javio kretanje',
  ATTENDANCE_CHECK_IN: 'je zabiljezio dolazak',
  ATTENDANCE_CHECK_OUT: 'je zabiljezio odlazak',
  ATTENDANCE_CONFIRMED: 'je potvrdio prijavu prisustva',
  ATTENDANCE_UNCONFIRMED: 'je povukao potvrdu prisustva',
  ATTENDANCE_REJECTED: 'je odbio prijavu prisustva',
  ATTENDANCE_CORRECTED: 'je ispravio zapis o prisustvu',
  VEHICLE_DEPARTED: 'je evidentirao izlazak vozila',
  VEHICLE_RETURNED: 'je evidentirao povratak vozila',
};

/** Somebody whose account has no profile name on the server. Never blank. */
export const UNNAMED_ACTOR = 'Nepoznat nalog';
