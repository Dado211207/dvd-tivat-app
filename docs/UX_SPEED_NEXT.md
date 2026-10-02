# Brzi poziv: dalja pojednostavljenja

Stanje 2. oktobra 2026. Ovaj plan vazi za izolovanu testnu aplikaciju.
Produkciona upotreba i dalje zavisi od kapija u `P7_P8_RELEASE_PREP.md`.

## Sada uradjeno

- Komandir popunjava jedan ekran i bira DVD, SZS ili obje sluzbe; server bira
  podobne operativce. Nema rucnog oznacavanja ljudi.
- Clan moze odmah pritisnuti `Dolazim` ili `Ne mogu`; aplikacija cuva odgovor,
  pa odvojeno biljezi prijem poziva. `Dolazim kasnije` trazi procjenu vremena.
  `Vidio sam poziv` ostaje za clana koji jos ne zna odgovor. Ako potvrda
  prijema ne uspije poslije sacuvanog odgovora, ekran to kaze i nudi retry.
  Kod i automatski testovi su na PR #81, a testni Netlify deploy
  `6abf5e819e860ed014fdf8d3` je spreman. Vlasnik je na telefonu pritisnuo
  `Dolazim`; testni server je sacuvao odgovor i potvrdu prijema.
- Ispravljena je blokada za slanje objema sluzbama kada sluzba komandira nema
  podobnih primalaca. Server i dalje odbija objavu ako ih nema ni u jednoj
  sluzbi. Ova izmjena je u posebnoj grani i jos nije na testnoj adresi.
- U draft PR #82 dodati su uredjivi predlozi TEST/VJEZBA za komandira i
  vremena pojedinacnog otvaranja, odgovora i kretanja u komandnom pregledu.
  Sve je samo u kodu; testna aplikacija i dalje prikazuje prethodno izdanje.
- Pregled pred objavu broji jedinstvene podobne naloge i naloge sa aktivnom
  push pretplatom. Migracija je provjerena u izdvojenoj testnoj bazi, a puna
  CI provjera (baza/RLS i browser) je prosla u [run 37028798449](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37028798449).
  Nije objavljeno na testnoj adresi; broj pretplata nije potvrda dostave.
- Vodjena priprema naloga je u narednoj izmjeni draft PR #82: vlasnik na
  jednom ekranu provjerava profil, bira sluzbu, postojeci roster zapis ili
  novi zapis iz imena profila, i operativnu ulogu. Jedna serverska transakcija
  povezuje zapis i dodjeljuje ulogu, sa postojecim revizijskim tragovima.
  Ceka CI i nije objavljena na testnom sajtu.

## Naredne izmjene, po vrijednosti

1. **Prihvat poslije objave.** Na izdvojenom testnom sajtu pregledati
   spremnost za DVD, SZS i obje sluzbe sa stvarnim test nalozima. Na uredjajima
   kasnije potvrditi da pozvani clan dobija i otvara poziv. Ovaj korak ne trazi
   novu radnju vlasnika sada.
2. **Predlosci za stvarnu intervenciju.** TEST/VJEZBA su pripremljeni. Tekst
   za stvarnu intervenciju usaglasiti sa DVD/SZS prije dodavanja; lokacija,
   naslov i potvrda objave ostaju obavezni.
3. **Mjeriti stvarno kasnjenje.** Na testnim pozivima prikazati vremena objave,
   prihvata push provajdera, otvaranja i odgovora. Odvojiti serverski prihvat
   od prikaza na telefonu; ako problem bude u mrezi ili pretplati, komandir
   ne smije dobiti lazno `dostavljeno`.

## Ne preskakati

Zavrsna potvrda prije objave ostaje: slanje svim operativcima izabrane sluzbe
je znacajna radnja. Odgovor clana, prijem poziva, dolazak i potvrdjeno
prisustvo ostaju odvojene cinjenice. Web Push ne garantuje zvuk na zakljucanom
iPhoneu; vlastita sirena trazi zasebnu native aplikaciju i prihvat.
