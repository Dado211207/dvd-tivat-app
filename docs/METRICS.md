# What every number on a screen means

Written because a figure without a definition is not evidence. If somebody
reads "45 min" beside a member's name six months from now, they must be able to
say exactly which two events it sits between and who stood behind it — not
guess.

Two rules run through everything here.

**Nothing is collapsed.** Being sent a call-out, opening it, answering it,
moving, arriving, being present, and having that presence confirmed are seven
different facts about one person on one incident. They are stored separately,
displayed separately, and never added together or inferred from one another. A
single "response time" would have to pick one of them and throw six away.

**Nothing is invented.** Where a fact was not recorded, the screen says
`Nije zabiljezeno`. It never substitutes a nearby timestamp, a zero, or a dash
that could be read as a value.

---

## Where times come from

Every timestamp in this system is written by PostgreSQL, stored as
`timestamptz` (UTC), and displayed in **Europe/Podgorica** as
`dd.MM.yyyy. HH:mm:ss`.

**Seconds are always shown.** Without them a ten-second interval and a
one-second interval print the same two timestamps, so a reader cannot check a
duration against the times it was measured from — which is how the rounding
defect above stayed invisible on a screen that had the evidence on it.

* **No client supplies a time.** Not one command takes a timestamp argument
  from the browser, except `attendance_correct`, which exists precisely so a
  commander can fix a recorded interval and which writes the correction as its
  own audited event with a required reason.
* **`now()` is the transaction's start time**, not the statement's. Two events
  written in one transaction therefore share a timestamp to the microsecond.
  That is why check-in and check-out are separate transactions, and why the
  chronology breaks ties on the row id rather than leaving the order to chance.
* **The display zone is named, not offset.** Montenegro observes summer time;
  the IANA database knows the dates and we do not. A device-local rendering
  would make one stored fact print differently for the phone that was at the
  fire and the laptop reviewing it afterwards, with nothing on either screen
  saying which to believe.

---

## One intervention

| Shown as | Column | Written by | Means |
| --- | --- | --- | --- |
| Kreirano | `interventions.created_at` | `create_intervention_draft` | The commander saved a draft. Nobody has been called. Visible only to command. |
| Objavljeno | `interventions.published_at` | `publish_intervention` | The commander published. Recipient rows were frozen and outbox rows queued. **Nothing was sent.** |
| Stanje | `interventions.status` | `set_intervention_status` | Okupljanje / Na terenu / Pod kontrolom. Each change is its own audit event with both ends and an actor. |
| Zatvoreno | `interventions.closed_at` | `close_intervention` | Closed or cancelled, with a required reason. |

**"Fire reported" is not a field, and must not be spoken of as one.** The
earliest time this system holds for an incident is `created_at` — the moment a
commander opened a draft. That is a fact about the commander, not about a
citizen: there is no citizen reporting channel in this product, and describing
`created_at` as "when the fire was reported" would invent a caller who does not
exist. Say "kreirano" and "objavljeno", which are what happened.

**Which timestamp a list row shows** is the one that matches the state printed
beside it: draft → `created_at`, published or running → `published_at`, closed
or cancelled → `closed_at`. Never a fallback to a different column; where the
matching one is missing the row says `Nije zabiljezeno`. (See
`stateTimestamp()` — this rule exists because a row reading "Zatvoreno" once
showed the publication time.)

---

## One member, on one intervention

Seven facts, seven places, in the order they can happen.

| Fact | Where | Written by | Never means |
| --- | --- | --- | --- |
| **Called** | `intervention_recipients` | `publish_intervention` | that anything was delivered |
| **Opened** | `intervention_acknowledgements.opened_at` | `acknowledge_intervention` | that they agreed to come |
| **Answered** | `intervention_responses.responded_at`, `.answer`, `.eta_minutes` | `submit_response` | that they set off |
| **Moving** | `intervention_journey.progress` (current) and every `JOURNEY_PROGRESS_SET` audit row (all of them) | `set_journey_progress` | attendance — including `NA_LICU_MJESTA` |
| **Present** | `attendance_intervals.started_at` / `.ended_at` | `attendance_check_in` / `_check_out` | confirmed participation |
| **Confirmed** | `attendance_intervals.verified`, `.verified_at`, `.verified_by` | `attendance_confirm`, `attendance_confirm_many` | — |
| **Rejected** | `attendance_intervals.rejected_at`, `.rejection_reason` | `attendance_reject` | that the member did not attend — only that command does not stand behind this claim |

`intervention_recipients.member_name_at_publication` is the name **as it was
when the call-out went out**, deliberately frozen. Everywhere else a member's
name is read live from the roster, so a corrected spelling is corrected
everywhere at once. The recipient list is the one place where that would be
wrong: it records who was called, under the name they were called by.

### Who may be called

`is_eligible_recipient(member)` is true only for a member with an active roster
record, a linked account, a completed profile, an active grant, and a role of
`OWNER`, `ADMIN`, `COMMANDER` or `FIREFIGHTER`. Those are exactly the conditions
`current_dvd_role()` applies, so "can be called" and "can respond" cannot drift
apart.

**Command roles are eligible recipients, deliberately.** In a volunteer society
the commander and the administrator turn out to incidents like everybody else;
excluding them would mean the roster could not call the people most likely to
attend.

Publishing refuses the **whole** call-out if any recipient is ineligible. A
commander who selected five people and got four must be told, not left to
discover it when somebody never answers.

---

## Durations

### The contract

Every duration in this application obeys the same four rules. They are stated
once here because an independent review of the hosted build found an attendance
interval of **10.591 seconds** displayed as **"1 min"**, and carried that
invented minute into the participation total.

1. **Milliseconds are the unit.** `elapsedMs(from, to)` subtracts two instants
   and returns a number of milliseconds. Nothing computes a duration from a
   formatted string, a minute value, or a local wall clock — see `across DST`
   below for why that distinction is not theoretical.
2. **Sum exactly, format once.** Intervals are added as milliseconds and the
   total is rounded to the nearest second at the moment it is rendered. Three
   intervals of 29.6 s are **1 min 29 s**, not 1 min 30 s: rounding each one
   first and adding produces a number that never happened.
3. **The formatter can say seconds.** `formatDurationMs` renders `0 s`, `10 s`,
   `59 s`, `1 min`, `1 min 1 s`, `1 h 30 min`, `1 h 1 min 1 s`. There is no
   floor at one minute. The old formatter had one — `Math.max(minutes, 1)` —
   added so a real short interval would not read as "0 min", which at the time
   was indistinguishable from "did not attend". Both problems disappear once
   seconds can be expressed at all.
4. **Not measured is null, never zero.** `elapsedMs` returns `null` if either
   end is missing or unparseable, and the screen prints `Nije zabiljezeno`.
   A `0 s` on screen therefore always means a real measurement of no time —
   which is a different statement, and stays distinguishable.

Defined in `src/auth/duration.ts`; the boundaries, including midnight and both
Podgorica daylight-saving transitions, are pinned in `src/auth/duration.test.ts`.

**Across midnight and across DST.** A duration is the difference between two
instants, so neither a date boundary nor a clock change affects it. Twenty
minutes spanning 29 March 01:00 UTC — when Montenegro moves from +1 to +2 — is
twenty minutes, though the wall clock advanced by eighty. Anything computed from
the rendered local strings would report an hour and twenty.

**Negative durations are shown as negative.** The database forbids
`ended_at <= started_at`, so a negative value can only be corrupt data. Printing
`0 s` would make a broken record look like a brief one.

### Per-member response timings

Each of these is its own field on `RecipientTimings` (`src/auth/metrics.ts`),
each independently nullable, and each is labelled separately on screen. **There
is no combined "vrijeme odaziva" anywhere**, for the reason given under
*Times that are NOT computed*.

| Shown | Definition | Missing when |
| --- | --- | --- |
| Otvaranje — Vrijeme | `intervention_acknowledgements.opened_at` | they never opened it |
| Otvaranje — Od objave | `opened_at − interventions.published_at` | either is absent |
| Odgovor | `intervention_responses.answer` | they never answered |
| Odgovor — Vrijeme | `intervention_responses.updated_at`, falling back to `responded_at` | they never answered |
| Odgovor — Od objave | `answered_at − published_at` | either is absent |
| Odgovor — Od otvaranja | `answered_at − opened_at` | either is absent; this is how long they took to decide once they had read it |
| Najavio (procjena) | `intervention_responses.eta_minutes` — the member's own estimate, never a measurement, and labelled as one | they gave none |
| Kretanje | every `JOURNEY_PROGRESS_SET` audit event for that member, oldest first, each with its own timestamp | none reported |
| Dolazak — Na licu mjesta | the **first** `NA_LICU_MJESTA` movement; falls back to `intervention_journey.updated_at` when the audit cannot be read | never reported |
| Dolazak — Od objave | `arrived_at − published_at` | either is absent |
| Prisustvo — Prijava | the earliest `attendance_intervals.started_at` for that member | no attendance record |
| Prisustvo — Odjava | the latest `ended_at`; shows *Jos je prijavljen* while one is open | no closed interval |
| Prisustvo — Potvrdjeno | confirmed participation, below | nothing confirmed AND closed |

A member who reported arriving, left, and reported arriving again **arrived
once**: arrival is the first such report, not the latest.

### Intervention summary

On `InterventionSummary` (`src/auth/metrics.ts`), shown identically on the
commander's console and in the archive — one function feeds both, so the two
cannot print different numbers for one incident.

Every *first* is chosen by **comparing timestamps**, never by taking `[0]` of a
list. Ties break on a stable key (member id, or row id), because two events
written in one transaction share `now()` to the microsecond and an ordering that
happens to be right today is a defect waiting for a different query plan.

| Shown | Definition |
| --- | --- |
| Prvo otvaranje poziva | earliest `opened_at`, and `− published_at` |
| Prvi odgovor | earliest `answered_at` of any answer, and `− published_at` |
| Prvi odgovor Dolazim | earliest `answered_at` **among `DOLAZIM` answers only** — a different person and a different moment from the first answer, because somebody may have declined first |
| Prvi dolazak na lice mjesta | earliest arrival, and `− published_at` |
| Prva prijava prisustva | earliest `attendance_intervals.started_at`, and `− published_at` |
| Prvi izlazak vozila | earliest `vehicle_movements.departed_at`, and `− published_at` |
| Ukupno trajanje | `closed_at − published_at`; *Jos traje* while open |
| Ukupno potvrdjeno ucesce | confirmed participation summed across every member, formatted once |
| Vrijeme u svakom stanju | one period per state: from the transition that entered it to the transition that left it (or to `closed_at`, or open). The first period starts at `published_at` and names nobody, because publishing created it rather than a transition entering it. Every other period names the actor from its `INTERVENTION_STATUS_CHANGED` audit row. |
| Van baze (per vehicle) | `returned_at − departed_at`, with the member who recorded each end resolved from the `VEHICLE_DEPARTED` / `VEHICLE_RETURNED` audit rows by `movement_id` |

Nine tallies, each its own fact and none implying another: Pozvano, Otvorilo,
Odgovorilo, Dolazim, Dolazim kasnije, Ne mogu, Javilo dolazak, Prijavilo
prisustvo, Potvrdjeno prisustvo.

### Confirmed participation — the only number that is participation

```
sum over intervals where verified = true
                    and rejected_at is null
                    and ended_at is not null
    of (ended_at - started_at)
```

Three exclusions, each deliberate:

* **Unconfirmed** intervals count nothing. An interval a commander has not
  confirmed is a claim, not a record. It stays visible, in its own column, with
  its own figure, described as not counted.
* **Rejected** intervals count nothing and stay in the record with their
  reason. Deleting them would erase the disagreement, which is the one thing an
  attendance record must not do.
* **Open** intervals count nothing. A member still checked in has no duration
  yet; showing a running total would produce a number that changes every time
  the page is read.

**Each interval is counted separately and then summed.** A member who attended,
left, and came back has two intervals, both shown, and their times added. The
gap between them is not participation and is not counted.

**Nothing is rounded up.** A confirmed interval of 10.591 s is measured as
10591 ms and displayed as `11 s`. The earlier rule here — "shorter than half a
second counts as one second" — existed only because the formatter could not say
seconds, and it is what produced the invented minute the review found. It is
gone.

**A member with nothing confirmed shows `Nije zabiljezeno`, not `0 s`.** That
covers three different situations — no attendance record at all, an interval
still open, an interval waiting for the commander — and in none of them is there
a confirmed duration yet. The pending and rejected counts sit beside it and say
which.

The same rule is computed twice on purpose: on the client from intervals it
already has, and on the server by `attendance_totals()`. A disagreement between
them is a real defect and should be visible rather than hidden behind whichever
one is shown.

### Times that are NOT computed, and why

* **"Response time"** — not shown anywhere. It would have to choose between
  publication→opened, publication→answered, publication→moving and
  publication→on scene. Those are four different things about four different
  moments and a commander needs them separately.
* **"Time on scene"** — not shown. `NA_LICU_MJESTA` is a member's statement
  about where they are, with no counterpart statement about leaving. Turning it
  into a duration would manufacture attendance out of a movement report, which
  is the single thing this schema is built to prevent.
* **Vehicle time** — `vehicle_movements.departed_at` to `.returned_at`, shown
  per movement **with its exact duration and both actors**. It is a fact about a
  vehicle and never creates attendance for anybody riding in it.

---

## The counts on the commander's console

| Shown | Counts |
| --- | --- |
| Trenutno na zadatku | members with an attendance interval that is open (`ended_at is null`, not rejected) |
| Vozila na terenu | vehicle movements with no `returned_at` |

Only those two are on the console's live panel, and only because they describe
**this moment** rather than the record — the archive would have nothing to say
about either six months later. Every cumulative tally is in the summary above,
in one place, so no two panels can disagree about one number.

These two headline figures were one figure until it contradicted its own table:
a board reading "Prijavljeno prisustvo: 0" beside a member shown as present is
worse than no headline at all.

---

## The chronology

Every line in an intervention's history is one `operational_audit` row, read by
`intervention_audit()`. Each carries:

* `occurred_at` — the server's own time, never a client's;
* `event_type` — one of the fourteen recorded kinds;
* `detail` — whatever the writing command recorded, by name;
* the acting account, resolved to a display name.

**Nothing overwrites anything.** `intervention_journey` holds one current row
per member, which is why a chronology built from it could only ever show each
member's latest movement. The audit has held all of them since the schema was
written. Rows are insert-only: no client holds an INSERT, UPDATE or DELETE
privilege on the table, in any role, through any policy, and the actor is always
`auth.uid()` recorded by the command that did the work — never anything a
browser supplied.

**Who may read it:** command, for any intervention; a member, for an
intervention they were actually called to — that is their own participation
record. An operational firefighter who was not called reads nothing, not a
filtered list.

Where the chronology cannot be read, the archive falls back to what it can
reconstruct from current-state rows **and says so**. A shortened record
presented as the whole one is worse than a short one.

---

## What no number here ever means

* **That anybody was notified.** There is no push, SMS, Viber, e-mail or
  telephone transport. Publishing writes `notification_outbox` rows in state
  `QUEUED` and nothing sends them. Every screen that publishes or receives a
  call-out says so in words.
* **That a member attended, because they said they were on their way.**
* **That a member did not attend, because their claim was rejected.** It means
  command does not stand behind that particular claim, with a reason recorded.
* **That the society was dispatched by anyone outside it.** Every intervention
  in this system was created by a commander of DVD Tivat.
