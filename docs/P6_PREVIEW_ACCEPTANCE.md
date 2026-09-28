# P6 preview acceptance — the four account shapes, testable on a preview

This is the companion to `docs/P6_RELEASE_PREP.md` (on the release-prep branch).
That document lists the phone-testing acceptance matrix a person runs on real
devices. This one records the **automated browser coverage** added for those
same cases, how to open a **mobile-sized preview** of each shape, and — plainly —
what a preview built on the fake project does and does **not** prove.

Nothing here is run against production. No hosted test, no migration, no
deployment. The fresh production-derived equivalence gate through migration 039
remains **OPEN** and is not addressed here (see the last section).

---

## 1. What a person can now see and run

Two things were missing before: the dual-service switch and the owner (no member
record) were described in the acceptance matrix but had **no end-to-end coverage**
that drove the real screens, and there was no mobile capture of the four shapes to
look at. Both are added, against the fake project with fictional data only.

### Browser coverage added (real UI, not a mocked hook)

| Acceptance case | Test file | What it drives and asserts | Result |
|---|---|---|---|
| **1a DVD-only** — unchanged, no service badge | `e2e/operational.spec.ts`, `e2e/p6-shape-screenshots.spec.ts` | Existing command/firefighter/archive lifecycle; the screenshot shows the console with **no** acting-service badge | pass |
| **1b SZS-only** — full lifecycle, DVD never seen | `e2e/szs-lifecycle.spec.ts` | SZS commander draft→publish→answer→attend→confirm→close→archive, with a DVD decoy that never appears | pass |
| **1c dual-service** — badge, explicit switch, re-scope, draft isolation | `e2e/dual-service-switch.spec.ts` (new) | Badge shows; Settings offers both; switching to SZS shows only the SZS call-out and never the DVD one, and back again; an unsaved DVD draft is kept for DVD and is **empty** in SZS | pass (3/3) |
| **1d owner** — administers both, no member record | `e2e/owner-both-services.spec.ts` (new) | Owner gets the badge and both service radios; the read screen renders with no member record; the Accounts directory shows **both** DVD and SZS columns; the member-only "my call-out" screen says *"not linked to a member"* rather than going blank | pass (3/3) |
| **1f in-app sound** — any route; hidden-arrival stays silent on return | `e2e/callout-alarm-any-route.spec.ts`, `e2e/callout-alarm-resume.spec.ts` (new) | A chosen sound fires for a call-out that arrives while on Settings; a call-out that arrives while the tab is **hidden** does **not** sound when the tab returns | pass |

The complement of 1f — that a genuinely later arrival, *after* the resume
re-baseline, still sounds — is proven deterministically as a unit test
(`src/notifications/call-out-alarm.test.tsx`, *"quietly catches up after a hidden
tab becomes visible, then sounds later arrivals"*). It is not repeated as a
browser test because reproducing it needs three sequential publishes through the
commander UI whose timing against the realtime debounce makes a browser test
flaky for no added signal.

### How the fixture models a multi-service account

`e2e/fixture-server.ts` gained a `memberships` option: a list of `{ service,
role, memberId }`. It answers the identity RPCs (`current_organization_memberships`,
`is_installation_owner`, `current_role_in`, `current_member_id_in`) for **both**
services from that list and seeds a distinct call-out and roster per service,
each labelled with its `organization_id`. Because every operational read the
client makes already carries `?organization_id=eq.<org>`, the fixture's existing
equality filter re-scopes the screen on a switch with nothing extra to compute.
The owner is `memberships` with `memberId: null` in each service and `owner: true`.

---

## 2. Opening the mobile preview yourself

The preview is the **real application** served from a local build, answering a
**fake** Supabase project that lives entirely in the browser. It needs no
credentials and reaches nothing.

```bash
# from the repo root, on this PR's branch
npm ci
npm run build:fixture      # builds with the multi-service flag on, to dist-fixture
npm run preview:fixture     # serves http://127.0.0.1:4174
```

Then, to see a given shape, open the browser dev tools to a phone size (or use a
phone on the same network pointed at your machine's IP:4174) and, in the
console, install the shape you want before loading a screen. The exact fixtures
the tests use are in `e2e/fixture-server.ts` (`installFixtureProject`) and
`e2e/*.spec.ts`; the tests are the runnable, always-current version of "open this
shape and look". The simplest way to *watch* a shape end to end is to run its
spec headed:

```bash
# one shape, in a visible browser, paused so you can look
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  npx playwright test e2e/dual-service-switch.spec.ts --project=mobile --headed
```

Ready-made mobile screenshots of all four shapes are in
`docs/screenshots/p6/` (regenerate with
`npx playwright test e2e/p6-shape-screenshots.spec.ts --project=desktop --grep @screenshots`;
they render at a phone width via `test.use`):

- `1a-dvd-only-poziv.png` — DVD-only console, no service badge
- `1b-szs-only-poziv.png` — SZS-only console
- `1c-dual-poziv-badge.png` — dual-service, the "acting as" badge
- `1c-dual-podesavanja-switch.png` — the explicit service switch on Settings
- `1d-owner-nalozi-both-columns.png` — owner Accounts, both service columns
- `1d-owner-no-member-record.png` — owner on a member-only screen, refused in words

### What the preview proves — and what it does not

**It proves** that the real screens render for each shape, that the client scopes
every read to the acting service and re-scopes on an explicit switch, that an
unsaved draft is kept per service, that the owner with no member record is
refused member-only actions in words rather than a blank, and that the in-app
sound is addressed to the member, works on any route, and stays silent for a
hidden arrival on return.

**It does not prove** server isolation. The fake project has no row-level
security; a screen shows only its service's data here because the *client* asked
the right, service-scoped question, not because a server refused the wrong one.
The database's isolation is proven separately, against real PostgreSQL, in
`db-tests/` (RLS policies, definer functions, cross-service refusals). The
preview is not a connected or hosted system and must never be presented as one.

---

## 3. Full local battery on this head

Measured on this PR's committed head (see the PR body for the exact SHA):

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | pass (app + db-tests projects) |
| Lint | `npm run lint` | pass |
| Unit (incl. committed-files secret scan test) | `npm run test` | **807 passed / 52 files** |
| Migration consistency | `npm run check:migrations` | 40/40, no drift |
| Database / RLS | `npm run test:db` | **891 passed, 12 skipped** (hosted-only) |
| Build | `npm run build` | pass |
| Bundle secret scan | `npm run verify:bundle` | 26 files, no secret |
| Production dependency audit | `npm run audit:production` | 0 vulnerabilities |
| Browser / accessibility | `CI=true npm run e2e` | **354 passed** |

Local PostgreSQL 16 was started with `scripts/local-postgres.sh` under an
unprivileged user; Playwright used the sandbox Chromium. These are **local**
results. Because this PR is stacked (its base is not `main`), the repository's CI
workflow does not run on it — there is no GitHub CI result to cite for this head,
and none is claimed.

No application defect was found. Every new test passes against the current head:
the gap this PR closes was **missing coverage**, not broken behaviour, so there is
no failing-before/passing-after fix in it.

---

## 4. The gate that stays OPEN

The fresh **production-derived copy equivalence check through migration 039**
remains **OPEN**. It can only be satisfied by running the gate against an
authorised, isolated copy of production data — which is not done here, and which
a fixture result cannot substitute for. No production capture was created, and
`hosted_operations.test.ts` was not run. The release owner runs that gate, with
independent review, before any production step, exactly as
`docs/P6_RELEASE_PREP.md` §0 requires.
