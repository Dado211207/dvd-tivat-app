# FireNexa app origin transition — 3 October 2026

## Current verified state

- Current working application: `https://boka-operativa-phone-test.netlify.app/`,
  source `3ef2144`, Netlify deploy `6ac07b3e6f727b14a880c55c`.
- Public guide: `https://firenexa.netlify.app/`, still linking to the working
  application with a visibly temporary QR.
- A separate free Starter Netlify project named `firenexa-app` was created,
  ID `04c0d262-53e1-48b4-a49a-d2f3db286316`. Its intended URL is
  `https://firenexa-app.netlify.app/`. **It has no successful deploy yet.**
  Do not share it as a working application or print its QR.
- The verified app bundle was rebuilt with the same public configuration in an
  isolated output directory. The bundle scan found no secret key in 23 files.
- A final guide candidate was built separately with this exact intended app
  URL. `publication.json`, links and QR agree, and the temporary address copy
  is absent. It was not published because the app URL is not active.

## Registration and Auth

The application uses email/password. Sign-up and resend now supply
`emailRedirectTo` from the current application origin, so a confirmation
initiated at either address can return to that same address. The test covers
both origins. This client change requires the **isolated** Supabase project
`zoipjcdtcfetqvcfmhxd` to allow both exact HTTPS origins in Auth URL
Configuration. Set the new app address as Site URL only after verifying that
confirmation templates and existing pending confirmations still work; retain
the old URL as an allowed redirect during migration. Check the actual hosted
Auth settings and templates before editing them. Password login is not itself
a redirect flow. Password recovery remains disabled pending SMTP and template
verification. Do not change the separate production Supabase project.

## Publication sequence

1. Authenticate the Netlify deployment client or approve the connected browser
   fallback for the already created `firenexa-app` project. The CLI in this
   execution workspace currently reports `denied`; the connector generated a
   deploy proxy command, but that command failed at network fetch before
   uploading a working deploy. Do not assume an empty site was published.
2. Deploy the reviewed app build to the **new site**, keeping the old site
   running. Verify the active deploy, live HTML/manifest/SW/bundles and public
   configuration against that build. Run the read-only mobile/desktop hosted
   review with the new application URL.
3. Inspect and add the two Auth allowlist URLs on the isolated Supabase project.
   Verify confirmation and login without creating a real person or incident.
   A fixture or approved demonstration account can be used for the signed-in
   check; do not turn a fixture pass into a physical-device claim.
4. Publish the prepared final guide build only after the new app is verified.
   Its links and both QR formats must target the exact same new address. Keep
   the original site available for existing installations and push subscriptions.
5. Complete the three reviewed videos with final URL and device-accurate
   installation footage. A new origin needs separate installation, sign-in and
   notification permission on each phone. Real delivery acceptance remains a
   later DVD/SZS gate.

Source: `docs/APP_FINISH_AND_ONBOARDING_PLAN.md` and current Supabase Auth
redirect documentation. No real alert, account, role, email or database change
was made while preparing this transition.
