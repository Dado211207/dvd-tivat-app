# FireNexa app origin transition — 3 October 2026

## Current checkpoint

- App: <https://firenexa-app.netlify.app/>, application source `5fe8380`,
  active Netlify deploy `6ac09260869e05dc0999869c` on site
  `04c0d262-53e1-48b4-a49a-d2f3db286316`. Rechecked through the Netlify
  connector and public HTTPS on 3 October in the resumed session.
- Guide: <https://firenexa.netlify.app/>, active deploy
  `6ac073dc9f7561fdc8a84961` on site
  `6dcc0123-3287-43a5-98a2-0ee25d33b5f2`. Its public `publication.json`
  still targets `https://boka-operativa-phone-test.netlify.app/` with
  `preview: true`. The new guide/QR has **not** been published.
- Original app remains available for existing installations and subscriptions.
- Resume branch: `codex/callout-readiness`, PR #82, combined CI via PR #83.
  Starting head `4b0b9b81e0d8731c2cb598ac90008b1194fb76cf` has successful
  CI run `37100044844`. This is distinct from the deployed application source.

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
links and SVG/PNG QR assets are generated from this address. Videos remain
honestly marked `U pripremi`.

Browser tests now generate separate temporary preview and final packages for
each worker. They check all app links, final/preview copy, widths and WCAG axe;
they never overwrite the package awaiting deployment. Local lint, typecheck,
Node publication checks and smoke-script syntax passed in the resumed session.
Local Chromium download returned an invalid archive; new browser checks must
be validated by CI before publication. No new application, database or worker
behavior is changed by these test/documentation changes.

The hosted smoke accepts `FIRENEXA_SMOKE_APP_URL` and
`FIRENEXA_SMOKE_GUIDE_URL`; defaults are the new app and the public guide.
It now also validates publication metadata against the reviewed app. Before
guide publication it will correctly fail the old guide/new app mismatch.
To check a draft guide, set its exact reviewed HTTPS URL in the guide variable.
To review the previous pairing, explicitly set the old app URL.

## Next action and access blocker

The resumed Netlify CLI reports **Not logged in**. The connected plugin can
read both sites, but its deploy operation cannot upload `dist-site` or select
a draft deploy. Do not trigger an unrelated repository build or claim a new
publication. CLI authentication must be renewed for the already-authorized
upload to the existing `firenexa` guide site. No new site or paid plan is needed.

After authentication:

1. Publish only the reviewed `dist-site` directory to a draft on the existing
   guide site, with no app build or functions. Check its page, links and QR.
2. Promote/publish the same reviewed package to the existing public guide.
3. Verify active deploy ID, live file hashes, publication metadata, both QR
   targets and hosted smoke; record those concrete results here and in the
   project status. Preserve the old app origin.
4. Complete the three video exports from `VIDEO_PRODUCTION_SCRIPT.md`.
   Physical-device installation footage is still missing; label any illustrated
   screens explicitly. Do not request new owner phone exercises at this stage.

A new origin needs separate installation, sign-in and notification permission.
Guide publication is not operational acceptance: signed-in hosted checks,
SZS/dual membership, Android/iPhone delivery and the production release gates
remain separate. No real alert, account, role or database mutation was made
in the resumed session.
