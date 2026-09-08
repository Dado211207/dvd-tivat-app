# Project state

Single source of truth for resuming this work without reading the conversation that produced it.
**Update this file in the same commit as the change it describes.**

Last updated: 2026-09-08

---

## Current scope

Phase 1 of [PRODUCT_PLAN.md](../PRODUCT_PLAN.md) — a **local browser exercise prototype** for DVD
Tivat call-out and response. No server, no accounts, no notifications, no real data.

## Repository and branch

- Repository: `Dado211207/dvd-tivat-app` — **public**, and must stay public. Do not create another.
- Verified application state: `main@9b4ba3fd22e83d30cb64c9718b673b5c19167a94`.
- PRs #1, #3, #4, #5, #6, #7 and #8 were merged with merge commits, in that order, after the owner's
  explicit approval. Their source branches were not rewritten or deleted.
- PR #2 is separate historical continuity documentation. It is not part of the application stack
  and remains unmerged pending closure as superseded.
- No `LICENSE` file. The owner has not chosen a licence and one must not be added for them.

## Status

**Phase 1 behaviour is complete on `main`; a visual redesign is under owner review on
`codex/modern-ui-ux`.** The redesign keeps the domain, confirmation flow, simulation disclosure
and six product views unchanged while replacing the dense presentation with a simpler operational
workspace. It must not be merged and the promotional video must not be remade until the owner has
reviewed real desktop and phone screenshots.

Local verification on the redesign passes lint, 50 unit tests, strict typecheck and the production
build. Browser, accessibility and screenshot evidence must come from GitHub CI because this
environment could not download the Playwright Chromium binary; that infrastructure limitation is
not being presented as an application pass. See [WORK_LOG.md](./WORK_LOG.md) for exact evidence and
[DESIGN_DIRECTION.md](../DESIGN_DIRECTION.md) for the visual decisions.

The owner expects **DVD Tivat only**, but the society has not confirmed that. Keep the UI focused
on DVD Tivat; do not implement multi-society routing or treat this assumption as an agreed requirement.

Not deployed anywhere. No licence file. No real alert, account or member data exists.

## Where things are

```
src/domain/      pure rules - types, errors, commands, reducer, selectors, seed, message
src/storage/     one state key plus a namespaced write probe; known failures tested
src/state/       React binding: injects the clock, ids and persistence
src/ui/          six views + shared components; hand-written CSS in src/styles
src/i18n/        shared labels; additional view copy lives in components; no diacritics
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
- Use one demonstration tab. Concurrent tabs can overwrite each other's local records; there is no sync.
- Stored JSON receives a top-level shape check, not complete nested schema validation; do not hand-edit it.
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

Run GitHub CI on the exact redesign head, download its screenshot artifact and inspect both desktop
and phone layouts. The owner then reviews those images and requests visual changes. Keep the branch
unmerged until that approval. After the UI and functions are accepted, replace the first promotional
video with a new script, more natural narration and footage captured from the accepted interface.

Production Phase 2 still waits on
[PRODUCT_PLAN.md §G](../PRODUCT_PLAN.md#g-questions-for-the-meeting-with-the-society), especially
Q1 and Q12. Visual approval does not answer those operational questions.

See the last entry of [WORK_LOG.md](./WORK_LOG.md) for detail.
