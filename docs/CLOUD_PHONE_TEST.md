# Cloud test na telefonu

Stanje 2026-10-02, poslije prve probe brzog poziva sa testnim nalozima. Aktuelni plan je u [CURRENT_STATUS_AND_PLAN.md](./CURRENT_STATUS_AND_PLAN.md). Ovaj test je odvojen od postojece produkcije i ne trazi instalaciju niti cuvanje podataka na vlasnikovom Macu ili poslovnom laptopu.

## Adrese i granica

- Test aplikacija: <https://boka-operativa-phone-test.netlify.app/>
- Test Supabase: `dvd-tivat-phone-test` (`zoipjcdtcfetqvcfmhxd`), Free plan; Netlify: `boka-operativa-phone-test`.
- Kod: draft PR [#81](https://github.com/Dado211207/dvd-tivat-app/pull/81), grana `codex/p7-p8-integration`. Novi commit na GitHubu sam po sebi ne objavljuje novi Netlify build. Trenutni testni frontend je objavljen iz kodnog commita `cf1c94d` kao Netlify deploy `6abe8e4f67afc951415aa1a4` (ready, 2026-10-01 u 16:46 UTC). Raniji deploy `6abdf29b8db7f63eaf1ca3aa` pripada prvoj iPhone probi.
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

## Nova objava za ponovnu probu

Netlify je potvrdio `ready`, a javna test adresa vraca novi CSS asset i JS konfiguraciju za **test** Supabase, bez produkcionog URL-a. U odvojenom cloud browseru pocetni ekran i prijava se otvaraju. To ne potvrdjuje prijem novog builda, skrol gestove ni ponovni push na vlasnikovom fizickom iPhoneu. Otvori instaliranu aplikaciju dok ima mreze; ako se pojavi dugme za osvjezavanje aplikacije, dovrsi rad na trenutnom ekranu pa ga pritisni. Ne brisi instalaciju zbog updatea jer bi to moglo ukloniti postojecu push pretplatu.

## Kako vlasnik ponavlja bezbjednu probu

Otvori aplikaciju preko ikonice dodate na pocetni ekran i prijavi se. U **Podesavanja** izabrani zvuk mozes cuti preko **Preslusaj**; to je proba zvuka dok je aplikacija otvorena. Obavjestenja za zatvoren ekran koriste iOS zvuk. Pri eventualnom novom testnom pozivu naslov i uputstvo moraju jasno reci da je simulacija, bez mobilizacije. Ne koristiti test sajt za prijavu stvarnog pozara.

## Otvoreni poslovi

1. Provjeriti duboki link iz notifikacije, prijem/odgovor na `Moj poziv`, otvoreni ekran sa izabranim zvukom i reset ponavljanja nakon otvaranja. Probu biljeziti sa stvarnim vremenima i okolnostima telefona.
2. CI za kodni commit `cf1c94d` i dokumentacioni commit `825c14e` je prosao; draft PR #81 ostaje otvoren. Testni Edge Function koristi ispravljeni izvorni kod bez privremene dijagnostike.
3. Prosiriti zasebni test na DVD-only, SZS-only, dvojnu ulogu i Android, uz izmisljene podatke i odobrene testere.
4. Za produkciju odvojeno ispuniti uslove iz [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md): kompatibilnost na produkcionoj kopiji, enkriptovani backup i vracanje, promjene u tacnom redosljedu, prava pristupa i prihvat DVD/SZS. Besplatan projekat nema automatski produkcioni backup.
