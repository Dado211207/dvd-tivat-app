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
 * The accounts screen runs on the server, so the simulation wording above would
 * be false there - it would say roles are simulated on the one screen where
 * they are not. A banner that is wrong in that direction is worse than no
 * banner, because it teaches people to ignore it everywhere else.
 */
export const SERVER_BANNER_TITLE = 'STVARNI NALOZI';
export const SERVER_BANNER_TEXT =
  'Ovaj ekran radi na serveru. Prijava, uloga i pristup su stvarni i provjeravaju se pri svakom zahtjevu. Izbor simuliranog ucesnika ovdje ne mijenja nista.';

export const LOCAL_DATA_NOTE =
  'Podaci se cuvaju samo u ovom pregledacu, na ovom uredjaju. Nista se ne sinhronizuje izmedju uredjaja niti se salje na server. Brisanje podataka pregledaca brise i ovo.';

export const NAV = {
  dezurni: 'Dezurni',
  clan: 'Clan',
  vozila: 'Vozila',
  prikaz: 'Prikaz u bazi',
  clanovi: 'Clanovi',
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

/** Formats an ISO timestamp for display. Local time of the viewing device. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}. ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
