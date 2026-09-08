# Work log

Newest entry first. One entry per unit of work, written in the same commit as the work itself.
Record what was done, what was verified, and what the next concrete action is.

---

## 2026-09-07 — Development toolchain security update

**Finding**

`npm audit --omit=dev` reported zero production vulnerabilities, but the full audit reported five
development-only findings: three moderate, one high and one critical. They affected the local
Vite/esbuild development server and the optional Vitest UI server. The application ships no Node
server, so this was not a runtime-app vulnerability, but leaving known vulnerable tools in the
project was unnecessary risk for anyone running the prototype locally.

**Done**

- Upgraded the compatible toolchain set together: Vite 5 to 8.2.2, Vitest 2 to 5.0.0, and the React
  Vite plugin 4 to 6.1.1. No `--force` or `--legacy-peer-deps` was used.
- Rebuilt `package-lock.json` from the declared dependency set instead of preserving an old peer
  graph that npm correctly refused to reconcile.
- Added the Node version range required by Vitest 5 and documented it in the README.
- Updated the architecture document's current Vite version. The earlier Session 1 entry remains
  unchanged as historical evidence of what was originally scaffolded.
- Corrected the old claim that Vite output can be opened directly from disk. The generated HTML
  uses root-relative `/assets/...` URLs; it must be served by `npm run preview` or a static host.

**Verified before push**

| Check | Result |
|---|---|
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Full `npm audit` | **0 vulnerabilities** |
| ESLint | Passes |
| Vitest 5 | **47 passed** |
| Strict TypeScript + Vite 8 production build | Passes |
| `git diff --check` | Passes |
| GitHub CI run 34147837288, job 101823596636, attempt 1 | **Success** |
| Playwright + axe in that job | **38 passed** — 19 desktop and 19 phone |

GitHub CI installed Chromium and exercised the browser/accessibility suite on the exact toolchain
commit `4f070a5`; all 38 checks passed. A later documentation-only commit records that evidence and
does not change dependencies, application code or tests.

**Next concrete action**

Review stacked Draft PR #4. Leave it unmerged and undeployed for owner review.

---

## 2026-09-07 — Member response confirmation and test-count correction

**Done**

- Continued from `claude/dvd-tivat-app-dev-n8wctb@35a6416` on the separate
  `codex/member-response-confirmation` branch. The source branch and `main` were not modified.
- Corrected the member response flow: tapping `Dolazim`, `Dolazim kasnije` or `Ne mogu` now creates
  a visible draft. The member reviews the destination and, where applicable, the ETA before the
  explicit `Posalji odgovor` action records anything.
- Added a browser regression covering arrival via the station, direct arrival, delayed arrival,
  refusal, and editing an existing answer. Updated the existing flow, accessibility and screenshot
  paths to use the same explicit confirmation.
- Corrected `PROJECT_STATE.md` to distinguish 38 CI browser checks from the two desktop-only
  screenshot-generation checks instead of combining them into one ambiguous total.

**Verified before push**

| Check | Result |
|---|---|
| ESLint | Passes |
| Vitest | **47 passed** |
| Strict TypeScript + production build | Passes |
| `git diff --check` | Passes |
| GitHub CI run 34146149937, job 101818505766, attempt 1 | **Success** |
| Playwright + axe in that job | **38 passed** — 19 desktop and 19 phone |

The local environment could not download its Chromium test binary, so no local browser-test pass is
claimed. GitHub CI installed Chromium and executed the full browser/accessibility suite on the exact
runtime commit `f09fea1`; all 38 checks passed. A later documentation-only commit records that
evidence and does not change application or test code.

**Next concrete action**

Review stacked Draft PR #3 into `claude/dvd-tivat-app-dev-n8wctb`. Do not merge or deploy it
automatically.

---

## 2026-09-07 — Session 1, part 2: prototype implementation and verification

**Done**

- Scaffolded React 18 + TypeScript (strict) + Vite 5. Two runtime dependencies (`react`,
  `react-dom`); everything else is a dev dependency. No backend, no paid service, no network calls
  at runtime.
- Implemented the pure domain layer in `src/domain/`: `types`, `errors` (errors as values, not
  exceptions), `commands` (the command union, shaped like a future server API), `reducer`
  (`applyCommand`, the single place state changes), `selectors`, `message`, and the fictional
  `seed`.
- Implemented `src/storage/persistence.ts` over one `localStorage` key, handling storage
  unavailable, quota exceeded, corrupt data and an unknown schema version — each with its own
  message, and no silent migration.
- Built six views with hand-written CSS: dispatcher, member, vehicles, station display, roster,
  history. The application opens directly into the dispatcher screen.
- Wrote `.github/workflows/ci.yml` — one job on `ubuntu-latest`, `concurrency` with
  `cancel-in-progress`, Chromium only, 7-day artifact retention.

**The honesty rules, and where they are enforced**

- `DeliveryAttempt` is only ever created in `applyCommand`, always as `NIJE_POKUSANO` on channel
  `NEMA`. A test drives every user-reachable command and asserts no other state is ever produced.
- `vehicleStateFrom(movements, vehicleId)` does not take responses as a parameter, so no future
  edit can make an answer move a vehicle.
- `Exercise.status` changes only through `SET_EXERCISE_STATUS`; `ZAVRSENA`/`OTKAZANA` are not
  reachable from it at all, only through the separate confirmed close/cancel commands.
- `Call.recipientIds` is frozen at send time and is not recomputed from group membership.
- The simulation bar is on every screen, styled as a warning strip rather than an account menu.

**Verified — all green**

| Check | Result |
|---|---|
| `tsc --noEmit`, strict | Passes |
| ESLint (typescript-eslint, react-hooks, jsx-a11y) | Passes |
| Vitest | **47 passed** — 37 domain, 10 storage |
| Playwright, desktop 1440x900 | **20 passed** |
| Playwright, Pixel 5 viewport | **18 passed** (screenshot spec is desktop-only) |
| axe-core (wcag2a/2aa/21a/21aa) | No violations on six views, light **and** dark, empty and populated, plus the modal |
| Build | Clean; 203 kB JS / 62 kB gzipped |

Screenshots regenerated into `docs/screenshots/` from fictional data only.

**Three real defects found by the checks and fixed at the cause**

1. `saveState` probed storage with a test write before saving, so a quota-exceeded failure was
   reported as "this browser blocks storage". Split the probe (start-up only) from the real write,
   which now reports its own failure.
2. `--c-ink-faint` measured 4.49:1 against the page background — below WCAG AA for small text.
   Darkened to 5.2:1. `--c-unknown` had the same problem at chip size.
3. `.btn--danger` hardcoded white text, but `--c-alert` flips to a light salmon in dark mode:
   2.28:1. Added `--c-ink-inverse`, which flips with the theme, and extended the dark-mode axe scan
   to render a selected answer button, where the same bug was latent.

Also fixed: `scrollable-region-focusable` at phone width — tables and the modal body scroll but had
no tab stop, so they were unreachable without a pointer. Added a labelled `ScrollRegion`. And row
headers were inheriting the column-header styling, rendering member names uppercase and faint.

**Two more found by CI itself, on the first hosted run**

4. The browser job died on a bare `Timed out waiting 120000ms from config.webServer`. `vite preview`
   binds `localhost` by default, which on the runner can resolve to `::1` while Playwright probes
   `127.0.0.1` — the server was up and unreachable. Both sides are now pinned to `127.0.0.1`, and
   the webServer's stdout/stderr are piped so the next such failure is readable rather than a bare
   timeout. Reproduced the CI path locally with `CI=1`, which forces a fresh server instead of
   reusing a running one.
5. The workflow listened to both `push` on every branch and `pull_request`, so each push to a
   branch with an open PR ran the whole suite twice. Push now covers `main` only.

**Not done / limitations**

- No server, no accounts, no notification of any kind. By design.
- FireApp itself was never installed or tested; `docs/FIREAPP_REVIEW.md` is a documentation review.
- Apple's Critical Alerts entitlement wording and the Google Play SMS policy table were **not**
  verified in this session and are marked as such.
- No private preview hosting was available, so the prototype is provided as a runnable project and
  screenshots. It has not been deployed anywhere.
- Playwright resolves to a version whose bundled Chromium build may not match a pre-provisioned
  sandbox. `PLAYWRIGHT_CHROMIUM_PATH` points the run at an existing browser; CI installs its own and
  leaves the variable unset.

**Next concrete action**

Take the prototype to the meeting and answer
[PRODUCT_PLAN.md §G](../PRODUCT_PLAN.md#g-questions-for-the-meeting-with-the-society) — starting
with Q1 (is any dispatch system obligatory?) and Q12 (what does a custom build give the society
that an existing product does not?). Do not start Phase 2 until those two are answered: the first
can invalidate the plan, and the second decides whether it is worth doing.

---

## 2026-09-07 — Session 1, part 1: research review and plan

**Done**

- Inspected the repository before editing: one commit (`307ebba`), a two-line `README.md`, no other
  files. Nothing pre-existing to preserve. Working branch `claude/dvd-tivat-app-dev-n8wctb` already
  existed on the remote and was already checked out.
- Re-verified the reference research against primary sources rather than trusting the supplied
  report. Fetched and confirmed: FireApp's selective-alarming workflow (recipient selection,
  preview, double confirmation, TEST/VAJE/INTERVENCIJA labels, internet requirement), the member
  response options (three answers, 15/30/60-minute bands, direct-to-location, changeable), and
  vehicle departure/return logging. Written up with a per-claim verification table in
  `docs/FIREAPP_REVIEW.md`.
- Could **not** verify Apple's Critical Alerts entitlement wording — the Apple documentation page is
  client-rendered and returned no body text to the fetch tool. Recorded as unverified rather than
  asserted. Same for the Google Play SMS policy table, which is reported from the source research
  and not independently re-fetched.
- Wrote the plan: `docs/PRODUCT_PLAN.md` (scope, users, prototype vs production, assumptions, four
  roles with a proposed permission matrix, the six-fact data model, five phases with failable
  acceptance criteria, risks, questions for the society) and `docs/ARCHITECTURE.md` (stack choice
  and rejected alternatives, layering, the pure-reducer decision, honesty enforced in types,
  persistence limits, path to mobile, verification strategy).

**Verified**

- Four primary-source fetches succeeded and are quoted in `docs/FIREAPP_REVIEW.md` §2.
- Two intended sources did not verify and are marked as such. No claim in the documents rests on an
  unverified source without saying so.

**Not done / limitations**

- No code yet at the time of this entry.
- FireApp itself was not installed, logged into, or tested. This is a documentation review only.

**Next concrete action**

Scaffold the React + TypeScript + Vite project per `docs/ARCHITECTURE.md` §1, then implement
`src/domain/` (types, errors, commands, pure reducer, selectors, fictional seed) before any UI.
