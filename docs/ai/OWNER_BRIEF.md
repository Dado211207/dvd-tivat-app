# DVD Tivat: owner brief and conversation handoff

Recorded: 2026-09-07. This is a project decision summary, not a transcript or a claim of completed implementation.

## Start here in a new session

1. Confirm the repository is Dado211207/dvd-tivat-app. Do not work in JARVIS or the Claude Toolkit repository.
2. Read this brief, repository agent instructions, and docs/ai/PROJECT_STATE.md and docs/ai/WORK_LOG.md when available.
3. Inspect live branches, open pull requests and the exact commit under review. Reports and this checkpoint can become stale.
4. Preserve concurrent work. Continue the existing implementation rather than scaffolding a second application.
5. Report what is implemented, what is simulated, the actual test evidence, and the next useful step. Never claim automatic access to previous conversations.

This brief is initially stored on codex/project-continuity, pending review. If it is not yet on main, read that branch explicitly. Do not merge it without owner approval.

## Goal and working arrangement

The owner wants a polished, working volunteer-firefighter coordination prototype personalized for DVD Tivat, inspired by FireApp.eu. The owner will test it, request changes and demonstrate it to the society. Selection for a production project is not yet agreed.

Codex helps clarify scope, review evidence and guide the owner. Claude Code has already received an implementation prompt for this repository. The owner decides scope, spending and acceptance. AI assistance is not a substitute for operational ownership, real-device testing or emergency-service approval.

Keep owner updates short, in the local language without diacritics. Development prompts and repository documentation are English. Give complete copy-ready prompts and identify the correct project chat. Avoid making the owner assemble fragments or repeatedly restate the project.

## Budget and authorization

- Build the prototype without new paid services, using existing tools within their limits.
- The repository is intentionally public. Do not change visibility.
- Public source does not authorize public app hosting or publication.
- Local or owner-only preview is allowed; confirm access controls before calling a hosted preview private.
- No paid infrastructure, real alerts, contacting members, public deployment, store submission or merge without further authorization.
- Never commit real credentials, phone numbers, personnel records, private locations or conversation screenshots.
- No guaranteed schedule, delivery reliability or production cost has been established. Maintenance ownership and funding remain undecided.

## First deliverable: exercise-only prototype

Build an original interface, not a copy of FireApp assets or proprietary implementation. Use fictional data and make simulation explicit.

Roles/views:
- Society administrator: fictional roster, groups, roles and specialties.
- Authorized dispatcher: create an exercise with title, instructions and incident location; select recipients; review the exact call before confirming.
- Member simulation: only addressed calls; Dolazim / Dolazim kasnije / Ne mogu; ETA and optional station versus direct arrival; permitted response changes while open.
- Read-only station display: legible active exercise, location, responses and vehicle states.

Required behavior:
- Clear no-response counts, timestamps and actor history.
- Vehicle departure and return are explicit events, independent of a member saying they will attend.
- Explicit cancel/close and confirmed demo reset.
- Handle empty data, invalid locations, no recipients, duplicate submits, closed/cancelled calls and storage failures.
- Distinguish call creation, simulated delivery, actual device acknowledgement if supported, human response and vehicle departure. Never infer one from another.
- Role switching is a demo control, not authentication. Local browser storage is not shared multi-device synchronization.
- Responsive phone/tablet/desktop UI, keyboard navigation, visible focus, adequate contrast and reduced motion.
- No real emergency use. The prototype must not replace existing alerting or dispatch arrangements.

Deferred:
Citizen reporting, nationwide geographic routing, continuous location tracking, real push/SMS/calls, official-system integrations, station hardware, production authentication, app-store publication and AI operational decisions.

The owner's earlier citizen-reporting idea remains a future possibility, not an approved first-phase requirement. The society's actual needs must be confirmed before expanding scope.

## Delivery sequence and acceptance

1. Write PRODUCT_PLAN.md and ARCHITECTURE.md, including assumptions, roles, entities, transitions, limitations and measurable acceptance criteria.
2. Implement the exercise prototype on a feature branch and open a Draft PR.
3. Test recipient isolation, responses/counts, duplicate actions, closure/cancellation, independent vehicle states, history and reset. Run browser and accessibility checks; capture real prototype screenshots with fictional data.
4. Review results and provide a usable owner preview with a short test checklist.
5. Owner tests; record feedback and repair confirmed defects.
6. Prepare the society demonstration: working exercise, screenshots, limitations and questions.
7. Only if accepted, agree production scope, costs, maintenance, security and delivery/fallback requirements before building operational services.

Production readiness requires separate validation, including real phones, locked/background states, permission denial, offline behavior, fallback alerting, access control and operational responsibility. A green demo is not evidence of emergency-grade delivery.

## Reference and unresolved requirements

Primary reference: https://fireapp.eu/
Public manuals: https://upute.fireapp.eu/ and https://doc.fireapp.eu/

Prior research found organizational dispatch, selective recipients, member responses, vehicle tracking and station displays. Public materials do not establish a citizen-reporting/nationwide dispatch requirement, source-code security or a suitable service agreement for this project. Platform notification behavior must be independently verified, not copied from marketing claims.

Ask the society:
- Who creates and receives calls, and through what existing system?
- How many members, devices and groups are involved?
- Which response and vehicle states are actually needed?
- Which roles may see or change which information?
- What fallback is required when phones or internet fail?
- Why a bespoke application, and who will own, fund and maintain it?

## Observed checkpoint

At the initial read on 2026-09-07:
- main: 307ebba9947313f654677c03c54e72fb2e80695b.
- Only README.md was present; no open PR or implementation branch was visible.
- The owner had sent Claude the full implementation prompt. No remote code at that moment does not mean no work was underway.
- No prototype test results, production readiness or society acceptance are claimed here.
- This documentation change adds no application code and does not deploy anything.

## Ongoing documentation contract

Keep docs/ai/PROJECT_STATE.md as the current resume point: active branch, base, PR, completed versus pending work, demo limitations, blockers and next action.

Keep docs/ai/WORK_LOG.md chronological: date, decisions, changes, exact tests and outcomes, failures, evidence links and owner approvals. Preserve corrected claims as corrections rather than silently rewriting history.

Record owner feedback as numbered items with expected/actual behavior, severity, reproduction steps, status and verification evidence. Use only sanitized screenshots/data.

Update handoff documents alongside meaningful changes. After CI or review completes, a PR comment can record results without pretending an older document already contains them. At session end provide the exact resume link and clearly identify unmerged documentation.

Do not promise to remember every chat automatically. Repository-backed decisions and verified checkpoints are the continuity mechanism.
