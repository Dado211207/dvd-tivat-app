# Cloud test na telefonu

Stanje 2026-10-01, poslije korisnicke potvrde prijema na zakljucanom iPhoneu i nove test objave. Aktuelni plan je u [CURRENT_STATUS_AND_PLAN.md](./CURRENT_STATUS_AND_PLAN.md). Ovaj test je odvojen od postojece produkcije i ne trazi instalaciju niti cuvanje podataka na vlasnikovom Macu ili poslovnom laptopu.

## Adrese i granica

- Test aplikacija: <https://boka-operativa-phone-test.netlify.app/>
- Test Supabase: `dvd-tivat-phone-test` (`zoipjcdtcfetqvcfmhxd`), Free plan; Netlify: `boka-operativa-phone-test`.
- Kod: draft PR [#81](https://github.com/Dado211207/dvd-tivat-app/pull/81), grana `codex/p7-p8-integration`. Novi commit na GitHubu sam po sebi ne objavljuje novi Netlify build. Test sajt je 2026-10-01 u 05:42 UTC zasebno objavljen iz commita `ac840f6` kao Netlify deploy `6abdf29b8db7f63eaf1ca3aa`.
- Produkcioni Supabase `yskhdzrdbywrpfowckpn`, stari push worker i produkcioni GitHub Pages nijesu mijenjani u ovom testu.

Test baza je podignuta od migracija iz PR-a, bez kopiranja produkcionih naloga ili intervencija. Poslije pocetnog postavljanja u njoj su napravljeni samo vlasnikov test nalog, vlasnikov DVD roster zapis i jedan fikcionalni testni pozar. Novi grant za worker je primijenjen **samo u test bazi** i sacuvan u repository migraciji `20260930190239_worker_joint_recipient_organization_read.sql`.

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

Providerovo `ACCEPTED` samo po sebi ne dokazuje prijem na telefonu; ovdje imamo i zasebnu korisnikovu potvrdu. Nijesmo izmjerili vrijeme od objave do prikaza na telefonu, provjerili tap/deep link, korisnikov odgovor, Focus/tihi rezim, Android ili vise korisnika. Testni pozar nije stvarna intervencija.

## Nova objava za ponovnu probu

Netlify je potvrdio `ready`, a javna test adresa vraca novi CSS asset i JS konfiguraciju za **test** Supabase, bez produkcionog URL-a. U odvojenom cloud browseru pocetni ekran i prijava se otvaraju. To ne potvrdjuje prijem novog builda, skrol gestove ni ponovni push na vlasnikovom fizickom iPhoneu. Otvori instaliranu aplikaciju dok ima mreze; ako se pojavi dugme za osvjezavanje aplikacije, dovrsi rad na trenutnom ekranu pa ga pritisni. Ne brisi instalaciju zbog updatea jer bi to moglo ukloniti postojecu push pretplatu.

## Kako vlasnik ponavlja bezbjednu probu

Otvori aplikaciju preko ikonice dodate na pocetni ekran i prijavi se. U **Podesavanja** izabrani zvuk mozes cuti preko **Preslusaj**; to je proba zvuka dok je aplikacija otvorena. Obavjestenja za zatvoren ekran koriste iOS zvuk. Pri eventualnom novom testnom pozivu naslov i uputstvo moraju jasno reci da je simulacija, bez mobilizacije. Ne koristiti test sajt za prijavu stvarnog pozara.

## Otvoreni poslovi

1. Provjeriti duboki link iz notifikacije, prijem/odgovor na `Moj poziv`, otvoreni ekran sa izabranim zvukom i reset ponavljanja nakon otvaranja. Probu biljeziti sa stvarnim vremenima i okolnostima telefona.
2. Pustiti CI na tacnom finalnom head SHA, pregledati draft PR #81 i provjeriti da su SQL grant, harness lista i push oznaka u istoj verziji. Testni Edge Function koristi ispravljeni izvorni kod bez privremene dijagnostike.
3. Prosiriti zasebni test na DVD-only, SZS-only, dvojnu ulogu i Android, uz izmisljene podatke i odobrene testere.
4. Za produkciju odvojeno ispuniti uslove iz [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md): kompatibilnost na produkcionoj kopiji, enkriptovani backup i vracanje, promjene u tacnom redosljedu, prava pristupa i prihvat DVD/SZS. Besplatan projekat nema automatski produkcioni backup.
