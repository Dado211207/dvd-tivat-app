# FireNexa app origin transition — 3 October 2026

## Current checkpoint

> **4 October 2026:** the guide now serves deploy `6ac2a05f9fa3f188e860c23c` (real iPhone video, written Android and usage guides); `6ac15ece…` below is the previous deploy. Its QR targets the app on the isolated test Supabase project — not for member sign-up before production cutover. See [FIRENEXA_PUBLICATION.md](./FIRENEXA_PUBLICATION.md).


- App: <https://firenexa-app.netlify.app/>, application source `5fe8380`,
  active Netlify deploy `6ac09260869e05dc0999869c` on site
  `04c0d262-53e1-48b4-a49a-d2f3db286316`. Rechecked through the Netlify
  connector and public HTTPS on 3 October in the resumed session.
- Guide: <https://firenexa.netlify.app/>, active deploy
  `6ac15ece1e8fab8653e75379` on site
  `6dcc0123-3287-43a5-98a2-0ee25d33b5f2`. Its public `publication.json`
  targets `https://firenexa-app.netlify.app/` with `preview: false`.
- Original app remains available for existing installations and subscriptions.
- Resume branch: `codex/callout-readiness`, PR #82, combined CI via PR #83.
  Head `9fdbeaece67f567c24bcc43f2118c3fa02b3e74d` passed CI run
  `37147745817`. This is distinct from the deployed application source.

## Auth: completed configuration recovered from the previous conversation

The owner explicitly approved adding the exact Redirect URL
`https://firenexa-app.netlify.app/` to isolated Supabase project
`zoipjcdtcfetqvcfmhxd`. The previous session recorded the saved dashboard
showing exactly one additional allowed URL at 05:33 UTC on 3 October.
The Site URL remained `https://boka-operativa-phone-test.netlify.app`.
[Source conversation](https://chatgpt.com/share/6ac0ca52-ddb8-83eb-ad5a-995007ce93e1).

The earlier version of this document stopped before that save and was stale.
Do not add the redirect again or ask for the same approval. In the resumed
session the dashboard redirected to sign-in, so its current configuration was
not independently re-read. A completed email-confirmation/login round trip
on the new origin is not recorded. The twelve credential-dependent hosted
operation tests remain unverified; fixture tests do not replace them.

Sign-up and resend request `emailRedirectTo` from the current application
origin; both original and new origins are covered by tests. The previous
session verified the default signup template uses `{{ .ConfirmationURL }}`.
Password recovery remains disabled pending SMTP/template verification.
Do not change the separate production project `yskhdzrdbywrpfowckpn`.

## Prepared guide and checks

Build the final guide without modifying the application build:

```sh
npm run build:site -- --app-url https://firenexa-app.netlify.app/
```

`dist-site/publication.json` must contain `preview: false`, and both `appUrl`
and `qrTarget` must equal `https://firenexa-app.netlify.app/`. All four app
links and SVG/PNG QR assets are generated from this address. The guide now
includes three illustrated MP4 tutorials (59 s iPhone, 58 s Android, 123 s
command/member), their transcripts, and an explicit illustration label. The
render source is under `tutorials/`; device footage and device-specific menu
review remain future work.

Browser tests now generate separate temporary preview and final packages for
each worker. They check all app links, final/preview copy, widths and WCAG axe;
they may overwrite `dist-site` through the preview web server, so rebuild the
final package after running them. The earlier commit `d1fe21c` passed full CI
37113888994. The video/site package passed local lint, typecheck, Node site
checks and four desktop Playwright/axe guide tests using a local Chromium.
Its own CI must pass after pushing. No application, database or worker behavior
is changed by this package.

The hosted smoke accepts `FIRENEXA_SMOKE_APP_URL` and
`FIRENEXA_SMOKE_GUIDE_URL`; defaults are the new app and the public guide.
It validates publication metadata against the reviewed app. To check a draft
guide, set its exact HTTPS URL in the guide variable.

## Guide publication and verification

On 3 October, the owner authorized the Netlify CLI login and publication to the
existing `firenexa` guide site. The prepared `dist-site` was copied to an
isolated temporary directory linked to site
`6dcc0123-3287-43a5-98a2-0ee25d33b5f2`, then uploaded with `--no-build`
as draft `6ac15ece1e8fab8653e75379`. Its HTTPS draft URL served the expected
`publication.json`, four app links, both QR assets and all three MP4 files.
The Netlify API's documented restore-deploy endpoint promoted that exact draft
to production; a subsequent site read returned the same ID as
`published_deploy.id`. This did not build or deploy the app or create a site.

Public HTTPS returned 200 for `publication.json`, `index.html`, both QR assets,
three MP4 tutorials and three transcripts. Their bytes matched the reviewed
local `dist-site` files. The metadata has `preview: false` and both `appUrl`
and `qrTarget` set to `https://firenexa-app.netlify.app/`; the HTML has four
links to that app and no old app origin. The Playwright hosted smoke could not
run in this workspace because its Chromium executable is absent; browser and
physical-device playback remain to be checked. The tutorials are labeled
illustrations, and physical-device installation footage is still missing.

A new origin needs separate installation, sign-in and notification permission.
The isolated project's `send-web-push` v9 still had a single-origin CORS guard
that excluded the new app. On 3 October, the reviewed source was deployed as
v10 to isolated project `zoipjcdtcfetqvcfmhxd`, preserving `verify_jwt=false`
and the worker's explicit scheduler-secret/commander authorization. The hosted
`index.ts`, `origin.ts`, `deliver.ts` and `policy.ts` match the reviewed source.
Read-only HTTP checks returned `204` and the matching origin for FireNexa and
the old installed Netlify app; an unknown origin got no matching CORS header.
An unauthenticated POST from FireNexa returned `401`, with no alert sent.
This verifies CORS and unauthenticated refusal; a signed-in fictional commander
wake-up and actual device delivery still require credential/device acceptance.
Guide publication is not operational acceptance: signed-in hosted checks,
SZS/dual membership, Android/iPhone delivery and the production release gates
remain separate. No real alert, account, role or database mutation was made
in the resumed session.
