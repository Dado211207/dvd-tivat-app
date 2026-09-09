# Work log

Newest entry first. One entry per unit of work, written in the same commit as the work itself.
Record what was done, what was verified, and what the next concrete action is.

---

## 2026-09-09 — Accounts, owner roles and incident-map foundation

**Requested workflow:** added the detailed design for email/password signup, a six-digit email
verification code, name-and-surname completion, citizen-by-default access, and owner-only promotion
to firefighter, commander or administrator. Names are display data; permissions bind to the
authentication UUID. The owner role is deliberately absent from assignable roles.

**Report workflow:** specified and tested that every active approved firefighter, commander,
administrator and owner receives an informational `UNVERIFIED` report alert. This is separate from
an authorised call-out. Citizens cannot see the member roster, account directory, other reports or
operational details.

**Prototype UI:** added an eighth `Nalozi i pristup` view with the five-step registration flow and
a searchable fictional owner directory. It lets the owner simulation review role assignment without
accepting real emails or claiming authentication. Added an interactive Leaflet/OpenStreetMap map to
citizen intake: explicit device location and explicit map pin carry different sources, and stored
prototype reports appear with labelled unverified/reviewed markers. CI blocks community tile requests
rather than using the public tile service as test infrastructure.

**Production foundation:** added a dormant Supabase client for signup, OTP verification, profile
completion, sign-in and sign-out; a sample file containing only public browser configuration names;
and a SQL migration for profiles, access grants, role audit, citizen reports and private-media
metadata with RLS enabled. No project exists or is configured by this change, and the migration is
not applied anywhere.

**Research:** primary-source security, upload, geolocation, map-policy, push, storage and email limits
are cited in `ACCOUNTS_REPORTS_MAP_PLAN.md`. Free service allowances are treated as prototype capacity,
not reliability evidence. Custom SMTP, real role-policy tests, private storage, owner MFA and field
notification measurements remain gates before involving real people.

**Verification:** ESLint, 91 Vitest tests across eight files, strict TypeScript, production build and
`git diff --check` pass on the final local tree. The initial build warned that the new map and auth
libraries pushed one JavaScript chunk over 500 kB; the account and citizen-report views are now lazy
chunks, reducing the initial bundle to about 230 kB (69 kB gzip). The local Playwright run was
attempted and all 66 scenarios stopped before page launch because the required Chromium executable
was absent. Four official CDN attempts then timed out or returned 502, so no browser pass is claimed
locally. The complete tests remain committed for GitHub CI, which installs its own browser.

**Next:** publish this isolated branch for review and require the exact-head GitHub browser and
accessibility job to pass. The SQL migration has not been executed because this environment has no
dedicated Supabase project or local PostgreSQL instance; apply it only after independent review. Do
not configure a backend, deploy, send email or alert anyone as part of this slice.

## 2026-09-09 — Prepare the first-test and presentation package

**Source clarification:** the prototype owner confirmed that he is a DVD Tivat
firefighter-rescuer. The 52-member count, two vehicle categories, no-shift/base-first routine,
Viber alert group, iPhone/Android mix and DVD-Tivat-only scope are therefore recorded as first-hand
operating facts, not as facts awaiting another confirmation. Formal application permissions,
pilot approval, data governance and emergency safeguards remain authorised product decisions.

**Public context:** checked the society's public Instagram and Facebook presence. The public profile
supports the name and the 2018 origin/history statement only; it is not used to infer operations.
No social-media crest was imported because no approved original SVG or high-resolution transparent
PNG was available.

**Test package:** added `FIRST_TEST_CHECKLIST.md` with simulation safety gates, one complete
call-out, vehicle/status separation, citizen-report and administration checks, persistence/reset,
and explicit 390x844 and 412x915 phone passes. Added `TEST_FEEDBACK_FORM.md` with ratings, an issue
template and a decision outcome. Both forbid real identities and incident data.

**Presentation package:** added an 8–10 minute `PRESENTATION_SCRIPT.md` with exact fictional inputs,
spoken opening/boundary/closing text, a timed demonstration and the product decisions to obtain.
The detailed `DEMO_GUIDE.md` now routes presenters through the checklist and feedback form first.

**Drift protection:** three new tests read the committed documents and require the same 52-member
scale, base, Viber fallback, MAN-1, TERENAC-1, iPhone/Android targets, non-delivery statement and
public-branding boundary used by the application. The first implementation failed because Vitest
resolved an `import.meta.url` document path to `/docs`; the test now resolves from the project root.
The next run correctly caught two copy mismatches (`Viber` versus `Viber grupa`, and `terenac`
versus `TERENAC-1`); the documents were made exact and no assertion was weakened.

**Verification:** ESLint, 78 Vitest tests, strict TypeScript, the Vite production build and
`git diff --check` pass locally twice on the final tree. The private-data scan first matched CSS
triplets such as `255 255 255`; after excluding CSS colour declarations, the targeted secret,
telephone and email scan was clean.

GitHub CI run `34333542412`, job `102407498984`, completed successfully at attempt 1 on exact head
`0631119b8316cb390a654c70eaee6278e7dbee2e`: 78 unit tests, production build, 62 Chromium
functional/accessibility scenarios and 3 screenshot scenarios. Screenshot artifact `10096819765`
contains 14 PNGs, is 4,869,671 bytes and has GitHub-recorded ZIP SHA-256
`dd632584a7fd27884f6f9297a998a7c16fab996ea4bc3401a2e79cc3d4c13893`.

**Next:** keep PR #12 Draft and unmerged. The owner can now run the first-test checklist before
showing the prototype to DVD Tivat. The only visual output changed in this slice is the profile note
from pending confirmation to member-confirmed; the same screenshot suite passed on the exact head.

---

## 2026-09-09 — Apply the DVD Tivat operating profile

**First-hand operating facts:** the owner, a DVD Tivat firefighter-rescuer, confirmed 52 members;
one MAN firefighting vehicle and one firefighting SUV; no shifts; members travel from home to the
base for equipment before deployment; the current alert channel is a Viber group; both iPhone and
Android are used; and the product is for DVD Tivat only. Pending product decisions are isolated in
`docs/SOCIETY_PROFILE.md`.

**Public-data boundary:** the public repository still contains no real person, number, address,
registration, credential or incident. The seed now has 52 fictional member rows; rows 15–52 use
generic names. The two vehicle callsigns are invented. No scraped crest is used: the available
social profile image is not an approved, app-quality identity asset.

**Workflow correction:** removed the member-facing direct-to-incident choice. Every new response is
normalised by the pure reducer to `directToLocation: false`; the field remains only for compatibility.
Every preview and stored message states `Mjesto okupljanja: Baza DVD Tivat` separately from the
incident location. The duty overview names the no-shift/base-first model and Viber only as the
existing fallback; no Viber integration or notification was added.

**Scale and mobile UX:** the all-members group contains all 52 active fictional records. The duty
composer adds accessible search and a bounded scrolling roster without losing hidden selections.
Representative 390x844 iPhone and 412x915 Android checks assert no horizontal overflow and a 44px
primary action. These are browser-layout checks, not native push or locked-screen evidence.

**Local verification:** `npm run verify` passed: ESLint, 74 Vitest tests, strict TypeScript and a
Vite production build. Local Playwright could not launch because this environment has no Chromium;
the failed launch ran zero application assertions and is not counted as browser evidence. CI on the
exact remote head remains required before review.

**GitHub evidence:** Draft PR #12, runtime head
`f37994fc16a8aaa52d9eafef0b4cce89fd32a0e6`, CI run `34313382766`, job `102344466690`, attempt 1,
passed without a rerun: lint, strict typecheck, 74 unit tests, production build, 62 Chromium
browser/accessibility scenarios and 3 screenshot scenarios. Artifact `10089211902` contains 14 PNGs,
is 4,869,709 bytes and has GitHub-recorded ZIP SHA-256
`2085185206a6198ff79bf53d1385a706d7f154aacec9dc5c3b8d2408f66a2678`. The overview, composed
recipient search, member screen, two-vehicle board and 390x844 phone screenshot were visually
inspected; no overlap or clipping was observed. The phone screenshot is responsive-browser evidence,
not an iOS or Android native-device result.

**Next:** review the stacked Draft PRs in order (#9 through #12). Merge only with explicit owner
approval and reverify each retargeted exact head. Do not deploy, publish, enter real data or call
this an operational alert system.

---

## 2026-09-09 — Add safe local administration and define the production boundary

**Owner direction:** continue independently while Claude is unavailable, add the remaining useful
prototype functions, keep the experience personalised for DVD Tivat, and leave a reliable written
handoff. A later clarification records single-society use as the confirmed current scope.

**Citizen-report evidence:** CI run `34304900877`, job `102319448025`, attempt 1, passed on exact
head `b2c8065f18b82a9156a05aa48639b312f99efaa3`: lint, strict typecheck, 61 unit tests, production
build, 52 Chromium browser/accessibility scenarios and 3 screenshot scenarios. Artifact
`10086318945` contains 13 PNGs and has GitHub-recorded ZIP SHA-256
`4f69f5b6528b7a1264ff2cb484d2354c101e9ef8cf50f416965378093ef4c05d`. The preceding run failed
only because one test selected both a visible location result and the same text in a hidden dialog;
the selector was narrowed to the visible result without changing product behaviour or assertions.

**Local administration:** added pure reducer commands and a simulated-admin panel for creating and
updating invented members, groups and vehicles. Group membership is updated symmetrically on both
records, duplicate group names and vehicle callsigns are rejected, deactivated members remain in
history but are excluded from new recipient resolution, and repeated command ids are no-ops. The
panel accepts no contact details and repeatedly warns that it is local demonstration data, not
authentication or permission enforcement. Ten focused domain tests and browser/accessibility
coverage guard the new paths.

**Production boundary:** added `docs/PRODUCTION_ARCHITECTURE.md`. It records the server-owned data,
identity, authorisation, realtime, notification, citizen-media, privacy, operations and staged
physical-device evidence required after workflow approval. It is explicitly a decision document;
no backend, account, push service, upload endpoint, deployment or real data was added.

**Local verification:** `npm run verify` passed on the complete working tree: ESLint, 71 Vitest
tests, strict TypeScript and the Vite production build. `git diff --check` is clean. Local Chromium
remains unavailable, so no local browser pass is claimed.

**GitHub evidence:** Draft PR #11 targets `main` to test the complete stacked tree. CI run
`34305679955`, job `102321763307`, attempt 1, passed on exact runtime head
`55b3c15b848d489e903577ce020795953d63d2c8`: dependency install, lint, strict typecheck, 71 unit
tests, production build, 56 Chromium browser/accessibility scenarios and 3 screenshot scenarios.
Artifact `10086586979` contains 14 PNGs, is 4,107,485 bytes and has GitHub-recorded ZIP SHA-256
`92af330186f3f0abe8ec4362efea6c932d158d40fb6aaee6aa24524fda9c8239`. The full-page fictional
administration screenshot was visually inspected: the warning, forms, focusable controls, status
chips and roster/group/vehicle tables are legible with no observed clipping or overlap.

**Next:** review the stacked Draft PRs in order (#9, #10, #11). Merge only with explicit owner
approval and re-run exact-head CI after each retarget. Do not deploy, publish or enter real people
or operational data.

---

## 2026-09-08 — Simplify and modernise the interface before remaking the video

**Owner direction:** the first cinematic demonstration was acceptable as a video, but its application
interface was not. Do not revise the video yet. First produce a cleaner, simpler and more modern
desktop and phone experience, preserve every function, let the owner review it, then write a better
script and use more natural narration for the replacement video.

**Branch and safety:** work is isolated on `codex/modern-ui-ux`, based on verified
`main@9b4ba3fd22e83d30cb64c9718b673b5c19167a94`. No merge, deployment, real alert, real data,
credential, paid service or new video is part of this change.

**Interface correction:** removed the oversized decorative first-screen treatment and replaced it
with a compact operational summary whose status and counts come from the existing fictional state.
Grouped the six routes into operations and records, made the call composer a clear two-step workflow,
kept diagnostics secondary, and replaced the two-row phone menu with a compact horizontally
scrollable navigation row. Light and dark palettes now use calmer surfaces, stronger hierarchy,
larger focus rings and local system typography. The simulation disclosure, actor selector, preview
confirmation, validation, accessibility labels and every domain transition remain in place.

**Local verification:** `npm run verify` passed: ESLint, 50 Vitest tests, strict TypeScript and the
Vite production build. `git diff --check` passed. The repository Playwright command could not launch
locally because its Chromium binary was absent. One installation attempt was made; the CDN timed out
or returned 502, so it was not repeated. Browser, accessibility, responsive and screenshot evidence
will come from the existing GitHub workflow on the exact branch head rather than being guessed.

**First browser result and correction:** CI run `34233620774`, job `102085644202`, attempt 1,
failed five accessibility scenarios while all functional browser scenarios passed. Axe found the
new footer colour at 4.35:1 instead of the required 4.5:1 and found three explanatory `span`
elements inside a definition-list group. The result was not rerun. The next commit darkens the
shared faint-text token with a safety margin, increases footer text slightly, and represents each fact note
as a proper `dd`; no accessibility assertion was changed.

**Second browser result and correction:** CI run `34234136013`, job `102087384224`, attempt 1,
passed 46 browser scenarios and failed the same active-vehicle contrast check on desktop and phone.
The `Izaslo` chip measured 4.38:1 against its pale accent surface. That run was not rerun. The next
commit changes the light-theme accent from `#087b8c` to `#077687`, a measured 4.68:1 on that surface;
the existing dark-theme token is unchanged and no test or semantic status is changed.

**First complete browser pass and visual finding:** CI run `34234493087`, job `102088592524`,
attempt 1, passed all 50 unit tests, 48 browser/accessibility scenarios and two screenshot scenarios.
Screenshot artifact `10059284486` matched GitHub's recorded ZIP SHA-256
`4eb17435f0b4c307e62deb09a2f2b0c308329f037317babcb6e37c47f12585ac`. Visual inspection then
found that the three summary fact notes rendered at the numeric `dd` size and were ellipsised. The
cause was selector specificity after changing those notes from `span` to semantic `dd`. The next
commit gives the note selector equal structural specificity and allows the short copy to wrap; this
is a visual correction even though the automated suite was already green.

**Next:** push one atomic branch commit, open a Draft PR, run the existing 48 browser/accessibility
checks and two screenshot scenarios, then visually inspect the generated desktop and phone PNGs.
Do not merge or create the replacement video before owner review.

---

## 2026-09-08 — Final review, ordered merge and post-merge verification

**Owner approval:** after the combined-tree review reported no blocker, the owner explicitly
approved merging the reviewed stack.

**Review before merge:** the complete PR #7 tree matched the remote branch tree. Local lint,
strict typecheck, 50 unit tests and the production build passed. Both the full and runtime-only npm
audits reported zero known vulnerabilities. The public-tree scan found no real phone number,
email, credential, member record or private incident data. The only runtime external URL is the
OpenStreetMap search link opened by an explicit user click. Exact-head CI run `34200629847`, job
`101978356399`, attempt 1, passed 48 browser/accessibility checks and 2 screenshot scenarios.

**Merge:** PRs #1, #3, #4, #5, #6 and #7 were merged with merge commits in that order. Each next
PR was retargeted to `main` only after its verified base landed, preserving the tested ancestry.
Final `main` is `5c9acb6853543d61d6219fe377ba466e83ddf897`. GitHub compare reported the PR #7 branch ahead by
zero with no changed files, proving the merged tree is the reviewed final tree. PR #2 was not part
of the application stack and remains unmerged.

**Post-merge verification:** CI run `34204300780`, job `101990099552`, push event, attempt 1,
completed successfully on the exact final `main` commit. Dependency installation reported zero
vulnerabilities; lint, strict typecheck and production build passed; 50 unit tests, 48 Chromium
browser/accessibility checks and 2 screenshot scenarios passed. Artifact `10047140105` contains
12 PNGs, is 2,303,291 bytes, and has GitHub-recorded ZIP SHA-256
`5f3251f5f910889af95809ef65dd6c2f43391a8a0f9b4fe86069be10c8efdda7`.

**Unchanged limits:** no deployment, licence, account, backend, notification channel, paid service
or real data was added. Single-society use is still the owner's expectation, not a confirmed DVD
Tivat requirement.

**Next:** owner testing from `main` using `docs/DEMO_GUIDE.md`. Record concrete feedback before
changing the prototype. Do not begin production work before PRODUCT_PLAN questions Q1 and Q12 are
answered with the society.

---

## 2026-09-07 — Personalise the DVD Tivat workspace and prepare the demonstration

**Owner direction:** implement the outstanding review, mobile/keyboard checks, screenshots and
demonstration scenario. Personalise the modern interface for DVD Tivat. Use by this society alone
is an expectation, not confirmed; recorded in PRODUCT_PLAN and PROJECT_STATE. Claude is temporarily
unavailable; Codex is continuing on `codex/dvd-tivat-interface`, preserving every previous branch.

**Changes:** navy society rail, responsive six-item navigation, system light/dark working surfaces,
original sea-line decoration and a team overview whose fictional record counts use existing selectors.
No official logo, remote asset, dependency, authentication, alert channel or operational rule added.
The simulation disclosure remains visible on every view. Added DESIGN_DIRECTION and DEMO_GUIDE.

**Two corrections found during the requested review:**

- The skip link's `#main` fragment changed the hash route to the default screen. It now moves keyboard
  focus to main without changing the route or losing an unsent member draft. Added an HTTP browser
  interaction test, compact-width navigation checks and a count-independence scenario.
- A failed write probe discarded readable saved work in favour of the seed. A pre-fix persistence
  run showed **1 failed, 12 passed**, with the saved exercise title replaced by the seed title. Reads
  now proceed even if writes fail; existing data load with a truthful warning. No stored state is
  overwritten during loading. Full nested validation and multi-tab synchronisation remain limitations.

**First verification on runtime head `6016df4`:** lint, typecheck, build and **50 unit tests** passed
locally and on GitHub. CI run **34167989821**, job **101882738158**, attempt 1: **46 browser/axe
checks and 2 screenshot scenarios passed**. Twelve PNGs in artifact **10034805633**, ZIP SHA-256
`01e8d04406d3a0bc1e2e128727fa8e28d5a69ca435b27ea9c7626c0bc828ebfb`, downloaded and matched before review.

**Visual-review follow-up:** the member notice still claimed an answer had been recorded before
submission (pre-existing copy). It now distinguishes unsent, recorded and editing states, covered
by one browser scenario in both viewports. Full-page screenshot capture now scrolls to the top so
the sticky rail does not appear halfway down the image. Final follow-up CI belongs in the PR evidence.

**Follow-up verification on `dc38f1a`:** GitHub CI run **34168251914**, job **101883472581**, attempt
1: lint, strict typecheck, production build, **50 unit tests, 48 browser/axe checks and 2 screenshot
scenarios all passed**. Twelve screenshots in artifact **10034881906** were downloaded, the ZIP
matched SHA-256 `b8e9ed27f4816caf697e6e8d337f4a0dd615394bc3270a2295f90d29a97a12a0`, and the corrected desktop
and phone images were visually reviewed before being committed. The artifact contained only the
12 expected PNG basenames. No test was re-run; both CI runs were attempt 1.

The interactive cloud browser could not open this environment's localhost (`ERR_BLOCKED_BY_CLIENT`),
so browser verification and refreshed images use the repository's existing Playwright suite on a
standard GitHub runner. Added a CI screenshot artifact step; no deployment or automatic image commit.
The first local typecheck caught an optional indexed test value; corrected before CI.

**Next:** review Draft PR #7 and the committed screenshots, then have the owner run the demo.
Keep all PRs Draft and unmerged; no publishing, licence, paid service or real member data.

---

## 2026-09-07 — Harden local storage startup checks

**Finding and reproduction**

The start-up capability check wrote and deleted the fixed generic key `__dvd_tivat_probe__`.
Another application on the same origin could already own that key, in which case merely opening
this prototype overwrote and deleted the other application's value. Separately, `loadState()` did
not catch a `getItem()` refusal after the storage reference and write probe had succeeded, so a
browser policy change during start-up could crash React initialisation instead of showing the
existing storage warning.

Both regressions were written and run before the correction. The focused pre-fix result was
**2 failed, 10 passed**: one uncaught `SecurityError`, and one erased pre-existing probe value. The
test-only commit is preserved as remote commit `4e192fa`.

**Correction**

- The write probe now stays in the prototype's own `dvd-tivat-prototip:*` namespace.
- Any value already present at that namespaced probe is restored, including a best-effort restore
  when a storage backend mutates and then throws.
- Refusal of the real state read is caught. The app starts from fictional seed data and displays
  the existing `NEDOSTUPNO` warning instead of crashing.

**Verified**

| Check | Result |
|---|---|
| Persistence suite | **12 passed** |
| Full Vitest suite | **49 passed** |
| ESLint | Passes |
| Strict TypeScript + Vite 8 production build | Passes |
| GitHub CI run 34149475169, job 101828503089, attempt 1 | **Success** |
| Playwright + axe | **40 passed** — 20 desktop and 20 phone |

The CI result is on the exact runtime correction `279619b`. The failure-report upload step was
correctly skipped because the job passed; no verification step was skipped.

**Next concrete action**

Review stacked Draft PR #6 after #5. Do not merge, deploy or publish automatically. The committed
screenshots still need regeneration before the meeting because this environment could not download
Chromium locally.

---

## 2026-09-07 — Isolate unsent member drafts between simulated actors

**Finding and reproduction**

`MemberView` kept its answer draft, ETA, direct-to-location choice, error and edit mode in component
state. Switching the simulated actor did not unmount that view, so a second fictional member could
inherit the first member's unsent form. Nothing had been persisted, but the second member could
submit the inherited choices as their own.

The regression was pushed before the correction. GitHub run 34148415755, job 101825317231, attempt
1 failed on both desktop and phone: after switching from Ivan to Petar, `submit-response` still had
count 1 instead of 0. The rest of the browser suite passed (38 passed, 2 failed).

**Correction**

- Key only the member view by the simulated actor id. React now remounts that local form when the
  simulated person changes, discarding the old person's unsent draft.
- Other views are not keyed by actor, so changing the simulation selector cannot erase an
  in-progress dispatcher or vehicle form.
- The regression verifies a delayed/direct draft, switches actors twice, requires clean controls,
  and finally confirms that all four called members still have no recorded response.

**Verified**

| Check | Result |
|---|---|
| Full `npm audit` | **0 vulnerabilities** |
| ESLint | Passes |
| Vitest 5 | **47 passed** |
| Strict TypeScript + Vite 8 production build | Passes |
| GitHub CI run 34148622458, job 101825935869, attempt 1 | **Success** |
| Playwright + axe | **40 passed** — 20 desktop and 20 phone |

The failing run remains recorded; it was not rerun. The passing result came from the next commit
containing the product correction.

**Next concrete action**

Review stacked Draft PR #5. The committed screenshot files still need regeneration before the
meeting; the screenshot test is updated, but this environment could not download Chromium.

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
# 2026-09-08 — Citizen-report prototype, first slice

**Scope**

- Started `codex/citizen-report-prototype` from the exact tree under review in
  `codex/modern-ui-ux`. Stable `main` and the redesign branch were not modified.
- Added a seventh route for a citizen to describe a possible incident, attach an optional
  session-only photo, type a landmark or explicitly request device coordinates, review the exact
  record, and save it locally.
- Added a separate DVD Tivat inbox action that can say only "reviewed in simulation". The domain
  structurally prevents report submission or review from creating an exercise, call, delivery,
  member response or vehicle movement.
- A reviewed item may prefill the existing dispatcher composer. It selects no recipients and
  creates nothing until the duty officer reviews and explicitly confirms the ordinary call flow.
- Bumped the JSON schema to 2 with one explicit lossless migration from schema 1: add an empty
  report inbox. Unknown versions are still rejected.

**Privacy and safety boundary**

- No backend, account, notification, upload or real alert channel was added.
- Image bytes and the local filename never enter application state or local storage.
- Device location is requested only after an explicit button press and remains in this browser.
- Every report screen states that it is not an emergency channel and that nothing reaches DVD
  Tivat or any service.

**Verification so far**

- TypeScript and ESLint pass.
- 24 focused domain and persistence tests pass, including nine new report rules and explicit
  schema migration coverage.
- Local browser execution is not claimed: the Playwright Chromium download failed with repeated
  CDN timeouts/502 responses. GitHub CI must execute the browser, mobile and accessibility checks
  on the eventual pushed head.

**Next concrete action**

Run the complete local non-browser gate, finish browser-test coverage and push this isolated branch
for a Draft stacked review. Do not merge or deploy it.

---
