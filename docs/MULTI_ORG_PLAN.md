# Multi-organisation plan

One application, two organisations: **DVD Tivat** and **Sluzba zastite i spasavanja
Tivat** (SZS).

This document is a plan, not a record of built work. Every item is marked
**DECIDED** (settled by the owner) or **OPEN** (needs the owner before the step
that depends on it can start). Nothing is guessed to make the plan look finished:
where an answer is missing, the plan says which step it blocks.

**Progress, 2026-09-23:** P0 is merged (#47). D9–D13 closed Q9, Q10, Q11 and both
flagged assumptions, which unblocks P1 through P5 end to end. Q1–Q8 remain open
and block P6 and P7 only. No migration from this plan has been applied to
production.

The audit this is built on ran read-only against the hosted project
`yskhdzrdbywrpfowckpn` on 2026-09-23, with code read at `2e66ace`. Counts quoted
below are live production values from that audit.

---

## 1. The size of this, stated plainly

**DECIDED — D0. This is an authority-model rewrite, not an additive feature.**

Adding SZS is not "switch on the second organisation". Today the application has
exactly one notion of authority: `access_grants.role`, one row per person, read by
a function that takes no arguments. Making authority per-organisation means
changing that function's signature and everything that depends on it.

The concrete surface:

| What | Count | Source |
|---|---|---|
| RLS policies, none of which reference an organisation | 51 | `pg_policies` |
| …of those, granting access through a DVD-named predicate | 32 | `pg_policies` |
| Guard call sites across the 17 migrations | 134 | `grep` over `supabase/migrations/` |
| Tables carrying no organisation reference at all | 30 of 33 | `pg_class` / `pg_attribute` |
| `organization_memberships` rows that grant any authority today | **0** | see §2 |

The membership feature that exists today is **display-only metadata**. It grants
nothing. So the work is not "extend memberships to SZS" — it is "move authority
from `access_grants` to `organization_memberships`, then add SZS".

This is stated first so the size is not a surprise at phase 4.

---

## 2. What exists today

**Organisation-scoped (the complete list):** the `organizations` table (2 rows,
`DVD` and `SZS`, both active), `organization_memberships` (6 rows, **all DVD**,
0 SZS), `organization_membership_audit` (0 rows), and the functions
`owner_set_organization_membership()` / `current_organization_memberships()` plus
the DVD/SZS columns in `AccountsView`.

**Everything operational assumes DVD.** `interventions`, `members`, `vehicles`,
`groups` and every child table carry no organisation. All authority resolves
through `current_dvd_role()`, which reads `access_grants` and takes no argument.

**The two role systems are the same fact stored twice.** A trigger
(`sync_dvd_membership_after_grant`) writes DVD membership from the grant, and
`owner_set_organization_membership` writes the grant back from DVD membership.
Live data confirms it: all 6 DVD membership roles are identical to their account's
`access_grants.role`. The owner is the only account with no membership at all.

**Consequence, verified:** an SZS-only account has `access_grants.role = 'CITIZEN'`,
so `current_dvd_role()` returns null and every screen and command refuses it. It
cannot even read its own `web_push_subscriptions` row. SZS membership currently
grants nothing.

**Blocking schema constraints:** `members_user_id_key UNIQUE (user_id)` (one member
record per account), `groups_name_key UNIQUE (name)` and `vehicles_callsign_key
UNIQUE (callsign)` (globally unique across both services).

---

## 3. Decisions carried from the brief

| # | Decision |
|---|---|
| **D1** | One application, two organisations: DVD Tivat and Sluzba zastite i spasavanja Tivat. |
| **D2** | Everyone registers as CITIZEN with no operational access. *(Already true — `handle_new_account` writes CITIZEN.)* |
| **D3** | The owner assigns each account to DVD, SZS, or both. |
| **D4** | SZS gets the same operational workflow DVD has: publish intervention, recipients answer, attendance, vehicles, archive. |
| **D5** | When SZS publishes an alert it may tick "DVD Tivat" as an additional recipient organisation, and every eligible DVD member receives it exactly as a DVD call-out. |
| **D6** | The official display name is **"Sluzba zastite i spasavanja Tivat"**, code `SZS`. Not "savez". The `organizations` row already carries this string; it is now fixed vocabulary for the plan, the interface, and all future documents. |
| **D7** | The missing organisation predicate in `eligible_recipients()` / `is_eligible_recipient()` is closed **first**, in its own PR, before any SZS membership work, and **not** bundled into the authority migration. *Corrected after the fact: this was decided on the claim that it was a live production bug. It is not — see P0, which proves the omission is currently unreachable. The sequencing still holds, for a weaker reason.* |
| **D8** | The society-registry "organisation" naming is renamed early, as its own step, before the tenant concept spreads (§5). |

### Answered 2026-09-23, closing Q9, Q10, Q11 and both flagged assumptions

| # | Decision |
|---|---|
| **D9** *(was Q9)* | **A single installation owner administers both DVD and SZS.** No second owner, and no new per-organisation administrator role. **Interpretation, stated because it decides what P4 does:** the existing `ADMIN` keeps exactly the powers it has today, scoped to its own service — an SZS `ADMIN` manages SZS's registry, a DVD `ADMIN` manages DVD's. That is the only reading consistent with "no existing DVD account loses access", since production holds a live `ADMIN` account whose registry powers cannot be withdrawn by this rewrite. **The owner confirmed this reading on 2026-09-23, and restated the constraint: no account loses access as part of this rewrite.** P4f asserts it in both directions. |
| **D10** *(was Q10)* | **Every vehicle is owned by exactly one service.** No sharing. `vehicles.organization_id` is non-null with no exception, and `UNIQUE (callsign)` becomes `UNIQUE (organization_id, callsign)` as §4.1 assumed. |
| **D11** *(was Q11)* | The demo-data cleanup is **sequenced with this rewrite** rather than deferred. **It does not authorise any deletion.** Nothing is deleted in any phase of this plan without the full row-level inventory and a separate explicit sign-off, exactly as already agreed for `docs/DEMO_DATA_INVENTORY.md`. A phase that would benefit from cleaner data waits for that sign-off or proceeds with the data as it stands; it never deletes to make itself easier. |
| **D12** | **The rename moves the registry side** (§5): `OrganisationView.tsx` → `RegistryView.tsx`, `organisation_audit` → `registry_audit`, `t.organisation.*` → `t.registry.*`. The tenant vocabulary — `organizations`, `organization_memberships`, `organization_id` — is **untouched**. |
| **D13** | **A person serving in both services gets two member records**, one per service (§4.1), with `UNIQUE (user_id)` becoming `UNIQUE (organization_id, user_id)`. Accepted as designed, with its costs: two availability rows, two attendance histories, two roster entries. The interface consequence remains OPEN (Q8). |

**Still OPEN: Q1–Q8.** All eight block P6 or P7 only, so P1–P5 can now run to completion without another answer.

---

## 4. Data model

Items here follow from D1–D5 as engineering consequences rather than as separate
product choices. Say so if you disagree with any of them; they are not settled by
anything other than "this is what D1–D5 require".

### 4.1 Organisation ownership of records

Every operational record gains a non-null `organization_id` referencing
`organizations(id)`:

| Table | Change | Unique constraint change |
|---|---|---|
| `members` | `+ organization_id` | `UNIQUE (user_id)` → `UNIQUE (organization_id, user_id)` |
| `vehicles` | `+ organization_id` | `UNIQUE (callsign)` → `UNIQUE (organization_id, callsign)` |
| `groups` | `+ organization_id` | `UNIQUE (name)` → `UNIQUE (organization_id, name)` |
| `interventions` | `+ organization_id` — the **publishing** organisation | — |

**A person serving in both organisations gets two member records**, one per
organisation. This is deliberate, and it is the only model that works: availability,
specialties, attendance history and group membership are all properties of serving
*in a particular service*, not of the person. "Available to SZS, off with DVD" is
not expressible with one record.

It has a cost, and the owner should see it before phase 2: two rows in
`member_availability`, two attendance histories, two entries in any roster export.
**Accepted as designed on 2026-09-23 — D13.** The interface consequence is still
OPEN (§7, Q8).

### 4.2 Child tables

Tables hanging off an intervention (`intervention_recipients`, `intervention_responses`,
`intervention_response_revisions`, `intervention_updates`,
`intervention_acknowledgements`, `intervention_journey`,
`intervention_journey_history`, `attendance_intervals`, `attendance_corrections`,
`attendance_correction_requests`, `vehicle_movements`, `notification_outbox`,
`notification_delivery_attempts`, `operational_audit`) can reach the organisation
through their parent.

**Recommendation: denormalise `organization_id` onto them anyway**, maintained by a
trigger from the parent. A policy that joins to `interventions` to find the
organisation is a policy that runs a subquery on every row of every read, on tables
that are in the Realtime publication and are read on a phone during an incident.
The cost of denormalising is a trigger and a consistency test; the cost of not
denormalising is paid on every call-out.

`attendance_intervals` is the exception that also needs a *second* organisation
column — see §6.3.

### 4.3 Per-organisation roles

`organization_memberships(organization_id, user_id, role, active)` becomes the
**sole** source of operational authority. Its `role` keeps the existing vocabulary:
`ADMIN`, `COMMANDER`, `FIREFIGHTER`.

`access_grants` is reduced to what is genuinely global:

- `active` — account suspension, which is installation-wide and must stay that way.
- `role = 'OWNER'` — the installation owner, who administers both organisations.
- Every other role value stops carrying authority. `CITIZEN` remains the value for
  "no operational role anywhere", written by `handle_new_account`.

The mirror trigger `sync_dvd_membership_after_grant` is **dropped** at the end of
phase 5. Until then it stays, because it is what keeps today's accounts working.

New authority functions replace the DVD-named ones:

| Today | Replacement |
|---|---|
| `current_dvd_role()` | `current_role_in(target_organization uuid)` |
| `is_dvd_staff()` | `is_staff_in(uuid)` |
| `is_dvd_command()` | `is_command_in(uuid)` |
| `is_dvd_admin()` | `is_admin_in(uuid)` |
| `is_dvd_owner()` | `is_installation_owner()` — unchanged meaning, honest name |
| `current_member_id()` | `current_member_id_in(uuid)` |
| `is_eligible_recipient(member)` | `is_eligible_recipient(member)` — now organisation-aware internally (§8, P0) |

Whether SZS gets its own owner or the single installation owner administers both is
**OPEN** (§7, Q9).

---

## 5. Naming collision, and the rename

Today "organisation" means two unrelated things, and the only thing separating them
is **one letter of spelling**:

| Spelling | Means | Where |
|---|---|---|
| organis**a**tion (British) | the society's registry of members, groups and vehicles | `src/ui/views/OrganisationView.tsx`, `organisation_audit`, `t.organisation.*`, `202609120005_organisational_writes.sql` |
| organi**z**ation (American) | the tenant — DVD or SZS | `organizations`, `organization_memberships`, `organization_id` |

**This must not survive into the rewrite.** A one-letter distinction is invisible in
review, invisible in a grep, and a typo silently targets the wrong concept. It is
exactly the kind of thing that produces a policy that reads the wrong table and
passes its tests.

**Rename confirmed on 2026-09-23 (D12): the registry concept becomes `registry`,
and the tenant vocabulary is untouched.** The screen already serves the route
`evidencija`, which is the Montenegrin word for registry/records, so the name is
already in the product — it is only the code that drifted.

| From | To |
|---|---|
| `src/ui/views/OrganisationView.tsx` | `src/ui/views/RegistryView.tsx` |
| `organisation_audit` (table) | `registry_audit` |
| policy `organisation_audit_admin_read` | `registry_audit_admin_read` |
| i18n namespace `t.organisation.*` | `t.registry.*` |
| `db-tests/organisation.test.ts` | `db-tests/registry.test.ts` |

`RegistryView` does not collide with the existing prototype `RosterView.tsx`
(route `clanovi`), which is unrelated local-simulation code.

**Blast radius, measured:** `organisation_audit` is referenced from 20 lines in a
single migration (`202609120005`) and read by **no client code at all** — only
`db-tests/organisation.test.ts`. So the table rename is one `alter table … rename`,
one policy rename, and one test file. This is why it is cheap now and expensive
later.

---

## 6. Cross-organisation alerting

Implements D5. Everything in this section is blocked on at least one OPEN question;
each subsection names which.

### 6.1 Recipient resolution

A new table records which organisations an intervention was aimed at:

```
intervention_recipient_organizations(
  intervention_id, organization_id, added_by, added_at)
```

At publication, `publish_intervention` resolves recipients as the union of:

1. the member ids the commander selected from their **own** organisation, and
2. for each additional recipient organisation, every **eligible** member of it.

"Eligible" keeps its current meaning (active member, linked account, complete
profile, active operational role) with the organisation predicate added by P0.

Whether SZS may target *specific DVD groups* or only "all of DVD" is **OPEN**
(§7, Q2). The table above supports either; the difference is whether a second
table `intervention_recipient_groups` is needed.

Whether DVD may alert SZS symmetrically is **OPEN** (§7, Q1). Nothing in the
design above is direction-specific, so symmetry costs nothing extra to build —
but it is a product decision about who may page whom, not an engineering one,
and it must be answered before P7 ships rather than assumed.

### 6.2 One notification per person

A person in both organisations has **two member records** (§4.1). A joint SZS→DVD
call-out would therefore reach them twice: once as an SZS member, once as a DVD
member. Two pushes, two in-app obligations, two response rows for one human at one
incident.

**Resolution: deduplicate by `user_id`, not `member_id`.** Concretely:

- `notification_outbox` gains `user_id`, with a partial unique index on
  `(intervention_id, user_id, channel)` where the row is not superseded. This is
  the enforcement point, so a bug in the resolver cannot page somebody twice.
- `publish_intervention` keeps **one** recipient row per person, preferring the
  member record of the **publishing** organisation. Rationale: the call-out belongs
  to whoever published it, so the person answers as a member of that response, and
  the archive attributes it consistently.

The dedupe key gains a version segment as today (`…:CHANNEL:1`), unchanged.

Whether the person should nevertheless *see* that both of their services were
called — and whether they answer once or once per service — is **OPEN** (§7, Q8).
The dedupe above is the floor: never page twice. It does not settle the interface.

### 6.3 Ownership, command, archive and attendance on a joint intervention

These four are entangled and are the single largest OPEN cluster in this plan.
The design below is what the schema will support; the policy choices are the
owner's.

- **Owner of the record:** `interventions.organization_id` = the publishing
  organisation. Not open — it follows from D5 ("when SZS publishes"), and the
  record needs exactly one owner for the archive to be coherent.
- **Command:** who may close, update or correct a joint intervention is **OPEN**
  (§7, Q3).
- **Archive:** which organisation's archive it lands in, and what the *other*
  organisation sees of it, is **OPEN** (§7, Q4).
- **Attendance:** whether a DVD member's hours on an SZS call-out count towards
  DVD, SZS or both is **OPEN** (§7, Q5). The schema answer that keeps every option
  available is to give `attendance_intervals` **two** columns —
  `organization_id` (whose intervention) and `credited_organization_id` (whose
  participation record) — and let the answer to Q5 decide how the second is
  filled. `attendance_totals()` then groups by the credited organisation. Building
  it this way costs one column now and avoids a second migration over live
  attendance records later.

---

## 7. OPEN questions

**No step that depends on one of these may start before it is answered.** The
"blocks" column names the phase from §8.

| # | Question | Blocks |
|---|---|---|
| **Q1** | Symmetric or one-way? May DVD also alert SZS, or is it only SZS→DVD as described in the brief? | P7 |
| **Q2** | May SZS target specific DVD groups (e.g. "Smjena A"), or only "all of DVD"? | P7 |
| **Q3** | Who commands a joint intervention? May a DVD commander who was added as a recipient organisation see the SZS command console for it, close it, confirm attendance — and if attendance, only for DVD's own people or for everyone on it? | P7 |
| **Q4** | Whose archive does a joint intervention land in? Does DVD get a permanent record of an SZS call-out its members attended, and if so does it show SZS's members and instructions, or only DVD's own participation? | P7 |
| **Q5** | Is a DVD member's attendance on an SZS intervention credited to DVD, SZS, or both? This decides what the participation totals mean, and it is not reversible once records exist. | P6 (schema), P7 (behaviour) |
| **Q6** | Does SZS need different response options or ETA bands from DVD's, or are the current ones right for both? | P6 |
| **Q7** | Does SZS use the same intervention kinds as DVD (`interventions.kind`), or its own taxonomy? | P6 |
| **Q8** | For a person in both organisations: one merged operational screen, or an explicit "acting as DVD / acting as SZS" switch? And on a joint call-out, do they answer once or once per service? | P6, P7 |
| ~~Q9~~ | **ANSWERED — see D9.** Single installation owner for both services; no new per-organisation administrator role. | — |
| ~~Q10~~ | **ANSWERED — see D10.** Every vehicle is owned by exactly one service. | — |
| ~~Q11~~ | **ANSWERED — see D11.** Cleanup is sequenced with the rewrite; no deletion without separate sign-off. | — |

Q6 and Q7 have a defensible default (same response options as DVD, same
intervention kinds as DVD) and are cheap to change later. Q3, Q4 and Q5 are not:
they decide what records mean, and changing them after records exist means
migrating live history.

**Every remaining open question blocks P6 or P7 only.** P1 through P5 — the
rename, the columns, the authority functions, the policy rewrite and retiring
the mirror — are fully specified and can run to completion without another
answer.

---

## 8. Phased implementation

Smallest safe order first. **At no point in P0–P5 may an existing DVD account lose
access** — that is the constraint the ordering is built around, and it is why the
`access_grants` mirror survives until P5.

Every phase is one PR. Acceptance criteria are written so they can fail: each one
is a test that passes only if the change is correct, and each phase's regression
tests must fail against the code as it was before that phase.

### Running order and state

| Phase | What it touches | Schema risk | State |
|---|---|---|---|
| **P0** | two eligibility functions | none | **merged** (#47, `202609230018`, not applied to production) |
| **P1** | names only — no schema semantics | none | **next** |
| **P2** | `organization_id` columns + backfill | additive | ready; unblocked by D10, D11 |
| **P3** | new authority functions + DVD shim | none (functions only) | ready; unblocked by D9 |
| **P4a–f** | the 51 policies, six PRs | none (policies only) | ready; unblocked by D9 |
| **P5** | drop the mirror, reduce `access_grants` | destructive | ready; unblocked by D9 |
| **P6** | SZS runs its own workflow | additive | blocked on Q5, Q6, Q7, Q8 |
| **P7** | cross-service alerting | additive | blocked on Q1–Q5, Q8 |
| **P8** | branding and storage keys | none | ready |

P1 through P5 can now run end to end without another answer. **P4 is split into
six PRs** — one policy rewrite per table group — because "one PR" for 51 policies
is not a reviewable change, and because a mistake in one group should not require
re-reviewing the other five. Each P4 PR is independently safe: P3's shim means a
single-service installation resolves identically either way, so the groups can
land in any order and a bad one can be reverted alone.

---

### P0 — Close the cross-service recipient leak *(merged — #47)*

`eligible_recipients()` and `is_eligible_recipient()` have no organisation
predicate, which is real. **It is not reachable today**, and the first draft of
this plan was wrong to call it a standing production bug.

`sync_dvd_membership_from_grant` mirrors every operational grant into an active
DVD membership, and mirrors a DVD stand-down back to `CITIZEN`. So "holds an
operational grant" and "is an active DVD member" are currently the same set of
people, the owner aside, and every command-layer route to an SZS-only account
ends in a `CITIZEN` grant — which the existing operational-role question already
refuses. Walked in full:

| Step | Grant | Memberships | Callable by a DVD commander |
|---|---|---|---|
| after registration | `CITIZEN` | `(none)` | no |
| after `SZS=COMMANDER` | `CITIZEN` | `SZS=COMMANDER` | **no** |
| after `owner_set_role COMMANDER` | `COMMANDER` | `DVD=COMMANDER,SZS=COMMANDER` | yes — correctly; they really are in DVD |
| after `DVD=NONE` | `CITIZEN` | `DVD=COMMANDER(off),SZS=COMMANDER` | **no** |

The omission is therefore **masked** by that invariant, and becomes reachable at
**P5**, when the mirror is retired.

So P0 is not urgency, it is sequencing: it removes a trap that springs at the
point in the rewrite where the schema is most disturbed and this would be one
defect among fifty. Closing it now costs one function and is provable against a
fixture; closing it then is guesswork. It ships on its own, against today's
schema, using `organization_memberships` for the predicate — correct even before
memberships carry authority, because membership is already the truthful statement
of who serves where, and because the rule reads no membership *role*.

**Acceptance criteria**

1. A DB test builds the post-P5 state (operational grant, SZS membership, no
   active DVD membership) and asserts `eligible_recipients()` called as a DVD
   commander does **not** return them. Fails against current `main`.
2. A DB test asserts `publish_intervention` raises `RECIPIENT_NOT_ELIGIBLE` when a
   DVD commander passes such a member's id directly, bypassing the UI, and that
   no recipient or outbox row survives. Fails against current `main`.
3. DB tests walk every command-layer route above and pin the masking invariant,
   so that if the mirror's behaviour ever changes it surfaces as a decision
   rather than a surprise.
4. A single-organisation installation sees no change: the DVD picker, DVD
   publication and self-eligibility for push registration all behave as before.
   *Amended: the original wording — "every existing DVD-only test passes
   unchanged" — is not achievable. Eligibility stops being a property of the
   target alone and becomes a property of the caller/target pair, so three rows
   in `recipient_eligibility.test.ts` that called the RPC as the superuser with
   no JWT have to move onto `asUser`. No real request arrives that way;
   PostgREST attaches a JWT to every call.*
5. The installation owner keeps its existing behaviour in both directions: it
   sees every service's members, and stays callable by every service. It holds
   no membership row by design (202609210016), so a plain shared-membership rule
   would silently remove it from every roster.

---

### P1 — Rename the registry concept *(no behaviour change)*

§5. Table rename, policy rename, view rename, i18n namespace rename, test file
rename.

**Acceptance criteria**

1. `grep -rn "organisation" src/ supabase/ db-tests/ e2e/` returns **zero** matches
   outside this document and the historical migration filename. (The filename
   `202609120005_organisational_writes.sql` is not renamed — applied migrations are
   immutable.)
2. Full DB suite green with `registry_audit`; the migration is additive-and-rename
   only, with no data loss, asserted by a row-count check across the rename.
3. Typecheck, lint, unit and browser suites green with no behavioural diff;
   screenshots unchanged.

---

### P2 — Organisation columns and backfill *(no policy change)*

Add nullable `organization_id` to `members`, `vehicles`, `groups`, `interventions`
and the child tables of §4.2; backfill every existing row to DVD
(`00000000-0000-4000-8000-000000000001`); set `not null`; swap the three unique
constraints. Add `attendance_intervals.credited_organization_id` (§6.3).

Authority is untouched. Nothing reads the new columns yet.

**Blocked on:** nothing — D10 and D11 settle it. D11 means this phase never
deletes a demo row to simplify the backfill; it backfills whatever is there.

**Acceptance criteria**

1. After migration, `select count(*) from <each table> where organization_id is
   null` is 0 for all of them, asserted per table.
2. Every row that existed before the migration still exists, with identical
   content, asserted by a checksum over the pre- and post-migration rowsets.
3. A test asserts two members with the same `user_id` in **different**
   organisations can now coexist, and that two in the **same** organisation still
   cannot. Fails against P1.
4. A test asserts two vehicles may share a callsign across organisations but not
   within one. Fails against P1.
5. The full existing DB suite passes untouched, at the same test count as the
   phase before it. A changed count means the migration changed behaviour.

---

### P3 — Per-organisation authority functions, with a DVD shim *(no policy change)*

Introduce `current_role_in(uuid)`, `is_staff_in(uuid)`, `is_command_in(uuid)`,
`is_admin_in(uuid)`, `is_installation_owner()`, `current_member_id_in(uuid)`,
reading `organization_memberships`.

Then **reimplement `current_dvd_role()` as a shim** over `current_role_in(DVD)`,
keeping its exact signature. All 51 policies keep working, unchanged, now resolving
through the new path. This is the phase that proves the two models are equivalent
before anything depends on it.

**Blocked on:** nothing — D9 settles it.

**Acceptance criteria**

1. An equivalence test: for every account in a fixture covering all six role values
   × active/suspended × profile-complete/incomplete, the shimmed
   `current_dvd_role()` returns exactly what the pre-P3 function returned. A single
   divergence fails the phase.
2. The full existing DB suite passes with **no test changes at all**. If a test
   needs editing, the shim is wrong.
3. A test asserts `is_command_in(SZS)` is true for an SZS COMMANDER and false for a
   DVD COMMANDER, and vice versa. Fails against P2.
4. A test asserts `is_installation_owner()` is true for the owner regardless of
   which organisations they belong to, including none.

---

### P4 — Rewrite the policies and call sites *(the large one)*

Rewrite all 51 policies and the 134 guard call sites onto the organisation-aware
functions — **as six PRs, one per table group**, not one.

Fifty-one policies in a single diff is not a reviewable change, and a mistake in
one group would force re-reviewing the other five. The split is safe because of
P3: the shim makes a single-service installation resolve identically through
either path, so the groups may land in any order and a bad one can be reverted on
its own without stranding the rest.

| PR | Tables | Policies |
|---|---|---|
| **P4a** — registry ✅ **done, `202609240024`–`202609240026`** | `members`, `groups`, `group_members`, `vehicles`, `member_availability`, `member_availability_history`, **`registry_audit`** *(moved here from P4f)* | 8 |
| **P4b** — interventions ✅ **done, `202609250027`–`202609250029`** | `interventions`, `intervention_recipients`, `intervention_updates`, `intervention_acknowledgements`, **`operational_audit`** *(moved here from P4f)*; **and the read side of all ten tables below, which its commands write** *(see "What P4b's commands write")* | 8 + 13 |
| **P4c** — responses and journey ⏳ **in review, `202609250030`** | `intervention_responses`, `intervention_response_revisions`, `intervention_journey`, `intervention_journey_history` — *reads and `set_journey_progress` service-scoped by P4b; `submit_response` now resolves its member in the call-out's service* | 7 |
| **P4d** — attendance ⏳ **in review, `202609250031`** | `attendance_intervals`, `attendance_corrections`, `attendance_correction_requests`, `vehicle_movements`, and `attendance_totals()` — *reads and every attendance/vehicle command service-scoped by P4b; the correction-request INSERT policy now asks the interval's own service, and what each row is about is settled at insert. Crediting across services stays Q5's* | 8 |
| **P4e** — notifications ⏳ **in review, `202609250032`** | `notification_outbox`, `notification_delivery_attempts`, **`web_push_subscriptions`'s self-read policy** *(moved here from P4f)*, **and the `send-web-push` Edge Function** — *reads already service-scoped by P4b; registration now asks any service, the worker's eligibility question is answered by `push_delivery_verdict()` in the call-out's service — only for a recipient of a call-out still running — the worker sweeps `push_delivery_queue()`, which no unwritable row can block, the wake-up asks command in the stored call-out's service, and what an alert is about is settled at insert* | 3 + 1 function |
| **P4f** — accounts and audit ⏳ **in review, `202609250033`** | ~~`operational_audit`~~ *(moved to P4b; its history rule is P4f's)*, ~~`registry_audit`~~ *(moved to P4a)*, `role_audit`, `account_status_audit`, `organization_membership_audit`, `organization_memberships`, `organizations`, `access_grants`, `profiles`, `citizen_reports`, `report_media`, `report_status_audit`, ~~`web_push_subscriptions`~~ *(its one policy moved to P4e)* — *reads needed no change (owner-level checks are the installation owner); audit history made append-only, truncate included, and the service role's writes on it withdrawn; citizen reports left with DVD pending an owner decision* | 16 |

**What P4a established, and the later five inherit.** Rewriting the policies
closes only the READ path. Every one of these tables is `enable row level
security` WITHOUT `force row level security`, and the commands that write them
are `security definer` owned by `postgres` — which bypasses those policies
entirely. P4a therefore also had to rewrite all thirteen registry writers, and
each of P4b–f has to audit its own group's `security definer` functions the
same way. The pattern P4a settled on:

- an **edit** derives its service from the STORED row and takes no service
  parameter, so there is nothing to forge;
- a **create** must be told its service, so it gains a separate `*_in` command
  and the original becomes a DVD wrapper — the existing signature is never
  changed, because an added defaulted parameter makes every current call
  ambiguous against the old one that `202609130006a` can replay;
- `ADMIN_REQUIRED` still means "you administer nothing" and is checked BEFORE
  any row is read, so ids cannot be probed; `ORGANIZATION_MISMATCH` means "you
  administer a different service than this row".

**`registry_audit` moved from P4f to P4a**, and the reason generalises. Its one
policy read `is_dvd_admin()` with no service filter and the table had no
`organization_id` — harmless while only DVD could write, and a leak the moment
P4a gave SZS its own writers, because `detail` carries the member's name.
Measured on a schema at `202609240024`: an SZS ADMIN created `Tajni Clan SZS`
and a DVD ADMIN read the name straight out of the audit trail, while the SZS
ADMIN who wrote the row read nothing at all.

So: **a boundary is closed by the phase that opens it, not by the phase that
happens to own the table.** P4b–f each need to ask which audit and history
tables their own new writers start filling, rather than assuming the table's
listed phase will get there in time. The service on an audit row is derived
from the entity it is about by a trigger, never supplied by the writer — the
writers are `security definer`, so a column they filled in would be a claim
rather than a fact.

**And deriving it on INSERT is not the whole invariant.** `202609240025` did
that, and guarded only `organization_id` on UPDATE — so an existing DVD row
could be repointed at an SZS member by changing `entity_id`, keeping its DVD
label while resolving into the other service. Freezing the two entity columns
would have closed that and left `detail` rewritable (falsifying the recorded
name) and `changed_by` rewritable (blaming the wrong person), which are worse.
`202609240026` therefore makes `registry_audit` append-only **as a database
rule** rather than only by privilege, which is what its own comment had claimed
since the table was created. Every audit and history table P4b–f touches should
be read the same way: *which columns decide what this row means, and is every
one of them settled at insert?*

**What P4b added to the pattern.** Two things P4a's shape did not cover:

- **Recipient selection is half of publication.** `is_eligible_recipient` and
  `eligible_recipients` asked `access_grants.role`, which since P3 carries DVD's
  role only — an SZS member's grant reads `CITIZEN`, because anything else is
  mirrored into an active DVD membership. So SZS could not have published a
  call-out to anybody. Both gained `*_in(service)` forms; the old signatures are
  DVD wrappers.
- **"Shares a service with me" is not "may receive this call-out".**
  `serves_with(member)` is caller-relative, and is true of *both* services for
  somebody who serves in both — so a commander of two services could have sent
  one service's call-out to the other's members. The question now asks the
  service running the call-out.
- **…but who may ASK is still a question.** `202609250027` moved the question
  to the service and dropped P0's caller bound with it, so any signed-in
  account — a citizen included — could ask whether a given member of either
  service was active and serving. `202609250029` answers only somebody who is
  staff in the service asked about. Replacing a bound is not the same as
  removing one; check that the old question's *other* job survived.

**A phase must also guard the commands it points at.** P4b's own four tables
were not the whole surface: `attendance_check_in`, `set_journey_progress` and
`record_vehicle_departure` write rows that hang off an intervention, are
`security definer`, and asked only `is_dvd_staff()`. Making SZS call-outs
possible made all three reachable across services — a DVD member checked in on
an SZS call-out, a DVD member's journey row written onto one, a DVD vehicle
sent to one. `202609250028` gives each the same two questions: is the caller
staff **in that call-out's service**, and does the row being written belong
there too. The tables themselves stay P4c's and P4d's.

`submit_response` was the near miss, and it is worth knowing why it held: it
looks its recipient up **inline against the member it is about to write**
rather than calling `is_recipient_of`, so the two can never disagree. Every
later phase should prefer that shape.

**What P4b's commands write — derived, not listed.** Twice review found P4b's
hand-made list of affected tables short. `202609250029` was built the other
way: every table reachable from `interventions` by foreign key (fifteen), every
policy on them, every function whose body names one, every trigger that labels
their rows with a service. It closed:

- **thirteen read policies on ten tables** P4b's commands write —
  `notification_outbox`, `notification_delivery_attempts`,
  `intervention_journey`(`_history`), `attendance_intervals`,
  `attendance_corrections`, `attendance_correction_requests`,
  `vehicle_movements`, `intervention_responses`(`_revisions`) — all of which a
  DVD-only commander could read SZS rows from. The full workflows stay in P4c–e
  (table above); only "may you see or touch this row" moved;
- **eight commands** that act on those rows by id and asked only
  `is_dvd_command()` / `is_dvd_staff()` — confirm, reject, unconfirm, correct,
  confirm-many, check-out, vehicle return — plus `attendance_check_in`, whose
  `requested_vehicle` went in unchecked, so an SZS interval could name a DVD
  vehicle;
- **two `security definer` readers no policy reaches**: `intervention_audit`,
  which returned an SZS call-out's whole chronology to a DVD commander, and
  `is_eligible_recipient_in` (above);
- **a DVD fallback**: `operational_audit` labels a row with no call-out DVD
  (`dvd-if-orphaned`). Once SZS could send its own vehicle out, that filed SZS
  vehicle movements under DVD. The two vehicle commands now name the vehicle's
  service.

`organisation_interventions.test.ts` re-derives the same list from the catalogue
and asserts which DVD-only questions survive on it — after P4b, `submit_response`
(P4c) and the correction-request INSERT policy (P4d), both failing closed; after
P4d, none — so a table or command added later is caught by construction.
A DVD-only check cannot see a function that asks *nothing*, which is what
`is_eligible_recipient_in` was; so it also asserts, installation-wide, that
every client-callable `security definer` function asks about its caller or is a
one-line DVD wrapper around one that does. It first applies every migration that
sorts after 029, so a later file that reopens any of this fails there.

Two consequences worth knowing. `attendance_totals()` is caller-rights and joins
`members`, so P4a's `members` policy already bounded it; 029's policy is a
second, independent bound, and the test pins it as NOT `security definer`
because that would remove both at once. And `202609230021` — a "restore exact
text" file — now has a **load-bearing position**, as `202609130006a` does: it
re-creates `intervention_audit` at its DVD-only text, so replayed after 029 it
would reopen that leak. `restore_exact_function_text.test.ts` asserts both the
ordering and the consequence.

**What P4c did, and why it is one function.** Of the four P4c tables, P4b had
already scoped every read and `set_journey_progress`; the catalogue names only
two functions that write them. `submit_response` resolved its caller through the
DVD shim, so an SZS recipient was refused their own call-out and a dual-service
one was checked as their DVD record. `202609250030` resolves the member in the
service read from the stored call-out — an unknown id judged as DVD's, as
before — and checks and writes that same member, keeping the inline recipient
lookup that made the old version fail closed. For DVD the member resolved is
the shim's, so every DVD refusal and its order is unchanged; section 13's gate
re-measures that on the production copy. An answer writes its response and its
revision and nothing else, so no further table became reachable.

**What P4d did.** The one direct write a member may make — asking for their own
attendance to be corrected — checked the interval against the DVD shim, so an
SZS member was refused and a dual-service member only had their DVD record.
`202609250031` asks for the caller's member in the service of the stored
interval, and requires the request to be what a request is: OPEN, with no
decision on it, dated by the server (a DVD member could previously file one
already "decided" by a commander, a month back — gate difference E4). It also
settles what each row is about at insert, as the P4a rule asks: an interval's
call-out, member and credited service; a correction (append-only); a request's
interval, author, time and message. `vehicle_movements` keeps P2's rules — a
movement belongs to its vehicle and may be moved within that service. Crediting
stays exactly as it is: every interval credited to the service whose call-out it
was, now fixed once written; whether that may ever differ is Q5's. No command
resolves a correction request (none ever did), and the four tables' reads and
every attendance command were already P4b's.

**Reviewed after P4c: what a call-out id tells somebody who cannot read it.**
`submit_response` reads the stored call-out's service before resolving the
member, so a caller holding a DVD record gets `MEMBER_RECORD_REQUIRED` for an
SZS call-out and `INTERVENTION_NOT_FOUND` for an id that matches nothing — one
bit: "another service has a call-out with this id". Measured at `202609250030`
for every command that takes a call-out id (`db-tests/response_service.test.ts`):

- the same bit reaches the same caller through `set_journey_progress`,
  `acknowledge_intervention`, `attendance_check_in`/`_check_out` and
  `record_vehicle_departure` (`STAFF_REQUIRED`), and a commander through the
  draft, publish and status commands (`ORGANIZATION_MISMATCH`) — the
  convention P4a set down on purpose: a caller with no standing learns nothing,
  a caller with standing may learn that an id belongs to another service;
- an SZS member can learn the same about a DVD id through those P4b commands;
- nobody without standing (citizen, suspended, half-registered, the owner
  without a member record) learns anything from any of them;
- P4c **narrowed** it: before, `submit_response` also said whether the other
  service's call-out was open, closed or a draft.

Ids are random UUIDs and every read path to them is service-scoped (section
13's grid), so the bit is only available about an id obtained out of band. It
was therefore pinned, not changed. **Open, and not one of Q1–Q8:** whether a
call-out of another service should be indistinguishable from no call-out. If
yes, it is one change to every command at once, with a catalogue test asserting
the uniform refusal — hiding it in one function would leave the bit in five.

**A permission the owner loses, deliberately.** The installation owner could
publish one call-out to members of both services. That is a joint intervention,
which Q1–Q8 have not been answered for. The owner keeps both services and may
run a call-out in each; what is gone is mixing them into one recipient list.
`recipient_organisation_scope.test.ts` records the change where it was asserted.

**P4e carries a hazard the others do not.** The push worker reads `members`,
`interventions` and `intervention_acknowledgements` with the **service-role
client, which bypasses RLS entirely**. It inherits nothing from P4a–d: the
organisation filter has to be written into those queries by hand, or the worker
keeps delivering across services after every policy above it is correct.

**What P4e did.** Measured on a schema at `202609250031` and the worker at
`58e2776`: an SZS-only member who may be called out could not register a device
(`register_web_push_subscription` asked `current_dvd_role()`) nor read their own
device list; the worker decided "still eligible" from the account's grant —
DVD's role — so an SZS-only member was refused every alert, a member withdrawn
from SZS but still in DVD was alerted for SZS, and a queued row naming another
service's member was sent like any other; the immediate wake-up asked
`current_dvd_role()` and never looked at the call-out, so a DVD commander could
wake an SZS call-out's delivery and an SZS commander not their own.
`202609250032` and the worker change:

- registration asks for standing in any service, then for a member record the
  account may be called out as **in that record's own service**
  (`is_eligible_recipient_in`). A device belongs to the account — one device for
  somebody serving in both, reached as whichever member each call-out was sent
  to. The self-read policy asks `is_staff_anywhere()`. DVD's answers are the
  same by construction and measured unchanged on the production copy;
- the worker puts one question to the database per queued alert,
  `push_delivery_verdict(outbox)` — service role only, caller-rights — answered
  from the STORED alert, call-out, recipient list and member: `SERVICE_MISMATCH`
  unless all three are in one service, `NOT_A_RECIPIENT`, `OPENED`,
  `CALLOUT_NOT_OPEN`, `INELIGIBLE`, or `DELIVER` with the account whose devices
  to use (the second and fourth were added in review, below). Eligibility is `is_eligible_recipient_in`'s
  conditions for the call-out's service, repeated because the service role has
  no user for that function's caller bound; the tests hold the two to agree. A
  mismatched alert is set aside (`delivery_close_reason = 'SERVICE_MISMATCH'`),
  unsent and without an attempt;
- the wake-up reads the call-out's service from the stored call-out with the
  service client and asks the caller `is_command_in()` for it; an id that
  matches nothing is refused exactly like another service's;
- what an alert is about — call-out, member, channel, dedupe key, time queued —
  is fixed once written (`OUTBOX_IDENTITY_FIXED`), and a delivery attempt is
  never updated (`DELIVERY_HISTORY_APPEND_ONLY`); deleting a call-out still takes
  both with it.

The worker's queries moved from `index.ts` into `deliver.ts` so they can be run
as written: `db-tests/push_service.test.ts` drives them as the service role
against real rows through a PostgREST stand-in, with a push service that records
and sends nothing — delivery, the one repeat, the claim race between two
workers, device revocation and the locked-screen payload included. Two things
it found that no policy test could: a row whose stored label contradicts its
call-out cannot be updated at all (P2's trigger refuses any UPDATE of it), so the
worker cannot set it aside; and P4d's own replay check ordered its hash by a
constant, which a later migration's triggers reordered — fixed.

**What review of the first P4e draft (`3ac2717`) added.** Three gaps, each
shown by a test that failed against that draft before it was fixed — the tests
are in `db-tests/push_service.test.ts`:

- *Recipients.* The verdict never asked whether the member was on the
  call-out's frozen recipient list; `notification_outbox` has one foreign key to
  the call-out and another to the member, and nothing ties the pair. A
  hand-written alert for an eligible member of the right service who was never
  sent the call-out was `DELIVER`ed, and the recording fake received it. Now
  `NOT_A_RECIPIENT`, from `intervention_recipients` in the alert's service, and
  set aside unsent.
- *Ended call-outs.* The verdict never read the call-out's status, and
  `close_intervention` touches nothing queued: an alert still waiting — a first
  attempt whose wake-up failed, or the repeat — went out after the call-out was
  closed or cancelled, on the scheduler and on a commander's wake-up alike. Now
  `CALLOUT_NOT_OPEN` unless the call-out is `PUBLISHED`, `ASSEMBLING`,
  `DEPLOYED` or `CONTAINED`, and set aside unsent. An alert the member has
  already opened is still closed `MEMBER_OPENED`, as before. This changes DVD
  behaviour on purpose — see E5 under "Re-run with P4e".
- *Starvation.* The worker sweeps the fifty oldest open alerts. With fifty
  mislabelled rows at the front — which it can neither send nor close — no valid
  alert behind them was ever reached, on the scheduler or on a wake-up. The
  sweep is now `push_delivery_queue()`, which does not hand out a row whose
  stored service contradicts its call-out's; those rows stay exactly as they
  are, unsent, and `push_delivery_mislabelled()` counts them so the worker
  reports them on every run (`mislabelled` in its reply, a warning in its log).
  P2's rule is untouched: the rows still refuse every update.

**What P4f did, and what it left.** Catalogued at `202609250032` before any
change:

- **Reads needed nothing.** Every account-table policy that is not "your own
  row" asks `is_dvd_owner()` or `current_dvd_role() = 'OWNER'`, and both are the
  installation owner by definition: `current_role_in()` answers OWNER for the
  owner in every service and for nobody else. `db-tests/audit_history.test.ts`
  asserts the equivalence with the owner active, suspended, half-registered and
  with DVD stood down, and that every account reads exactly what it read
  before. An ADMIN of either service reads its own grant, profile and
  memberships and nothing else — D9's ADMIN powers are the registry's, which
  P4a scoped and `organisation_registry.test.ts` asserts in both directions.
- **History was append-only by privilege only.** A superuser session or the
  service role could rewrite who changed a role, why an account was suspended,
  what a citizen-report review decided or which call-out an event was about, or
  delete them; P4a's and P4d's append-only rules stopped at TRUNCATE, which
  fires no row trigger (`202609240026` said so); and the service role could
  write an `operational_audit` row with no call-out claiming either service —
  the gap `organisation_columns.test.ts` pinned for P4 to close.
  `202609250033` makes `role_audit`, `account_status_audit`,
  `organization_membership_audit`, `report_status_audit` and
  `operational_audit` refuse UPDATE and DELETE (`AUDIT_APPEND_ONLY`), refuses
  TRUNCATE on those and on `registry_audit` and `attendance_corrections`, and
  withdraws every service-role write on all seven — nothing the service role
  runs writes history. The one change `operational_audit` still accepts is its
  own foreign keys' `ON DELETE SET NULL` when a call-out or account is deleted:
  it arrives nested inside the referential trigger and only clears links, so the
  row keeps its service, wording and time. A superuser can still disable a
  trigger; rewriting history is now a deliberate act, as `202609220017` said of
  its own step.
- **Citizen reports are left with DVD — an open decision, not one of Q1–Q8.**
  `citizen_reports`, `report_media`, `report_status_audit` and `review_report()`
  answer DVD staff and DVD command, and the rows carry no service. Whether
  citizen reports exist at all and who reviews them is recorded as open in
  `docs/PRODUCTION_ARCHITECTURE.md` and `docs/MEETING_DECISIONS.md`; scoping
  them to a service would be answering it. Nothing crosses a service boundary
  meanwhile: an SZS-only account reads none of them and they hold no SZS data.
  **So P4f acceptance criterion 5 cannot close yet**: `is_dvd_staff()` and a
  `current_dvd_role()` check survive in exactly those four places, pinned by the
  catalogue test with the reason, alongside the shims themselves, the
  owner-level functions and policies, and `serves_with()` (no caller since P4b).
- **Three more history tables are not append-only yet — a separate reviewed
  follow-up, not part of P4f.** `member_availability_history`,
  `intervention_journey_history` and `intervention_response_revisions` (P4a/P4c
  tables) are written only by INSERT, by `set_own_availability_in`,
  `set_journey_progress` and `submit_response`; no function updates or deletes
  them or deletes their parents. The service role holds every privilege on
  them, and measured on the merged P4f tree it can rewrite, delete and forge
  their rows. The first two sit under RESTRICT foreign keys only, so a strict
  refuse-UPDATE/DELETE/TRUNCATE rule breaks nothing. Revisions go with their
  response through `ON DELETE CASCADE` — today a call-out with answers and no
  journey progress can still be deleted by hand, taking its answer history
  with it — so their rule must refuse DELETE except when the response is already
  gone (the cascade). That is prototyped on a scratch copy: direct changes are
  refused, both cascades still work, the commands still write. The follow-up
  should also withdraw the service role's writes on all three. Whether deleting
  a call-out should remove answer history at all is an owner question the rule
  does not need.

**Not decided by P4e:** delivering one service's call-out to another service's
member (a joint call-out) and one alert per person across services — Q1–Q5,
P7. Until then a member of another service on a call-out is a mismatch; P7 has
to replace that rule, not work around it. Two call-outs, one per service, are two
alerts to the same device. The `dvd-` push topic prefix is P8's. The interface is
P6's: the client still gates operational screens on `current_dvd_role()`, so an
SZS-only account can register a device at the database but is not yet offered
the screen that does it.

**Blocked on:** nothing — D9 settles it.

**Acceptance criteria, per PR**

1. For each table in that PR's group, a test asserts a COMMANDER of service A
   **cannot** read a row belonging to service B. One assertion per table, each
   failing against the phase before it.
2. A test asserts the DVD fixture's visible rows are **identical** before and
   after — a single-service installation sees no change whatsoever.
3. The full existing suite passes at the same test count, plus that PR's new
   tests.

**Acceptance criteria, on P4f as the last of the six**

4. A test asserts an SZS staff member reading `members` sees only SZS members,
   and `attendance_totals()` called by them returns only SZS people.
5. `grep` asserts zero remaining references to
   `is_dvd_staff|is_dvd_command|is_dvd_admin` in `supabase/migrations/` beyond
   the historical files.
6. A test asserts a DVD `ADMIN` still holds every registry power it holds today,
   scoped to DVD (D9), and holds none over SZS.
7. Full browser suite green; no screen loses data for a DVD user.

---

### P5 — Retire the mirror

Drop `sync_dvd_membership_after_grant` and `sync_dvd_membership_from_grant()`.
Reduce `access_grants` to `active` + `OWNER`. Remove the DVD mirror block from
`owner_set_organization_membership`. Rename `NO_DVD_ROLE` → `NO_SERVICE_ROLE`
through the client.

After this phase, membership is the only statement of authority and there is no
second copy to disagree with it.

**Blocked on:** nothing — D9 settles it.

**Acceptance criteria**

1. A test asserts changing `access_grants.role` no longer changes anybody's
   operational access. Fails against P4.
2. A test asserts suspending an account (`access_grants.active = false`) still
   removes access in **both** organisations at once. Must pass.
3. A test asserts the owner keeps `OWNER` and full access with zero membership rows.
4. The audit-trigger tripwires added in `202609220017` still fire — the assertions
   in `owner_set_role` and `owner_set_organization_membership` must be carried
   through the rewrite, not dropped with it.

---

### P6 — SZS runs its own workflow

Per-organisation registry admin (members, groups, vehicles), an organisation
context in the client, SZS command console and SZS archive. SZS can publish, be
answered, record attendance and close — with no reference to DVD.

**Blocked on:** Q5, Q6, Q7, Q8.

**Acceptance criteria**

1. A browser test drives a full SZS call-out end to end — publish, respond,
   check in, confirm, close, archive — with no DVD account involved.
2. A test asserts an SZS commander's archive contains their intervention and
   **no** DVD intervention.
3. A test asserts a DVD firefighter's screens are byte-identical to P5's for the
   same fixture.
4. A test asserts an SZS-only account can read its own `web_push_subscriptions`
   row and register a subscription — the specific thing that is impossible today.
   *The database half is P4e's and done (`db-tests/push_service.test.ts`); what
   remains here is the screen that offers it.*

---

### P7 — Cross-organisation alerting

§6. `intervention_recipient_organizations`, the additional-recipient control in the
SZS publish flow, `user_id` dedupe in the outbox, and the joint-intervention
visibility rules that Q3/Q4 decide.

**Blocked on:** Q1, Q2, Q3, Q4, Q5, Q8.

**Acceptance criteria**

1. A test asserts an SZS call-out ticking DVD produces a recipient row for every
   eligible DVD member and exactly one outbox row per **person** per channel —
   including for a person who is a member of both services. Fails against P6.
2. A test asserts a DVD member receiving a joint call-out sees it on the same
   screen, with the same response options, as a DVD call-out (D5, literally).
3. A test asserts a DVD commander **not** added to a joint intervention cannot read
   it.
4. A test asserts SZS still cannot read DVD's roster, availability, or any
   intervention DVD was not added to — the P4 assertions re-run with joint
   interventions present.
5. Whatever Q3/Q4/Q5 decide, one test per decision asserting the decided behaviour
   and one asserting the rejected alternative does **not** happen.

---

### P8 — Naming and branding cleanup

`SOCIETY_PROFILE` becomes per-organisation configuration; `index.html` and
`manifest.webmanifest` descriptions stop naming DVD Tivat; storage keys
(`dvd-tivat.callout-draft`, `dvd-tivat-prototip:v2`) and the push topic prefix
`dvd-` are renamed. The app title is already neutral ("Boka Operativa") and does
not change.

**Acceptance criteria**

1. A test asserts a person in both organisations does not share one call-out draft
   slot between them. Fails against P7.
2. `grep` asserts no user-visible string hardcodes "DVD Tivat" outside the
   `organizations` row and the i18n label.
3. A storage-migration test asserts an existing device's draft survives the key
   rename.

---

## 9. Migration path for today's production data

Today: 9 accounts (1 real), 7 member records, 6 DVD memberships, 0 SZS
memberships, ~200 rows across 33 tables. One OWNER, with no membership row and no
member record.

| Concern | Handling |
|---|---|
| Existing accounts | Untouched. Their `access_grants.role` keeps working through P4 because of the P3 shim, and their DVD membership rows already exist and already agree. |
| Existing members, vehicles, groups, interventions and history | Backfilled to DVD in P2. No row is deleted, rewritten or re-keyed. |
| The owner | Keeps `access_grants.role = 'OWNER'`. Whether they also get DVD and/or SZS membership is Q9. They currently have neither a membership nor a member record — unchanged by this plan, and still blocking the push test tracked separately. |
| Demo data | Out of scope here. It has its own inventory (`docs/DEMO_DATA_INVENTORY.md`) and its own approved, not-yet-executed cleanup. Q11 only asks whether to sequence the two. |
| Rollback | P0–P3 are individually revertible. P4 is the point of no return for the policy layer; it ships only after P3's equivalence test has been green on a restored copy of production, not only on fixtures. |

**What gets renamed, in one list:** `organisation_audit` → `registry_audit`;
`OrganisationView` → `RegistryView`; `t.organisation.*` → `t.registry.*`;
`current_dvd_role` → `current_role_in`; `is_dvd_staff/command/admin` →
`is_staff_in/is_command_in/is_admin_in`; `is_dvd_owner` → `is_installation_owner`;
`current_member_id` → `current_member_id_in`; `NO_DVD_ROLE` → `NO_SERVICE_ROLE`;
`SOCIETY_PROFILE` → per-organisation configuration; the two storage keys and the
push topic prefix. Applied migration **filenames** are never renamed.

---

## 10. Out of scope

- **A third organisation.** The model generalises, but nothing will be built or
  tested for N > 2 until somebody asks.
- **Separate Supabase projects per organisation.** One project, one database, RLS
  as the boundary. Splitting projects would mean no joint interventions at all.
- **Organisation-level billing, quotas or separate branding/theming.**
- **Cross-municipality use.** Both organisations are in Tivat; nothing assumes a
  geography beyond that, and nothing will be generalised for it.
- **The abandoned citizen-reporting feature.** It stays abandoned and stays
  DVD-shaped; it is not part of either service's workflow.
- **Native mobile.** Unchanged: PWA only.
- **The demo-data cleanup** and **the end-to-end push test**, both tracked
  separately and both still blocked on the owner.
- **Any change to what a role *means* within one organisation.** ADMIN, COMMANDER
  and FIREFIGHTER keep exactly the powers they have today; only the scope they
  apply to changes.

---

## 11. What has to happen before implementation starts

1. ~~The owner answers Q9, Q10 and Q11.~~ **Done, 2026-09-23 — D9, D10, D11.**
   Q1–Q8 remain open and block P6 and P7 only.
2. ~~P0 ships on its own, ahead of the schema phases.~~ **Done — merged as #47,
   migration `202609230018`.** Not applied to production.
3. ~~P3's equivalence test is run against a **restored copy of production**,
   not only against fixtures, before P4a is written.~~ **Done, 2026-09-24 —
   the gate passed. P4a is unblocked.** See "The P3 equivalence gate" below.
4. Each phase's migration is applied to production on its own approval. Nothing
   in this plan applies a migration as a side effect of merging a PR: the tree
   already carries two unapplied migrations (`202609220017`, `202609230018`),
   and that separation is deliberate.

---

## 12. The P3 equivalence gate

Run 2026-09-24 against an isolated local copy of the hosted project's
authority-relevant state. `scripts/p3-equivalence-gate.mjs` is the gate;
`scripts/p3-equivalence-export.sql` produces its input over a read-only path
and says exactly which columns it reads. **Production was not written to, and
no migration was applied to it.**

### What it found

| | |
|---|---|
| Accounts compared | 9 |
| With a role before P3 | 2 |
| With a role after P3 | 2 |
| **Divergences** | **0** |
| Migrations applied to the copy | `202609240022`, then `202609240023` |

The copy was built by applying the 22 migrations production has, verifying
`current_dvd_role()` and `current_member_id()` were **byte-identical** to the
hosted ones, then loading the exported rows with triggers suppressed — a copy,
not a re-enactment — and confirming it reproduced production's own answers for
all 9 accounts before anything was applied. Both cases the phase exists to
protect were present in the real data and survived: the installation owner
holding no organisation membership, and a suspended account whose DVD
membership is still active because the mirror never fires on `active`.

### What it does not prove

Seven of the nine accounts resolve to NULL both before and after, so they would
pass under almost any implementation. The gate's weight is in the four
supporting checks, not in the count:

- the copy reproduces production exactly before the comparison begins;
- both migrations apply cleanly, in order, to real production state;
- three negative controls fail the comparison when the equivalence is broken
  on purpose, including one that confirms the owner is unaffected by
  memberships and one that confirms a membership-only shim really would return
  NULL for the owner — the lockout `202609240023`'s header describes, now
  measured against the real installation rather than argued;
- breadth comes from `db-tests/organisation_authority.test.ts`, whose
  twenty-six constructed states cover the combinations production does not
  currently contain.

### A finding worth acting on separately

Five accounts hold an active operational grant (`FIREFIGHTER`, `COMMANDER`,
`ADMIN`) but have **no operational access today**, because their profile was
never completed and `current_dvd_role()` requires `profile_complete`. This is
existing behaviour, unchanged by P2 or P3 and unrelated to this gate — but it
means the live installation currently has two usable accounts, not seven.
Worth confirming with the owner that this is understood rather than a surprise.

### Re-running it

The export is production-derived and is **not kept in the repository**. To
re-run: execute `scripts/p3-equivalence-export.sql` over a read-only path, save
its output plus the two blocks documented at the bottom of that file as a
`.json` outside the tree, then `npm run gate:p3 -- <path>`. The gate exits `2`
rather than `0` when it cannot run, so a missing export never reads as a pass.

## 13. The P4a/P4b equivalence gate

Run 2026-09-25, before P4c, against an isolated local copy of the hosted
project. `scripts/p4-equivalence-gate.mjs` is the gate (`npm run gate:p4`);
`scripts/p4-equivalence-production.sql` is the one read-only batch it needs
from production, and says exactly what it reads. **Production was not written
to, no migration was applied to it, and `hosted_operations.test.ts` was not run
against it.** Every production query ran in a transaction that reported
`transaction_read_only = on`.

The P3 gate asked what two functions answer. P4a and P4b rewrote the policies
and commands over the registry, call-outs, what a call-out produces and its
history, so this one asks what every real account can **read** — every row key
of all 33 public tables, and every reader function — and what it can **do**:
every command a signed-in client can call, as every account, against real rows,
with the outcome *and* the effect on every table.

### What it found

| | |
|---|---|
| Production | 22 migrations, through `202609230021`; `202609240022`–`202609250029` under test |
| Copy fidelity, before anything was compared | schema fingerprint 7/7 categories (60 functions, 51 policies, 186 constraints, 63 indexes, 254 columns, 33 tables, 4 triggers); rows 32/32 tables; reads 621/621 facts over 9 accounts; 65 foreign keys, 0 orphans |
| Reads, before vs after | 621 facts; **0 divergences**; 5 expected (E1) |
| Commands, before vs after | 42 commands × 9 accounts (45 succeed) + 50 steps of a live call-out; **0 divergences**; 1 expected (E2) |
| The same with every profile completed | 621 facts, 378 probes (79 succeed), 132 steps; **0 divergences**; 4 + 4 expected (E1, E2) |
| SZS-only and dual-service, added to the migrated copy | 61 steps and postconditions as expected; mixing refused both ways (E3); real accounts' 621 facts about existing rows unchanged by SZS data; 14 accounts × 24 service-owned tables, no cross-service read; every DVD command unchanged with SZS data present |
| Negative controls | a one-second change to one attendance row, `is_recipient_of()` answering yes to everybody, `submit_response()` accepting a non-recipient: each caught |
| Production unchanged at the end | same migrations, same 32 table digests as at the export |

**The copy was proven before it was used.** It is built from the harness
migration list up to production's boundary, the capture's rows are loaded with
triggers suppressed — a copy of the stored state, not a re-enactment — and the
same batch that captured production is run against it. The gate refuses to
compare anything unless the schema fingerprint, every table's rows and every
account's answers come back identical to production's.

**Why the second pass exists.** Production has two accounts that can act today —
the owner, who holds no membership, and one firefighter. The commander, the
admin and two firefighters never completed registration (section 12's finding,
unchanged). So the gate repeats everything with those profiles completed through
`complete_own_profile()`, as each account: the near-future production in which
membership-derived authority is exercised on the real roster and history. That
pass is what drives the real commander and admin through a whole call-out.

### The three expected differences

- **E1 — `is_eligible_recipient()` answers only a caller who is staff in the
  service** (`202609250029`). P0 answered anybody who served with the member,
  so an account with an active DVD membership but no operational access —
  profile incomplete, or suspended — was told `true`. Five such accounts on
  production today; the suspended one only, once profiles are complete. The
  client never calls it; publication and web-push registration refuse such an
  account before asking.
- **E2 — `set_own_availability()` returns null instead of an empty void**
  (`202609240024`). It became a one-line SQL wrapper over
  `set_own_availability_in()`; a plpgsql `void` yields an empty value and a SQL
  one yields null. The effect is identical row for row, and the client's
  `command()` reads only `error`.
- **E4 — a correction request cannot arrive already decided**
  (`202609250031`). The requester could fill `resolved_by`, `resolved_at`,
  `resolution_note` and `requested_at`; now the server dates it and a
  commander decides it. The same request as any client sends it is unchanged.
- **E3 — one call-out can no longer name members of two services**
  (`202609250027`). The installation owner could do this before; the owner
  keeps both services and may run a call-out in each. Only reachable with SZS
  data, so it is asserted in the SZS pass, in both directions:
  `ORGANIZATION_MISMATCH`. Joint interventions are P7's, once Q1–Q8 are
  answered.

### What it found that P4c has to fix

On the production-derived copy, exactly as on the fixtures: an SZS recipient
answering their own call-out gets `MEMBER_RECORD_REQUIRED`, and a dual-service
recipient gets `NOT_A_RECIPIENT`, because `submit_response()` resolves the
caller through the DVD shim. It fails closed and writes nothing. The gate
already states what P4c must change these to (`scripts/p4-gate/szs.mjs`), so the
same run grades P4c when it lands.

### What it does not prove

- **Commands were measured on the copy, never on production** — they write. The
  copy is only as good as the four fidelity checks above; they are why the
  command results are evidence.
- **PostgreSQL 16 locally, 17 hosted**, and a local stand-in for Supabase's
  `auth` schema. The fingerprint normalises the one catalogue difference that
  showed (PG17's `MAINTAIN` privilege letter); reads through RLS were compared
  directly against production's own answers.
- **PostgREST is not in the loop.** E2 is exactly the kind of difference that
  only matters at that layer, which is why the client code was checked for it.
- **Text is synthetic.** The capture carries only whether a name, note or
  location was present, so validation that depends on a text value is
  exercised on synthetic values.
- **The SZS side is synthetic by construction** — production has no SZS
  members, call-outs or SZS-only accounts yet. It is built through the real
  commands, by the real owner.
- **Delivery is not exercised**: the push worker runs with the service role and
  bypasses RLS (P4e's hazard above), and Realtime is not driven. Both read
  tables whose policies this gate did compare. Since P4e the worker's DECISION
  is compared (step 8b) — nothing is sent, and the worker's own queries are
  exercised by `db-tests/push_service.test.ts`, not here.

### Re-running it

The capture is production-derived and is **not kept in the repository**. Run
`scripts/p4-equivalence-production.sql` as one batch over a read-only path, save
the returned row as a `*.production-export.json` outside the tree (`.gitignore`
covers the suffix, as a backstop), then `npm run gate:p4 -- <path>`. With the
local server running (`npm run db:start`) it takes about ninety seconds. It
exits `2`, not `0`, when it cannot run — no capture, no local server, or a copy
that does not reproduce production — so a missing input never reads as a pass.

### Re-run with P4c

With `202609250030` added, the same capture and the same command: **passed**.
Every DVD read and every DVD command on the production copy is unchanged —
the same E1 and E2 and nothing else, across 621 facts, 378 probes and the live
call-out in both passes, `submit_response` for every real account included.
On the SZS side the steps the gate had already written down for P4c now hold:
an SZS recipient answers, repeats without a new revision and revises; a
dual-service recipient answers each call-out as that service's member; the
stored answers and revisions carry the SZS member and the SZS label; a DVD-only
account answering an SZS call-out gets `MEMBER_RECORD_REQUIRED`, and an SZS
member it was not sent to gets `NOT_A_RECIPIENT`.

What P4c does **not** reach is the screen. The client finds "my member" through
`current_member_id()`, which is DVD's, so an SZS-only account is held at the
operational gate and a dual-service account is not shown as a recipient of an
SZS call-out. The database path is open; offering it in the interface is P6's.

### Re-run with P4d

With `202609250031` added: **passed**. The matrix gained the correction
request — as a client sends it and pre-filled with a decision — for every real
account, and a correction step in the live call-out: 396 probes and 51 steps,
135 with profiles completed. Every DVD read and command is unchanged except E4,
for the one account with attendance (the real firefighter): the pre-filled
request is now refused, the client-shaped one still accepted. On the SZS side an
SZS member now files a correction to their own attendance; a DVD member and the
SZS commander still cannot file one for it.

### Re-run with P4e

With `202609250032` added: **passed**, with the same E1, E2 and E4 and no new
difference — registering, re-registering and revoking a device answer every
real account exactly as before (no production account holds operational
standing outside DVD). A new step, 8b, compares the push worker's decision: the
rule it applied in TypeScript before P4e, as SQL, against
`push_delivery_verdict()`, for every queued alert on the copy and for a new DVD
alert to every one of its members — 9 alerts as production is (2 deliverable),
9 with profiles completed (5 deliverable), 0 differences; a verdict sabotaged to
refuse everybody is reported.

After review added the recipient and call-out-status checks, the same run is
**no longer "0 differences"**, and says so. One expected difference is named:

- **E5** — an alert the member has not opened, on a call-out that is no longer
  running, is `CALLOUT_NOT_OPEN`: set aside unsent. Before, the worker judged it
  as if the call-out were running — `DELIVER` sent it, `INELIGIBLE` recorded an
  `ACCESS_REVOKED` attempt.

On the copy: of the 2 real Web Push alerts, 1 is `OPENED` (unchanged) and 1 —
on a `CLOSED` call-out — was `DELIVER` and is now `CALLOUT_NOT_OPEN`. It is not
due (the worker would not take it up again either way), so no pending alarm
changes; what changes is that one could no longer be produced. A new alert per
member on a running DVD call-out: 7 alerts (6 `INELIGIBLE`, 1 `DELIVER`; 3 and 4
with profiles completed), 0 differences. The same members on a DVD call-out
closed before any worker reached it: 7 of 7 set aside (E5), and nothing else.
`NOT_A_RECIPIENT` appears nowhere: every real alert was written by
`publish_intervention` with its recipient. A second negative control — a
verdict that treats a running call-out as ended — is reported as a divergence,
not excused as E5. Step 9 is unchanged (81 steps). On the SZS side, an SZS-only member registers a
device and is queued an alert (before: `OPERATIONAL_ACCESS_REQUIRED`, no alert);
a suspended or half-registered account still cannot register; a device another
account registered cannot be claimed; and a member of both services withdrawn
from SZS after publication is refused their SZS alert and still sent their DVD
one.

### Re-run with P4f

With `202609250033` added: **passed**, identical to the P4e run — E1, E2 and E4
in reads and commands and nothing else, the push comparison showing E5 exactly
as P4e's own run does since its review follow-up (re-run on the merged tree,
`a50cfe7`), every SZS step as before.
The commands that write audit history (`owner_set_role`,
`owner_set_account_active`, `owner_set_organization_membership` and every
call-out command) do exactly what they did, for every real account; P2's
backfill, which rewrites `operational_audit` rows, runs before the new rule
exists, as it always will.
