# FireNexa public guide

The public guide has no operational data, accounts or reporting form. Build it
separately from the app; publish **dist-site**, never the repository root.

## Preview

`npm run build:site:preview` uses the verified existing isolated application
address. The generated QR is visibly marked as a preview, not for permanent
printing. This command does not publish anything.

## Final address

After the professional application address serves the verified build and its
Auth redirects have been configured, run:

`npm run build:site -- --app-url https://YOUR-VERIFIED-APP-ADDRESS/`

No address is assumed. Every application link, SVG QR and downloadable PNG QR
is generated from this one argument. `publication.json` records the exact
address and preview status for deployment review. A hostname containing the
word `test` requires `--preview`; final output cannot silently retain the old
phone-test address. The QR does not imply operational acceptance.

Deploy `dist-site` as the separate informational website. Do not publish under
the existing PWA path or change its service worker boundaries. The existing app
origin stays available during migration; a new origin requires login and
notification permission again. See `docs/APP_FINISH_AND_ONBOARDING_PLAN.md`.

Videos remain in preparation until reviewed and exported. Contact details
must come from the society; no personal address or phone is invented.

The guide is not published yet. Installation footage must show the reviewed
device/browser steps; see `docs/VIDEO_PRODUCTION_SCRIPT.md`.
