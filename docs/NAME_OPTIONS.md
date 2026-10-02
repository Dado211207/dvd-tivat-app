# Naziv aplikacije - prijedlog za odluku

Trenutni radni naziv: **Boka Operativa**. Korisnik je 2026-09-30 rekao da mu se ne svidja i trazi kraci, snazniji naziv. Ovo je izbor za pregled, bez promjene vec instalirane test aplikacije.

| Prijedlog | Kako izgleda na ikoni / u pushu | Utisak |
| --- | --- | --- |
| **Boka Signal** | `BOKA SIGNAL` / `OPERATIVNI POZIV - Boka Signal` | Kratko, jasno poziva na reakciju, odgovara i DVD-u i SZS-u. Preporuka. |
| Boka Odziv | `BOKA ODZIV` | Direkno govori da se clan javlja na poziv; manje zvucno kao ime brenda. |
| Boka Komanda | `BOKA KOMANDA` | Snazno, ali sugerise da je aplikacija samo za komandira. |

Izbjegavati `112`, `SOS` i nazive koji obecavaju javni prijem hitnih dojava: aplikacija je interni alat za mobilizaciju, ne zvanicni kanal hitne sluzbe. Ovaj kratki javni pregled naziva ne predstavlja provjeru ziga, domena ili prava na upotrebu. Konacan naziv treba da prihvate vlasnik i predstavnici DVD/SZS prije produkcionog identiteta.

Ako se izabere **Boka Signal**:

1. Zamijeniti prikazani naziv na pocetnom ekranu, naslov stranice, manifest `name`/`short_name`, vidljivi naslov push obavjestenja i ikone kojima pripada tekst. Sacuvati ID, scope i URL PWA dok se ne provjeri ponasanje postojecih instalacija i prijava.
2. Pregledati oba jezika, male ekrane, a11y nazive, naslov na zakljucanom telefonu i dokumentaciju. Postojece baze i tabelarna imena ne zavise od brenda.
3. Prvo objaviti u zasebnoj test aplikaciji, zatim provjeriti update na vlasnikovom iPhoneu bez brisanja pretplate ili prijave. Tek poslije toga razmotriti produkciju; ne mijenjati URL i Web Push origin u istom potezu.
