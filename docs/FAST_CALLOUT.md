# Brzi poziv i zavrsetak intervencije

Odluka vlasnika, 1. oktobar 2026. Testna primjena u draft PR #81. Stvarna
upotreba zahtijeva zaseban prihvat i uslove iz `P7_P8_RELEASE_PREP.md`.

## Objavljivanje

Komandir upisuje vrstu, naslov, lokaciju i uputstvo na jednom ekranu. Mjesto
okupljanja je opciono. Na istom ekranu bira kome ide poziv:

- sluzbi u kojoj trenutno komanduje (podrazumijevano);
- drugoj sluzbi (ako je ukljucen viseorganizacijski rad);
- objema sluzbama.

Nema rucnog oznacavanja pojedinaca. Nakon `Pregledaj i objavi` prikazuju se
naslov, lokacija, izabrane sluzbe i upozorenje o ogranicenjima dostave. Tek
zavrsno `Objavi` pise nacrt na server i odmah ga objavljuje. `Sacuvaj nacrt`
ostaje kao opciona radnja za pripremu koja se ne salje.

Server u trenutku objave odredjuje sve podobne operativce u izabranim
sluzbama: aktivan roster zapis, povezan aktivan nalog, aktivno operativno
clanstvo i potpun profil. Opsta izjava `Nisam dostupan` je vidljiva komandiru,
ali ne mijenja operativno clanstvo niti automatski iskljucuje clana iz poziva.
Osoba koja je clan obje sluzbe dobija jedan poziv i jednu notifikaciju. Ako u
izabranim sluzbama nema podobnih primalaca, objava se odbija, a nacrt ostaje.

Komandir SZS koji je samo vatrogasac DVD-a moze iz SZS komandnog prikaza
izabrati samo DVD ili obje sluzbe. Takav poziv i dalje vodi SZS; DVD vidi
svoje primaoce i vodi evidenciju svojih clanova. Korisnik ne dobija komandna
prava DVD-a samo zato sto je tamo clan.

## Zatvaranje

Normalan zavrsetak ne trazi razlog. Komandir moze opciono upisati kratak
izvjestaj o tome sta je uradjeno (najvise 500 znakova); on ostaje u arhivi.
Otkazivanje poziva je druga radnja i zadrzava obavezan razlog. Ako postoje
otvoreni zapisi prisustva, potvrda o tome ostaje vidljiva; zatvaranje im ne
izmisljava vrijeme zavrsetka.

## Provjere prije prihvata

1. Komandir DVD objavljuje samo DVD-u, zatim objema sluzbama.
2. Komandir SZS koji je clan DVD-a objavljuje samo DVD-u i vidi da poziv
   vodi SZS. Nijedan primalac ne dobija duplu notifikaciju.
3. Novi aktivni clan dodat izmedju otvaranja obrasca i objave ulazi u poziv;
   suspendovan ili nepovezan nalog ne ulazi.
4. Obican vatrogasac i gradjanin ne mogu objaviti ni putem direktnog zahtjeva.
5. Zatvaranje bez teksta radi; opcioni izvjestaj se vidi u arhivi;
   otkazivanje bez razloga se odbija.
