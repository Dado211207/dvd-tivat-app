# FireNexa - odabrani identitet

Vlasnik je 2. oktobra 2026. izricito odabrao **FireNexa**, poslije pregleda
FireLink, FireOps, FireRelay i FireCall. Ne otvarati ponovo izbor imena bez
novog zahtjeva vlasnika. Opis brenda: **Fire & Rescue Response Platform**.
FireNexa je izmisljeni naziv izveden iz Fire i ideje nexus/povezivanja;
ne zavisi od naziva Boke ili jedne sluzbe.

## Primjena

- Isti naziv u oba jezika, naslovu HTML-a, manifestu, instaliranoj aplikaciji,
  push naslovu, offline ekranu, sajtu i video uputstvima.
- Originalni F/N znak u tamno plavoj, tirkiznoj i bijeloj, sa narandzastim
  signalnim akcentom. SVG i PNG nastaju iz istih koordinata u
  `scripts/make-icons.mjs`. Nema geografskog motiva ni sluzbenog grba.
- Aplikacija koristi `public/icons/firenexa.svg`, sajt
  `site/assets/firenexa.svg`; launcher ikone zadrzavaju iste putanje.
- Promjena naziva cuva postojece lokalne kljuceve, `start_url`, `scope`,
  service worker putanju, nalog i push pretplatu na istom origin-u. SW v9
  osvjezava shell tek nakon postojeceg korisnickog dugmeta za osvjezavanje.
- Servisi ostaju DVD Tivat i Sluzba zastite i spasavanja Tivat. Promjena
  brenda ne preimenuje organizacije, clanove, intervencije ili migracije.

## Domen i zavrsna adresa

Ranija web pretraga u razgovoru nije dokaz registracione dostupnosti ili
provjere ziga. Nijedan domen nije kupljen i dostupnost `firenexa.com` nije
potvrdjena. Nema ovlascenja za kupovinu ili placeni servis u ovom koraku.
Besplatnu profesionalnu adresu bez `test` treba provjeriti i objaviti tek
kada postoji odgovarajuci build i konfiguracija prijave. Ne upisivati
nepostojeci finalni URL u javni sajt, QR ili video.

Promjena origin-a trazi zasebnu prijavu, instalaciju i Web Push dozvolu.
Zadrzati staru adresu tokom prelaza prema
[APP_FINISH_AND_ONBOARDING_PLAN.md](./APP_FINISH_AND_ONBOARDING_PLAN.md).
iOS moze zadrzati naziv stare precice; stvarno ponasanje ne smatrati
provjerenim samo na osnovu browser testova.

## Istorija

Objavljena ranija verzija koristi Boka Operativa; PR #82 je prvobitno imao
neusvojeni nacrt Boka Signal. FireNexa ih zamjenjuje u trenutnom kodu.
Objavu voditi u [CURRENT_STATUS_AND_PLAN.md](./CURRENT_STATUS_AND_PLAN.md)
sa tacnim commitom i CI rezultatom.
