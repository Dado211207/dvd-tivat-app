# Cloud test na telefonu

Stanje 2026-09-30. Ovaj test je zaseban od postojeceg produkcionog projekta i ne zahtijeva da vlasnik ista instalira ili cuva na Macu ili poslovnom laptopu.

## Adrese i granica

- Test aplikacija: <https://boka-operativa-phone-test.netlify.app/>
- Supabase test projekat: `dvd-tivat-phone-test` (`zoipjcdtcfetqvcfmhxd`), u postojecoj organizaciji Dado ORG na Free planu.
- Netlify test sajt: `boka-operativa-phone-test` (`49a6863e-0b66-4e72-b179-f5b90cdbea9a`).
- Kod: draft PR [#81](https://github.com/Dado211207/dvd-tivat-app/pull/81), grana `codex/p7-p8-integration`. Ovaj dokument i kasnije izmjene nisu automatski objavljene na Netlify; rucni deploy mora koristiti odgovarajuci build.

Na test bazu su primijenjene sve 44 migracije iz kandidata redom. Baza nema kopiju pravih naloga, clanova, intervencija ni istorije. U njoj su samo inicijalne dvije organizacije. Public tabele imaju RLS. Test sajt koristi iskljucivo URL i **javni publishable key** test projekta. Produkcioni Supabase projekat `yskhdzrdbywrpfowckpn`, stari push worker i produkcioni GitHub Pages sajt nisu mijenjani.

## Instalacija i prva prijava

1. Na iPhone otvori test adresu u Safari pregledacu. Iz menija za dijeljenje izaberi **Add to Home Screen / Dodaj na pocetni ekran**, potvrdi **Add / Dodaj**, pa pokreni ikonu **Boka Operativa**. Ovo je web aplikacija koja se dodaje na pocetni ekran; nema App Store preuzimanja.
2. Otvori **Nalozi**, zatim **Nemam nalog**. Unesi svoju email adresu, ime i prezime, broj telefona, datum rodjenja i lozinku od najmanje 12 znakova. Lozinku nikome ne salji.
3. Test projekat trenutno zahtijeva potvrdu email adrese. Supabase podrazumijevani SMTP na Free projektu salje poruke samo adresama clanova Supabase tima. Zato registracija sa drugom adresom moze odmah javiti `Email address not authorized`; nije dokaz da je aplikacija pogresno povezana. Ako dobijes poruku, otvori vezu za potvrdu i vrati se u aplikaciju. Ako je nema ili te veza odvede drugdje, prijavi samo tekst greske, bez lozinke ili sadrzaja tajnog linka. Za sire testiranje treba posebno podesiti Auth potvrdu ili custom SMTP, pa ponovo provjeriti tok.
4. Svaki novi nalog ima ogranicen pristup. Za prvi OWNER nalog treba provjeriti identitet registrovanog korisnika i jednokratno dodijeliti ulogu **samo u test projektu** po `docs/OWNER_BOOTSTRAP.md`. Aplikacija nikad sama ne dodjeljuje OWNER prvom registrovanom nalogu. Poslije te dodjele izaberi **Provjeri pristup ponovo** ili se prijavi ponovo.

Za test svih uloga i stvarnog poziva potrebni su izmisljeni test clanovi i dodjele DVD/SZS pristupa u test projektu. Ne unositi stvarne operativne podatke niti slati pravi poziv dok se test ne pripremi.

## Provjereno i preostalo

- Netlify deploy `6abd03556a356b57e5b279ea` je `ready`. HTTPS otvara aplikaciju i prikazuje prijavu za test bazu. `manifest.webmanifest` se posluzuje kao `application/manifest+json`; servisni radnik i ikone su dostupni. Bundle sadrzi test Supabase URL i javni VAPID kljuc. Fizicka iPhone instalacija jos nije provjerena.
- `send-web-push` je ACTIVE v1 na test projektu, sa provjerom ovlascenja u samoj funkciji (`verify_jwt=false` je nuzan za poziv rasporeda bez korisnickog JWT). `ALLOWED_ORIGIN` i `VAPID_SUBJECT` su postavljeni na test HTTPS adresu, a `VAPID_PUBLIC_KEY` odgovara javnoj Netlify build varijabli `VITE_WEB_PUSH_PUBLIC_KEY`. `pg_net`, `pg_cron` i Vault su dostupni, a Cron zasad ima nula poslova. **Nisu podeseni** VAPID privatni kljuc, `PUSH_WORKER_SECRET` ni minutni Cron. Zato pozadinski push trenutno nije spreman za test na telefonu.
- Ne proglasavati zvuk i obavjestenja pouzdanim bez testa na fizickom iPhone. Web Push na iPhone radi za web aplikaciju dodatu na pocetni ekran i dozvola se trazi korisnickom radnjom. Potreban je probni poziv sa izmisljеним clanovima, provjera primitka, otvaranja, zakljucanog ekrana i Focus rezima.
- CI za raniji kandidat na `af710077de410ead0adbe52d5d5c7cf8773a9a27` je prosao (run `36682329199`); nakon izmjena ovog dokumenta provjeriti novi tacan SHA.

## Dalji cloud koraci

1. Unijeti preostale test push tajne samo u test Supabase projektu, i zaseban minutni Cron sa tajnom u Vaultu. Nikada ne stavljati privatni kljuc ili service-role u `VITE_*`, git ili zapisnik.
2. Provjeriti negativne i pozitivne worker putanje prije probnog poziva.
3. Registrovati i potvrditi vlasnikov nalog na telefonu; potvrditi koja je email adresa njegova, pa mu dodijeliti OWNER samo u test bazi i provjeriti kompletan profil.
4. Napraviti iskljucivo izmisljeni probni skup preko odobrenog registra i sprovesti probu na fizickom telefonu. Produkcioni rollout i dalje ima zasebne backup, restore i ekvivalencijske uslove u `docs/P7_P8_RELEASE_PREP.md`.
