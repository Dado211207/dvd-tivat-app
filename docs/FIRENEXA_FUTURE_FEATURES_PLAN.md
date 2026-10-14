# FireNexa: nacrt funkcija poslije pilot povratnih informacija

**Datum:** 14. oktobar 2026.  
**Status:** samo plan za pregled vlasnika, DVD Tivat, SZS Tivat i Claude Code.  
**Granica:** nema promjene aplikacije, baze, hostinga, navigacije, korisnickih prava, email/push konfiguracije ili javne objave. Ne spajati ovaj nacrt u `main` kao odobrenu specifikaciju prije odluka navedenih ispod.

## 1. Polaziste i namjera

FireNexa trenutno sluzi za interne pozive i evidenciju DVD/SZS. Clanovi testiraju postojecu aplikaciju paralelno sa dosadasnjim nacinom obavjestavanja. Ovaj dokument razradjuje cetiri ideje iz vlasnikove biljeske: (1) Podrska za aplikaciju, (2) koristan prikaz za gradjane, (3) imenik/profil sa fotografijom, uz dob, telefon, hitni kontakt i krvnu grupu, (4) kontrolisana vidljivost podataka medju clanovima sluzbe. Biljeske o mreznom switchu i kartici nijesu zahtjevi za FireNexu.

Ovo nije vracanje stare funkcije za gradjansku dojavu. `src/ui/views/CitizenReportView.tsx` je oznacen kao napusteni istrazivacki prototip bez pravog slanja. Gradjanin ne salje dojavu u FireNexu, niti aplikacija zamjenjuje zvanicne kanale za hitne slucajeve. Stariji `docs/ACCOUNTS_REPORTS_MAP_PLAN.md` opisuje istorijski plan, ne aktuelnu odluku o proizvodu. Trenutni status i granice su u `docs/PROJECT_HANDOFF.md`.

## 2. Preporuceni obim i redosljed

| Paket | Vrijednost | Preporuka | Zavisnost prije objave |
| --- | --- | --- | --- |
| A. Podrska i greske | Direktan feedback iz pilota, brzi trag za otklanjanje greske | Prvi za dizajn i kasniju izradu | Vlasnik prijava i postupak odgovora, sigurnost podataka, end-to-end test |
| B. Imenik i profilna slika | Clan brzo nalazi kolegu i kontakt u sopstvenoj sluzbi | Drugi | Saglasnost sluzbi oko polja, privatnosti i opsega pristupa |
| C. Obavjestenja za gradjane | Gradjanin vidi odobrene osnovne informacije o intervencijama | Poslije interne probe i odobrenja DVD/SZS | Urednik, pravilo objave, tekst o ogranicenjima i test protiv curenja detalja |
| D. Hitni kontakt i krvna grupa | Pomoc kod povrede clana, ako sluzbe potvrde potrebu | Odvojena odluka; kontakt prije krvne grupe | Definisana svrha, informisanje ljudi, prava pristupa, rok cuvanja i procedura provjere |

Ni jedna funkcija iz paketa A-D nije uslov da se trenutni pilot nastavi. Buduce kodne promjene raditi na zasebnim granama protiv lokalne/izolovane test baze; ne mijenjati hosted pilot dok traje ocjenjivanje.

## 3. A: Podrska u Podesavanjima

U dnu `Podesavanja` dodati karticu `Pomoc i podrska` sa jasnim dugmetom `Prijavi problem`. Stranica `Podesavanja` je danas dostupna i bez vatrogasne uloge (`src/ui/views/SettingsView.tsx`), pa i gradjanin moze poslati tehnicku prijavu, ali pristup operativnim podacima ostaje zatvoren. Ponuditi tri vrste: `Greska u radu`, `Pitanje` i `Predlog`. Obavezno kratak opis; za gresku neobavezni koraci, ocekivano i stvarno ponasanje. Ne traziti od prijavioca da zna tehnicke termine. Nakon slanja prikazati broj prijave i potvrdu.

Za gresku priložiti **minimalan tehnicki kontekst**: verziju/commit aplikacije, rutu ekrana, vrijeme, platformu i browser, sirinu prikaza, online/offline stanje i nasumicni ID prijave ili vec postojeci correlation ID konkretne greske. Poslati samo nakon sto korisnik vidi sta se prilaze; zasebno pitati za screenshot. Ne slati automatski lozinke, tokene, email/telefon drugih ljudi, tacnu lokaciju incidenta, podatke o intervenciji, slobodan dump `localStorage`, mrezne zahtjeve, bazu ili puni console log. Screenshot treba pregled/brisanje osjetljivog sadrzaja prije slanja.

Server prima prijavu u posebnu tabelu, veze je za prijavljenog korisnika, cuva status `NOVO / U RADU / RIJESENO`, datum i odgovor. Korisnik moze vidjeti svoje prijave; vlasnik moze trijazirati sve. Drugi clanovi i obicni administratori nemaju pristup sadrzaju po defaultu. Ograniciti broj prijava po nalogu, velicinu priloga i rok cuvanja; sva autorizacija je serverska. Email obavijest vlasniku sadrzi samo broj prijave, tip i kratak bezopasan opis/link do zasticenog prikaza, bez raw dijagnostike. Snimiti prijavu prije emaila; neuspjeli email ne smije obrisati prijavu. Ako se koristi postojeci SMTP za Auth, ne pretpostaviti da Edge funkcija automatski ima tajnu ili pravo slanja: izabrati zaseban siguran server-side sender i provjeriti isporuku.

**Prihvat:** gradjanin moze prijaviti svoju gresku ali ne cita tudju; suspendovan korisnik ne dobija operativni pristup; email ne otkriva privatne detalje; duplikat/neuspjelo slanje jasno je prikazano; nema tajni u prilozima; owner dobija prijavu i moze je oznaciti rijesenom.

## 4. B: Imenik clanova i profilne fotografije

U operativnom dijelu dodati `Clanovi sluzbe`. Prijavljeni aktivni clan DVD-a vidi aktivne DVD clanove; isto vazi za SZS. Clan obje sluzbe vidi samo izabranu sluzbu, nikada spojenu listu. Korisnik bez aktivne operativne uloge vidi nula clanova. Ucesce u zajednickom pozivu samo po sebi ne otvara imenik druge sluzbe. Postojeci `members` i `organization_memberships` vec imaju org granicu; `src/auth/roster.ts` danas cita clanove za administraciju. Nova funkcija treba poseban, minimalan server-side read model/RPC za obican imenik, ne sirovi `SELECT *` nad `profiles` ili prosirenim `members`.

Preporucena kartica clana: ime, funkcija u toj sluzbi (ako je odobrena za prikaz), fotografija ili inicijali, i dugme `Pozovi`. Datum rodjenja je vec potreban pri registraciji, ali imenik ne smije prikazati puni datum; godine racunati iz datuma i prikazivati samo ako su sluzbe to odobrile. Broj iz naloga ne dijeliti automatski kolegama: odvojeno polje `kontakt za sluzbu` ili izbor clana da njegov postojeci broj bude vidljiv u imeniku. Ako clan nema nalog, organizacija moze imati roster zapis bez fotografije i sa kontrolisanim sluzbenim kontaktom. Samo vlasnik/admin ovlascen za sluzbu odrzava roster; clan moze urediti samo svoja dozvoljena kontakt polja i sliku.

Fotografija je neobavezna. Privatni storage, provjera stvarnog formata i dimenzija, smanjenje slike/uklanjanje EXIF lokacije na serveru, ogranicenje velicine, moderacija/uklanjanje od strane admina, fallback na inicijale. Ne izlagati javni URL za fotografiju ili cache koji ostaje dostupan nakon suspenzije; testirati opoziv i promjenu sluzbe.

**Prihvat:** DVD ne vidi SZS imenik; SZS ne vidi DVD imenik; dvojni clan vidi samo trenutno izabranu sluzbu; gradjanin, odjavljeni i suspendovani ne citaju imenik ni fotografije; profil se brzo otvara na telefonu; clan moze ukloniti svoju sliku.

## 5. D: Hitni kontakt i krvna grupa

Ova dva polja ne pripadaju obicnom imeniku. Hitni kontakt je i podatak trece osobe. Predlog: clan moze upisati ime, vezu i broj jednog ili dva hitna kontakta, uz potvrdu da je kontakt obavijesten. Vidi/uredjuje sopstvene podatke. Komandir, ovlasceni administrator i owner unutar njegove sluzbe mogu ih otvoriti kada postoji opravdana potreba; drugi vatrogasci ne vide ih automatski. Pristup po mogucnosti auditovati (ko, kada, za kog clana); nikad u javnom profilu, push poruci, logu ili emailu. Posebno odrediti sta se radi sa kontaktom nakon izlaska iz sluzbe.

Krvna grupa je **posebna opcionalna odluka**. Ne dodavati je u `members` ili `profiles`: postojeca pravila citanja tih tabela nijesu projektovana za medicinske kolone. Ako sluzbe nakon pregleda ipak traze polje, cuvati ga odvojeno sa vrlo uskim citanjem, oznakom izvora (`sam unio` / `provjerena dokumentacija` ako postoji formalna procedura) i datumom provjere; korisnik moze ostaviti `nepoznato`. Ne prikazivati kao pouzdan medicinski nalaz i ne koristiti ga za odluku o transfuziji. Bolnica prije transfuzije radi odgovarajucu provjeru krvne grupe.

Prije bilo kakve stvarne medicinske evidencije vlasnik i sluzbe moraju utvrditi osnov/svrhu obrade, ko smije vidjeti podatak, obavjestenje clanovima i hitnim kontaktima, ispravku/brisanje, rok cuvanja i reviziju pristupa prema vazecim pravilima zastite licnih podataka. Nije dovoljno samo dodati novo polje na postojeci profil.

## 6. C: Koristan gradjanski prikaz

Gradjaninu ponuditi `Obavjestenja o intervencijama`: pregled **samo odobrenih javnih objava** sluzbe. Za svaku objavu: tip (npr. pozar), siroka oblast/mjesto bez tacne tacke, status (`u toku`/`zavrseno`), vrijeme koje znamo iz sistema sa tacnim nazivom (`poziv evidentiran` ili `objava`, ne izmisljeno vrijeme dojave), vrijeme zavrsetka tek kad je stvarno zatvorena, kratak tekst odobren za javnost i vrijeme poslednjeg azuriranja. Prazno stanje i kasnija objava moraju biti normalni: nijesu sve intervencije javne, niti je spisak potpun pregled svih hitnih dogadjaja.

Komandir ovlascen za sluzbu sastavlja ili odobrava javnu objavu; admin/owner mogu korigovati ili povuci uz audit. Sistem moze ponuditi predlog iz intervencije, ali nikad automatski objaviti svaki interni poziv, draft, test/vjezbu ili sirovi opis. Odvojena tabela/projekcija javne objave: javna stranica ne cita `interventions`, `intervention_recipients`, prisustvo, lokaciju vozila, identitete i telefone clanova. Ne prikazivati tacnu aktivnu lokaciju, taktiku, adrese privatnih lica, fotografije ljudi, unutrasnje biljeske, brzinu odziva pojedinaca niti broj raspolozivih vatrogasaca. Prvo razmotriti objave **po zavrsetku**; sire zivo obavjestavanje samo ako DVD/SZS dogovore urednicko dezurstvo, kasnjenje i pravila bezbjednosti. Ako nijesu spremni da uredjuju objave, bolja pocetna korist za gradjane su novosti o obuci, akcijama i kontakt zvanicnih kanala.

Na ekranu trajno i razumljivo: informativni sadrzaj nije kanal za prijavu pozara niti garancija potpunog/uzivo stanja. Prava za javne objave su odvojena po sluzbi: DVD ne objavljuje u ime SZS bez odobrenja, a zajednicki poziv ne otkriva interne detalje druge sluzbe. Treba odluciti da li je pregled dostupan svima ili samo prijavljenim gradjanima; javna informacija ne bi trebalo da zavisi od naloga bez jasnog razloga.

**Prihvat:** gradjanin vidi samo izricito objavljene zapise; ne moze pogoditi interni ID i procitati poziv; test/vjezba nikad ne procuri; povlacenje uklanja javni zapis; vrijeme/status su ispravni i objava jasno pokazuje ko je izvor.

## 7. Gdje se uklapa u postojeci kod

- `src/ui/views/SettingsView.tsx`: mjesto za ulaz u Podrsku; ne mjesati postavke uredjaja sa profilom naloga bez jasne sekcije.
- `src/access/navigation.ts` i `src/ui/router.ts`: novi imenik za staff i eventualni informativni gradjanski ekran; frontend je samo navigacija, nikad izvor prava.
- `src/auth/roster.ts`, `src/auth/directory.ts`: postojece citanje rostra i owner direktorijuma nijesu API za novi imenik/medicinske podatke.
- `supabase/migrations/`: zasebne aditivne tabele/RPC/RLS za prijave, javne objave, dozvoljene detalje profila, hitni kontakt i eventualnu krvnu grupu; sve raditi u izolovanoj bazi i testirati aktivnost/suspenziju/organizaciju/owner.
- `supabase/functions/`: server-side email obavijest i bezbjedna obrada fotografija/dijagnostike samo ako je opravdana arhitekturom; tajne nikad u `VITE_*` ili browseru.
- `db-tests/`, `e2e/`, `docs/RELEASE_ACCEPTANCE.md`: negativni testovi pristupa, privacy, telefon i prijava supporta; niti jedna izmjena ne ide u pilot prije odobrenja.

## 8. Odluke za vlasnika i sluzbe prije implementacije

1. Ko prima i odgovara na support prijave: samo owner ili i imenovani admin? Na koju adresu ide email i koliko brzo se trijazira u pilotu?
2. Da li clan zeli privatni mobilni broj vidljiv svim aktivnim kolegama u svojoj sluzbi, ili samo poseban sluzbeni kontakt? Da li prikazujemo tacne godine ili samo ime/funkciju?
3. Koji komandir/admin smije otvoriti hitni kontakt, i da li sluzba zaista ima postupak u kom bi upotrijebila krvnu grupu?
4. Da li DVD i SZS uopste zele javna obavjestenja o intervencijama? Ko ih potpisuje, kada smiju izaci i koliko precizno smije biti mjesto? Predlog: poceti zavrsenim, rucno odobrenim objavama.
5. Ko je vlasnik/pod kontrolom sluzbe za stvarne podatke, politiku cuvanja, brisanja i pristupa; postoji li obavjestenje clanovima i kontaktima?

## 9. Granice faze i pregled sa Claudeom

Sacekati stvarni feedback vatrogasaca. Zatim za svaki paket prvo izraditi zaseban tehnicki nacrt i RLS matricu, dati Claude Codeu na nezavisan pregled (posebno `profiles`/`members` vec siroke citanosti, DVD/SZS izolaciju, gradjanski read model i sanitizaciju dijagnostike), pa tek onda odluciti o izolovanoj implementaciji. Nijedan korak ovog dokumenta nije odobrenje za objavu, Supabase migraciju ili promjenu pilota.

### Kratak zadatak za Claude Code (na engleskom)

> Review `docs/FIRENEXA_FUTURE_FEATURES_PLAN.md` against the current `main` code, migrations, RLS and the pilot handoff. Do not implement or deploy anything. Identify missing threat scenarios, contradictory assumptions, the smallest safe schema/UI slices, and any places where the proposed citizen view or sensitive member fields could leak across DVD/SZS. Return a prioritized critique with file paths and exact tests to add later. Treat the current pilot as frozen.

## Reference za medicinsku i privatnosnu provjeru

- Agencija za zastitu licnih podataka Crne Gore: <https://www.azlp.me/me/propisi> (aktuelna lista propisa, provjeriti pri implementaciji).
- NHS: <https://www.nhs.uk/tests-and-treatments/blood-transfusion/> (provjera uzorka prije transfuzije).
