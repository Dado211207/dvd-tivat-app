# FireNexa video uputstva

Izvor za tri vertikalna ilustrovana videa nalazi se u `src/root.tsx`. Svaki
simulirani prikaz je označen kao ilustracija. Uputstva nemaju zvučnu naraciju;
svaka scena ima čitljiv tekst, a transkripti su u `site/videos/*.txt`.

```
npm ci
npm run studio
npm run render:iphone
npm run render:android
npm run render:usage
```

Kopirati `out/*.mp4` u `site/videos/` i pokrenuti `npm run build:site --
--app-url https://firenexa-app.netlify.app/` iz korijena repozitorijuma.
Izvezeni video fajlovi na sajtu su pregledani zajedno sa transkriptima.
Na stvarnim telefonima još treba provjeriti tačan raspored menija i dozvola.
