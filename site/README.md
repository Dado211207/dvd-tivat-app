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

The guide is published at <https://firenexa.netlify.app/>. Its active version
still links to the old app with a temporary QR. The new app is already live at
<https://firenexa-app.netlify.app/>, and the previous session recorded the
approved Auth redirect save. The final guide build is prepared, not published.

The resumed CLI needs authentication before uploading to the existing guide
site `6dcc0123-3287-43a5-98a2-0ee25d33b5f2`. Upload **only `dist-site`**,
with `--no-build`; first review a draft, then publish the same files. Do not run
the application build or upload the repository root as the public guide.
See [the transition checkpoint](../docs/FINAL_ORIGIN_TRANSITION.md).

Both preview and final builds have browser checks in `e2e/public-site.spec.ts`.
For hosted review, `scripts/hosted-smoke.mjs` accepts `FIRENEXA_SMOKE_APP_URL`
and `FIRENEXA_SMOKE_GUIDE_URL` so the new app can be checked against a draft
before the public guide is replaced. Publication metadata must match the app.
