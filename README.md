# DVD Tivat — internal mobilisation and intervention records

An **internal** coordination system for a volunteer fire society: an authorised
commander publishes an intervention with verified details and an exact location,
approved firefighters receive it and respond, and the society keeps a reliable
record of who actually attended, where, when they arrived, when they left and
how long each interval lasted — while response intent, notification state,
vehicle movements and the operational status of the incident stay **separate
facts that no single action is allowed to fake**.

> ### This is not a public emergency reporting channel
>
> It is **not** a replacement for calling the official fire service, and nobody
> should ever be encouraged to use it instead. Owner decision of 9 September
> 2026. The earlier citizen-report screen is abandoned research, kept only
> behind an explicitly experimental heading.

> **It sends no notification of any kind.** There is no push, email, SMS, Viber
> or telephone transport in this application at all. Publishing a call-out writes
> rows saying a message is *owed* to each recipient; nothing sends them, and
> nothing in the interface may say a member was notified. Every member, contact
> label, vehicle and location in this repository is invented.
>
> **The operational path runs against the real server.** *Poziv i intervencija*
> drafts, publishes, runs and closes an intervention. *Moj poziv* is where a
> firefighter states availability, opens the call-out, answers, reports movement
> and records arrival and departure. *Arhiva i ucesce* is the record afterwards.
> *Nalozi i pristup* and *Evidencija drustva* cover accounts and the society's
> roster. All seven migrations are applied to the hosted project and
> fingerprint-verified against a local PostgreSQL built from the same files.
>
> **The earlier prototype screens remain, clearly labelled**, under a
> *Prototip (simulacija)* heading. They run on device-local fictional state
> driven by an actor selector and say so in a banner on every one of them.
>
> The actor selector is a demonstration control, **not a login** — and it is not
> rendered at all on a server-backed screen, so it cannot be tabbed to,
> announced or scripted there.

Status: **a working prototype of the whole journey, on real data behind real
access control.** Nothing is agreed with DVD Tivat yet, no real member exists in
it, and nothing here is ready to be relied on in an emergency — there is no
notification transport and no offline queue. See
[docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) §7 for the honest readiness
summary.

The member-confirmed operating profile is represented at realistic scale: 52 fictional roster rows,
one fictional MAN vehicle record, one fictional firefighting SUV record, no shifts, assembly at
the base before deployment, and layouts exercised at representative iPhone and Android sizes.
See [docs/SOCIETY_PROFILE.md](docs/SOCIETY_PROFILE.md). Future permissions and formal adoption are
still product decisions, not unresolved facts about current operations.

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
npm run test:db      # PostgreSQL - migrations, role matrix, RLS, attendance
npm run e2e          # Playwright - full flow, keyboard, axe accessibility
npm run verify:bundle # reads the built output: no secret may reach the browser
npm run screenshots  # regenerates docs/screenshots/ (writes into the repo)
```

`npm run e2e` needs a browser once: `npm run e2e:install`. If your environment
already provides one, point at it with `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium`.

`npm run test:db` needs a real PostgreSQL 16 - no Supabase project, credentials
or paid service, and it never touches the hosted project. `npm run db:start`
provides a throwaway one; see [docs/DATABASE.md](docs/DATABASE.md). It drops and
recreates schemas, so point it only at a scratch database.

## The screens

### The real screens, on the server

| Screen | For | What it does |
|---|---|---|
| **Poziv i intervencija** | Owner, administrator, commander | Draft, choose recipients, publish, set status, see who did what, confirm attendance, record vehicle movements, close |
| **Moj poziv** | Any member with an account | State general availability, open the call-out, answer with an ETA, report movement, record arrival and departure |
| **Arhiva i ucesce** | Any member with an account | The chronology of a finished intervention and confirmed participation per member |
| **Evidencija drustva** | Owner and administrator | Members, groups, vehicles and the account-to-member link |
| **Nalozi i pristup** | **Real accounts** | Sign in and register against the real project; the owner sees every registered account and can assign a role or withdraw access with a mandatory reason, with a permanent audit beneath |

### The earlier prototype, on device-local fictional state

Kept because these still demonstrate ideas the server slice has not reached.
Every one of them carries a banner saying the data is invented and that no
access check applies.

| Screen | For | What it does |
|---|---|---|
| **Dezurni** | Duty officer | Compose a call, review the exact message and recipients, confirm, watch answers, change status, close or cancel |
| **Clan** | Operational member | See a call addressed to them, answer *Dolazim* / *Dolazim kasnije* (15/30/60 min) / *Ne mogu*, see the base assembly instruction, change the answer |
| **Vozila** | Anyone at the station | Log vehicle departures and returns as explicit, independent actions |
| **Prikaz u bazi** | Station wall display | Large read-only overview: incident, location, totals, answers, vehicles |
| **Clanovi** | Everyone; editable in the admin simulation | The fictional roster, groups and vehicles, with a local-only editor for invented demonstration records |
| **Istorija** | Everyone | Past exercises, the timestamped activity log, and a confirmed demo reset |
| **Prijava gradjana** (under the *Nije u upotrebi* heading) | **Abandoned research, not part of the product** | Out of the operational navigation groups. Retained only so reviewed work can be reused, behind an explicitly experimental heading and a non-emergency notice |

The application opens on **Poziv i intervencija**, the real commander's console.
Somebody who is not signed in lands on a screen that says so and offers the way
in — which is the correct first screen for a real tool, and keeps a fictional
actor selector from being the first thing anybody sees.

## What it deliberately does not do

| Absent | Why |
|---|---|
| Any real notification | Nobody may be alerted by a demonstration. Delivery is recorded as `NIJE_POKUSANO` and never anything else, enforced by a test |
| An actor selector on a real screen | It is not rendered there at all, so it cannot be tabbed to, announced by a screen reader or found by a script. It switches only the fictional prototype screens and protects nothing — which is why each of those says so on itself |
| An offline queue | An action taken with no signal is refused and the interface says so. Storing it and sending it later without saying which of the two happened would be worse than refusing |
| Real member data | The repository is public. Everything is invented |
| Public citizen emergency reporting | Removed from the product by the owner's decision of 9 September 2026. Never a substitute for calling the official fire service |
| Radius dispatch, door control, official integrations, continuous member tracking | Out of scope. The application contacts nobody and tracks nobody |
| Password reset | No mail provider is configured, so a reset form would send nothing while looking as though it had. The screen says that instead of offering one |
| Any notification transport | Publishing writes `QUEUED` rows saying a message is owed. There is no push, email, SMS, Viber or telephone sender, and nothing in the interface may say a member was notified. See [docs/ACCESS_MODEL.md §8](docs/ACCESS_MODEL.md#8-not-enforced-yet) |
| A native application | The shell is an installable PWA: manifest, icons, standalone display, and a service worker that caches only the shell and never a server answer. No app store packaging |

**A browser prototype is not evidence that a locked Android or iPhone will raise
an alarm.** Whether that is achievable at all depends on platform permissions,
store policy and delivery acknowledgements, and it is a separate investigation
([PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) Phase 3) that has not been done.

## Documentation

| Document | Contents |
|---|---|
| [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) | Users, scope, assumptions, roles and permission matrix, data model, five phases with acceptance criteria, risks, questions for the society |
| [docs/SOCIETY_PROFILE.md](docs/SOCIETY_PROFILE.md) | Member-confirmed membership, vehicles, assembly flow and phone mix, separated from pending product decisions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack choice and rejected alternatives, layering, the pure domain reducer, persistence limits, path to mobile |
| [docs/PRODUCTION_ARCHITECTURE.md](docs/PRODUCTION_ARCHITECTURE.md) | Gated server, identity, notification and mobile architecture if DVD Tivat accepts the workflow |
| [docs/ACCESS_MODEL.md](docs/ACCESS_MODEL.md) | **The account, role and row-level-security contract, and exactly what is not enforced yet** |
| [docs/OWNER_BOOTSTRAP.md](docs/OWNER_BOOTSTRAP.md) | **How the one owner account is created, step by step, by somebody who is not a developer** |
| [docs/DATABASE.md](docs/DATABASE.md) | **Schema semantics, the attendance rules, and how to run the database tests** |
| [docs/ACCOUNTS_REPORTS_MAP_PLAN.md](docs/ACCOUNTS_REPORTS_MAP_PLAN.md) | Earlier account, email-code, owner access, incident map and photo plan. Superseded on citizen reporting by the internal-operations decision |
| [docs/FIREAPP_REVIEW.md](docs/FIREAPP_REVIEW.md) | What the reference product's public documentation says, per-claim, with what was and was not verified |
| [docs/FIRST_TEST_CHECKLIST.md](docs/FIRST_TEST_CHECKLIST.md) | Exact simulation-only pass/fail checks for the owner's first desktop and phone test |
| [docs/PRESENTATION_SCRIPT.md](docs/PRESENTATION_SCRIPT.md) | An 8–10 minute first presentation with honest spoken boundaries and decisions to collect |
| [docs/TEST_FEEDBACK_FORM.md](docs/TEST_FEEDBACK_FORM.md) | A printable per-tester rating and issue form that excludes private and real incident data |
| [docs/MEETING_DECISIONS.md](docs/MEETING_DECISIONS.md) | A role-only decision record so accepted rules survive conversation and session limits |
| [docs/ai/PROJECT_STATE.md](docs/ai/PROJECT_STATE.md) | Current state and the rules for continuing this work |
| [docs/ai/WORK_LOG.md](docs/ai/WORK_LOG.md) | What was done, verified, and what is next |
| [docs/screenshots/](docs/screenshots) | The screens, with fictional data |

## Built with

TypeScript, React and Vite; Vitest, Playwright and axe-core for verification; PostgreSQL for the
row-level-security suite. Identity and access run on Supabase; organisational administration has a
tested server path awaiting hosted migration `202609120005`; the incident, response, attendance and
notification screens still have no connected backend. Only the project URL and the publishable key are configured, both public by design and both
kept out of tracked files - see [.env.example](.env.example). Reasoning and rejected alternatives in
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
