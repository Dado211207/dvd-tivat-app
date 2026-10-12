# FireNexa — operativni pilot — handoff za nastavak rada

> Presjek: 12. oktobar 2026, grana `main` na `690841c7` prije ove dokumentacione izmjene. Opis koda je provjeren u repozitorijumu; stanje hostinga koje nije izričito potvrđeno označeno je kao neprovjereno. Ovaj dokument nije zamjena za aktuelni kod, CI ili odluke vlasnika.

## Trenutno, najvažnije

FireNexa je aplikacija za DVD Tivat i Službu zaštite i spašavanja Tivat: komandni poziv, odgovori članova, praćenje dolaska, evidencija i arhiva. Namijenjena je službama, nije javni kanal za prijavu hitnih slučajeva. `main` je 10. oktobra 2026. zabilježio objavu javnog vodiča. Produkciona web aplikacija je na <https://dado211207.github.io/dvd-tivat-app/>, vodič na <https://firenexa.netlify.app/>. Izdvojeni <https://firenexa-app.netlify.app/> je testna infrastruktura i vodič ne šalje članove tamo. Ovo je presjek do 12. oktobra, a ne nova verifikacija hostovanih postavki.

Vlasnik je na iPhoneu potvrdio registraciju uz verifikacioni mail, instalaciju, push obavještenje i podsjetnik, odgovor i zatvaranje označenog probnog poziva. Probni sastav je očišćen. Članovi DVD/SZS su pozvani da testiraju i da aplikaciju koriste paralelno sa dosadašnjim obavještavanjem; čekaju se njihove stvarne povratne informacije. To **nije** prihvat za samostalno korišćenje u stvarnim intervencijama. Dok pilot nije završen, Viber/telefonski kanal ostaje rezerva.

## Arhitektura i operativne granice

- React/TypeScript/Vite PWA; Supabase Auth, PostgreSQL i RLS; Edge funkcija za Web Push, vremenski raspored podsjetnika; GitHub Pages za aplikaciju, odvojeni Netlify vodič iz `site/`/skripte `build:site`. Dvije službe, članovi obje, dežurni/komandir/vlasnik imaju serverski definisana prava. Ne mijenjati recipijente, RLS ili uloge samo u UI-u.
- `src/App.tsx` sklapa operativni interfejs; `src/` i `supabase/migrations/` su ugovor, `supabase/functions/send-web-push/` politika isporuke. `docs/ARCHITECTURE.md`, `ACCESS_MODEL.md`, `DATABASE.md`, `MEMBER_ONBOARDING.md` i `RELEASE_ACCEPTANCE.md` su posebni detalji; `docs/ai/PROJECT_STATE.md` ima datirane istorijske presjeke. Najnoviji vrh je važniji od starijih odjeljaka.
- Korisnik dobija autoritet tek kad vlasnik potvrdi identitet i poveže nalog sa službom/ulogom. Ne tražiti lozinku ili kod. Ne koristiti stvarne podatke intervencija u probama. iOS zaključani ekran koristi sistemski zvuk za Web Push; izbor zvuka u aplikaciji važi kada je otvorena. Native iOS/Android aplikacije su plan poslije pilot evaluacije, nijesu objavljene.
- Supabase podrška je potvrdila da `pg_net` PUBLIC grantovi ostaju dok je ekstenzija aktivna i ne mogu se izolovati za pojedinačnu DB login ulogu. Ne oslanjati se na `REVOKE` iz `postgres`. Ne davati direktan DB login nepouzdanim servisima; `net` ne izlagati kroz Data API; tajne ne stavljati u pg_net zahtjeve koji su čitljivi DB login ulogama. Ne uklanjati ekstenziju bez provjere webhooks/cron/worker zavisnosti. Ovo je operativno ograničenje, ne nov plan migracije.

## Provjere i šta još treba

`npm ci`, `npm run verify`, `npm run test:db` uz lokalni PostgreSQL prema uputstvu, `npm run e2e`, `npm run test:site`, `npm run build:site`; `release:preflight` prije izdanja. CI/deploy i lokalni testovi nijesu zamjena za iPhone/Android i nadgledane scenarije. U `docs/RELEASE_ACCEPTANCE.md` su otvoreni oporavak lozinke sa stvarnim sandučetom, fizički Android, šifrovani backup/restore nakon završnih migracija i tri nadgledane fiktivne vježbe. Tokom pilota evidentirati uređaj, ulogu, očekivano/stvarno ponašanje, screenshot bez privatnih podataka i prioritet svake prijave. Tek nakon provjerenog prihvata odlučiti o samostalnoj operativnoj upotrebi.

**Prvi zadatak za sljedeći chat:** prikupiti povratne informacije vatrogasaca, uporediti ih sa aktuelnim kodom i izdati ciljane ispravke; ne izmišljati feedback niti otvarati nove intervencije samo radi pregleda. `docs/FIRENEXA_PUBLICATION.md` je zapis posljednje objave vodiča.

## Kako nastaviti u novom chatu

1. Otvori ovaj dokument, `README.md`, najnoviji commit na `main` i otvorene PR-ove. Stariji planovi i nacrti ne nadjačavaju noviji kod.
2. Za konkretan zadatak pročitaj navedene izvorne fajlove i provjeri odgovarajuće podatke sa vlasnikom; ne dopunjavaj činjenice nagađanjem.
3. Pokreni relevantne provjere, pregledaj promjenu na telefonu i računaru kada dira UI, pa dokumentuj šta je stvarno objavljeno. Nikad ne upisuj lozinke, tokene, lične podatke ili sadržaj privatnih razgovora u Git.

