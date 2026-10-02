# Plan dovrsetka aplikacije i uvodjenja korisnika

Zabiljezeno 2. oktobra 2026. Ovaj plan prati zahtjev vlasnika: sada ne
organizovati nove probe na njegovom telefonu. Prvo pojednostaviti i dovrsiti
aplikaciju, zatim identitet, javni informativni sajt i tri uputstva u videu.
Razvoj i interne automatske provjere mogu ici bez novih radnji vlasnika.

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

- Radna preporuka je **Boka Signal**: krace ime koje odgovara DVD-u i SZS-u.
  [NAME_OPTIONS.md](./NAME_OPTIONS.md) cuva alternative i razloge. Prije javne
  upotrebe provjeriti dostupnost naziva i dobiti prihvat predstavnika sluzbi.
- Nacrtati originalan, citljiv znak: signal/odziv, motiv Boke, bez tudjeg
  grba, broja hitne sluzbe ili obecanja garantovanog alarma. Napraviti SVG i
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
- Posebno, prije stvarne upotrebe za uzbunjivanje: SZS/dualni nalog, iPhone i
  Android dostava, rezervni ljudski kanal, produkciona kompatibilnost,
  enkriptovani backup sa vracanjem i prihvat DVD/SZS. To nijesu radnje za
  vlasnika sada; uslovi su u [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md).

## Evidencija

Za svaku fazu upisati PR/commit, adresu testne objave, provjere i otvorene
rizike u [CURRENT_STATUS_AND_PLAN.md](./CURRENT_STATUS_AND_PLAN.md). Video i
sajt dobijaju vlastite linkove tek kad zaista postoje; ne navoditi plan kao
gotovu funkciju.
