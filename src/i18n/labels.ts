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
 * Web Push is an optional, device-bound transport. It is deliberately described
 * without claiming that a provider acceptance proves a phone rang or that the
 * web app can override the device's sound and focus settings.
 */
export const SERVER_BANNER_TITLE = 'STVARNI PODACI';
export const SERVER_BANNER_TEXT =
  'Ovaj ekran radi na serveru. Prijava, uloga i pristup se provjeravaju pri svakom zahtjevu. Web Push radi samo na uredjaju na kojem ga clan ukljuci; prihvatanje poruke od servisa nije dokaz da je telefon zazvonio. Nema SMS, Viber ni automatskog telefonskog poziva.';

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
// Moved to `src/i18n/time.ts` when the interface gained a second language. The
// fixed Europe/Podgorica zone and the whole argument for it live there; what
// changed is that the same instant is now WRITTEN the way the chosen language
// writes it, while remaining the same instant.
//
// Re-exported here so that every screen already printing a time became
// language-aware without a single call site changing.
// ---------------------------------------------------------------------------

export {
  formatClock,
  formatCount,
  formatTime,
  formatTimeOrNotRecorded,
  formatTimeWithZone,
  notRecorded,
  SOCIETY_TIME_ZONE,
  timeZoneIsSupported,
} from './time';

// ---------------------------------------------------------------------------
// Symbols for the server's vocabulary.
//
// The WORDS moved to `strings.me.ts` and `strings.en.ts` when the interface
// gained a second language. These did not, because they are not words: every
// status and answer is paired with a text symbol so that meaning never rests on
// colour alone, and a symbol means the same thing in both languages.
// ---------------------------------------------------------------------------

export const SERVER_ANSWER_SYMBOL: Record<string, string> = {
  DOLAZIM: '+',
  DOLAZIM_KASNIJE: '~',
  NE_MOGU: '-',
};

/** Where a member is for one call-out. Never a statement about attendance. */
export const JOURNEY_SYMBOL: Record<string, string> = {
  KRECEM: '>',
  U_PUTU: '>>',
  NA_LICU_MJESTA: '#',
  ODUSTAJEM: '-',
};

export const ATTENDANCE_STATE_SYMBOL: Record<string, string> = {
  PENDING: '~',
  CONFIRMED: '+',
  REJECTED: '-',
};

/**
 * A note somebody typed, placed inside a sentence the application builds.
 *
 * The hosted review found a chronology line reading
 * "Vjezba zavrsena - test operativnog prototipa.." - the commander's closing
 * note already ended in a full stop, and the sentence around it added another.
 *
 * This trims trailing sentence punctuation from the QUOTED COPY only. The
 * stored audit text is never altered: `operational_audit` is append-only, the
 * note is evidence, and tidying evidence to make a sentence read well is
 * exactly the thing an audit trail exists to prevent. If somebody asks what was
 * typed, the answer is still in the database, character for character.
 *
 * Only `.`, `,`, `;` and `:` are trimmed. A note ending in "!" or "?" keeps it,
 * because those carry meaning a full stop does not.
 */
export function forSentence(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const trimmed = note.trim().replace(/[.,;:\s]+$/u, '');
  return trimmed === '' ? null : trimmed;
}

/**
 * Close a sentence the application built, without doubling the punctuation.
 *
 * The other half of the same defect. `forSentence` handles a note quoted in the
 * MIDDLE of a sentence; this handles the end of it - where a note may
 * legitimately be the last thing on the line and may legitimately end in "?" or
 * "!", which `forSentence` deliberately keeps. Appending a full stop to those
 * would produce "vracena?." which is no better than "prototipa..".
 */
export function endSentence(sentence: string): string {
  const trimmed = sentence.trimEnd();
  return /[.!?…]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}
