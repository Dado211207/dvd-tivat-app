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
