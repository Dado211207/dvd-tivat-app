# Boka Operativa - trenutno stanje i plan

## Nacrt poboljsanja, jos nije na testnom sajtu (2. oktobar 2026)

[Plan dovrsetka, sajta i tri videa](./APP_FINISH_AND_ONBOARDING_PLAN.md) je
upisan prije izmjena. Draft PR #82 sada ima ispravku za poziv objema sluzbama
kada sluzba komandira nema primalaca, dva uredjiva predloga uputstva za TEST
i VJEZBU, vremena otvaranja/odgovora/kretanja na komandnom pregledu i nacrt
identiteta **Boka Signal** sa novim SVG/PWA ikonama. Sve su to promjene u kodu,
ne objavljene funkcije. Sajt je pripremljen u kodu; tri videa jos nijesu
snimljena. Ne traziti
novu probu na vlasnikovom telefonu tokom ove faze. U nacrtu je sada i pregled
broja jedinstvenih podobnih naloga i naloga sa aktivnom Web Push pretplatom u
potvrdi objave. Server daje zbir samo komandiru i ponovo racuna stvarne
primaoce pri slanju. U izdvojenoj testnoj Supabase bazi migracija je dala
DVD 2 podobna / 1 push, SZS 0 / 0 i zajedno 2 / 1 za postojece test podatke;
neovlasceni nalog je odbijen, anoniman nema EXECUTE pravo. Nula poznatih
primalaca blokira potvrdu, a nula push pretplata upozorava. Broj pretplata
ne dokazuje dostavu, a prikaz nije jos objavljen na testnom sajtu. Puna CI
provjera ovog koraka je prosla u [run 37028798449](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37028798449),
sa baznim, RLS i browser testovima. Vodjena priprema naloga je sada u draft
PR-u: vlasnik bira sluzbu, postojeceg clana ili
novi zapis iz potpunog profila, te ulogu, a serverska transakcija upisuje
povezivanje i ulogu zajedno. Puna CI provjera je prosla u
[run 37039803188](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37039803188).
CLI u ovom radnom okruzenju nije prijavljen na Netlify, a konektor ne bira
PR granu za rucnu objavu. Zato taj kod jos nije na testnom sajtu. Zatim slijede pregled
izgleda i javni materijali. Staticni izvor informativnog sajta je pripremljen u
`site/`, sa instalacijom, ulogama i oznacenim video sekcijama u pripremi;
scenariji za tri videa su u [VIDEO_PRODUCTION_SCRIPT.md](./VIDEO_PRODUCTION_SCRIPT.md).
Sajt i videa jos nijesu objavljeni. Stari naziv u ovom naslovu
oznacava trenutno objavljenu verziju.

U draft PR #82 dodat je filter naloga bez aktivne DVD/SZS uloge, radi brzeg
pronalazenja novih gradjanskih naloga. Ne dodjeljuje prava automatski.

Zavrsni javni URL ce biti profesionalno imenovan bez `test` u adresi. Stari
testni host ostaje do zavrsetka prelaza naloga i push pretplata; sam redirect
ne prenosi instaliranu aplikaciju. Koraci su u planu dovrsetka.

## Brzi poziv: objavljen na izdvojenom testnom sajtu (1. oktobar 2026)

**Ubrzanje odgovora, 2. oktobar:** kod u draft PR #81 sada dozvoljava clanu da
jednim dodirom sacuva odgovor i potom potvrdu prijema. CI za commit `bfde58f`
je zelen ([run 36976634301](https://github.com/Dado211207/dvd-tivat-app/actions/runs/36976634301)).
Vlasnik je izricito odobrio prenos izvora na postojeci testni Netlify sajt.
Objava iz commita `b3b4814` je `6abf5e819e860ed014fdf8d3` (ready,
2026-10-02 07:34 UTC). Javna adresa vraca novi tekst jednog dodira i samo
testni Supabase URL. Vlasnik je zatim na telefonu pritisnuo `Dolazim` na
novom pozivu vrste TEST; odgovor i potvrda prijema su zasebno upisani u
testnu bazu u 08:10:59 i 08:11:00 UTC. Prikaz novog push obavjestenja na
telefonu nije zasebno opisan.
[Plan daljih pojednostavljenja](./UX_SPEED_NEXT.md).

**Proba 2. oktobra:** korisnik je izvrsio korake, a izdvojena test baza biljezi DVD poziv za dva primaoca, jedno otvaranje i odgovor `DOLAZIM`, push prihvacen od provajdera i zatvaranje bez razloga. [Detaljan zapis](./CLOUD_PHONE_TEST.md) odvaja serverske dokaze od prikaza na fizickom telefonu. SZS i zajednicki tok jos cekaju prihvat; testna SZS trenutno nema roster zapis ni operativnu ulogu, pa prvo treba pripremiti zaseban testni nalog.

Novi komandni obrazac je na jednom ekranu. Komandir bira svoju sluzbu, drugu ili obje, a server pri objavi sam zamrzava sve podobne operativne primaoce, bez rucnog biranja ljudi. Dvojni clan dobija jedan poziv. Normalno zatvaranje dozvoljava prazan razlog i opcioni izvjestaj; otkazivanje zadrzava obavezan razlog. Implementacija, kriterijumi i ogranicenja: [FAST_CALLOUT.md](./FAST_CALLOUT.md). Kodni commit `cf1c94d` ima zeleni [CI](https://github.com/Dado211207/dvd-tivat-app/actions/runs/36884138856) sa DB/RLS i browser testovima. Migracija je primijenjena samo u odvojenu testnu Supabase bazu. Raniji frontend objavljen je kao Netlify deploy `6abe8e4f67afc951415aa1a4` (2026-10-01 16:46 UTC); aktuelni deploy je naveden iznad. Neprijavljeni browser ispravno upucuje na prijavu. Ovo jos nije dokaz stvarne dostave za oba servisa. Produkcija nije dirana.


Azurnost: 2026-10-02, poslije prve probe brzog poziva u izdvojenoj testnoj bazi. Ovaj zapis opisuje **izolovanu test aplikaciju**, ne produkciju DVD Tivat. Izvrsni zapis testa: [CLOUD_PHONE_TEST.md](./CLOUD_PHONE_TEST.md). Uslovi za produkciju: [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md). Detaljan plan organizacija: [MULTI_ORG_PLAN.md](./MULTI_ORG_PLAN.md). Matrica testiranja uredjaja i tokova: [DEVICE_QA.md](./DEVICE_QA.md). Prijedlozi novog imena: [NAME_OPTIONS.md](./NAME_OPTIONS.md).

## Sta je stvarno uradjeno

- Test PWA radi na https://boka-operativa-phone-test.netlify.app/ i koristi zasebnu Free Supabase bazu. Trenutni deploy i provjere su zabiljezeni iznad. Raniji deploy `6abdf29b8db7f63eaf1ca3aa` iz commita `ac840f6` objavljen je 2026-10-01 u 05:42 UTC i predstavlja prethodnu fazu telefonske probe. Vlasnik je napravio i potvrdio nalog, prijavio se na iPhone, dobio OWNER prava u test organizacijama i aktivno DVD FIREFIGHTER clanstvo povezano sa svojim test roster zapisom.
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
2. **Prihvatiti brzi tok na uredjajima.** Migracija, harness, CI i objava testnog frontenda su zavrseni. Na telefonu i laptopu probati izdvojene testne uloge, slanje DVD-u, SZS-u i objema sluzbama, odgovor primaoca, bez duple notifikacije, te zatvaranje bez razloga i sa opcionim izvjestajem. Zabiljeziti vrijeme i rezultat svakog testa. PR ne proglasavati spremnim za produkciju na osnovu jednog telefona.
3. **Odluka o zvuku pri zakljucanom ekranu.** Ako je prilagodjena sirena obavezna, pripremiti *zasebnu native iPhone aplikaciju*, uz postojeci server kao izvor istine: autentikacija, APNs registracija tokena, mapiranje tokena na nalog, native obavjestenje sa zapakovanim zvukom, opoziv starih uredjaja, bez podataka o lokaciji na zakljucanom ekranu. Testirati u TestFlight/distribuciji uz uslove Apple Developer programa i stvarne troskove tek nakon odluke; ne obecavati besplatan App Store ili native push. Razmotriti Android zasebno. Kriticna obavjestenja koja mogu zaobici tihi rezim/Focus zavise od posebnih Apple prava i nijesu dio postojeceg plana.
4. **Produkcija tek poslije kapija.** Ne spajati test bazu sa produkcijom. Zasebno zavrsiti produkcionu provjeru kompatibilnosti i RLS, rucni enkriptovani backup sa vracanjem na drugi cilj, kontrolisane migracije, worker, odobrenje DVD/SZS, test svake uloge, fallback kanal i zabiljezen prihvat. Detalji: [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md).

Test adresa je sada rucno objavljena iz commita `b3b4814`. GitHub commit sam po sebi i dalje ne pokrece automatski Netlify deploy. Vlasnik je 2026-10-01 pregledao raniju test verziju na iPhoneu i javio da mu izgleda da sve radi, bez prijavljene greske. Za brzi komandni tok 2. oktobra imamo serverski trag poziva, odgovora i zatvaranja; odgovor jednim dodirom je potom potvrdjen na fizickom telefonu i u dva odvojena serverska zapisa. Detalji prikaza novog pusha i proba obje sluzbe jos nijesu potvrdjeni.

Status native sirene: **plan, nije implementirana**. Status poziva na jednom iPhoneu: **stvarni Web Push prijem potvrdio vlasnik**. Status operativne pouzdanosti: **nije prihvacena za stvarne intervencije**.
