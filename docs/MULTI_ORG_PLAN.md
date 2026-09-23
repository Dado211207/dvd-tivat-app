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
| **D9** *(was Q9)* | **A single installation owner administers both DVD and SZS.** No second owner, and no new per-organisation administrator role. **Interpretation, stated because it decides what P4 does:** the existing `ADMIN` keeps exactly the powers it has today, scoped to its own service — an SZS `ADMIN` manages SZS's registry, a DVD `ADMIN` manages DVD's. That is the only reading consistent with "no existing DVD account loses access", since production holds a live `ADMIN` account whose registry powers cannot be withdrawn by this rewrite. Say so if you meant something narrower. |
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
| **P4a** — registry | `members`, `groups`, `group_members`, `vehicles`, `member_availability`, `member_availability_history` | 7 |
| **P4b** — interventions | `interventions`, `intervention_recipients`, `intervention_updates`, `intervention_acknowledgements` | 6 |
| **P4c** — responses and journey | `intervention_responses`, `intervention_response_revisions`, `intervention_journey`, `intervention_journey_history` | 7 |
| **P4d** — attendance | `attendance_intervals`, `attendance_corrections`, `attendance_correction_requests`, `vehicle_movements`, and `attendance_totals()` | 8 |
| **P4e** — notifications | `notification_outbox`, `notification_delivery_attempts`, **and the `send-web-push` Edge Function** | 3 + 1 function |
| **P4f** — accounts and audit | `operational_audit`, `registry_audit`, `role_audit`, `account_status_audit`, `organization_membership_audit`, `organization_memberships`, `organizations`, `access_grants`, `profiles`, `citizen_reports`, `report_media`, `report_status_audit`, `web_push_subscriptions` | 20 |

**P4e carries a hazard the others do not.** The push worker reads `members`,
`interventions` and `intervention_acknowledgements` with the **service-role
client, which bypasses RLS entirely**. It inherits nothing from P4a–d: the
organisation filter has to be written into those queries by hand, or the worker
keeps delivering across services after every policy above it is correct.

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
3. P3's equivalence test is run against a **restored copy of production**, not
   only against fixtures, before P4a is written. This is the one remaining
   precondition, and it is the gate on the whole policy rewrite: P4a–f are safe
   to split only because P3's shim is proven to resolve identically, and a
   fixture cannot prove that about six real accounts and seven real member
   records.
4. Each phase's migration is applied to production on its own approval. Nothing
   in this plan applies a migration as a side effect of merging a PR: the tree
   already carries two unapplied migrations (`202609220017`, `202609230018`),
   and that separation is deliberate.
