# FireNexa hosted publication

## Current publication state — 6 October 2026

### Application

- Production app: <https://dado211207.github.io/dvd-tivat-app/>.
- GitHub Pages workflow run [37466894648](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37466894648) completed successfully on main commit `5ee2583a0252d35f8b5a724c4fd288c144b753af`.
- The workflow build used the configured production Supabase URL. The published page was opened read-only and showed the FireNexa logged-out screen; no member data was displayed.
- The previous Netlify app <https://firenexa-app.netlify.app/> remains a separate isolated test app. Do not use its sign-up or accounts for production.

### Public guide — still needs its app target and QR updated

> **Do not distribute the guide or its QR for member sign-up yet.** The live guide at <https://firenexa.netlify.app/> still links and encodes <https://firenexa-app.netlify.app/>, the isolated test app, rather than the production GitHub Pages URL above.

- Current guide deploy: `6ac2a05f9fa3f188e860c23c` on Netlify site `firenexa` (`6dcc0123-3287-43a5-98a2-0ee25d33b5f2`), state ready.
- The guide remains the previously approved package: iPhone installation recording and written Android/use guides are present. Their content has not been changed in this release review.
- Needed before the guide can be shared: rebuild its links, QR SVG/PNG and publication metadata using the production app URL; deploy a draft, verify that draft and the QR target, then publish it. Keep the existing guide deploy available for rollback until the new page is verified.
- The Netlify app site remains isolated and is not the production app. Do not change its deployment or backend as part of publishing the guide.

## Earlier record — 3 October 2026

### Published source and evidence

The original application and the currently active public guide were built from
`e94d4c27f0a12fd984d95a473cf68267855e6a60` on
`codex/callout-readiness`. Full CI run
[37092085664](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37092085664)
passed on that exact head: lint, types, unit, guide publication checks,
database/RLS, bundle scan, browser/accessibility and review screenshots.
Netlify CLI login was approved by the owner. No credentials are in this record.

### Active application

- URL: https://boka-operativa-phone-test.netlify.app/
- Netlify site: `49a6863e-0b66-4e72-b179-f5b90cdbea9a`.
- Active application source: `3ef2144f5fc7cac56efc08df9199155a9594616d`.
- Active deploy: `6ac07b3e6f727b14a880c55c`.
- Preview checked first: `6ac07a2a4f568a532295e175`.
- Previous active deploy: `6ac07368c460951867388882`.
- Full correction CI: [37093860429](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37093860429).
- Correction removes duplicate Accounts/Registry H1s. Live HTML, SW, manifest,
  main, Accounts and Registry bundles match the separate reviewed build exactly.
- Connected isolated Supabase project: `zoipjcdtcfetqvcfmhxd`.

FireNexa identity, icons, SW v9, faster call-out/member preparation and
regular-build prototype retirement are now hosted. The existing origin,
PWA scope and local setting keys remain; no reinstall or phone exercise was
requested. The isolated database migration history includes readiness,
member preparation and the reviewed preparation code repair. This publication
made no database, account, role, alert or production-project changes.

### Separate public guide

- URL: https://firenexa.netlify.app/
- Netlify site: `6dcc0123-3287-43a5-98a2-0ee25d33b5f2`.
- Active deploy: `6ac073dc9f7561fdc8a84961`.
- Output: `dist-site`, built with `build:site:preview`.
- Application/QR target: https://boka-operativa-phone-test.netlify.app/

Created under the existing Starter team `dado211207`; no paid plan, domain or
service was purchased. Guide is independent of the PWA scope. It contains
installation steps, usage, FAQs and the SVG/downloadable PNG QR. The current
QR is visibly labelled as preview and unsuitable for permanent printing.
All three videos remain marked in preparation.

### Hosted verification and remaining work

17 preview app files matched the local build byte-for-byte; six guide preview
files matched. Live app HTML/manifest/SW and guide HTML/PNG/publication metadata
were checked against build output. Hosted mobile Settings loaded with no
prototype links and no horizontal overflow. The automated browser's network
proxy CA required a test-only HTTPS exception; curl checks used normal TLS
verification. No phone push or operational acceptance is claimed.

Next: prepare a professional application origin separately, configure its
Supabase Auth/email redirects and update the guide through its single app URL.
Keep the existing origin while members migrate. A new origin requires login,
installation and notification permission again. Then finish reviewed video
exports. Production release gates in `P7_P8_RELEASE_PREP.md` remain separate.
