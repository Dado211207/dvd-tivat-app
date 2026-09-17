# Every route, every role, and what changed

The audit that came before the redesign, and the record of what was done with
it. Written so the next person can check the reasoning rather than re-derive it.

---

## 1. The routes, as they were

Thirteen routes exist. Five are server-backed, one is this device's own
settings, seven are the earlier local prototype.

| Route | Backed by | Who may use it | Was it in the rail? | What it is |
|---|---|---|---|---|
| `poziv` | server | OWNER, ADMIN, COMMANDER | yes | Prepare, publish and lead an intervention |
| `mobilizacija` | server | all four operational roles | yes | A member's own call-out and attendance |
| `arhiva` | server | all four operational roles | yes | The record of closed interventions |
| `evidencija` | server | OWNER, ADMIN | yes | Members, groups, vehicles |
| `nalozi` | server | anyone, including signed out | yes | Sign in, own account, owner's directory |
| `podesavanja` | device | anyone | **new** | Language and notifications |
| `prikaz` | simulation | anyone | yes | Station display |
| `dojava` | simulation | anyone | no | Abandoned citizen-report research |
| `dezurni` | simulation | anyone | no | Duty officer (duplicates `poziv`) |
| `clan` | simulation | anyone | no | Member view (duplicates `mobilizacija`) |
| `vozila` | simulation | anyone | no | Vehicle log (duplicates a console tab) |
| `clanovi` | simulation | anyone | no | Roster (duplicates `evidencija`) |
| `istorija` | simulation | anyone | no | History (duplicates `arhiva`) |

The audience column is `ROUTE_AUDIENCE` in `src/access/navigation.ts`, which
mirrors each screen's `OperationalGate allow` prop and is pinned by a test. None
of it is security: every screen sits behind a gate that asks the server, and
every command behind a `security definer` function that asks again.

### What each role actually saw

- **Firefighter** — three links (`mobilizacija`, `arhiva`, `nalozi`) plus
  `prikaz`, spread across three group headings. Three captions over four links.
- **Commander** — the above plus `poziv`; still three headings.
- **Admin / Owner** — everything.
- **Signed out** — everything is offered, deliberately: a navigation that
  shrinks while a session is being checked is worse than one that explains
  itself at the gate.

---

## 2. What was wrong

### 2a. Headings outnumbered the things they introduced

"Operativa", "Evidencija drustva", "Prototip (simulacija)" — for a firefighter,
three headings standing over one, one and one link respectively. A group of one
is a caption, and each caption cost roughly as much vertical space as the link
beneath it.

**Changed.** Two groups, named for the task: **Rad** (`poziv`, `mobilizacija`,
`arhiva`) and **Drustvo** (`evidencija`, `nalozi`, `podesavanja`).

### 2b. The simulation sat in the same rail as the real product

Under a label reading "Prototip (simulacija)". A label is not a separation.
During a demonstration it was one tap from a real call-out to a fictional one,
and the two look alike enough that afterwards nobody can say which they were
looking at. The previous reasoning kept `prikaz` because it duplicated nothing
server-backed — true, and beside the point.

**Changed.** Every simulation is reached from Settings, behind a closed
disclosure with its own warning. Routes, code and each screen's self-declaring
notice are untouched: an old link still resolves and still explains itself.
`dojava` is not offered even there — this application must never read as a way
to report a fire.

### 2c. A banner that contradicted itself

The rail carried "LOKALNA SIMULACIJA — Bez stvarnih poziva i obavjestenja" on
**every** screen, two elements above a badge reading "STVARNI PODACI — ovaj
ekran radi na serveru". Since Web Push shipped, the first half was false as well
as contradictory: there ARE real notifications now.

**Fixed.** The rail note is gone. The simulation warning, which does mean
something, stays on simulation screens only. The server badge strip is also
gone from the top of every server-backed screen: saying "this is the real
product" on arrival at the real product is noise, and the footer still says it.

Before, a firefighter opening the application met, in order: the rail, the
masthead (eyebrow + title + description), a badge strip, the connection bar, and
possibly a storage warning — five layers of chrome before the first thing they
needed to read. Two of those are gone.

### 2d. Three screens led with the wrong thing

- **The commander's console** opened onto a blank compose form for a NEW
  call-out — even with one in progress. The running intervention was below it.
- **The firefighter's screen** put general availability and a notification panel
  above the fire.
- **The notification panel** printed a paragraph explaining itself even when it
  was already on and there was nothing to do.

**Changed.** Each now leads with what the person came for. The compose form and
the availability panel drop below and close when a call-out is running; the
notification panel collapses to one line while it is on, and opens in full
whenever there IS an action to take. Nothing was removed: closed is one tap, and
hiding a capability to tidy a screen would be buying calm with a missing
feature.

One subtlety worth recording, because it is the trap this kind of change sets:
both panels are rendered in **one** position and only their shape changes.
Rendering a panel in one of two places depending on a flag unmounts it when the
flag flips and takes its `useState` with it — a commander who had half-typed a
second call-out would have lost it the moment they published the first. That is
the same class of fault as the resume reset, and `e2e/live-updates.spec.ts`
exists because of it.

### 2e. Times rendered in the device's zone on two screens

Eight timestamps in `MobilisationView` and `CommandView` used
`new Date(...).toLocaleString('sr-Latn')`, which renders in the **device's**
time zone. The rest of the system is careful to render every instant in
Europe/Podgorica so that one stored fact prints as one sentence for everybody.
So the same check-in printed one time on the firefighter's screen and another in
the archive.

**Fixed.** All eight go through `formatTime`.

### 2f. The archive claimed publishing sent nothing

"i upisao N obaveza za slanje (bez stvarnog slanja)" — true before Web Push,
false afterwards for every member who has opted a device in. A record that
asserts "without actually sending" about a call-out that did send is worse than
one that says nothing.

**Fixed.** The line names how many members were called out and claims nothing
about transport. The test that pinned the old phrase now asserts the property.

---

## 3. What was deliberately NOT changed

- **No capability was removed.** Everything that existed still exists, at the
  same route, with the same permissions.
- **No role restriction was loosened or tightened.** `ROUTE_AUDIENCE` gained one
  entry (`podesavanja`, open to everyone including signed-out) and changed
  nothing else. Every gate `allow` prop is untouched.
- **Settings sits outside the operational gate** on purpose. The person most in
  need of a refusal message they can read is the one who has been refused, and a
  language switch behind a role check is a language switch they cannot reach.
- **No drawer on phones.** Below 900px the rail already becomes a horizontal
  strip of large targets. A drawer would put a tap in front of every navigation
  to save space the strip does not cost.
- **The visual identity is unchanged.** Same tokens, same institutional accent,
  same status symbols paired with every colour. The new components — the
  disclosure, the language chooser, the compact notification line — use existing
  tokens and existing sizes.

---

## 4. Accessibility

Checked, and what was done:

- **Keyboard.** The language chooser is a real `<fieldset>`/`<legend>` radio
  group, so arrow keys move between options and the group announces itself. The
  disclosures are native `<details>`/`<summary>`: keyboard-operable, announced
  as expandable, and findable by the browser's own in-page search when open.
- **Focus.** `:focus-visible` on every new interactive element, using the
  project's `--focus` token rather than a new outline.
- **Screen readers.** `<html lang>` is set from the stored language at start-up
  and updated when it changes, because a screen reader chooses its voice from
  it — Montenegrin read with English pronunciation is a defect that never shows
  up in a screenshot. Every Settings section is a `<section aria-labelledby>`
  pointing at a real heading. The "language saved" confirmation is
  `role="status"`, so a change nobody can see is still announced.
- **Touch targets.** Minimum 44px on the disclosure summaries, the language
  chips, the compact notification link and the prototype links, matching the
  project's existing `--tap-min`.
- **Contrast and colour.** No new colour carries meaning alone; the existing
  symbol-with-every-status rule is untouched.
- **Text size.** Relative units throughout; nothing new is set in pixels.

The axe scans in `e2e/a11y.spec.ts` cover the changed screens at every target
viewport.

---

## 5. What remains untranslated

Stated plainly rather than left to be discovered.

**Translated in full (Crnogorski and English):** the shell and navigation,
Settings, the operational gate and every refusal it can show, the notification
panel, the commander's console (all four tabs), the firefighter's screen, the
archive including its chronology sentences, the shared timings panels, and the
whole server-side vocabulary — intervention kinds, statuses, answers, movement
steps, attendance states and sources, roles, and every audit event sentence.

**Not translated:** the seven simulation screens' own body copy (`prikaz`,
`dezurni`, `clan`, `vozila`, `clanovi`, `istorija`, `dojava`). They are the
abandoned local prototype, reached only from a closed disclosure in Settings and
labelled as simulation on arrival. Their shared vocabulary in `src/i18n/labels.ts`
is still Montenegrin-only.

**Never translated, by design:** anything a member typed or the database stored
— intervention titles, member names, locations, instructions, closing notes and
audit detail. Translating a commander's note would be rewriting evidence.
Settings says this in words so a Montenegrin title on an English screen reads as
the record speaking rather than as a half-finished translation.

---

# Part two: the clarity redesign

A second pass, after the first one shipped and the screens were still crowded.
The first pass fixed the NAVIGATION - fewer destinations, no duplicate headings,
simulation moved out of the way. It did not touch what a firefighter sees once
they arrive, and that was the part still failing.

## 6. What the screens actually looked like, measured

Captured from the fixture build in a real browser at 390x844, the size this
application is designed around. Numbers, not impressions.

### The firefighter's screen, before

| Measurement | Value |
|---|---|
| Full page height | 2096px |
| Viewport height | 844px |
| Blocks of chrome above the incident | 5 |
| Incident title position | 26% down the page |
| Cards of equal visual weight | 4 |
| Of those four, already complete | 3 |
| The one action left to do | fourth card, below the fold |

The five blocks were: the society masthead, a page title, a description of the
page, the notification panel (five lines), and the live-connection line. All of
it above "what happened and where".

The four cards were the four facts the schema keeps apart - opened, answered,
movement, attendance - each in its own panel with its own explanatory
paragraph, all the same size. For this member, three were finished. The one
thing being asked of them looked exactly like the three that were not.

That is the defect. Not colour, not spacing: rank. Nothing on the screen said
which of the four things mattered now.

### The commander's console, before

| Measurement | Value |
|---|---|
| Tab rows at 390px | 2 (`Vozila` alone on the second) |
| Intervention picker label | `Intervencija (nije obavezno)` |
| Incident facts | a `<dl>` with a label column beside every value |
| Value column width at 390px | ~172px, so a location wrapped over 3 lines |
| Answer to "who is coming" | on a different tab |

## 7. What was done

### The firefighter's screen

1. **One dominant action.** `src/ui/views/callOutStep.ts` is a pure function
   answering one question: given what this member has and has not recorded,
   what is left? Its answer is rendered large, with an eyebrow reading
   `SLJEDECE`, and nothing else on the screen competes with it. Thirteen unit
   tests cover every position a member can be in, including the one that used
   to be wrong.
2. **The four facts stay four facts, as a strip.** `Sta ste javili` lists all
   four with a mark and a word each. Visibility was the reason the four cards
   existed and it is the part worth keeping; a full panel each was not.
3. **One tap is the answer.** `Dolazim` and `Ne mogu` commit directly.
   Previously it took two taps - choose a chip, then press a separate send
   button that sat disabled until you had - and the failure that invites,
   believing you answered when you only highlighted, is the one a commander
   cannot see.
4. **Everything else, one disclosure away.** Changing an answer, correcting a
   movement already reported and reading one's own attendance records all still
   exist, closed, under `Ostale radnje`. Nothing was removed.
5. **Chrome moved below the incident.** The notification panel collapses to one
   line while a call-out is running, and the live-connection line moved to the
   bottom of both screens.
6. **Two columns wherever there is width.** Stacked, the incident card alone
   filled a phone held sideways and the action fell off the bottom. Landscape is
   short, not narrow.

### The commander's console

1. **The incident first, in the same card the firefighters see.**
   `IncidentCard` is now one component used by both screens, so a commander and
   a firefighter standing at the same incident read the same description of it.
   The `<dl>` is gone; every fact it held is still there.
2. **`ODZIV` second.** Six counts - invited, coming, later, declined, no answer,
   on scene - each its own fact and none inferred from another. `Na terenu` is a
   count of reported positions and never implies attendance.
3. **Four tabs, one row** at 390px in both languages.
4. **The picker is a switcher, not a field.** It only appears when there is more
   than one intervention, and it no longer claims to be optional.
5. **A call-out is written in a sequence.** Four steps - what happened, where and
   what to do, who, and a last look - across the two server operations that
   already existed. The review step shows the incident card and the names before
   anything reaches a telephone.
6. **A half-typed call-out survives a reload.** Between opening the form and
   pressing `Sacuvaj nacrt` there was no record anywhere. See
   `src/ui/views/callOutDraft.ts`; it is cleared the moment the draft reaches
   the server.

## 8. Two defects found while redesigning

Both were real, both predate this pass, and both are now covered by tests.

### 8a. The status strip denied an evening's work

A member who checked in, worked ninety minutes and checked out again had no OPEN
attendance interval. The strip read that boolean and printed `Prisustvo: ne` -
telling somebody who had been at the incident all evening that their attendance
was nothing.

Attendance is not a boolean. It has four positions - none, on the task, recorded
and awaiting confirmation, confirmed - and the difference between the last two
is the whole product. `AttendanceStanding` in `callOutStep.ts` carries all four,
and the strip shows `+`, `~` or `-` with a word beside it, never colour alone.

### 8b. The movement warning vanished exactly when it had been needed

`Ne prijavljuje prisustvo - ni "Na licu mjesta"` appeared only while reporting
movement was the current step. Once a member reported being on scene it
disappeared - and the movement buttons, `Na licu mjesta` among them, stayed
reachable under `Ostale radnje` with nothing saying that pressing one is not
reporting attendance. The warning now travels with the buttons it warns about.

## 9. What was deliberately not changed

- **No schema, RLS, authorization, role meaning, audit or server workflow
  change.** Every command called is one that already existed.
- **No Web Push change.** Not its delivery logic, payload, opt-in behaviour,
  repeat policy or configuration. The panel's SHAPE changed - collapsed during a
  call-out - and nothing about what it does. Permission is still never requested
  without a press.
- **No capability removed.** Where something moved, this document says where.
- **The seven simulation screens** keep their own layout and their
  Montenegrin-only copy. They are reached from a closed disclosure in Settings.
