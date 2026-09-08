/**
 * Every user-facing string, in one place.
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
  'Izmisljeni clanovi i izmisljeni podaci. Prototip ne salje nijedno obavjestenje - ni push, ni SMS, ni poziv. Prebacivanje uloge je demonstracija, nije prijava na nalog.';

export const LOCAL_DATA_NOTE =
  'Podaci se cuvaju samo u ovom pregledacu, na ovom uredjaju. Nista se ne sinhronizuje izmedju uredjaja niti se salje na server. Brisanje podataka pregledaca brise i ovo.';

export const NAV = {
  dezurni: 'Dezurni',
  clan: 'Clan',
  vozila: 'Vozila',
  prikaz: 'Prikaz u domu',
  clanovi: 'Clanovi',
  istorija: 'Istorija',
} as const;

export const ROLE_LABEL: Record<RoleId, string> = {
  ADMIN: 'Administrator drustva',
  DEZURNI: 'Ovlasteni dezurni',
  CLAN: 'Operativni clan',
  PRIKAZ: 'Prikaz u domu',
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
  U_DOMU: 'U domu',
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
  changeAnswer: 'Promijeni odgovor',
  etaQuestion: 'Za koliko stizete?',
  etaMinutes: 'minuta',
  directToLocation: 'Idem direktno na lokaciju, ne u dom',
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
  displayTitle: 'Prikaz u domu',
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
