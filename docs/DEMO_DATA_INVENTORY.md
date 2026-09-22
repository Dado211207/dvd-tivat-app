# Demo data in the production project

Complete row-level inventory of the hosted Supabase project, taken 2026-09-22.
**Nothing has been deleted, changed or inserted.** This exists so the owner can
decide what goes, in what order, with every dependency visible beforehand.

Fictional accounts use `@example.invalid`, a reserved domain that can never
receive mail, so none of them belongs to a real person and none can be recovered
by its owner.

## The whole database, by table

33 tables. Seven are already empty. Everything below is demo data except the
owner's own account.

| Table | Rows | In scope to delete |
|---|---:|---|
| `operational_audit` | 69 | 47 tied to the five interventions, 22 not |
| `organisation_audit` | 19 | all |
| `notification_outbox` | 10 | all |
| `access_grants` | 9 | 8 of 9 (owner's stays) |
| `profiles` | 9 | 8 of 9 (owner's stays) |
| `intervention_journey_history` | 9 | all |
| `intervention_recipients` | 8 | all |
| `role_audit` | 8 | **see the warning below** |
| `members` | 7 | all |
| `group_members` | 6 | all |
| `organization_memberships` | 6 | all |
| `interventions` | 5 | all |
| `attendance_intervals` | 4 | all |
| `intervention_acknowledgements` | 4 | all |
| `intervention_response_revisions` | 4 | all |
| `intervention_responses` | 4 | all |
| `vehicle_movements` | 4 | all |
| `intervention_journey` | 3 | all |
| `notification_delivery_attempts` | 3 | all |
| `vehicles` | 3 | owner's choice - see step 6 |
| `groups` | 2 | owner's choice - see step 6 |
| `organizations` | 2 | **no** - DVD and SZS are real |
| `web_push_subscriptions` | 2 | all |
| `account_status_audit` | 1 | all |
| `member_availability` | 1 | all |
| `member_availability_history` | 1 | all |
| `attendance_correction_requests` | 0 | - |
| `attendance_corrections` | 0 | - |
| `citizen_reports` | 0 | - |
| `intervention_updates` | 0 | - |
| `organization_membership_audit` | 0 | - |
| `report_media` | 0 | - |
| `report_status_audit` | 0 | - |

## Accounts

Nine accounts. One is real.

| Account | Name on profile | Role | Member record | Service |
|---|---|---|---|---|
| `doncicdragan2112@gmail.com` | Dragan Doncic | OWNER | **none** | none |
| `vatrogasac1@example.invalid` | **Dragan Doncic** | FIREFIGHTER | Ivo Vatrogasac | DVD:FIREFIGHTER |
| `komandir@example.invalid` | Komandir Smjene | COMMANDER | Komandir Smjene | DVD:COMMANDER |
| `vatrogasac2@example.invalid` | Pero Vatrogasac | FIREFIGHTER | Pero Vatrogasac | DVD:FIREFIGHTER |
| `vatrogasac3@example.invalid` | Jovo Vatrogasac | FIREFIGHTER | Jovo Vatrogasac | DVD:FIREFIGHTER |
| `ukinut@example.invalid` | Bivsi Clan | FIREFIGHTER | Bivsi Clan | DVD:FIREFIGHTER |
| `administrator@example.invalid` | Admin Kancelarija | ADMIN | none | DVD:ADMIN |
| `cekanje@example.invalid` | Novi Clan | CITIZEN | none | none |
| `vlasnik@example.invalid` | Vlasnik Naloga | CITIZEN | none | none |

The first row is the only real account. **Keep it.**

Two things worth naming. `vatrogasac1@example.invalid` carries **the owner's own
name on its profile** while its member record still says "Ivo Vatrogasac", so the
roster and the account directory disagree about who that is - on the one screen
where identity matters. And `vlasnik@example.invalid` was the **previous OWNER**,
demoted to CITIZEN on 2026-09-21 when ownership moved to the real account.

## Members

Seven member records, all fictional. Counts are live.

| Member | Linked account | Recipient | Attendance | Responses | Groups |
|---|---|---:|---:|---:|---:|
| Ivo Vatrogasac | `vatrogasac1` | 5 | 4 | 4 | 2 |
| Komandir Smjene | `komandir` | 1 | 0 | 0 | 1 |
| Pero Vatrogasac | `vatrogasac2` | 1 | 0 | 0 | 1 |
| Jovo Vatrogasac | `vatrogasac3` | 1 | 0 | 0 | 1 |
| Bivsi Clan | `ukinut` | 0 | 0 | 0 | 0 |
| Marko Probni | none | 0 | 0 | 0 | 1 |
| Ana Probna | none | 0 | 0 | 0 | 0 |

## Interventions, and everything that hangs off each one

All five are CLOSED. All five are fictional - two are `kind: TEST` and the titles
say so outright.

| Intervention | Kind | Recip. | Acks | Resp. | Journey | J.hist | Attend. | Vehicle | Outbox | Audit |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Vjezba - pozar na objektu (13.09) | POZAR | 1 | 1 | 1 | 1 | 3 | 1 | 1 | 1 | 14 |
| Codex test uzivo 13.09.2026 | TEST | 1 | 1 | 1 | 1 | 3 | 1 | 1 | 1 | 11 |
| Zavrsni Realtime test 13.09.2026 | TEST | 1 | 1 | 1 | 1 | 3 | 1 | 1 | 1 | 14 |
| TEST PUSH - NIJE STVARNI POZIV (14.09) | POZAR | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 2 | 5 |
| Vjezba - pozar na objektu (14.09) | POZAR | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 3 |
| **Total** | | **8** | **4** | **4** | **3** | **9** | **4** | **3** | **10** | **47** |

## Rows not tied to an intervention

- **`operational_audit`, 22 rows** whose `intervention_id` is null, carrying
  event types that are all intervention-shaped (`INTERVENTION_CLOSED`,
  `ATTENDANCE_CHECK_IN`, `VEHICLE_DEPARTED`, and so on). These look like the
  residue of test interventions deleted before this inventory was taken. Worth
  a decision of their own: they are history for records that no longer exist.
- **`organisation_audit`, 19 rows** - `MEMBER_CREATED`, `MEMBER_ACCOUNT_LINKED`,
  `GROUP_CREATED`, `GROUP_MEMBERS_CHANGED`, `VEHICLE_CREATED`. This is the
  creation history of the demo roster.
- **`vehicles` 3** (AC-2, NV-1, TV-3), **`groups` 2** ("Prva smjena" with 4
  members, "Nosioci IDA aparata" with 2).
- **`web_push_subscriptions` 2**, both `vatrogasac1`, both from an iPhone, one
  still active.
- **`account_status_audit` 1**, **`member_availability` 1 + 1 history**.
- **`organizations` 2** - DVD Tivat and Sluzba zastite i spasavanja Tivat. These
  are **real** and must not be deleted.

## What the database will and will not allow

This decides the order, and it is not a matter of preference. Foreign keys to
`members` are split:

- **`on delete restrict`** - `intervention_recipients`, `intervention_responses`,
  `attendance_intervals`, `notification_outbox`, `member_availability`,
  `member_availability_history`, `intervention_journey`,
  `intervention_journey_history`.
- **`on delete cascade`** - `group_members`, `intervention_acknowledgements`.

So **deleting a member that has ever been called out is refused outright**, not
silently cascaded. Ivo Vatrogasac cannot be deleted while any of the five
interventions exist. The interventions have to go first.

## Proposed order, for approval

Nothing below has been run. Each step is separately approvable and the earlier
steps are the safe ones. **Every step is preceded by an export of exactly the
rows it touches** - see the section after this one.

**Step 1 - the two unused member records.** Marko Probni and Ana Probna have no
operational history at all. Ana has nothing; Marko is in one group, which
cascades. Lowest risk, no interventions involved.

**Step 2 - the two demo push subscriptions.** Both fictional. Worth doing before
the owner registers his own phone, so the first real subscription is
unambiguous.

**Step 3 - the five interventions and their 81 dependent rows.** Delete in
dependency order: `notification_delivery_attempts`, `notification_outbox`,
`operational_audit` (the 47 tied rows), `attendance_intervals`,
`intervention_response_revisions`, `intervention_responses`,
`intervention_acknowledgements`, `intervention_journey_history`,
`intervention_journey`, `intervention_recipients`, `vehicle_movements`, then
`interventions`. **One transaction**, so a failure leaves nothing half-removed.

**Step 4 - the remaining five member records**, once step 3 has released the
restrict constraints. Plus `member_availability` and its history.

**Step 5 - the demo accounts.** Seven of the eight can go; `access_grants`,
`profiles` and `organization_memberships` follow the account. See the warning
below about the eighth.

**Step 6 - vehicles, groups and the leftover audit rows**, if the owner wants a
clean slate. AC-2, NV-1 and TV-3 are plausible callsigns and may be worth keeping
and correcting rather than deleting; the same goes for the two groups.

## The export, before anything is deleted

No deletion runs until the rows it touches have been written out as a restore
script. The export is generated per step, immediately before that step, from the
live rows rather than from this document - so it cannot drift from what is
actually there. It is delivered as a file and **not committed to this
repository**, which is public.

## Three things I would not do without a decision from you

**Do not delete `vlasnik@example.invalid`, and do not touch `role_audit`.** That
account is the previous OWNER, and `role_audit` holds the two rows recording the
transfer of ownership to the real account. Those rows are the only record in the
system that the transfer happened - and they are already weaker than they look,
because the transfer did not go through any owner function (see
`docs/ai/WORK_LOG.md`). Removing either should be a deliberate decision, not a
side effect of tidying up.

**Decide what to do about the name on `vatrogasac1@example.invalid` first.**
While that account carries the owner's name, anything showing "Dragan Doncic" in
the roster, the archive or an attendance record is ambiguous. If the account is
going anyway this resolves itself; if it is being kept for testing, the profile
name should be corrected to something obviously fictional.

**Consider keeping one demo firefighter.** Once everything above is gone there is
no way to exercise a call-out end to end without creating real records against
real people. One clearly-labelled fictional account is cheap insurance. That is a
judgement call, not a recommendation.
