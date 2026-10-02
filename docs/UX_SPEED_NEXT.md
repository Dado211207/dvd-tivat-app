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
  `6abf5e819e860ed014fdf8d3` je spreman; fizicki telefon jos nije prihvatio
  ovaj novi ekran.

## Naredne izmjene, po vrijednosti

1. **Spremnost prije objave.** Na pregledu poziva prikazati broj operativnih
   naloga u izabranim sluzbama i broj naloga sa aktivnom push pretplatom.
   Komandir mora vidjeti ako je, na primjer, pozvano dvoje, ali samo jedan
   uredjaj ima push. Ovo je pregled trenutnog stanja, ne obecanje dostave;
   server ponovo odredjuje primaoce pri objavi. Posebno provjeriti SZS bez
   operativaca i dvostruko clanstvo bez duplog broja.
2. **Jednostavna priprema SZS testera.** U administraciji objediniti provjeru
   naloga, potpun profil, povezivanje roster zapisa i operativnu ulogu u jedan
   vodjeni postupak. Novi nalog i dalje pocinje kao gradjanin, a promjenu
   izvrsava ovlasceni administrator uz trag u reviziji.
3. **Kratki predlosci uputstva.** Ponuditi nekoliko tekstova za vjezbu i
   intervenciju koje komandir moze urediti. Lokacija i naslov ostaju obavezni
   za svaki novi poziv; predlozak nikada sam ne objavljuje poziv. Predloske
   potvrditi sa DVD/SZS prije operativne upotrebe.
4. **Mjeriti stvarno kasnjenje.** Na testnim pozivima prikazati vremena objave,
   prihvata push provajdera, otvaranja i odgovora. Odvojiti serverski prihvat
   od prikaza na telefonu; ako problem bude u mrezi ili pretplati, komandir
   ne smije dobiti lazno `dostavljeno`.

## Ne preskakati

Zavrsna potvrda prije objave ostaje: slanje svim operativcima izabrane sluzbe
je znacajna radnja. Odgovor clana, prijem poziva, dolazak i potvrdjeno
prisustvo ostaju odvojene cinjenice. Web Push ne garantuje zvuk na zakljucanom
iPhoneu; vlastita sirena trazi zasebnu native aplikaciju i prihvat.
