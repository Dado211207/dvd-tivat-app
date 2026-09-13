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
`timestamptz` (UTC), and displayed in **Europe/Podgorica**.

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

A confirmed interval shorter than half a second counts as **one second**, not
zero. `formatDuration` renders both as "0 min", and a board reading "0 min"
beside a confirmed record says "did not attend". A real interval that short is a
mis-tap, not an absence.

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
  per movement. It is a fact about a vehicle and never creates attendance for
  anybody riding in it.

---

## The counts on the commander's console

| Shown | Counts |
| --- | --- |
| Trenutno na zadatku | members with an attendance interval that is open (`ended_at is null`, not rejected) |
| Prijavilo prisustvo | members with any attendance interval on this intervention, confirmed or not |
| Vozila na terenu | vehicle movements with no `returned_at` |

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
