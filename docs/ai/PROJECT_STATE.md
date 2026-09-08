# Project state

Single source of truth for resuming this work without reading the conversation that produced it.
**Update this file in the same commit as the change it describes.**

Last updated: 2026-09-07

---

## Current scope

Phase 1 of [PRODUCT_PLAN.md](../PRODUCT_PLAN.md) — a **local browser exercise prototype** for DVD
Tivat call-out and response. No server, no accounts, no notifications, no real data.

## Repository and branch

- Repository: `Dado211207/dvd-tivat-app` — **public**, and must stay public. Do not create another.
- Working branch: `codex/persistence-load-hardening`, stacked on `codex/member-draft-isolation`,
  `codex/dev-toolchain-security`, and `codex/member-response-confirmation` in that order. Keep each
  as a separate review; do not rewrite or force-push any base branch.
- Default branch: `main`. Do not merge; the owner decides.
- No `LICENSE` file. The owner has not chosen a licence and one must not be added for them.

## Status

**Planning complete. Phase 1 prototype complete and verified.** All checks green: 49 unit tests;
40 CI browser checks (20 scenarios in desktop and 20 in phone viewports), plus 2 separate
desktop-only screenshot-generation checks; axe-core clean on every view in both light and dark
themes; strict typecheck and lint clean. See [WORK_LOG.md](./WORK_LOG.md) for the evidence and for
the defects the checks caught.

Not deployed anywhere. Not merged. No licence file.

## Where things are

```
src/domain/      pure rules - types, errors, commands, reducer, selectors, seed, message
src/storage/     one localStorage key, with every failure mode handled
src/state/       React binding: injects the clock, ids and persistence
src/ui/          six views + shared components; hand-written CSS in src/styles
src/i18n/        every user-facing string, local language, no diacritics
e2e/             Playwright: flow, accessibility, screenshots (tagged @screenshots)
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

## Known limitations (by design, not defects)

- Data lives in one browser's `localStorage`; nothing is shared between devices or users.
- No authentication and no permission enforcement anywhere.
- No notification is sent by any code path.
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

Review stacked Draft PRs #3, #4, #5 and #6; their browser/accessibility evidence is recorded in
[WORK_LOG.md](./WORK_LOG.md). After that, take the prototype to the meeting with the society and answer
[PRODUCT_PLAN.md §G](../PRODUCT_PLAN.md#g-questions-for-the-meeting-with-the-society). Do not begin
Phase 2 until Q1 and Q12 are answered — the first can invalidate the plan, the second decides
whether the project is worth continuing at all.

See the last entry of [WORK_LOG.md](./WORK_LOG.md) for detail.
