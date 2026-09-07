# Work log

Newest entry first. One entry per unit of work, written in the same commit as the work itself.
Record what was done, what was verified, and what the next concrete action is.

---

## 2026-09-07 — Session 1: research review and plan

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
