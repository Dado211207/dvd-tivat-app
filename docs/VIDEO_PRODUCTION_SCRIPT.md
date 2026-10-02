# Tri video uputstva za Boka Signal

Radni scenario, 2. oktobar 2026. Video snimci jos nijesu izvezeni ni objavljeni.
Snimati tek na zavrsnoj testnoj verziji i provjerenoj adresi. U kadru su samo
fiktivni test nalozi, TEST pozivi i lokacije; bez stvarnih imena, emailova,
brojeva telefona, push tokena ili aktivnih intervencija. Svaki kadar sa
simuliranim ekranom mora imati oznaku `Ilustracija`.

## 1. Instalacija na iPhone (oko 75 sekundi)

| Vrijeme | Kadar sa stvarnog iPhonea | Naracija / titl |
| --- | --- | --- |
| 0-8 s | Naslov i profesionalni link sajta; testna oznaka dok traje proba | `Boka Signal se instalira iz Safarija. Otvori aktuelni link sa ovog sajta.` |
| 8-25 s | Safari na PWA adresi, dijeljenje, `Dodaj na pocetni ekran` | `Dodirni Dijeli, pa Dodaj na pocetni ekran. Ako vidis Otvori kao web aplikaciju, ostavi ukljuceno i potvrdi Dodaj.` |
| 25-37 s | Ikona na pocetnom ekranu i otvaranje | `Pokreni novu ikonu sa pocetnog ekrana.` |
| 37-52 s | Prijava fiktivnog naloga, bez prikaza lozinke | `Prijavi se svojim nalogom. Novi nalog nema operativna prava dok vlasnik ne poveze clanstvo i ulogu.` |
| 52-65 s | Podesavanja i zahtjev za obavjestenja | `U Podesavanjima ukljuci obavjestenja i prihvati iOS dozvolu.` |
| 65-75 s | Kratka kartica ogranicenja | `Na zakljucanom iPhoneu koristi se sistemski zvuk. Web Push nije garantovan alarm.` |

Prije izvoza provjeriti redosljed menija na fizickom uredjaju, da li web
aplikacija zaista ima ikonu, da li korisnik vidi prompt i da li je video citljiv
bez zvuka. [Apple uputstvo](https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iphea86e5236/ios).

## 2. Instalacija na Android (oko 70 sekundi)

| Vrijeme | Kadar sa stvarnog Androida | Naracija / titl |
| --- | --- | --- |
| 0-8 s | Profesionalni sajt i link za aplikaciju | `Otvori aktuelni link u Chrome browseru na Androidu.` |
| 8-25 s | Chrome meni sa tri tacke, instalacija / precica | `U meniju izaberi Instaliraj ili Dodaj na pocetni ekran. Naziv stavke zavisi od verzije browsera.` |
| 25-37 s | Potvrda i ikona aplikacije | `Potvrdi prikazane korake i pokreni ikonu.` |
| 37-52 s | Prijava test naloga | `Prijavi se nalogom koji je povezan sa sluzbom.` |
| 52-63 s | Prompt za obavjestenja i podesavanja | `Dozvoli obavjestenja. Ako prompt izostane, provjeri Podesavanja u aplikaciji i dozvole telefona.` |
| 63-70 s | Kartica ogranicenja | `Dostava zavisi od uredjaja, browsera, mreze i dozvola.` |

Snimiti na stvarnom Android uredjaju. Uputstvo u videu mora odgovarati upravo
browseru i verziji u kadru. [Google uputstvo](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid).

## 3. Koriscenje aplikacije (oko 3 minute)

### Komandir, poglavlje 1 (oko 100 sekundi)

1. Otvoriti testni nalog komandira, prikazati aktivnu sluzbu u zaglavlju.
2. U `Komanda` izabrati `TEST` ili `VJEZBA`, unijeti naslov `TEST - nije stvarna intervencija`,
   fiktivnu lokaciju i po potrebi urediti predlozeno uputstvo.
3. Pokazati izbor DVD, SZS ili obje sluzbe samo ako testni nalozi imaju prava.
   Naglasiti da se ljudi ne biraju rucno; server bira operativne clanove.
4. Na potvrdi pokazati broj podobnih naloga i broj naloga sa aktivnom push
   pretplatom. Reci da to nije dokaz dostave i da se primaoci racunaju ponovo
   pri objavi.
5. Potvrditi slanje samo u izolovanoj test bazi. Pokazati odzive i vremena:
   `Dolazim`, `Dolazim kasnije`, `Ne mogu`, bez odgovora, kretanje i prisustvo.
6. Pokazati zavrsetak sa opcionim opisom onoga sto je bila intervencija;
   obican zavrsetak ne trazi obavezan razlog. Otkazivanje ima razlog.

### Clan, poglavlje 2 (oko 80 sekundi)

1. Na drugom fiktivnom nalogu pokazati testno obavjestenje i otvaranje poziva.
2. Procitati naslov, lokaciju i uputstvo. Jednim dodirom `Dolazim` se cuva
   odgovor i zatim zasebno potvrdjuje prijem; pokazati status oba zapisa.
3. Pokazati `Dolazim kasnije` sa procjenom vremena i `Ne mogu`, na odvojenim
   testnim pozivima, da snimak ne predstavlja jedan poziv sa tri odgovora.
4. Pokazati prijavu kretanja i potvrdu prisustva kao odvojene korake, uz
   mogucnost pregleda svog poziva i istorije.

Finalni video ima poglavlja, titlove, dovoljno vremena da se procita svaki
ekran, izvoz u vertikalnom formatu za telefon i tekstualni transkript na sajtu.
Prije objave provjeriti svaki pomenuti naziv dugmeta u zavrsnom buildu i
uporediti video sa stvarnim iPhone/Android tokom. Nema obecanja da je push
garantovan kanal za hitne intervencije.
