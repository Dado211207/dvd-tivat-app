# Naziv aplikacije - prijedlog za odluku

Trenutno objavljeno ime testne aplikacije: **Boka Operativa**. Korisnik je 2026-09-30 zatrazio kraci, snazniji naziv. Kod za **Boka Signal** i novi znak pripremljeni su u draft PR #82; jos nijesu objavljeni na testnom sajtu niti usvojeni kao konacan identitet.

| Prijedlog | Kako izgleda na ikoni / u pushu | Utisak |
| --- | --- | --- |
| **Boka Signal** | `BOKA SIGNAL` / `OPERATIVNI POZIV - Boka Signal` | Kratko, jasno poziva na reakciju, odgovara i DVD-u i SZS-u. Preporuka. |
| Boka Odziv | `BOKA ODZIV` | Direkno govori da se clan javlja na poziv; manje zvucno kao ime brenda. |
| Boka Komanda | `BOKA KOMANDA` | Snazno, ali sugerise da je aplikacija samo za komandira. |

Izbjegavati `112`, `SOS` i nazive koji obecavaju javni prijem hitnih dojava: aplikacija je interni alat za mobilizaciju, ne zvanicni kanal hitne sluzbe. Ovaj kratki javni pregled naziva ne predstavlja provjeru ziga, domena ili prava na upotrebu. Konacan naziv treba da prihvate vlasnik i predstavnici DVD/SZS prije produkcionog identiteta.

Nacrt **Boka Signal** u PR #82:

1. Promijenjeni su vidljivi naziv, oba jezika, naslov stranice, manifest `name`/`short_name`, naslov push obavjestenja, SVG i PWA ikone. Simbol spaja radio signal i dva morska talasa; ne koristi grb ili sluzbeni broj. Isti `start_url`, `scope`, URL, service worker putanja i lokalni kljucevi ostaju radi postojecih instalacija.
2. Prije objave provjeriti izgled malih ikona, kontrast, citljivost na telefonu i azuriranje vec instalirane PWA bez gubitka prijave/pretplate. iOS moze zadrzati staru ikonu ili naziv dok korisnik ponovo ne doda aplikaciju na pocetni ekran; to se mora stvarno provjeriti, bez uputstva za brisanje prije cuvanja naloga.
3. Prije javnog usvajanja uraditi provjeru prava na naziv i prihvat DVD/SZS. Obicna web pretraga nije provjera ziga ili domena. Produkcionu adresu i Web Push origin ne mijenjati u istom koraku.
