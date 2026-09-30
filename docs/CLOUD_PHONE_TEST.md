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
4. Svaki novi nalog ima ogranicen pristup. Za vlasnikov nalog treba provjeriti identitet registrovanog korisnika i jednokratno dodijeliti ulogu **samo u test projektu** po `docs/OWNER_BOOTSTRAP.md`. Aplikacija nikad sama ne dodjeljuje OWNER prvom registrovanom nalogu. Vlasnik je i DVD clan: poslije potvrde naloga dodijeliti mu aktivno DVD FIREFIGHTER clanstvo i povezati njegov stvarni test roster zapis sa nalogom. OWNER daje administrativna prava u oba servisa, a DVD clanstvo i povezan roster zapis daju tacan identitet za `Moj poziv`. Poslije dodjele izaberi **Provjeri pristup ponovo** ili se prijavi ponovo.

Za test svih uloga i stvarnog poziva potrebni su izmisljeni test clanovi i dodjele DVD/SZS pristupa u test projektu. Ne unositi stvarne operativne podatke niti slati pravi poziv dok se test ne pripremi.

## Provjereno i preostalo

- Netlify deploy `6abd03556a356b57e5b279ea` je `ready`. HTTPS otvara aplikaciju i prikazuje prijavu za test bazu. `manifest.webmanifest` se posluzuje kao `application/manifest+json`; servisni radnik i ikone su dostupni. Bundle sadrzi test Supabase URL i javni VAPID kljuc. Fizicka iPhone instalacija jos nije provjerena.
- `send-web-push` je ACTIVE v1 na test projektu, sa provjerom ovlascenja u samoj funkciji (`verify_jwt=false` je nuzan za poziv rasporeda bez korisnickog JWT). `ALLOWED_ORIGIN` i `VAPID_SUBJECT` su na test HTTPS adresi; VAPID javni i privatni kljuc i `PUSH_WORKER_SECRET` su u Edge Secrets, javni kljuc je i u Netlify buildu. Minutni Cron `phone-test-send-web-push` (ID 1) cita worker tajnu iz Vaulta, a njegov SQL ne sadrzi samu tajnu. Direktan neovlasceni POST vraca 401, ovlasceni prazni sweep 200 sa svim brojacima 0; dva Cron HTTP odgovora bila su 200. To provjerava rad worker putanje bez slanja obavjestenja telefonu.
- Ne proglasavati zvuk i obavjestenja pouzdanim bez testa na fizickom iPhone. Web Push na iPhone radi za web aplikaciju dodatu na pocetni ekran i dozvola se trazi korisnickom radnjom. Potreban je probni poziv sa izmisljеним clanovima, provjera primitka, otvaranja, zakljucanog ekrana i Focus rezima.
- CI za kandidat `0af041aab0c933c9fdf5eb7aeac6a86c868ae1ae` je prosao (run `36716828628`); nakon izmjena ovog dokumenta provjeriti novi tacan SHA.

## Dalji cloud koraci

1. Registrovati i potvrditi vlasnikov nalog na telefonu. Trenutno `auth.users` u test projektu ima nula redova. Potvrditi koji je registrovani nalog njegov, pa mu dodijeliti OWNER u test bazi, DVD FIREFIGHTER clanstvo i povezani DVD roster zapis sa njegovim imenom iz profila. Ne davati OWNER prvoj nepoznatoj prijavi.
2. Napraviti iskljucivo izmisljeni probni skup preko odobrenog registra i sprovesti probu na fizickom telefonu: dozvola za obavjestenja, zatvorena aplikacija, stvarni prijem, zvuk i otvaranje `Moj poziv`. Produkcioni rollout i dalje ima zasebne backup, restore i ekvivalencijske uslove u `docs/P7_P8_RELEASE_PREP.md`.
