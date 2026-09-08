# Architecture

Scope of this document: the **exercise prototype** in this repository, and the reasoning that keeps
the path to a real system open. Anything described as future is not built.

---

## 1. Stack, and why

| Layer | Choice | Reason |
|---|---|---|
| Language | **TypeScript** (strict) | The domain rules are the valuable part of this repository. Types are what stop `Dolazim` from being assignable to a vehicle status |
| UI | **React 18** | Boring, well documented, and the one mainstream UI library whose skills transfer directly to **React Native** if Phase 3 goes ahead |
| Build/dev | **Vite 8** | Static output, no application server and little configuration. `npm run build` produces a folder for any static host; `npm run preview` serves it locally for review |
| Unit tests | **Vitest** | Same transform pipeline as the build, so tests cannot pass on code the build would reject |
| Browser tests | **Playwright** (Chromium) | Real browser, real keyboard, real viewports; runs headless in CI on a standard GitHub runner |
| Accessibility | **axe-core** via `@axe-core/playwright` | Automated checks inside the same browser run, against real rendered state |
| Styling | **Hand-written CSS** with custom properties | The instruction is original styling for DVD Tivat. A utility framework would drag in someone else's visual language, and a design system is not needed for six screens |
| Routing | ~40 lines of hash routing | Deep-linkable views for tests and demos, no server rewrite rules, no dependency |
| Persistence | `localStorage`, one key | Explicitly device-local demonstration state only. Real records and uploads require server storage. See §5 |
| State | React context with `useState` and a current-state ref, invoking the **pure domain reducer** | See §3; the ref gives successive commands the latest state |

**Runtime dependencies: `react` and `react-dom`. Nothing else.** Everything else is a dev
dependency. No backend, no database, no account, no paid service, no analytics, no telemetry, no
network calls of any kind at runtime.

### Rejected, and why

- **Next.js / Remix** — a server we do not have and must not pretend to have.
- **Tailwind / MUI / Chakra** — imported visual identity; the brief asks for an original one.
- **Redux / Zustand / TanStack Query** — no server to synchronise with; the context binding around
  the pure command reducer is sufficient.
- **A real backend now** — would produce infrastructure and cost before the requirements exist, and
  is Phase 2 by design.
- **Vue / Svelte / SolidJS** — all fine; React wins only on the React Native transfer path.

---

## 2. Layering

```
  src/domain/     pure TypeScript. No React, no browser, no I/O, no Date.now(), no Math.random()
      types.ts        entities and state shape
      errors.ts       typed error codes + local-language messages
      commands.ts     the command union — every possible state change
      reducer.ts      applyCommand(state, command, ctx) -> Ok(state) | Err(error)
      selectors.ts    derived reads (totals, visibility, vehicle state)
      seed.ts         fictional roster, groups, vehicles

  src/storage/    localStorage read/write, versioning, quota and privacy failures

  src/state/      React binding: context, dispatch, persistence side effects, live-region messages

  src/ui/         components and the seven views

  src/i18n/       shared labels; view-specific copy also lives in components; no diacritics
```

The dependency arrow points one way: `ui → state → domain`. `domain` imports nothing from the
others. That is what makes it testable without a browser, and what makes §7 possible.

---

## 3. The central decision: a pure domain reducer

Every state change in the application is a **command** applied by one pure function:

```ts
applyCommand(state: AppState, command: Command, ctx: Ctx): Result<AppState, DomainError>
```

`ctx` supplies `now()` and `id()`. Time and identity are injected, never read from globals, so tests
produce identical output for identical input and timestamps are deterministic.

Three things follow, and they are the reason for the shape:

**It makes the rules testable in isolation.** "Answering does not move a vehicle" is a unit test over
a function, not a click-through of a browser.

**It makes the honesty rules enforceable.** `applyCommand` is the only place a `DeliveryAttempt` can
be created, so a single test proves that no code path anywhere can produce a fake delivery
confirmation. If that guarantee lived in a component, it would be one careless edit away from
breaking.

**It makes Phase 2 a move rather than a rewrite.** The command union is already the shape of a
server API. `SendCall` becomes `POST /calls`; the same validation runs server-side, this time
against an authenticated identity instead of a simulated one. The client keeps the reducer as an
optimistic local view. Nothing about the domain has to be rediscovered.

Commands are rejected with typed errors — `NEMA_PRIMALACA`, `VJEZBA_NIJE_OTVORENA`,
`NEDOSTAJE_LOKACIJA`, `DUPLIKAT`, and so on — each carrying a message in the local language and,
where relevant, the field to move focus to. Errors are values, not exceptions.

### Idempotency

Every command carries a `commandId`. `applyCommand` keeps a bounded list of recently applied ids and
returns the unchanged state for a repeat. This covers the double-tap on a half-awake member's phone
and the double-click on *Posalji poziv* — the two duplicate-submission cases that matter — and it is
the same mechanism a server would use.

---

## 4. Modelling honesty in types

The type system carries the separation described in [PRODUCT_PLAN.md §C](./PRODUCT_PLAN.md#c-data-model):

- `DeliveryState` declares all six states a real system would need, but the prototype's only
  producer sets `NIJE_POKUSANO` with `channel: NEMA`. A test asserts that after any sequence of
  commands, **no attempt is in any other state**.
- `Exercise.status` is only ever changed by an explicit `SetExerciseStatus` command. No response and
  no vehicle movement can reach it.
- Vehicle state is a *selector* over `VehicleMovement[]` and cannot read `MemberResponse[]` — it does
  not receive them as arguments.
- `Call.recipientIds` is frozen at send time rather than recomputed from groups, so history stays a
  record of what happened rather than a report of what would happen today.
- `CitizenReport` is intake only. Saving or reviewing one cannot reach exercises, calls,
  deliveries, responses or vehicles. Its status vocabulary cannot claim network delivery.

These are not comments asking future maintainers to be careful. They are structural.

---

## 5. Persistence, and its limits

One historically named key: `dvd-tivat-prototip:v1`. JSON, currently schema version 2. Written
after each successful command, read once at start-up. The explicit version 1 to 2 migration adds
only an empty citizen-report inbox; unknown versions are still refused rather than guessed at.

Handled failures — all of them real in practice:

| Failure | Behaviour |
|---|---|
| Storage unavailable (private mode, blocked cookies, an embedded frame) | The app runs in memory and shows a persistent warning that data will not survive a refresh |
| Quota exceeded | Same warning; the current state stays usable in memory |
| Corrupt or unparseable stored data | Falls back to the fictional seed, warns, does not crash |
| Unknown schema version | Refuses to guess; falls back to seed and warns |

**What the user is told, on screen and not only here:** this data belongs to *this browser on this
device*. It is not synchronised anywhere. A second device shows a different, unrelated state.
Clearing browser data deletes it. This is a property of a local demonstration, not a defect — but it
must be said out loud, because "my data is on my phone" is exactly the assumption a demo invites.

Reset removes only this key. It touches nothing else in the browser, and it requires confirmation.

---

## 6. Interface concerns

**Simulation control.** A persistent bar identifies the simulated actor and role and is labelled as
simulation. Switching actor changes what the screen shows; it grants nothing and protects nothing.
It is deliberately styled as a warning strip, not as an account menu, so it cannot be mistaken for
a login during a demonstration.

**Accessibility.** Native `<dialog>` with `showModal()` for confirmations — real focus trapping,
`Escape` handling and inert background from the platform, rather than a reimplementation of them.
`aria-live` regions announce command outcomes. Validation errors are tied to inputs with
`aria-describedby` and move focus to the first invalid field. Focus rings are visible on every
control. Status is always text plus symbol plus colour, never colour alone. All animation is behind
`prefers-reduced-motion`.

**Responsive.** Mobile-first, breaking at 640px and 1024px. The station display scales with
`clamp()` so one build serves a phone and a wall-mounted screen.

**Location and photographs.** Existing map links still require a deliberate press. The citizen
report view requests browser geolocation only after the person presses its labelled button. A
photo is previewed with a temporary object URL; its bytes and local filename never enter the
domain state or `localStorage`. Neither capability performs a network request in this prototype.

---

## 7. The path to a mobile application

The domain layer is plain TypeScript with no React and no browser API. It can be moved to a shared
package and imported unchanged by a React Native or Expo client. That makes the mobile question a
question about **delivery**, not about business rules — which is the right place for it, because
delivery is where the risk is.

That framework choice stays open until Phase 3 answers what each platform actually permits. Choosing
a mobile framework before knowing whether Critical Alerts, notification channels or an SMS fallback
are available to us would be choosing before the constraints are known.

---

## 8. Verification

| Level | Tool | Covers |
|---|---|---|
| Types | `tsc --noEmit`, strict | The whole repository including tests |
| Lint | ESLint (typescript-eslint, react-hooks, jsx-a11y) | Static accessibility and hook correctness |
| Unit | Vitest | Domain rules, selectors, storage failure handling |
| Browser | Playwright/Chromium | Whole flow at desktop and phone viewports, keyboard-only navigation |
| Accessibility | axe-core in Playwright | Every main view in a real rendered state |
| Screenshots | Playwright | Evidence, generated from fictional seed data only |

CI is one GitHub Actions workflow on `ubuntu-latest` — a standard GitHub-hosted runner, no paid
infrastructure. One job, in order: install → typecheck → lint → unit → build → browser+accessibility
tests. `concurrency` with `cancel-in-progress` stops superseded pushes from running a second full
suite. Artifacts are kept 7 days. Only Chromium is installed, not all three browser engines.

A failing check is a finding to investigate. Weakening an assertion, skipping a test or re-running
until it passes would convert this repository from evidence into decoration.
