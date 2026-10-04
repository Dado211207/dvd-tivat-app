# FireNexa hosted publication

## Guide publication — 4 October 2026 (current; supersedes the guide sections below)

> **⚠ Not for member sign-up yet.** The guide's QR code and every app link point
> to `https://firenexa-app.netlify.app/`, which is connected to the **isolated
> test** Supabase project `zoipjcdtcfetqvcfmhxd`, not production
> `yskhdzrdbywrpfowckpn`. The page uses final wording (no "preview" label), so it
> does not warn readers itself. Do not print, post or distribute the QR or the
> guide for member sign-up until the production cutover in
> [P7_P8_RELEASE_PREP.md](./P7_P8_RELEASE_PREP.md) is complete.

- URL: <https://firenexa.netlify.app/>, Netlify site `firenexa`
  (`6dcc0123-3287-43a5-98a2-0ee25d33b5f2`, not repository-linked; no build ran).
- **Live deploy: `6ac2a05f9fa3f188e860c23c`**, published 2026-10-04 18:52:50 UTC.
  Uploaded as a draft, verified at
  <https://6ac2a05f9fa3f188e860c23c--firenexa.netlify.app/>, then that same deploy
  was published.
- Previous live deploy, for rollback: `6ac15ece1e8fab8653e75379` (the earlier
  three-illustrated-video package).
- Source: `codex/callout-readiness` head
  `5d31f40caeedab78005f65cb41d113ce828358d3`, CI run
  [37217939609](https://github.com/Dado211207/dvd-tivat-app/actions/runs/37217939609)
  succeeded on that head. Built with
  `npm run build:site -- --app-url https://firenexa-app.netlify.app/`
  (`preview: false`); `npm run test:site` passed. Only `dist-site` was uploaded,
  through the Netlify API file-digest deploy with `draft: true`, so the app's
  `netlify.toml` played no part.
- Content: 12 files — `index.html`, `android.html`, `koriscenje.html`, CSS, logo,
  SVG/PNG QR, `publication.json`, the privacy-edited `videos/iphone.mp4`
  (byte-identical to `site/videos/iphone.mp4`) and three transcripts. No
  `android.mp4`/`usage.mp4`; no test-address or preview wording.

### Verification (draft and public URL)

- 9 of 12 files are byte-identical to the local build, including both QR images,
  `publication.json` and the MP4 (`video/mp4`, 664,731 bytes).
- The three HTML files differ only in internal links: the site's Netlify
  *Pretty URLs* post-processing rewrites `./android.html` → `/android`,
  `./koriscenje.html` → `/koriscenje` and `./index.html` → `/`. With `href`
  attributes removed, they are identical to the build. `/`, `/android` and
  `/koriscenje` return 200 with the expected titles.
- The public HTML is byte-identical to the verified draft's.
- The removed `videos/android.mp4` and `videos/usage.mp4` return 404.
- No app deploy, Supabase change (production or test) or account change was made.
- Not verified: rendering on a physical phone, and scanning the printed QR.

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
