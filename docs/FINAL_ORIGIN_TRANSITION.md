# FireNexa app origin transition — 3 October 2026

## Current verified state

- Current working application: `https://boka-operativa-phone-test.netlify.app/`,
  source `3ef2144`, Netlify deploy `6ac07b3e6f727b14a880c55c`.
- Public guide: `https://firenexa.netlify.app/`, still linking to the working
  application with a visibly temporary QR.
- A separate free Starter Netlify project named `firenexa-app` was created,
  ID `04c0d262-53e1-48b4-a49a-d2f3db286316`. Its intended URL is
  `https://firenexa-app.netlify.app/`. The app is now live there: source `5fe8380`, active deploy
  `6ac09260869e05dc0999869c`, after a preview deploy
  `6ac091ec9615914bc61b3a9a`. Do not print its final QR until Auth
  redirects and the separate public guide are updated.
- The app bundle from `5fe8380` was rebuilt with the same public configuration
  in an isolated output directory. Full CI 37098669572 passed on that source:
  853 unit/component, 960 database/RLS, 402 browser/accessibility and 16
  capture checks. Twelve credential-dependent hosted operation tests skipped.
  The bundle scan found no secret key in 23 files. Five live shell/changed
  bundle files match this build byte-for-byte. Signed-out Accounts loaded on
  the new main origin.
- A final guide candidate was built separately with this exact intended app
  URL. `publication.json`, links and QR agree, and the temporary address copy
  is absent. It remains unpublished pending Auth redirect verification.

## Registration and Auth

The application uses email/password. Sign-up and resend now supply
`emailRedirectTo` from the current application origin, so a confirmation
initiated at either address can return to that same address. The test covers
both origins. This client change requires the **isolated** Supabase project
`zoipjcdtcfetqvcfmhxd` to allow both exact HTTPS origins in Auth URL
Configuration. The dashboard currently shows Site URL
`https://boka-operativa-phone-test.netlify.app` and **no additional Redirect
URLs**. Its default sign-up email template uses `{{ .ConfirmationURL }}`. Add
`https://firenexa-app.netlify.app/` as an exact Redirect URL; keep the old
Site URL while existing pending confirmations and installations migrate. A
later Site URL switch needs the old address in the allowlist, and its email
impact must be verified before changing it. Password login is not itself
a redirect flow. Password recovery remains disabled pending SMTP and template
verification. Do not change the separate production Supabase project.

## Publication sequence

1. Add the new exact Redirect URL on the isolated Supabase project while
   keeping the old Site URL. Verify the saved configuration in the dashboard.
2. Verify confirmation and login without creating a real person or incident.
   A fixture or approved demonstration account can be used for the signed-in
   check; do not turn a fixture pass into a physical-device claim.
3. Publish the prepared final guide build only after the new app is verified.
   Its links and both QR formats must target the exact same new address. Keep
   the original site available for existing installations and push subscriptions.
4. Complete the three reviewed videos with final URL and device-accurate
   installation footage. A new origin needs separate installation, sign-in and
   notification permission on each phone. Real delivery acceptance remains a
   later DVD/SZS gate.

Source: `docs/APP_FINISH_AND_ONBOARDING_PLAN.md` and current Supabase Auth
redirect documentation. No real alert, account, role, email or database change
was made while preparing this transition.
