# FireNexa: nacrt funkcija poslije pilot povratnih informacija

**Datum:** 14. oktobar 2026.  
**Status:** samo plan za pregled vlasnika, DVD Tivat i SZS Tivat; dopunjen poslije nezavisnog Claude Code pregleda od 14. oktobra 2026.  
**Granica:** nema promjene aplikacije, baze, hostinga, navigacije, korisnickih prava, email/push konfiguracije ili javne objave. Ne spajati ovaj nacrt u `main` kao odobrenu specifikaciju prije odluka navedenih ispod.

## 1. Polaziste i namjera

FireNexa trenutno sluzi za interne pozive i evidenciju DVD/SZS. Clanovi testiraju postojecu aplikaciju paralelno sa dosadasnjim nacinom obavjestavanja. Ovaj dokument razradjuje cetiri ideje iz vlasnikove biljeske: (1) Podrska za aplikaciju, (2) koristan prikaz za gradjane, (3) imenik/profil sa fotografijom, uz dob, telefon, hitni kontakt i krvnu grupu, (4) kontrolisana vidljivost podataka medju clanovima sluzbe. Biljeske o mreznom switchu i kartici nijesu zahtjevi za FireNexu.

Ovo nije vracanje stare funkcije za gradjansku dojavu. `src/ui/views/CitizenReportView.tsx` je oznacen kao napusteni istrazivacki prototip bez pravog slanja **iz tog ekrana**, ali serverski dio nije uklonjen: `supabase/migrations/202609090001_accounts_reports.sql` i dalje definise `citizen_reports`, `report_media`, privatni bucket `report-media` i pravila za pisanje/citanje. Aktivnom nalogu migracija dozvoljava unos prijave, a `is_dvd_staff()` cita postojece prijave i slike; UI trenutno ne koristi taj put. Prije javnog gradjanskog prikaza treba odluciti da li taj stari prijem dojava formalno povuci ili ga zadrzati sa jasno dokumentovanom svrhom; pri povlacenju posebno provjeriti stvarno stanje hostovane baze, podatke i zavisnosti, bez naglog brisanja. Ne vezivati novu informativnu funkciju za te tabele. Gradjanin ne treba da salje dojavu kroz novi ekran, niti aplikacija zamjenjuje zvanicne kanale za hitne slucajeve. Stariji `docs/ACCOUNTS_REPORTS_MAP_PLAN.md` opisuje istorijski plan, ne aktuelnu odluku o proizvodu. Trenutni status i granice su u `docs/PROJECT_HANDOFF.md`.

## 2. Preporuceni obim i redosljed

| Paket | Vrijednost | Preporuka | Zavisnost prije objave |
| --- | --- | --- | --- |
| A. Podrska i greske | Direktan feedback iz pilota, brzi trag za otklanjanje greske | Prvi za dizajn; bez priloga u prvoj izolovanoj verziji | Vlasnik prijava i postupak odgovora, sigurnost podataka, end-to-end test |
| B. Imenik i profilna slika | Clan brzo nalazi kolegu u sopstvenoj sluzbi | Prvo imena i inicijali; uloga, kontakt i slika odvojeno kasnije | Saglasnost sluzbi oko polja, privatnosti i opsega pristupa |
| C. Obavjestenja za gradjane | Gradjanin vidi odobrene osnovne informacije o intervencijama | Prvo rucno odobreni sazetci po zavrsetku; zive objave su posebna odluka | Stari prijem dojava, urednik, pravilo objave i test protiv curenja detalja |
| D. Hitni kontakt | Mogucnost kontaktiranja porodice pri povredi clana | Kasnije, zasebna odluka, komandni pristup uz audit | Definisana svrha, informisanje ljudi, prava pristupa i rok cuvanja |
| E. Krvna grupa | Neutvrdjena operativna korist | Trenutno ne prikupljati; zasebna odluka samo ako sluzbe dokazu potrebu | Promjena postojece odluke o minimizaciji, formalna medicinska i privatnosna provjera |

Ni jedna od ovih funkcija nije uslov da se trenutni pilot nastavi. Buduce kodne promjene raditi na zasebnim granama protiv lokalne/izolovane test baze; ne mijenjati hosted pilot dok traje ocjenjivanje. Podrska je prva za projektovanje, ali prednost ne znaci odobrenje da je pustimo u tekuci pilot. Imenik samo sa imenima ima smisla ako vatrogasci potvrde da bi ga stvarno koristili.

## 3. A: Podrska u Podesavanjima

U dnu `Podesavanja` dodati karticu `Pomoc i podrska` sa jasnim dugmetom `Prijavi problem`. Stranica `Podesavanja` je danas dostupna i bez vatrogasne uloge (`src/ui/views/SettingsView.tsx`), pa i gradjanin moze poslati tehnicku prijavu, ali pristup operativnim podacima ostaje zatvoren. Ponuditi tri vrste: `Greska u radu`, `Pitanje` i `Predlog`. Obavezno kratak opis; za gresku neobavezni koraci, ocekivano i stvarno ponasanje. Ne traziti od prijavioca da zna tehnicke termine. Nakon slanja prikazati broj prijave i potvrdu.

Za gresku priložiti **minimalan tehnicki kontekst**: verziju/commit aplikacije, rutu ekrana, vrijeme, platformu i browser, sirinu prikaza, online/offline stanje i nasumicni ID prijave ili vec postojeci correlation ID konkretne greske. Poslati samo nakon sto korisnik vidi sta se prilaze. U prvoj verziji **bez screenshotova i drugih priloga**; eventualni prilog kasnije uz zaseban pregled i uklanjanje osjetljivog sadrzaja. Ne slati automatski lozinke, tokene, email/telefon drugih ljudi, tacnu lokaciju incidenta, podatke o intervenciji, slobodan dump `localStorage`, mrezne zahtjeve, bazu ili puni console log. Tekst koji korisnik slobodno upise moze ipak sadrzati tudje podatke: ograniciti i jasno objasniti unos, cuvati samo ovlascenima, ne prepisivati opis u email.

Server prima prijavu u posebnu tabelu, veze je za prijavljenog korisnika, cuva status `NOVO / U RADU / RIJESENO`, datum i odgovor. Korisnik moze vidjeti svoje prijave; vlasnik moze trijazirati sve. Drugi clanovi i obicni administratori nemaju pristup sadrzaju po defaultu. `Podesavanja` su dostupna i odjavljenima, ali se za slanje trazi prijava; pravila za `PENDING` i `SUSPENDED` odrediti prije dizajna RLS. Ograniciti broj prijava po nalogu i rok cuvanja; sva autorizacija je serverska. Email obavijest vlasniku sadrzi samo broj prijave i tip/link do zasticenog prikaza, bez slobodnog opisa i dijagnostike. Snimiti prijavu prije emaila; neuspjeli email ne smije obrisati prijavu, vec zabiljeziti neuspjeh za kasniji pokusaj. Kod offline stanja prikazati da prijava nije poslata, sacuvati uneseni tekst samo dok je ekran otvoren i omoguciti rucni ponovni pokusaj; ne uvoditi trajni lokalni red prijava bez posebnog plana zastite tih podataka.

Slanje emaila je novi serverski mehanizam; Auth SMTP i postojeci Web Push nijesu gotov sender za prijave. `docs/PROJECT_HANDOFF.md` posebno zabranjuje tajne u `pg_net` zahtjevima dostupnim DB login ulogama. Koristiti red obavjestenja i serverski proces/Edge Function sa tajnom van browsera i DB-citljivog `pg_net` zahtjeva; nacin bezbjednog pokretanja i ponavljanja provjeriti na stvarnoj konfiguraciji prije implementacije. `send-web-push` je primjer drzanja serverskih tajni, ne dokaz da je postojeci raspored prikladan za email.

**Prihvat:** prijavljeni gradjanin moze prijaviti svoju gresku ali ne cita tudju; odjavljeni dobija zahtjev da se prijavi; suspendovan korisnik ne dobija operativni pristup; email ne otkriva privatne detalje; duplikat/neuspjelo slanje jasno je prikazano; nema tajni u dijagnostici; owner dobija prijavu i moze je oznaciti rijesenom.

## 4. B: Imenik clanova i profilne fotografije

U operativnom dijelu dodati `Imenik`. Prijavljeni aktivni clan DVD-a vidi aktivne DVD clanove; isto vazi za SZS. Clan obje sluzbe vidi samo izabranu sluzbu, nikada spojenu listu. Korisnik bez aktivne operativne uloge vidi nula clanova. Ucesce u zajednickom pozivu samo po sebi ne otvara imenik druge sluzbe. Postojeci `members_staff_read` (`supabase/migrations/202609240024_organisation_registry.sql`) vec dozvoljava obicnom aktivnom vatrogascu da cita `members` svoje sluzbe; imena nijesu novo pravo. Prva verzija moze iskoristiti tu granicu za imena i inicijale. Za nove podatke kao sto su uloga, izabrani kontakt i fotografija treba zaseban minimalan model/RPC: ne siriti pristup `profiles` ili `organization_memberships`, ne dodavati osjetljiva polja u siroko citani `members`, ne emitovati `members.user_id` u prikazu. Pregledati da li sirovi `members.user_id` zahtijeva zasebnu usku projekciju za sam imenik.

Prva kartica clana: ime i inicijali; dodati funkciju u toj sluzbi samo ako se odobri zasebna projekcija. Broj iz naloga ne dijeliti automatski kolegama: za kasniju fazu odvojeno polje `kontakt za sluzbu` koje clan izricito objavi. Datum rodjenja je vec potreban pri registraciji, ali imenik ne smije prikazati puni datum; i prikaz godina je posebna odluka sluzbi, ne dio prve verzije. Ako clan nema nalog, organizacija moze imati roster zapis bez fotografije i sa kontrolisanim sluzbenim kontaktom. Samo vlasnik/admin ovlascen za sluzbu odrzava roster; clan moze urediti samo svoja dozvoljena kontakt polja i sliku.

Fotografija je neobavezna i ide u kasniju fazu. Privatni storage, provjera stvarnog formata i dimenzija, smanjenje slike/uklanjanje EXIF lokacije na serveru, ogranicenje velicine, moderacija/uklanjanje od strane admina, fallback na inicijale. Ne izlagati javni URL. Kratkotrajni potpisani URL moze ostati dostupan **do isteka i nakon suspenzije**: za zahtjev trenutnog opoziva treba pristup preko provjeravanog servera/proxy-ja ili drugo rjesenje koje autorizuje svaki zahtjev; odrediti tolerisani rok pristupa prije izbora arhitekture. Testirati suspenziju i promjenu sluzbe.

**Prihvat:** DVD ne vidi SZS imenik; SZS ne vidi DVD imenik; dvojni clan vidi samo trenutno izabranu sluzbu; gradjanin, odjavljeni i suspendovani ne dobijaju nove pristupe imeniku ni fotografijama; profil se brzo otvara na telefonu; nakon faze sa slikama clan moze ukloniti svoju sliku. Testovi citanja moraju imati pozitivan zapis kao dokaz da zabranjeni podaci zaista postoje.

## 5. D i E: Hitni kontakt i krvna grupa kao odvojene odluke

Ova dva polja ne pripadaju obicnom imeniku. Hitni kontakt je i podatak trece osobe. Predlog: clan moze upisati ime, vezu i broj jednog ili dva hitna kontakta, uz potvrdu da je kontakt obavijesten. Vidi/uredjuje sopstvene podatke. Komandir, ovlasceni administrator i owner unutar njegove sluzbe mogu ih otvoriti kada postoji opravdana potreba; drugi vatrogasci ne vide ih automatski. Pristup po mogucnosti auditovati (ko, kada, za kog clana); nikad u javnom profilu, push poruci, logu ili emailu. Posebno odrediti sta se radi sa kontaktom nakon izlaska iz sluzbe.

Krvna grupa je **zasebna odluka, trenutno ne prikupljati**. `supabase/migrations/202609200014_required_registration_profile.sql` je izricito iskljucila krvnu grupu i zdravstvene podatke iz registracije; novi unos bi promijenio tu odluku. Ne dodavati je u `members` ili `profiles`: postojeca pravila citanja tih tabela nijesu projektovana za medicinske kolone. Ako sluzbe nakon formalne medicinske i privatnosne provjere ipak dokazu potrebu, traziti dokumentovanu osnovu i postupak, odvojeno cuvanje sa vrlo uskim citanjem, oznakom izvora i datumom eventualne provjere; korisnik moze ostaviti `nepoznato`. Ne prikazivati kao pouzdan medicinski nalaz i ne koristiti ga za odluku o transfuziji. Bolnica prije transfuzije radi odgovarajucu provjeru krvne grupe.

Prije bilo kakve stvarne medicinske evidencije vlasnik i sluzbe moraju utvrditi osnov/svrhu obrade, ko smije vidjeti podatak, obavjestenje clanovima i hitnim kontaktima, ispravku/brisanje, rok cuvanja i reviziju pristupa prema vazecim pravilima zastite licnih podataka. Nije dovoljno samo dodati novo polje na postojeci profil.

## 6. C: Koristan gradjanski prikaz

Gradjaninu ponuditi `Obavjestenja o intervencijama`: pregled **samo odobrenih javnih objava** sluzbe. Za prvu fazu, objava ide poslije zatvaranja i nosi status `zavrseno`, tip (npr. pozar), siroku oblast/mjesto bez tacne tacke, vrijeme koje znamo iz sistema sa tacnim nazivom (`poziv evidentiran` ili `objava`, ne izmisljeno vrijeme dojave), vrijeme zavrsetka tek kad je stvarno zabiljezeno, kratak tekst odobren za javnost i vrijeme objave/azuriranja. Status `u toku` pripada tek eventualnoj kasnijoj fazi sa posebnim urednickim dezurstvom. Prazno stanje i kasnija objava moraju biti normalni: nijesu sve intervencije javne, niti je spisak potpun pregled svih hitnih dogadjaja.

Komandir ovlascen za sluzbu sastavlja ili odobrava javnu objavu; admin/owner mogu korigovati ili povuci uz audit. Sistem moze ponuditi predlog iz intervencije, ali nikad automatski objaviti svaki interni poziv, draft, test/vjezbu ili sirovi opis. Odvojena tabela/projekcija javne objave: javna stranica ne cita `interventions`, `intervention_recipients`, prisustvo, lokaciju vozila, identitete i telefone clanova. Ne prikazivati tacnu aktivnu lokaciju, taktiku, adrese privatnih lica, fotografije ljudi, unutrasnje biljeske, brzinu odziva pojedinaca niti broj raspolozivih vatrogasaca. Prvo razmotriti objave **po zavrsetku**; sire zivo obavjestavanje samo ako DVD/SZS dogovore urednicko dezurstvo, kasnjenje i pravila bezbjednosti. Ako nijesu spremni da uredjuju objave, bolja pocetna korist za gradjane su novosti o obuci, akcijama i kontakt zvanicnih kanala.

Na ekranu trajno i razumljivo: informativni sadrzaj nije kanal za prijavu pozara niti garancija potpunog/uzivo stanja. Prava za javne objave su odvojena po sluzbi: DVD ne objavljuje u ime SZS bez odobrenja, a zajednicki poziv ne otkriva interne detalje druge sluzbe. Treba odluciti da li je pregled dostupan svima ili samo prijavljenim gradjanima; javna informacija ne bi trebalo da zavisi od naloga bez jasnog razloga.

**Prihvat:** gradjanin vidi samo izricito objavljene zapise; ne moze pogoditi interni ID i procitati poziv; test/vjezba nikad ne procuri; povlacenje uklanja javni zapis; vrijeme/status su ispravni i objava jasno pokazuje ko je izvor.

## 7. Gdje se uklapa u postojeci kod

- `src/ui/views/SettingsView.tsx`: mjesto za ulaz u Podrsku; ne mjesati postavke uredjaja sa profilom naloga bez jasne sekcije.
- `src/access/navigation.ts` i `src/ui/router.ts`: novi imenik za staff i eventualni informativni gradjanski ekran; frontend je samo navigacija, nikad izvor prava. `clanovi` i `clan` su trenutno prototipske rute koje se u produkciji preusmjeravaju; predlog je nova ruta `imenik`, a `e2e/retired-prototype.spec.ts` ostaje uskladjen sa starim rutama.
- `src/auth/roster.ts`, `src/auth/directory.ts`: postojece citanje rostra i owner direktorijuma nijesu API za novi imenik/medicinske podatke.
- `supabase/migrations/`: zasebne aditivne tabele/RPC/RLS za prijave, javne objave, dozvoljene detalje profila, hitni kontakt i eventualnu krvnu grupu; sve raditi u izolovanoj bazi i testirati aktivnost/suspenziju/organizaciju/owner.
- `supabase/functions/`: server-side email obavijest i bezbjedna obrada fotografija/dijagnostike samo ako je opravdana arhitekturom; tajne nikad u `VITE_*` ili browseru.
- `db-tests/`, `e2e/`, `docs/RELEASE_ACCEPTANCE.md`: negativni testovi pristupa, privatnost, telefon i prijava supporta; svaki test zabrane citanja treba imati i privilegovanu provjeru da ciljni zapis postoji. Testirati DVD/SZS razdvajanje, dvojni nalog, suspenziju, gradjanina, odjavljenog i pogodjeni interni ID. Niti jedna izmjena ne ide u pilot prije odobrenja.

## 8. Odluke za vlasnika i sluzbe prije implementacije

1. Ko prima i odgovara na support prijave: samo owner ili i imenovani admin? Na koju adresu ide email i koliko brzo se trijazira u pilotu?
2. Da li clan zeli privatni mobilni broj vidljiv svim aktivnim kolegama u svojoj sluzbi, ili samo poseban sluzbeni kontakt? Da li prikazujemo tacne godine ili samo ime/funkciju?
3. Koji komandir/admin smije otvoriti hitni kontakt, i da li sluzba zaista ima postupak u kom bi upotrijebila krvnu grupu?
4. Da li DVD i SZS uopste zele javna obavjestenja o intervencijama? Ko ih potpisuje, kada smiju izaci i koliko precizno smije biti mjesto? Predlog: poceti zavrsenim, rucno odobrenim objavama.
5. Ko je vlasnik/pod kontrolom sluzbe za stvarne podatke, politiku cuvanja, brisanja i pristupa; postoji li obavjestenje clanovima i kontaktima?
6. Stari `citizen_reports` i medijski bucket: formalno povuci funkciju ili je zadrzati sa objasnjenom svrhom? Prvo ocijeniti hostovano stanje, podatke, eventualne klijente i posljedice; ne brisati napamet.
7. Nova ruta imenika: predlog `imenik`, bez ozivljavanja starih prototipskih ruta `clanovi` i `clan`.

## 9. Granice faze i pregled sa Claudeom

Claude Code je 14. oktobra 2026. dostavio nezavisan pregled originalnog nacrta; njegove provjerene ispravke i nase dodatne ograde unijete su ovdje. Sacekati stvarni feedback vatrogasaca. Zatim za svaki paket izraditi zaseban tehnicki nacrt i RLS matricu, dodatno pregledati bezbjednosne granice i tek onda odluciti o izolovanoj implementaciji. Nijedan korak ovog dokumenta nije odobrenje za objavu, Supabase migraciju ili promjenu pilota. Prije bilo kakvog izdanja potreban je poseban prihvat vlasnika i sluzbi, dokumentovan u `docs/RELEASE_ACCEPTANCE.md`.

### Zadatak za eventualni ponovni pregled (na engleskom)

> Re-review the revised `docs/FIRENEXA_FUTURE_FEATURES_PLAN.md` against current `main`, RLS and the pilot handoff. Confirm the dormant `citizen_reports` server stack, existing staff read of `members`, the email-worker secret boundary and signed-photo-URL expiry caveat. Flag remaining contradictions. Do not implement or deploy anything. Treat the current pilot as frozen.

## Reference za medicinsku i privatnosnu provjeru

- Agencija za zastitu licnih podataka Crne Gore: <https://www.azlp.me/me/propisi> (aktuelna lista propisa, provjeriti pri implementaciji).
- NHS: <https://www.nhs.uk/tests-and-treatments/blood-transfusion/> (provjera uzorka prije transfuzije).
