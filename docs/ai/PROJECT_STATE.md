# Project state

Single source of truth for resuming this work without reading the conversation that produced it.
**Update this file in the same commit as the change it describes.**

Last updated: 2026-09-09

---

## Current scope

Phase 1 of [PRODUCT_PLAN.md](../PRODUCT_PLAN.md) — a **local browser exercise prototype** for DVD
Tivat call-out, response and citizen-report intake. No server, no accounts, no notifications, no
real data.

The active isolated slice is Draft PR #12 on `codex/dvd-tivat-operational-profile`, stacked above
Draft PR #11. Exact runtime-and-handoff head `0631119b8316cb390a654c70eaee6278e7dbee2e`
passed CI on its first attempt: 78 unit tests, 62 browser/accessibility scenarios and 3 screenshot
scenarios. It
applies the member-confirmed DVD Tivat scale and workflow without adding any operational channel:
52 fictional member rows, two fictional vehicle records matching the reported categories, base-first
assembly, Viber shown only as the existing fallback, recipient search, and explicit iPhone/Android
layout checks. The prototype owner is a DVD Tivat firefighter-rescuer and confirmed these current
operating facts first-hand; see [SOCIETY_PROFILE.md](../SOCIETY_PROFILE.md). Formal adoption,
permissions and pilot rules remain separate product decisions.

The same branch contains the complete first-review handoff: `FIRST_TEST_CHECKLIST.md`,
`PRESENTATION_SCRIPT.md`, `TEST_FEEDBACK_FORM.md` and `MEETING_DECISIONS.md`. Four structural tests
keep those documents aligned with the operating profile and the simulation/non-delivery boundary.
The local gate passes with 78 unit tests. Hosted Chromium, accessibility and screenshot evidence is
recorded in the newest work-log entry.

## Repository and branch

- Repository: `Dado211207/dvd-tivat-app` — **public**, and must stay public. Do not create another.
- Verified application state: `main@9b4ba3fd22e83d30cb64c9718b673b5c19167a94`.
- PRs #1, #3, #4, #5, #6, #7 and #8 were merged with merge commits, in that order, after the owner's
  explicit approval. Their source branches were not rewritten or deleted.
- PR #2 is separate historical continuity documentation. It is not part of the application stack
  and remains unmerged pending closure as superseded.
- No `LICENSE` file. The owner has not chosen a licence and one must not be added for them.

## Status

The modern visual redesign is isolated in Draft PR #9. The citizen-report slice is isolated in
Draft PR #10 on `codex/citizen-report-prototype`, stacked above that redesign. Its exact remote head
`b2c8065f18b82a9156a05aa48639b312f99efaa3` is green in CI: 61 unit tests, 52 browser/accessibility
scenarios and 3 screenshot scenarios. The intake is deliberately local-only and must not be
described as a working alert channel.

The next isolated slice is in Draft PR #11 on `codex/local-admin-prototype`: fictional local
administration of members, groups and vehicles plus the production architecture decision document.
It adds no account, permission boundary, backend, notification or real data. Exact runtime head
`55b3c15b848d489e903577ce020795953d63d2c8` is green in CI: lint, strict typecheck, 71 unit tests,
production build, 56 browser/accessibility scenarios and 3 screenshot scenarios. The generated
administration screenshot was visually inspected. See [WORK_LOG.md](./WORK_LOG.md) for exact
evidence and [DESIGN_DIRECTION.md](../DESIGN_DIRECTION.md) for the visual decisions.

The confirmed current scope is **DVD Tivat only**. Keep the UI focused on DVD Tivat and do not
implement multi-society routing unless a later authorised decision changes the product scope.
Five key screenshots from artifact `10089211902` were visually inspected with no observed overlap
or clipping in the overview, recipient search, member, vehicle or phone views.

Confirmed first-hand on 2026-09-09 by the owner as a DVD Tivat firefighter-rescuer: 52 members; no
shifts; members come from home to the base for equipment before deployment; one MAN firefighting
vehicle; one firefighting SUV; both iPhone and Android; Viber group currently used for alerts. Do
not invent exceptions, real roster data, vehicle registrations or integration credentials.

Not deployed anywhere. No licence file. No real alert, account or member data exists.

## Where things are

```
src/domain/      pure rules - types, errors, commands, reducer, selectors, seed, message
src/storage/     one state key plus a namespaced write probe; known failures tested
src/state/       React binding: injects the clock, ids and persistence
src/ui/          seven views + local fictional-data editor; hand-written CSS in src/styles
src/i18n/        shared labels; additional view copy lives in components; no diacritics
e2e/             Playwright: flow, admin, accessibility, screenshots (tagged @screenshots)
```

The rule that matters when changing anything: **`applyCommand` in `src/domain/reducer.ts` is the
only place state changes.** Adding a rule in a component instead puts it out of reach of the tests
and one careless edit away from breaking.

## Non-negotiable rules for anyone continuing this work

1. **The repository is public.** No real member names, phone numbers, addresses, incident records,
   credentials, or private locations — not in code, fixtures, tests, screenshots, logs or CI
   artifacts. Everything is invented and labelled as such.
2. **Never fabricate a delivery or a response.** Sending a call creates zero responses and zero
   delivery confirmations. `DeliveryAttempt.state` is `NIJE_POKUSANO` and nothing else while there
   is no notification service. There is a unit test guarding this; do not relax it.
3. **The role selector is a simulation, not authentication.** It must be labelled as such wherever
   it appears and must never be demonstrated as a login.
4. **Six facts stay separate**: call composed, service accepted, device acknowledged, person
   answered, vehicle departed, incident closed. Never collapse them into one "success".
5. **No official DVD Tivat logo or branding** unless the society supplies and approves it.
6. **Do not copy FireApp** source, branding, assets or screen layouts. Documented workflow concepts
   only, cited in [FIREAPP_REVIEW.md](../FIREAPP_REVIEW.md).
7. **No public deployment**, no app store submission, no real alerts, no contacting anyone.
8. **Do not invent** the society's escalation timing, operational authority or dispatch rules. Where
   it is not known, it is an open question, not a default.
9. Application labels: local language **without diacritics**. Repository documentation: English.
10. If a check fails, fix the cause. Do not weaken assertions or re-run until it passes.
11. The DVD Tivat profile is base-first. The legacy `directToLocation` field stays only for schema
    compatibility and every new response records it as false unless the society later confirms a
    different rule in writing.

## Known limitations (by design, not defects)

- Data lives in one browser's `localStorage`; nothing is shared between devices or users.
- Use one demonstration tab. Concurrent tabs can overwrite each other's local records; there is no sync.
- Stored JSON receives a top-level shape check, not complete nested schema validation; do not hand-edit it.
- No authentication and no permission enforcement anywhere.
- No notification is sent by any code path.
- Citizen photographs are session-only previews; only the boolean fact that one was included is
  stored. Device coordinates are read only after an explicit user action and remain local.
- The 15/30/60-minute arrival bands are taken from the reference product and are unconfirmed
  placeholders for Tivat.
- A browser prototype is **no evidence** that a locked Android or iOS device will raise an alarm.

## Outstanding questions

Blocking, shaping and decisive questions for the society are listed in
[PRODUCT_PLAN.md §G](../PRODUCT_PLAN.md#g-questions-for-the-meeting-with-the-society).
The two that most affect the work:

- **A8/Q1** — is there any obligation to use a particular dispatch system? If yes, much of this plan
  changes.
- **Q12** — what does a custom build give DVD Tivat that an existing product at a published ~3 EUR
  per operational member per year does not?

## Next concrete action

Complete [FIRST_TEST_CHECKLIST.md](../FIRST_TEST_CHECKLIST.md) on desktop and phone width. Fix any
blocking prototype defect before presenting. Then use [PRESENTATION_SCRIPT.md](../PRESENTATION_SCRIPT.md)
and collect [TEST_FEEDBACK_FORM.md](../TEST_FEEDBACK_FORM.md) responses. Review the four Draft PRs
and merge in stack order only with explicit owner approval: redesign (#9), citizen report (#10),
local administration (#11), operational profile (#12). Retarget each next PR after its prerequisite
lands and require a green exact-head CI result.

After the UI and functions are accepted, replace the first promotional video with a new script,
more natural narration and footage from the accepted interface.

Production Phase 2 still waits on
[PRODUCT_PLAN.md §G](../PRODUCT_PLAN.md#g-questions-for-the-meeting-with-the-society), especially
Q1 and Q12. Visual approval does not answer those operational questions.

See the last entry of [WORK_LOG.md](./WORK_LOG.md) for detail.
