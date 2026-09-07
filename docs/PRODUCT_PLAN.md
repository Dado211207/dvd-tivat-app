# DVD Tivat — Product plan

Status: **draft for discussion with the society.** Nothing here is agreed with DVD Tivat yet.
Written 7 September 2026. Documentation language: English. Application labels: local language,
without diacritics.

Companion documents: [FIREAPP_REVIEW.md](./FIREAPP_REVIEW.md) (what the reference product
documents and how well we verified it), [ARCHITECTURE.md](./ARCHITECTURE.md) (how the prototype is
built), [ai/PROJECT_STATE.md](./ai/PROJECT_STATE.md) (where the work currently stands).

---

## 0. One paragraph

A coordination tool for a volunteer fire society: someone authorised composes a call-out, chooses
exactly who it goes to, confirms it, and then watches real answers arrive — while vehicle
departures, the incident's operational status and the society's own record of what happened are
tracked as **separate facts that no single action is allowed to fake**. What exists today is an
exercise prototype that runs entirely in one browser, sends nothing to anyone, and is built to make
that limitation visible rather than to hide it.

---

## A. Product scope

### A.1 Users and the task each one actually needs to do

| User | The job they need done | What failure looks like for them |
|---|---|---|
| **Duty officer / dispatcher** (*ovlasteni dezurni*) | Turn a phone call at 03:00 into a call-out that reaches the right people, in under a minute, without waking the whole roster for a chimney fire | Sends to the wrong group; cannot tell who is actually coming; has to keep a tally on paper |
| **Operational member** (*operativni clan*) | Be woken up, understand in one screen what and where, answer honestly (including "not this time"), and correct that answer when circumstances change | Alarm does not wake the phone; cannot find the address; answered "coming" then got stuck and had no way to say so |
| **Society administrator** (*administrator drustva*) | Keep the roster, groups, specialties and vehicles correct; see the record afterwards | Roster drifts out of date, so calls go to people who left |
| **Station display** (*prikaz u domu*) | Show whoever walks into the station, from across the room, who is coming and what is out | Shows a number that is not true; or needs someone to log in and operate it |
| *(Future, not in scope)* Society leadership | Statistics and reports for the annual record | — |

### A.2 What the prototype does today

Everything in this list is implemented and running in the repository.

- Create an exercise (title, instructions, incident location, optional reporter location, type label).
- Select recipients as individuals, as predefined groups, or both — deduplicated.
- **Review the exact message text and the exact recipient list**, then confirm as a separate act.
- Watch responses arrive from simulated members; nothing is answered on their behalf.
- Members answer *Dolazim* / *Dolazim kasnije* (with a 15/30/60-minute band) / *Ne mogu*, with an
  independent "direct to the location" flag, and can change their answer while the exercise is open.
- Explicitly move the exercise between operational statuses; cancel or close it behind a confirmation.
- Log vehicle departures and returns as explicit, independent actions.
- A large-format station display view.
- Roster, exercise history, a timestamped activity log naming the simulated actor, and a
  confirmed reset that clears only this prototype's own stored data.

### A.3 What the prototype deliberately does **not** do

Not "not yet built" — **deliberately absent, because pretending would be the failure mode**:

| Absent | Why it is absent |
|---|---|
| Any real notification — push, SMS, or call | Nobody may be alerted by a demo. Delivery is recorded as `NIJE_POKUSANO` and never anything else |
| Authentication | The role selector is a **simulation control**, labelled as such on every screen. It is not a login and does not protect anything |
| Shared data between devices | Data lives in one browser's `localStorage`. Two phones running the prototype see two unrelated worlds |
| Live personnel tracking | Out of scope by instruction, and a significant privacy decision the society has not made |
| Real member data of any kind | The repository is public. Every person, phone label, vehicle and address in it is invented |
| Citizen reporting, radius dispatch, door control, official system integration | Out of scope for this stage; recorded in §D as later possibilities only |

### A.4 The gap between prototype and production, stated plainly

A working browser screen is evidence that **a workflow makes sense to the people who would use it**.
It is not evidence of anything else. In particular it is not evidence that:

- a locked Android or iPhone will make a noise at 03:00;
- an alert survives silent mode, Focus/Do Not Disturb, or battery optimisation;
- the message arrived, or that a human read it;
- the system works when the mobile network does not;
- anyone's identity or permission is enforced anywhere.

Each of those is a separate piece of work with its own acceptance criteria, listed in §D.

### A.5 Assumptions we made, which the society must confirm or correct

Each is a guess. Each is cheap to change now and expensive to change later.

1. **A1** — The first useful thing is *internal call-out and response*, not citizen reporting.
2. **A2** — Someone at the society is authorised to call people out; there is a human decision, not
   an automatic trigger.
3. **A3** — Members answer on their own phones, in the local language.
4. **A4** — Vehicle departure is logged by a person, not sensed automatically.
5. **A5** — Response categories map onto how Tivat actually works: coming / coming later / cannot.
   The 15/30/60-minute bands are taken from the reference product and are a placeholder.
6. **A6** — The society wants a record afterwards (who was called, who answered, what went out).
7. **A7** — Roughly 20–60 operational members; this is a guess and changes nothing structural, but
   it does change hosting cost.
8. **A8** — There is no legal or institutional obligation forcing a particular dispatch system.
   **If this is wrong it can invalidate the whole project**, and it must be checked first.

### A.6 Deliberate non-goals for the whole product, not just the prototype

Continuous personnel location tracking, AI-driven operational decisions, and anything that would
place this tool in the path of a real emergency before it has been trialled and accepted by the
society. Nothing here should ever become the only way Tivat gets called out; a fallback the society
already trusts must remain in place.

---

## B. Roles and permissions

### B.1 The four roles

| Role | Local label | Purpose |
|---|---|---|
| Administrator | *Administrator drustva* | Roster, groups, specialties, vehicles, and the society's record |
| Authorised dispatcher | *Ovlasteni dezurni* | May raise, change status of, cancel and close a call-out |
| Operational member | *Operativni clan* | Sees calls addressed to them; answers; logs vehicle movement |
| Station display | *Prikaz u domu* | Read-only wall display, no interaction, minimum information |

### B.2 Proposed permission matrix

`Y` = allowed, `—` = denied, `own` = only their own record.
**Proposed.** DVD Tivat decides who really holds each power (see Q3 in §7).

| Action | Admin | Dispatcher | Member | Display |
|---|:--:|:--:|:--:|:--:|
| Create exercise / incident | Y | Y | — | — |
| Select recipients and send a call | Y | Y | — | — |
| Cancel a call | Y | Y | — | — |
| Change operational status | Y | Y | — | — |
| Close an exercise | Y | Y | — | — |
| See the full recipient list of a call | Y | Y | — | — |
| See who answered, **by name** | Y | Y | Y | Y¹ |
| See response **totals** | Y | Y | Y | Y |
| Answer a call addressed to them | Y² | Y² | Y (own) | — |
| Change their own answer while open | Y² | Y² | Y (own) | — |
| Answer on someone else's behalf | — | — | — | — |
| Log vehicle departure / return | Y | Y | Y | — |
| Edit roster, groups, specialties | Y | — | — | — |
| Edit vehicle roster | Y | — | — | — |
| Read activity history | Y | Y | Y³ | — |
| Reset local demo data | Y | Y | Y | — ⁴ |

1. Names on the station display is a **society decision**, not a technical default — a public-facing
   screen showing who did not come is a social problem. Q3 in §7.
2. Only if that person is themselves an operational member.
3. Members see history of exercises they were called to; admins see everything. Not enforced in the
   prototype.
4. The station display is deliberately given no destructive action at all.

### B.3 The rule that matters more than the matrix

**In production, every one of these decisions is made on the server.** The client asks; the server
decides, using the caller's authenticated identity, their membership of *this* society, and their
granted permissions. A client-side check is a convenience for the user interface and nothing more.

**In the prototype, none of this is enforced.** The role selector switches which fictional person the
screen is pretending to be. It is labelled *simulacija* everywhere it appears. It stops nobody from
doing anything, and it must never be demonstrated as if it were a login.

---

## C. Data model

### C.1 The separation that the whole design rests on

Six things happen during a call-out. They are routinely collapsed into one "status", and that is
exactly the mistake that makes a coordination tool dangerous:

```
  a call is composed        →  ExerciseDraft / Call        (a human decided to call people)
  a service accepts it      →  DeliveryAttempt             (a request left our system)
  a device acknowledges     →  DeliveryAttempt             (a phone said it received something)
  a person answers          →  MemberResponse              (a human made a commitment)
  a vehicle leaves          →  VehicleMovement             (equipment is physically out)
  the incident is closed    →  Exercise.status             (an authorised person declared it over)
```

None of the arrows are automatic. `Dolazim` never moves a vehicle. A vehicle leaving never closes
an incident. A delivery acknowledgement never counts as a person answering. Every one of these is a
separate row with its own timestamp, and the prototype's tests assert exactly that.

### C.2 Entities

**`Member`** — `id`, `name` (fictional), `roleProposed`, `specialties[]`, `groupIds[]`,
`contactLabel` (a placeholder string such as `kontakt-01`, never a phone number), `active`.

**`Group`** — `id`, `name`, `memberIds[]`. Example groups: command staff, C-category drivers,
breathing-apparatus carriers, first aid, all operational members.

**`Vehicle`** — `id`, `callsign`, `name`, `type`. Fictional.

**`Exercise`** — the incident or exercise itself.
`id`, `kind` (`VJEZBA` | `TEST` | `SIMULIRANA_INTERVENCIJA`), `title`, `instructions`,
`incidentLocation` (**the place of the event**), `reporterLocation` (**where the report came from**,
optional and always visually distinct), `status`, `createdAt`, `createdBy`, `closedAt`, `closedBy`,
`closeReason`.

`status ∈ { OTVORENA, EKIPA_KRENULA, NA_TERENU, ZAVRSENA, OTKAZANA }` — changed only by an explicit
act of an authorised person, never derived from responses or vehicles.

**`Call`** — one act of calling people. `id`, `exerciseId`, `messageText` (**exactly the text shown
in the preview**), `recipientIds[]` **frozen at send time**, `createdAt`, `createdBy`,
`status ∈ { POSLAT, OTKAZAN }`, `sourceSelection` (which individuals and which groups were ticked,
kept for the record).

Recipients are frozen deliberately: if a member joins a group after the call, the call's recipient
list must not change retroactively, or the history stops being a record of what happened.

**`DeliveryAttempt`** — one row per recipient per call. `id`, `callId`, `memberId`, `channel`,
`state`, `updatedAt`, `note`.

`state ∈ { NIJE_POKUSANO, NA_CEKANJU, PRIHVACENO_OD_SERVISA, POTVRDA_UREDJAJA, GRESKA, NEPOZNATO }`

The full set is modelled so that the shape is right for later. **In the prototype only
`NIJE_POKUSANO` is ever produced**, with `channel: NEMA`. This is enforced by a unit test.

**`MemberResponse`** — `id`, `callId`, `memberId`, `answer ∈ { DOLAZIM, DOLAZIM_KASNIJE, NE_MOGU }`,
`etaMinutes` (only with `DOLAZIM_KASNIJE`), `directToLocation` (boolean, independent of the answer),
`respondedAt`, `updatedAt`, `revision`.

At most one response per `(callId, memberId)`. Changing an answer updates that row, increments
`revision`, and appends an activity entry — it never creates a second response and never affects
another member.

**`VehicleMovement`** — `id`, `exerciseId`, `vehicleId`, `purpose`, `departedAt`, `departedBy`,
`returnedAt`, `returnedBy`. A vehicle's state is *derived* — out if it has a movement with no
`returnedAt`, otherwise in the station. Derived from movements only, never from responses.

**`ActivityEntry`** — append-only. `id`, `at`, `actorId`, `actorName`, `kind`, `summary`,
`exerciseId`. Every state change writes one. Nothing rewrites or deletes them except the explicit
demo reset.

### C.3 Cases the model must survive

Implemented and tested in the prototype:

| Case | Required behaviour |
|---|---|
| No open exercise | Member and display views say so plainly; response actions are unavailable, not broken |
| Missing or invalid fields | Field-level errors, focus moved to the first bad field, nothing saved |
| No recipients selected | Send refused with a clear reason |
| Duplicate submission | The second identical send produces no second call; the second identical answer produces no second response |
| Response change | Same row updated, `revision` incremented, history entry appended |
| Answering a closed or cancelled exercise | Refused with a specific message; earlier answers stay in the record |
| Missing location | Incident location is required; reporter location is optional and never substituted for it |
| Persistence failure | A visible warning that the browser refused to store data and the session will not survive a refresh; the app keeps working in memory |

---

## D. Development phases

Acceptance criteria are written so that they can be **failed**. A criterion that cannot fail is not
a criterion.

### Phase 1 — Interactive exercise prototype *(this repository, complete)*

Goal: something the owner can put on a screen in front of the society and drive through a whole
call-out, in order to collect real requirements.

Acceptance:
- [x] Opens directly into a working dispatcher interface.
- [x] Full flow works: create → select → **preview** → confirm → responses → vehicles → status → close → history.
- [x] Sending a call creates **zero** responses and **zero** delivery confirmations.
- [x] Changing one member's answer changes only that member.
- [x] Vehicle state cannot be altered by any response action, proven by test.
- [x] A closed exercise stays in history; reset clears only this application's own storage key.
- [x] No real people, no real numbers, no real addresses anywhere in the repository.
- [x] Simulation and non-delivery are visible on screen, not only in documentation.
- [x] Unit tests over the domain rules; browser tests over the whole flow at phone and desktop sizes; automated accessibility checks with material findings fixed.

### Phase 2 — Real accounts, server authorisation, shared data

Goal: two different people on two different devices see the same call-out.

Scope: server-side identity, society membership, permission enforcement, shared persistence,
audit log, an administration surface for the roster.

Acceptance:
- [ ] Every permission in §B.2 is enforced **server-side**, with a test proving a forged client
      request is rejected.
- [ ] Two devices, two accounts: one raises a call, the other sees it without a manual refresh.
- [ ] Concurrent edits resolve to one deterministic outcome; a late answer still attaches to the
      original call.
- [ ] The audit log identifies the authenticated actor, not a selected one.
- [ ] A documented, exercised backup and restore.
- [ ] A written decision on where personal data lives, who may read it, and how long it is kept —
      **before** any real member is entered.

### Phase 3 — Mobile applications and notification feasibility

Goal: answer the question the browser cannot answer — *will the phone wake up?*
This phase is **investigation first, product second**, and its findings may change the architecture.

Must be investigated before anything is promised:
- Android: notification channels and importance, `SCHEDULE_EXACT_ALARM`, battery optimisation and
  OEM-specific power management, foreground service policy, whether an SMS fallback is even
  permissible for us — Google Play restricts SMS permissions, and another vendor's approval does
  not transfer to us.
- iOS: Critical Alerts require an entitlement granted by Apple on request. This is understood to be
  Apple's documented position but **was not verified in this session**; it must be confirmed from
  Apple's own current documentation before it is stated to the society.
- Both: behaviour on a locked screen, in silent mode, under Focus/Do Not Disturb, with a paired
  watch, on network loss and recovery, after a phone change, after sign-out, and on call cancellation.
- Delivery acknowledgement: can a device confirm receipt, and how is "no acknowledgement" displayed
  so that it does not read as "not coming"?
- A fallback the society already trusts, and the rule for when it is used.

Acceptance:
- [ ] A written feasibility report per platform, citing current first-party documentation, stating
      what is possible, what needs approval, and what is not possible.
- [ ] A measured trial on real devices of both platforms: end-to-end time from send to alert, with
      **failures recorded, not discarded**.
- [ ] Pass/fail thresholds agreed with the society **in advance** of the trial.
- [ ] An honest statement of what happens when delivery fails.

### Phase 4 — Supervised exercises with the society

Goal: find out whether it works for people who are not the developer.

Acceptance:
- [ ] At least three supervised exercises with real members, on their own phones, with fictional
      incident content, and a fallback running in parallel throughout.
- [ ] Every failure written down with device, OS version and circumstances.
- [ ] Members can complete answering without being coached.
- [ ] The society's own written verdict on whether it is closer to useful or to a liability.

### Phase 5 — Operational readiness, maintenance, store submission

Not scheduled. **No date is offered**, because the requirements and the notification constraints are
not known yet, and a date given now would be invented.

Entry conditions, all of which must hold before this phase is even planned:
- [ ] Phase 3 feasibility answered positively and in writing.
- [ ] Phase 4 exercises passed with the society's agreement.
- [ ] A named person responsible for maintenance, and an agreed answer to who pays for hosting,
      store accounts and time.
- [ ] A written incident-response procedure for when the *application* fails during a real callout.
- [ ] A data protection review appropriate to Montenegrin law.
- [ ] A decision that a custom system is genuinely better for DVD Tivat than an existing product —
      revisited with real numbers, not assumed.

### Later possibilities, recorded but not planned

Citizen reporting; automatic regional dispatch; hydrant and AED map layers; availability scheduling;
station door control; integration with official dispatch systems; statistics and annual reports;
station display hardware. Each is a separate decision. None is implied by anything built so far.

---

## E. Risks worth saying out loud

| Risk | Why it matters | What reduces it |
|---|---|---|
| **A false sense of readiness** — a polished demo reads as a finished system | People could rely on it in an emergency | Simulation and non-delivery stated on-screen; delivery state permanently `NIJE_POKUSANO`; this document |
| **Notification delivery may simply not be achievable** at the required reliability under store policy | Phase 3 could invalidate the product | Investigate before promising; agree thresholds first; keep a trusted fallback |
| **Personal data in a public repository** | Irreversible once pushed | Fictional data only, by rule; no real contact details anywhere; reviewed before every commit |
| **Single maintainer** | The society depends on one volunteer's time | Named in Phase 5 entry conditions; the plan does not proceed without an answer |
| **The existing product may already be sufficient** at ~3 EUR/member/year | The whole project could be effort better spent | Q7 in §7, asked before the build is scaled up |

---

## F. Design principles

- Open into work, never into marketing.
- Red means urgency, and nothing else. Status is never carried by colour alone — always text and a
  symbol too, for colour vision deficiency and for a sunlit station wall.
- Large touch targets; the member's answer buttons are the largest controls in the application,
  because they are pressed by someone half awake.
- Strong contrast; a visible keyboard focus ring on every interactive element.
- Works on a phone, a tablet and a station display.
- Motion is decorative only and is removed under `prefers-reduced-motion`.
- Local language without diacritics for everything a member sees; English for the repository.
- A provisional text identity only. **No official DVD Tivat logo** is used unless the society
  supplies and approves one.
- Incident location and reporter location are distinct fields and never merged. Opening an external
  map is always a deliberate press, never automatic.

---

## G. Questions for the meeting with the society

**Blocking — the answers change the architecture**

1. Who receives the initial report today, and who decides to call members out? Is there any legal or
   institutional obligation to use a particular system? *(Assumption A8 — check this first.)*
2. Who may send, cancel and close a call-out? Is that the same person at 03:00 as at 15:00?
3. What must a member see in the first two seconds, before scrolling?
4. What happens today when a member has no internet, does not answer, or their phone fails? What is
   the fallback, and would it stay in place?

**Shaping — they change scope and effort**

5. How many operational members, which specialties, and roughly what mix of Android and iPhone?
6. How is vehicle departure recorded today, and who does it?
7. Should the station display show names, or only totals? Who walks past that screen?
8. Are the response options right for Tivat, and are 15/30/60 minutes the right bands, or should
   they be different, or free text?
9. Are there Tivat-specific needs the reference product does not cover — coastal, tourist-season,
   or cross-border?

**Decisive — they determine whether this project should continue**

10. Does the society already have FireApp access, or can it be trialled? What specifically does it
    not do?
11. Who maintains this afterwards, and who pays for hosting, store accounts and time?
12. Why a custom system rather than an existing service at a published ~3 EUR per operational member
    per year? *A good answer to this makes the project worth doing. There may not be one, and that
    is a legitimate outcome of the meeting.*
