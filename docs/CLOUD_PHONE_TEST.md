# Cloud test na telefonu

Stanje 2026-10-02, poslije prve probe brzog poziva sa testnim nalozima. Aktuelni plan je u [CURRENT_STATUS_AND_PLAN.md](./CURRENT_STATUS_AND_PLAN.md). Ovaj test je odvojen od postojece produkcije i ne trazi instalaciju niti cuvanje podataka na vlasnikovom Macu ili poslovnom laptopu.

## Adrese i granica

- Test aplikacija: <https://boka-operativa-phone-test.netlify.app/>
- Test Supabase: `dvd-tivat-phone-test` (`zoipjcdtcfetqvcfmhxd`), Free plan; Netlify: `boka-operativa-phone-test`.
- Kod: draft PR [#81](https://github.com/Dado211207/dvd-tivat-app/pull/81), grana `codex/p7-p8-integration`. Novi commit na GitHubu sam po sebi ne objavljuje novi Netlify build. Trenutni testni frontend je objavljen iz commita `b3b4814` kao Netlify deploy `6abf5e819e860ed014fdf8d3` (ready, 2026-10-02 u 07:34 UTC). Prethodni `6abe8e4f67afc951415aa1a4` pripada prvoj probi brzog komandnog toka, a `6abdf29b8db7f63eaf1ca3aa` ranijoj iPhone probi.
- Produkcioni Supabase `yskhdzrdbywrpfowckpn`, stari push worker i produkcioni GitHub Pages nijesu mijenjani u ovom testu.

Test baza je podignuta od migracija iz PR-a, bez kopiranja produkcionih naloga ili intervencija. U pocetnoj fazi napravljeni su vlasnikov test nalog, DVD roster zapis i jedan fikcionalni testni pozar; kasnije su dodati testni nalozi i pozivi za prihvat toka. Novi grant za worker je primijenjen **samo u test bazi** i sacuvan u repository migraciji `20260930190239_worker_joint_recipient_organization_read.sql`.

## Sta je provjereno

| Korak | Stvarni rezultat |
| --- | --- |
| Instalacija / prijava | Vlasnik je na iPhoneu otvorio test aplikaciju, registrovao nalog, potvrdio email i prijavio se. |
| Prava | Test nalog `doncicdragan2112@gmail.com` ima OWNER prava za test organizacije i aktivno DVD FIREFIGHTER clanstvo povezano sa test roster zapisom. Novi nalozi i dalje pocinju bez operativnih prava. |
| Push pretplata | Jedna aktivna pretplata za vlasnikov nalog pokazuje Apple Web Push odrediste; korisnik je dao dozvolu. |
| Fikcionalni poziv | Jedan `POZAR`, ID `8605f04e-fb98-480e-86c1-3e01992c1d8f`, naslov `TEST POZAR - NIJE STVARNA INTERVENCIJA`, izmisljena lokacija i izricito uputstvo da nema terenskog izlaska. U trenutku objave test baza je imala jednog korisnika; primaoc i push red su bili samo za njegov nalog. |
| Prvi pokusaji | Worker je prvo bio blokiran nedostajucim SELECT grantom na tabeli za zajednicke primaoce; po grantu Apple je vratio HTTP 400 (`BadWebPushTopic`) za staru oznaku. Popravljeni su grant i format oznake (32 znaka bez UUID crtica). |
| Push dostava | Novi pokusaj za **isti** poziv Apple je prihvatio 2026-09-30 u 19:08 UTC (`ACCEPTED_SCHEDULED`). Vlasnik je potvrdio da se obavjestenje pojavilo na zakljucanom iPhoneu i da je cuo sistemski, a ne izabrani zvuk iz aplikacije. |
| Zvuk | Izbor u aplikaciji vazi za otvorenu, vidljivu aplikaciju. Pri zakljucanom telefonu iOS bira zvuk Web Push obavjestenja. Foreground zvuk nije ovim testom posebno potvrdjen. |

Providerovo `ACCEPTED` samo po sebi ne dokazuje prijem na telefonu; za prvu probu imamo i zasebnu korisnikovu potvrdu. Tada nijesmo izmjerili vrijeme od objave do prikaza na telefonu, provjerili tap/deep link, korisnikov odgovor, Focus/tihi rezim, Android ili vise korisnika. Testni pozar nije stvarna intervencija.

## Prva proba brzog poziva, 2. oktobar 2026

Korisnik je javio da je izvrsio korake za probu sa testnim nalozima. Read-only pregled **izdvojene testne baze** potvrdio je sljedece za poziv `da0b8dda-12c9-4064-bedb-8fd4ea8e5eae`:

| Dogadjaj | Serverski zapis (UTC) |
| --- | --- |
| Objavljen | 05:55:18; naslov `TEST – NIJE STVARNA INTERVENCIJA,`, vrsta `POZAR`, vodi DVD. |
| Primaoci | Dva DVD primaoca; po jedan `IN_APP` red za svakog i jedan `WEB_PUSH` red za uredjaj sa pretplatom. |
| Otvoren i odgovoreno | Jedan primalac otvorio u 05:55:32 i odgovorio `DOLAZIM` u 05:55:35. |
| Push | Jedan pokusaj sa statusom `ACCEPTED_IMMEDIATE`; red ima `PROVIDER_ACCEPTED`. Ovo potvrdjuje prihvat kod push provajdera, ne vidljivost na ekranu. |
| Zatvoren | 05:56:46 kao `CLOSED`, bez teksta razloga/izvjestaja. |

Ovaj zapis potvrdjuje osnovni DVD tok u serveru, ukljucujuci automatski izbor dva primaoca, odgovor i zatvaranje bez razloga. Korisnicka poruka `odradio sam to` ne daje zasebne detalje o prikazu obavjestenja, zvuku, dubokom linku ili tome da li je odgovor vidio u komandnom pregledu. SZS, obje sluzbe, dvojno clanstvo i opcioni izvjestaj nijesu ovim pozivom potvrdjeni. Vrsta je bila `POZAR`, ali naslov izricito oznacava test; naredne probe birati kao `TEST` ili `VJEZBA`.

Pregled spremnosti testne baze istog dana pokazuje dva aktivna, povezana DVD roster zapisa sa potpunim profilima i dvije aktivne DVD sluzbene uloge. SZS trenutno ima **nula roster zapisa i nula aktivnih sluzbenih uloga**. Prije probe slanja SZS-u treba povezati poseban test nalog sa SZS roster zapisom i dodijeliti mu operativnu ulogu kroz administraciju; za probu dvojnog clanstva treba zasebno pripremiti takav testni nalog. Ne dodjeljivati SZS clanstvo stvarnoj osobi samo radi ove provjere.

## Odgovor jednim dodirom, 2. oktobar 2026

Vlasnik je na fizickom telefonu pritisnuo `Dolazim` na pozivu vrste `TEST`, ID `8525adb5-c359-4c24-930d-2e0207bf14e8`, sa naslovom `TEST - PROBA ODGOVORA - NIJE STVARNA INTERVENCIJA`. Testna baza biljezi objavu u 07:52:55 UTC za dva DVD primaoca. Web Push red za vlasnika je `PROVIDER_ACCEPTED`; vlasnik nije zasebno opisao prikaz ili zvuk te notifikacije.

Za vlasnikov nalog upisani su odgovor `DOLAZIM` u 08:10:59.993849 UTC i zasebna potvrda prijema u 08:11:00.117615 UTC. To potvrdjuje oba serverska zapisa nakon jednog korisnikovog pritiska, sa razmakom od oko 124 ms. Ne potvrdjuje terenski dolazak ni prisustvo. Poziv je nakon probe zatvoren u 12:48:24 UTC kao `CLOSED`, bez razloga; odgovor i potvrda ostaju u arhivi.

## Nova objava za ponovnu probu

Netlify je potvrdio `ready` za `6abf5e819e860ed014fdf8d3`. Javna adresa vraca tekst novog ekrana odgovora jednim dodirom i JS konfiguraciju za **test** Supabase, bez produkcionog URL-a. Vlasnik je na fizickom telefonu isprobao `Dolazim`, a oba serverska zapisa su potvrdjena iznad. Skrol gestovi i prikaz ponovnog push obavjestenja nijesu ovom provjerom posebno opisani. Pri narednom osvjezavanju instalirane aplikacije dovrsiti rad na trenutnom ekranu prije prihvatanja novog builda; ne brisati instalaciju radi azuriranja jer to moze ukloniti push pretplatu.

## Kako vlasnik ponavlja bezbjednu probu

Otvori aplikaciju preko ikonice dodate na pocetni ekran i prijavi se. U **Podesavanja** izabrani zvuk mozes cuti preko **Preslusaj**; to je proba zvuka dok je aplikacija otvorena. Obavjestenja za zatvoren ekran koriste iOS zvuk. Pri eventualnom novom testnom pozivu naslov i uputstvo moraju jasno reci da je simulacija, bez mobilizacije. Ne koristiti test sajt za prijavu stvarnog pozara.

## Otvoreni poslovi

1. Provjeriti duboki link iz notifikacije, otvoreni ekran sa izabranim zvukom i reset ponavljanja nakon otvaranja. Serverski odgovor i potvrda prijema jednim dodirom su potvrdjeni; prikaz na uredjaju i dalje biljeziti zasebno.
2. CI za kodni commit `cf1c94d` i dokumentacioni commit `825c14e` je prosao; draft PR #81 ostaje otvoren. Testni Edge Function koristi ispravljeni izvorni kod bez privremene dijagnostike.
3. Prosiriti zasebni test na DVD-only, SZS-only, dvojnu ulogu i Android, uz izmisljene podatke i odobrene testere.
4. Za produkciju odvojeno ispuniti uslove iz [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md): kompatibilnost na produkcionoj kopiji, enkriptovani backup i vracanje, promjene u tacnom redosljedu, prava pristupa i prihvat DVD/SZS. Besplatan projekat nema automatski produkcioni backup.
