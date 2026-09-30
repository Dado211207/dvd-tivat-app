# Testiranje uredjaja i tokova - matrica

Stanje 2026-09-30. Grana: `codex/p7-p8-integration` / draft PR #81. Ovaj dokument razlikuje tri izvora dokaza: vlasnikov stvarni iPhone, Chromium na GitHub Actions runneru sa simuliranim dimenzijama i testove SQL baze. Simulirana sirina nije fizicki iPad, Safari, Android ni laptop koji neko drzi u ruci.

## Uredjaji i gestovi

| Ekran | Simulirana dimenzija | Test |
| --- | --- | --- |
| Mali telefon | 320 x 568 | Poziv, Moj poziv, Arhiva; Nalozi sa dugim tekstom, Podesavanja, Evidencija |
| Android telefon | 360 x 800 | Isto; mobilni Chromium profil |
| iPhone | 390 x 844 | Isto; mobilni profil + vlasnikova stvarna Web Push proba na zakljucanom iPhoneu |
| Veliki telefon | 430 x 932 | Isti osnovni prikazi |
| Tablet uspravno | 834 x 1112 | Isti prikazi, dostupnost tabelarnih kolona |
| Tablet polozno | 1112 x 834 | Isti prikazi |
| Laptop | 1280 x 800 | Isti prikazi, kontrola sirine formi |
| Desktop | 1920 x 1080 | Isti prikazi i raspored |

`e2e/viewport.spec.ts` provjerava horizontalno sirenje, presjecen tekst, dostupne kolone i velicinu dodirnih kontrola na tri operativna ekrana. `e2e/mobile-settings-accounts.spec.ts` provjerava statusnu traku i kartice Naloga na telefonima. `e2e/edge-scroll.spec.ts` dodatno otvara Nalozi, Podesavanja i Evidenciju na osam sirina u dva Chromium profila, uz dug tekst. Mjeri da stranica ne prelazi sirinu ekrana, da je `overscroll-behavior: none`, da se dugi ekran moze skrolovati i da siroke tabele u Evidenciji ostaju dostupne u sopstvenoj skrol zoni. Izabrani CSS ne gasi normalan vertikalni skrol.

Tokom prosirenja testa otkriveni su: sirenje Evidencije na telefonu i Naloga na pojedinim tablet sirinama. Ispravke su u grani; njihov prolaz mora potvrditi **finalni CI**. Fizicki test gumastog odskakanja/povlacenja prstom na iOS/iPadOS i Androidu ostaje za uredjaje, jer headless Chromium ne dokazuje ponasanje Safari gestova.

## Funkcionalni tokovi

| Tok | Automatska provjera | Fizicka / hostovana provjera |
| --- | --- | --- |
| Registracija, potvrda emaila i OWNER + DVD clan | SQL/RLS i testovi naloga, prava i povezivanja; testni owner potvrdjen u izolovanoj bazi | Vlasnik se prijavio na iPhone |
| Unos/aktivacija clanova, grupa i vozila | `db-tests/organisation_registry.test.ts`, `db-tests/registry.test.ts`; browser testovi registra i prava | Potrebna dodatna proba uredjivanja kroz test admin ekran |
| Dodjela DVD, SZS i oba servisa | `db-tests/owner_service_membership.test.ts`, `db-tests/multi_service_accounts.test.ts` i browser matrica | Stvarni drugi test nalog jos ne postoji |
| Nacrt, objava, primaoci i jedan zajednicki poziv | `db-tests/interventions.test.ts`, `db-tests/joint_callouts.test.ts` i browser komandni tokovi | Jedan jasno oznacen test pozar objavljen samo vlasniku |
| Web Push i potvrda prijema | SQL outbox, worker i pravila ponavljanja u bazi/testovima | Apple prihvatio poruku; vlasnik potvrdio prikaz na zakljucanom iPhoneu |
| Odgovor, kretanje, vozila, prisustvo, arhiva | SQL/RLS i browser tokovi sa fikcionalnim clanovima | Potrebna proba na fizickom telefonu uz test naloge |
| Iskljucenje iz uloge / prelaz izmedju sluzbi | SQL RLS i browser testovi | Potrebni odvojeni korisnici za fizicku probu |

Browser testovi koriste **mock API i izmisljene podatke**, pa dokaz da interfejs radi nije dokaz da ce svaki produkcioni server upis uspjeti. Server testovi izvrsavaju stvarne PostgreSQL migracije u CI, ali nijesu kopija produkcione baze. Tokovi u stvarnoj test bazi pokriveni su zasad samo vlasnikovim nalogom i jednim fikcionalnim pozivom. Ne praviti nove testne naloge u ime stvarnih vatrogasaca bez njihove registracije.

## Sta preostaje za detaljno prihvatanje

- Dok je aplikacija otvorena: izabrani zvuk, osvjezavanje bez rucnog reloada, publikacija i odgovor na dva naloga, tabovi i pretraga evidencije.
- Dok je zatvorena: prijem, otvaranje dubokog linka, zakljucan ekran, dozvole, tihi rezim/Focus, bez mreze pa povratak veze. iOS bira sistemski Web Push zvuk; plan za posebnu native sirenu je u [CURRENT_STATUS_AND_PLAN.md](./CURRENT_STATUS_AND_PLAN.md).
- Na fizickim uredjajima (kada su dostupni): iPhone, Android, tablet i desktop browser, ukljucujuci rotaciju, tastaturu, pinch zoom, skrol do kraja i prevlacenje preko ivice. Za svaku gresku zapisati uredjaj, OS/browser, dimenziju, rutu i tacan korak.
- Prije operativne upotrebe: prihvat DVD/SZS, provjeren backup/restore i fallback kanal. Vidi [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md).

Naziv aplikacije: [NAME_OPTIONS.md](./NAME_OPTIONS.md).
