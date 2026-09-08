/**
 * Domain errors are VALUES, not exceptions. A command either produces a new
 * state or an error explaining why it did not, and the interface can point at
 * the field responsible.
 *
 * Messages are in the local language without diacritics, per the brief.
 */

export type DomainErrorCode =
  | 'NEDOSTAJE_NASLOV'
  | 'NEDOSTAJE_LOKACIJA'
  | 'NEDOSTAJE_UPUTSTVO'
  | 'NEMA_PRIMALACA'
  | 'NEPOZNAT_PRIMALAC'
  | 'VEC_POSTOJI_OTVORENA_VJEZBA'
  | 'VJEZBA_NE_POSTOJI'
  | 'VJEZBA_NIJE_OTVORENA'
  | 'POZIV_NE_POSTOJI'
  | 'POZIV_NIJE_AKTIVAN'
  | 'NIJE_PRIMALAC'
  | 'NEISPRAVNO_VRIJEME_DOLASKA'
  | 'VOZILO_NE_POSTOJI'
  | 'VOZILO_VEC_IZASLO'
  | 'VOZILO_NIJE_IZASLO'
  | 'CLAN_NE_POSTOJI'
  | 'NEISPRAVAN_STATUS'
  | 'NEDOSTAJE_RAZLOG';

export interface DomainError {
  code: DomainErrorCode;
  /** Local-language explanation shown to the user. */
  message: string;
  /** Form field to move focus to, where the error belongs to one. */
  field?: string;
}

const MESSAGES: Record<DomainErrorCode, string> = {
  NEDOSTAJE_NASLOV: 'Unesite naslov vjezbe.',
  NEDOSTAJE_LOKACIJA: 'Unesite lokaciju dogadjaja. Lokacija prijavioca nije zamjena za nju.',
  NEDOSTAJE_UPUTSTVO: 'Unesite uputstvo za clanove.',
  NEMA_PRIMALACA: 'Niste izabrali nijednog primaoca. Poziv nije poslat.',
  NEPOZNAT_PRIMALAC: 'Izabran je primalac koji ne postoji u spisku.',
  VEC_POSTOJI_OTVORENA_VJEZBA: 'Vec postoji otvorena vjezba. Zatvorite je ili je otkazite.',
  VJEZBA_NE_POSTOJI: 'Vjezba ne postoji.',
  VJEZBA_NIJE_OTVORENA: 'Vjezba je zatvorena ili otkazana. Izmjene vise nisu moguce.',
  POZIV_NE_POSTOJI: 'Poziv ne postoji.',
  POZIV_NIJE_AKTIVAN: 'Poziv je otkazan. Odgovor nije zabiljezen.',
  NIJE_PRIMALAC: 'Ovaj poziv nije upucen izabranom clanu.',
  NEISPRAVNO_VRIJEME_DOLASKA: 'Izaberite procijenjeno vrijeme dolaska: 15, 30 ili 60 minuta.',
  VOZILO_NE_POSTOJI: 'Vozilo ne postoji.',
  VOZILO_VEC_IZASLO: 'Vozilo je vec evidentirano kao izaslo.',
  VOZILO_NIJE_IZASLO: 'Vozilo nije evidentirano kao izaslo.',
  CLAN_NE_POSTOJI: 'Clan ne postoji.',
  NEISPRAVAN_STATUS: 'Taj status nije moguc iz trenutnog stanja vjezbe.',
  NEDOSTAJE_RAZLOG: 'Unesite kratak razlog.',
};

export function domainError(code: DomainErrorCode, field?: string): DomainError {
  const error: DomainError = { code, message: MESSAGES[code] };
  if (field !== undefined) error.field = field;
  return error;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T>(code: DomainErrorCode, field?: string): Result<T> => ({
  ok: false,
  error: domainError(code, field),
});
