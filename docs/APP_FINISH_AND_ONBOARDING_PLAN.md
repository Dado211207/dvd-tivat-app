# Plan dovrsetka aplikacije i uvodjenja korisnika

Zabiljezeno 2. oktobra 2026. Ovaj plan prati zahtjev vlasnika: sada ne
organizovati nove probe na njegovom telefonu. Prvo pojednostaviti i dovrsiti
aplikaciju, zatim identitet, javni informativni sajt i tri uputstva u videu.
Razvoj i interne automatske provjere mogu ici bez novih radnji vlasnika.

## Trenutno stanje, 3. oktobar

- FireNexa aplikacija je na <https://firenexa-app.netlify.app/>; informativni
  vodic sa QR kodom i tri ilustrovana videa je na
  <https://firenexa.netlify.app/>. Tacni deploy ID-ovi i javne provjere su u
  [zapisu prelaza](./FINAL_ORIGIN_TRANSITION.md).
- Draft PR #83 sadrzi novije zajednicke DVD/SZS funkcije od objavljene
  aplikacije. Zeleni CI na PR-u ne dokazuje da su te izmjene objavljene.
- Potrebni su prijavljeni hosted testovi sa odgovarajucim probnim nalozima,
  iPhone/Android prijem i odaziv za DVD, SZS i dvojnog clana, te odvojene
  produkcione kapije za kompatibilnost, backup/restore i prihvat sluzbi.
  Nema operativnog oslanjanja na aplikaciju prije tih provjera.

Stariji odjeljci ispod cuvaju redosljed i istoriju rada iz 2. oktobra.

## Polazno stanje i granice

- Izdvojena test aplikacija je na <https://boka-operativa-phone-test.netlify.app/>.
  Produkcioni podaci, nalog i sajt nijesu poligon za ove izmjene.
- Jedan pritisak `Dolazim` je na fizickom iPhoneu sacuvao odgovor i zasebnu
  potvrdu prijema. Dokaz i ogranicenja su u [CLOUD_PHONE_TEST.md](./CLOUD_PHONE_TEST.md).
- Popravka slanja objema sluzbama kada sluzba komandira nema primalaca je u
  draft PR #82; jos nije objavljena na testnom sajtu. Glavni zajednicki tok je
  draft PR #81. SZS i Android jos nijesu prihvaceni na stvarnim uredjajima.
- Web aplikacija na zakljucanom iPhoneu koristi sistemski zvuk obavjestenja.
  Vlastita sirena u pozadini zahtijeva zaseban native projekat; ovo ne smije
  biti predstavljeno kao funkcija postojece PWA.

## Redosljed i uslovi zavrsetka

### 1. Ubrzati dnevni rad u aplikaciji

1. **Pregled prije objave.** Server vraca broj jedinstvenih podobnih ljudi i
   broj naloga sa aktivnom Web Push pretplatom za DVD, SZS ili obje sluzbe.
   Dvojni clan broji se jednom; samo ovlasceni komandir dobija zbirne brojeve.
   Prikaz kaze da je to stanje u trenutku pregleda, a server ponovo odredjuje
   primaoce pri objavi. Nula primalaca blokira objavu; nula push pretplata
   istice upozorenje, ali ne tvrdi da je dostava propala.
2. **Kratki predlosci.** Ponuditi nekoliko uredjivih tekstova za vjezbu i
   intervenciju. Predlozak popunjava samo predlog uputstva; komandir i dalje
   upisuje vrstu, naslov i lokaciju, bira sluzbe i potvrdjuje slanje. Nema
   automatske objave. Sadrzaj predlozaka usaglasiti sa DVD/SZS prije stvarne
   operativne upotrebe.
3. **Pregled odziva.** Na prvom komandnom ekranu jasno prikazati `Dolazim`,
   `Dolazim kasnije`, `Ne mogu` i `Bez odgovora`, sa vremenima. Prijem poziva,
   odgovor, dolazak i potvrdjeno prisustvo ostaju razlicite cinjenice.
4. **Priprema naloga.** Skratiti administrativni tok od prijavljenog gradjanina
   do aktivnog DVD/SZS clana: potpun profil, roster veza, sluzba i uloga na
   jednom vodjenom ekranu, uz serverska ovlascenja i revizijski trag. Nikoga
   ne dodavati automatski u operativnu sluzbu.

Prije objave svakog koraka: pregled prava DVD/SZS, automatizovani testovi
pravila i ekrana, pristupacnost i mobilni/desktop rasporedi. Nema novog
korisnickog testa telefona u ovoj fazi. Promjene idu prvo na izdvojeni testni
sajt; produkcioni prelaz ima zasebne uslove u
[P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md).

### 2. Ime, logo i izgled

- Vlasnik je 2. oktobra odabrao **FireNexa** sa opisom
  **Fire & Rescue Response Platform**. Odluka je konacna za razvojni identitet;
  [NAME_OPTIONS.md](./NAME_OPTIONS.md) cuva odluku i granice provjere domena.
  Domen jos nije kupljen niti je dostupnost garantovana.
- Nacrtati originalan, citljiv znak: inicijali F/N sa signalnim akcentom,
  bez geografskog motiva, tudjeg grba, broja hitne sluzbe ili obecanja garantovanog alarma. Napraviti SVG i
  PWA ikone 192/512, maskable i Apple touch icon, u svijetloj/tamnoj primjeni.
- Ujednaciti naziv na naslovu stranice, u aplikaciji, manifestu, instaliranoj
  ikoni i push naslovu. Zadrzati postojeci URL, PWA identitet/scope i kljuceve
  lokalnih podataka dok se ne provjeri azuriranje postojecih instalacija.
- Pregledati kontrast, tipografiju, dodirne povrsine, skrol i prikaz na
  telefonu/tabletu/laptopu/desktopu. Ukloniti duplikate objasnjenja i
  vizuelni sum, bez skrivanja bitnih upozorenja i vremena.

### 3. Mali javni sajt

Napraviti zaseban, brz i prilagodljiv informativni sajt sa: imenom i logom,
kratkim opisom uloga, dugmetom i QR kodom za **tacnu aktuelnu adresu** PWA,
uputstvima za iPhone i Android, tri videa sa tekstualnim koracima, cestim
pitanjima, kontaktom nadlezne osobe i jasnom oznakom `testna verzija` dok je
takva. Na sajtu nema naloga, operativnih podataka, liste clanova, poziva ni
forme za prijavu nesrece. Sajt ne smije navoditi ljude da misle da sluzi za
hitne dojave ili da push garantuje prijem. Objaviti ga na besplatnom hostingu
sa URL-om koji se moze promijeniti bez promjene instalirane aplikacije.

### 4. Tri videa, nakon sto aplikacija i identitet budu stabilni

| Video | Tacan sadrzaj | Isporuka |
| --- | --- | --- |
| iPhone instalacija | Otvoriti sajt/link u Safariju; dodati PWA na pocetni ekran; otvoriti ikonu; prijaviti se; ukljuciti obavjestenja; objasniti sistemski zvuk na zakljucanom ekranu. | Kratki ekran po ekran, vertikalni video, titl i tekstualni koraci. |
| Android instalacija | Otvoriti aktuelni link u podrzanom browseru; instalirati/dodati na pocetni ekran; otvoriti ikonu; prijaviti se; dozvoliti obavjestenja. Razlike u nazivu menija prikazati prema pregledanom browseru. | Kratki vertikalni video, titl i tekstualni koraci. |
| Koriscenje aplikacije | Poglavlje komandir: izbor sluzbe, unos, pregled primalaca, potvrda objave, pracenje odgovora, prisustvo i zavrsetak. Poglavlje vatrogasac: obavjestenje, `Dolazim`/`Kasnije`/`Ne mogu`, kretanje, prisustvo i istorija. | Jedan video sa jasno oznacenim poglavljima, titlom i primjerima oznacenim `TEST`. |

Snimati na konacnom testnom izdanju, sa fiktivnim nalozima i pozivima. Nema
stvarnih imena, emailova, lokacija ni push tokena u kadru. Za stvarne korake
instalacije potreban je provjeren snimak odgovarajuceg uredjaja/browsera;
simulirani ekran mora biti oznacen kao ilustracija. Prije objave provjeriti
svaki prikazani korak, razumljivost bez zvuka i citljivost na telefonu.

### 5. Zavrsna kontrola i isporuka

- Povezati sajt, aplikaciju i videa; provjeriti sve linkove, QR, titlove,
  kontrast i prelom ekrana. Tek tada traziti vlasnikov pregled cijelog paketa.
- Zavrsni javni link aplikacije mora imati profesionalno ime bez rijeci `test`
  (radni primjer `firenexa.netlify.app`, samo ako je slobodan). Isto vazi
  za javni informativni sajt. Stari testni URL ne stampati kao trajni QR.
- Posebno, prije stvarne upotrebe za uzbunjivanje: SZS/dualni nalog, iPhone i
  Android dostava, rezervni ljudski kanal, produkciona kompatibilnost,
  enkriptovani backup sa vracanjem i prihvat DVD/SZS. To nijesu radnje za
  vlasnika sada; uslovi su u [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md).

### Zavrsni prelaz sa testne adrese

Promjena Netlify poddomena je promjena **origin-a** web aplikacije. Postojeci
Safari/Android precac, prijava, service worker i Web Push pretplata ne mogu se
smatrati prenesenim na novu adresu. Zato na kraju pripremiti profesionalnu
adresu kao zasebnu objavu, provjeriti da je slobodna i da otvara tacan build,
pa podesiti novu adresu u Supabase Auth dozvoljenim redirect URL-ovima i svim
linkovima. Na novoj adresi se korisnici prijavljuju i posebno ukljucuju
obavjestenja. Prije gasenja testnog URL-a provjeriti registraciju uredjaja,
prijavu, push i prelaz postojecih testera; staru adresu zadrzati dostupnom
tokom tog prelaza. Tek poslije prihvata azurirati sajt, videa, QR i
dokumentaciju na zavrsni link i ukloniti testni naziv iz javne prezentacije.
Ne mijenjati postojeci testni Netlify site name na silu i ne pretpostaviti da
obican HTTP redirect prenosi instaliranu PWA ili push dozvolu.

## Nastavak u Work okruzenju, 2. oktobar

Prvo zavrsiti FireNexa ime u oba jezika, HTML-u, manifestu, pushu, ikonama,
informativnom sajtu i video scenarijima. Napraviti originalni F/N znak i
azurirati glavni zapis projekta. Zadrzati postojece lokalne kljuceve,
PWA scope i testni origin tokom ove promjene da bi se sacuvali prijava,
nacrti i podesavanja. Podaci i migracije se ovom promjenom ne prepravljaju.
Zatim provjeriti postojeci tok i izgled na telefonu i desktopu i CI na
novom commitu; ne traziti nove probe od vlasnika sada. Konacni javni link
bez `test`, sajt i video uputstva ostaju naredne isporuke.

## Evidencija

- 2. oktobar: draft PR #82 ima popravku zajednickog poziva, uredjive
  predloge TEST/VJEZBA, vremena odziva na komandnom pregledu i nacrt imena
  **Boka Signal** sa originalnim SVG/PWA ikonama. Nijedna od ovih novih
  izmjena nije objavljena na testnom sajtu. Dodat je i serverski pregled broja
  podobnih naloga i aktivnih push pretplata u potvrdi slanja. Migracija je
  provjerena samo na izdvojenoj test bazi: DVD 2/1, SZS 0/0 i obje sluzbe
  2/1 na postojecim test podacima. Neovlasceni nalog je odbijen. To je
  trenutni zbir, ne potvrda dostave; puna CI provjera je prosla
  ([run 37028798449](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37028798449)).
  Vodjena priprema naloga je u narednoj izmjeni draft PR-a. I njena puna CI
  provjera je prosla ([run 37039803188](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37039803188));
  preostaju testna objava i pregled, zavrsni vizuelni pregled, objava sajta
  i videa.
- U istom nacrtu vlasnik moze jednim izborom izdvojiti naloge bez aktivne
  DVD/SZS uloge. To skracuje trazenje novih gradjanskih naloga, ali ne mijenja
  rostersku vezu niti automatski dodjeljuje pristup. Za to je sada pripremljen
  zaseban vodjeni obrazac sa izricitom potvrdom vlasnika.
- Informativni sajt je pripremljen kao statican izvor u `site/`: testni link,
  iPhone/Android koraci, uloge i jasne granice Web Push-a. Video kartice su
  oznacene `U pripremi`; sajt jos nije objavljen. Detaljni scenariji i kadrovi
  za tri snimka su u [VIDEO_PRODUCTION_SCRIPT.md](./VIDEO_PRODUCTION_SCRIPT.md).

Za svaku fazu upisati PR/commit, adresu testne objave, provjere i otvorene
rizike u [CURRENT_STATUS_AND_PLAN.md](./CURRENT_STATUS_AND_PLAN.md). Video i
sajt dobijaju vlastite linkove tek kad zaista postoje; ne navoditi plan kao
gotovu funkciju.
