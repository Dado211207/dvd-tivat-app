# Boka Operativa - trenutno stanje i plan

Azurnost: 2026-09-30, poslije probe na vlasnikovom iPhoneu. Ovaj zapis opisuje **izolovanu test aplikaciju**, ne produkciju DVD Tivat. Izvrsni zapis testa: [CLOUD_PHONE_TEST.md](./CLOUD_PHONE_TEST.md). Uslovi za produkciju: [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md). Detaljan plan organizacija: [MULTI_ORG_PLAN.md](./MULTI_ORG_PLAN.md). Matrica testiranja uredjaja i tokova: [DEVICE_QA.md](./DEVICE_QA.md). Prijedlozi novog imena: [NAME_OPTIONS.md](./NAME_OPTIONS.md).

## Sta je stvarno uradjeno

- Test PWA radi na https://boka-operativa-phone-test.netlify.app/ i koristi zasebnu Free Supabase bazu. Vlasnik je napravio i potvrdio nalog, prijavio se na iPhone, dobio OWNER prava u test organizacijama i aktivno DVD FIREFIGHTER clanstvo povezano sa svojim test roster zapisom.
- iPhone je upisao jednu aktivnu Apple Web Push pretplatu. Jedan fikcionalan `POZAR` sa naslovom `TEST POZAR - NIJE STVARNA INTERVENCIJA` poslat je samo vlasnikovom nalogu. Apple je prihvatio slanje 2026-09-30 u 19:08 UTC; vlasnik je potvrdio da je obavjestenje stiglo **na zakljucan telefon**.
- Apple je prvobitno odbio push oznaku sa `BadWebPushTopic`; oznaka je popravljena na 32 znaka, a u zasebnu test bazu dodat grant potreban workeru za provjeru primaoca. Ispravka i grant su u draft PR #81. Ovo ne predstavlja test odziva, terenskog izlaska, drugih korisnika, Androida niti dostave u stvarnom incidentu.

## Zvuk: trenutno ponasanje i granica platforme

U **Podesavanja > Zvuk poziva na ovom uredjaju** bira se zvuk koji svira samo kada je web aplikacija otvorena i vidljiva. Taj zvuk nastaje u otvorenoj stranici; ne putuje kroz Web Push. Kada je aplikacija u pozadini, zatvorena ili je iPhone zakljucan, servisni radnik prikazuje sistemsko obavjestenje sa `silent: false`, a iOS odlucuje koji se sistemski zvuk cuje. Vlasnik je potvrdio da je tada cuo **drugi** zvuk. Ocekivano ponasanje je vec opisano ispod izbora zvuka u aplikaciji.

Apple za Web Push dokumentuje izbor **ima/nema zvuka** preko `silent`, bez izbora proizvoljnog audio fajla za iOS web aplikaciju: https://developer.apple.com/videos/play/wwdc2023/10120/ . Za ugradjeni zvuk obavjestenja na iPhoneu postoji poseban API za **native** aplikacije: https://developer.apple.com/documentation/usernotifications/unnotificationsound . Native varijanta takodje podlijeze sistemskim dozvolama, tihom rezimu i Focus pravilima; zvuk i prikaz se moraju probati na stvarnom uredjaju. Nema osnova da se PWA prikazuje kao pouzdan alarm koji zaobilazi ta pravila.

| Okolnost | Sta radi danas | Sta treba provjeriti |
| --- | --- | --- |
| Aplikacija otvorena na ekranu | Izabrani zvuk na tom uredjaju za nov poziv, ako browser dozvoli audio | Posebna proba dok je ekran otkljucan i aplikacija otvorena |
| Aplikacija zatvorena / telefon zakljucan | iOS Web Push sa sistemskim zvukom; izbor iz aplikacije se ne primjenjuje | Prijem, vrijeme dostave, zvuk i tap na poziv |
| Tihi rezim / Focus / bez interneta | iOS i mreza odredjuju ponasanje; dostava nije garantovana | Proba sa paralelnim ljudskim kanalom, bez obecanja alarma |

## Redosljed rada

1. **Test aplikacija, bez troska za vlasnikove racunare.** Nastaviti probu na iPhoneu: otvoriti test poziv iz obavjestenja; zabiljeziti vrijeme objave, prikaza i otvaranja; probati izabrani zvuk dok je aplikacija otvorena. Provjeriti potvrdjivanje prijema i odgovor `Moj poziv`, bez stvarnog izlaska na teren. Kasnije koristiti odvojene test naloge za DVD, SZS i oba servisa te Android uredjaj ako je dostupan. Svaki test poziv mora imati jasno upozorenje da nije stvarna intervencija.
2. **Zatvoriti kod i provjere.** Odgovarajucu DB migraciju primijeniti u test projektu (vec uradjeno), drzati je u harness listi, pregledati zeleni CI za funkcionalni commit `df0ab7cb` i ponoviti kontrolu na konacnom head SHA, pregledati draft #81 i provjeriti da raspored, push, prava i duboki link ostaju ispravni. PR ne proglasavati spremnim na osnovu jednog telefona.
3. **Odluka o zvuku pri zakljucanom ekranu.** Ako je prilagodjena sirena obavezna, pripremiti *zasebnu native iPhone aplikaciju*, uz postojeci server kao izvor istine: autentikacija, APNs registracija tokena, mapiranje tokena na nalog, native obavjestenje sa zapakovanim zvukom, opoziv starih uredjaja, bez podataka o lokaciji na zakljucanom ekranu. Testirati u TestFlight/distribuciji uz uslove Apple Developer programa i stvarne troskove tek nakon odluke; ne obecavati besplatan App Store ili native push. Razmotriti Android zasebno. Kriticna obavjestenja koja mogu zaobici tihi rezim/Focus zavise od posebnih Apple prava i nijesu dio postojeceg plana.
4. **Produkcija tek poslije kapija.** Ne spajati test bazu sa produkcijom. Zasebno zavrsiti produkcionu provjeru kompatibilnosti i RLS, rucni enkriptovani backup sa vracanjem na drugi cilj, kontrolisane migracije, worker, odobrenje DVD/SZS, test svake uloge, fallback kanal i zabiljezen prihvat. Detalji: [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md).

GitHub izmjene rasporeda i push workera nijesu automatski objavljene na Netlify test adresi; za novu probu telefonom potreban je zaseban deploy iz provjerenog commita.

Status native sirene: **plan, nije implementirana**. Status poziva na jednom iPhoneu: **stvarni Web Push prijem potvrdio vlasnik**. Status operativne pouzdanosti: **nije prihvacena za stvarne intervencije**.
