# Detailed FireNexa review — 3 October 2026

## Scope and evidence

Published app: https://boka-operativa-phone-test.netlify.app/
Public guide: https://firenexa.netlify.app/
The base reviewed source is `e94d4c2`, documented on `6c5417b`.
CI 37092825208 passed on `6c5417b`: 851 unit/component tests, 960 database/RLS
tests, 400 browser/accessibility tests and 16 review captures. Twelve hosted
operation tests were skipped because real demonstration credentials were not
provided. They are excluded from the passing count.

Read-only checks on isolated Supabase `zoipjcdtcfetqvcfmhxd` confirmed:

- All 34 public tables have RLS enabled and no anon SELECT privilege.
- All 87 public SECURITY DEFINER functions deny PUBLIC and anon EXECUTE.
- Neither anon nor authenticated can CREATE in the public schema.
- Actual anonymous HTTP reads of profiles, grants, memberships, roster,
  interventions, recipients, responses, attendance, push subscriptions,
  outbox and delivery attempts were refused with HTTP 401 (11 endpoints).
- Repository-only migration consistency passed: 48 files, 48 harness entries.

No user rows, credentials or push endpoints were read. No account was created,
no alert sent and no database, role or permission changed. This is not hosted
schema equivalence or production/physical-device acceptance.

## Finding and correction

The app shell already supplies a single page H1. Accounts and Registry also
rendered their own hidden H1, producing duplicate top-level headings in actual
hosted pages. Removed these two view headings and the now-unused Accounts text
hook. Visible section headings and labels stay intact. Added a regression
check that every regular route has exactly one main H1.

The first automated offline check was affected by request interception.
A separate un-intercepted browser reproduced a working offline shell, an
accurate offline notice and Settings; the API was absent from the cache.
The reproducible review script disables interception before warming the SW
cache and switching offline, and uses a clean signed-out browser context.

## Reproducible hosted review

`scripts/hosted-smoke.mjs` checks the six regular routes at
320/390/768/1112/1440 px, seven retired links, native login validation,
keyboard skip/draft preservation, accessibility, offline reload and language
persistence, no private API caching, JavaScript crashes or live writes, and
the public guide/QR/local anchors. It never submits valid credentials or
registration, incident or push actions. Browser routing blocks writes during
UI checks; offline Settings uses only local preferences without credentials.

Run with the installed Playwright browser: `node scripts/hosted-smoke.mjs`.
An execution proxy with an untrusted CA can opt into the documented test-only
`FIRENEXA_PROXY_CA_EXCEPTION=true`; ordinary execution keeps strict TLS.
The JSON report defaults to `/tmp/firenexa-hosted-smoke.json`.

Remaining delivery work: professional app origin plus Auth/email redirects;
three reviewed video exports. Genuine signed-in operation and physical push
acceptance remain separate; do not label fixture tests as that evidence.


Local correction validation: lint, TypeScript, build and all 851 unit/component
tests passed. Thirty-two browser checks passed in the broad selection; the new
heading check initially used a commander fixture, whose navigation correctly
omits Registry. With the owner fixture, all four heading/retired-link checks
passed on desktop and mobile (34 unique selected browser cases covered).
Full candidate CI and publication must be verified before the new hosted
review is recorded as passing.
