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
- Working branch: `claude/dvd-tivat-app-dev-n8wctb`
- Default branch: `main`. Do not merge; the owner decides.
- No `LICENSE` file. The owner has not chosen a licence and one must not be added for them.

## Status

**Planning: complete.** Implementation: in progress — see [WORK_LOG.md](./WORK_LOG.md) for the
current entry.

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

See the last entry of [WORK_LOG.md](./WORK_LOG.md).
