# DVD Tivat — exercise prototype

A coordination prototype for a volunteer fire society: raise a call-out, choose
exactly who it goes to, confirm it, and watch real answers arrive — while
vehicle movements, the operational status of the incident and the society's own
record stay **separate facts that no single action is allowed to fake**.

> **This is a simulation.** It runs entirely in one browser, it sends **no push
> notification, no SMS and no phone call to anyone**, and it has no accounts:
> the role selector is a demonstration control, not a login. Every member,
> contact label, vehicle and location in this repository is invented.

Status: **Phase 1 — working prototype for discussion with the society.** Nothing
here is agreed with DVD Tivat yet, and nothing here is ready to be relied on in
an emergency.

---

## Run it

Requires Node.js 22.12 or newer on an even-numbered release line (22, 24, 26+), matching Vitest's
supported Node versions.

```bash
npm install
npm run dev        # http://localhost:5173
```

Build the static output and serve it locally for review:

```bash
npm run build && npm run preview
```

## Verify it

```bash
npm run lint         # ESLint, including static accessibility rules
npm run typecheck    # tsc --noEmit, strict
npm run test         # Vitest - domain rules and storage failure handling
npm run e2e          # Playwright - full flow, keyboard, axe accessibility
npm run screenshots  # regenerates docs/screenshots/ (writes into the repo)
```

`npm run e2e` needs a browser once: `npm run e2e:install`. If your environment
already provides one, point at it with `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium`.

## The screens

| Screen | For | What it does |
|---|---|---|
| **Dezurni** | Duty officer | Compose a call, review the exact message and recipients, confirm, watch answers, change status, close or cancel |
| **Clan** | Operational member | See a call addressed to them, answer *Dolazim* / *Dolazim kasnije* (15/30/60 min) / *Ne mogu*, flag going direct to the incident, change the answer |
| **Vozila** | Anyone at the station | Log vehicle departures and returns as explicit, independent actions |
| **Prikaz u domu** | Station wall display | Large read-only overview: incident, location, totals, answers, vehicles |
| **Clanovi** | Everyone | The fictional roster, groups and vehicles |
| **Istorija** | Everyone | Past exercises, the timestamped activity log, and a confirmed demo reset |

The application opens straight into the duty officer's screen. There is no
landing page — the point of a prototype is to be driven.

## What it deliberately does not do

| Absent | Why |
|---|---|
| Any real notification | Nobody may be alerted by a demonstration. Delivery is recorded as `NIJE_POKUSANO` and never anything else, enforced by a test |
| Authentication or permissions | The role selector switches which fictional person the screen pretends to be. It protects nothing |
| Shared data | State lives in one browser's `localStorage`. Two devices show two unrelated worlds, and clearing browser data deletes it |
| Real member data | The repository is public. Everything is invented |
| Citizen reporting, radius dispatch, door control, official integrations, location tracking | Out of scope at this stage — recorded as later possibilities only |

**A browser prototype is not evidence that a locked Android or iPhone will raise
an alarm.** Whether that is achievable at all depends on platform permissions,
store policy and delivery acknowledgements, and it is a separate investigation
([PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) Phase 3) that has not been done.

## Documentation

| Document | Contents |
|---|---|
| [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) | Users, scope, assumptions, roles and permission matrix, data model, five phases with acceptance criteria, risks, questions for the society |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack choice and rejected alternatives, layering, the pure domain reducer, persistence limits, path to mobile |
| [docs/FIREAPP_REVIEW.md](docs/FIREAPP_REVIEW.md) | What the reference product's public documentation says, per-claim, with what was and was not verified |
| [docs/ai/PROJECT_STATE.md](docs/ai/PROJECT_STATE.md) | Current state and the rules for continuing this work |
| [docs/ai/WORK_LOG.md](docs/ai/WORK_LOG.md) | What was done, verified, and what is next |
| [docs/screenshots/](docs/screenshots) | The screens, with fictional data |

## Built with

TypeScript, React and Vite; Vitest, Playwright and axe-core for verification.
No backend, no database, no paid service, and two runtime dependencies (`react`,
`react-dom`). Reasoning and rejected alternatives in
[ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Licence

**None yet, deliberately.** No licence file has been added because that is the
owner's decision to make. Until one exists, default copyright applies.

## Relationship to FireApp

[FireApp](https://fireapp.eu/) was given to DVD Tivat as a reference product.
This repository contains **no FireApp source code, branding, assets or screen
layouts** — only workflow concepts documented in its public handbooks, cited
claim by claim in [docs/FIREAPP_REVIEW.md](docs/FIREAPP_REVIEW.md). FireApp was
not installed, logged into, or tested; that document is a review of public
documentation and says so.
