# FireNexa hosted publication — 3 October 2026

## Published source and evidence

Application and public guide were built from
`e94d4c27f0a12fd984d95a473cf68267855e6a60` on
`codex/callout-readiness`. Full CI run
[37092085664](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37092085664)
passed on that exact head: lint, types, unit, guide publication checks,
database/RLS, bundle scan, browser/accessibility and review screenshots.
Netlify CLI login was approved by the owner. No credentials are in this record.

## Active application

- URL: https://boka-operativa-phone-test.netlify.app/
- Netlify site: `49a6863e-0b66-4e72-b179-f5b90cdbea9a`.
- Active deploy: `6ac07368c460951867388882`.
- Preview checked first: `6ac07216f2a450028fb1020b`.
- Previous active deploy: `6abf5e819e860ed014fdf8d3`.
- Connected isolated Supabase project: `zoipjcdtcfetqvcfmhxd`.

FireNexa identity, icons, SW v9, faster call-out/member preparation and
regular-build prototype retirement are now hosted. The existing origin,
PWA scope and local setting keys remain; no reinstall or phone exercise was
requested. The isolated database migration history includes readiness,
member preparation and the reviewed preparation code repair. This publication
made no database, account, role, alert or production-project changes.

## Separate public guide

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

## Hosted verification and remaining work

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
