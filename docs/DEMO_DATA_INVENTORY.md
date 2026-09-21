# Demo data in the production project

Read-only inventory of the hosted Supabase project, taken 2026-09-21. **Nothing
has been deleted, changed or inserted.** This exists so the owner can decide
what goes, in what order, with the dependencies visible before anything is run.

Every account except one is fictional. Fictional accounts use `@example.invalid`,
a reserved domain that can never receive mail, so none of them belongs to a real
person and none can be recovered by its owner.

## Accounts

Nine accounts. One is real.

| Account | Name on profile | Role | Member record | Service | Verdict |
|---|---|---|---|---|---|
| `doncicdragan2112@gmail.com` | Dragan Doncic | OWNER | **none** | none | **Real. Keep.** |
| `vatrogasac1@example.invalid` | **Dragan Doncic** | FIREFIGHTER | Ivo Vatrogasac | DVD:FIREFIGHTER | Demo. Heaviest dependencies. |
| `komandir@example.invalid` | Komandir Smjene | COMMANDER | Komandir Smjene | DVD:COMMANDER | Demo. |
| `vatrogasac2@example.invalid` | Pero Vatrogasac | FIREFIGHTER | Pero Vatrogasac | DVD:FIREFIGHTER | Demo. |
| `vatrogasac3@example.invalid` | Jovo Vatrogasac | FIREFIGHTER | Jovo Vatrogasac | DVD:FIREFIGHTER | Demo. |
| `ukinut@example.invalid` | Bivsi Clan | FIREFIGHTER | Bivsi Clan | DVD:FIREFIGHTER | Demo. No operational rows. |
| `administrator@example.invalid` | Admin Kancelarija | ADMIN | none | DVD:ADMIN | Demo. |
| `cekanje@example.invalid` | Novi Clan | CITIZEN | none | none | Demo. |
| `vlasnik@example.invalid` | Vlasnik Naloga | CITIZEN | none | none | Demo. **See the warning below.** |

Two things worth naming.

**The second "Dragan Doncic" is `vatrogasac1@example.invalid`.** Its *profile*
name was changed to the owner's name at some point; its *member record* is still
"Ivo Vatrogasac". So the roster and the account directory disagree about who
that is, which is confusing on exactly the screen where identity matters. It also
carries more operational history than any other demo account, and both push
subscriptions belong to it.

**`vlasnik@example.invalid` was the previous OWNER.** It was demoted to CITIZEN
on 2026-09-21 when ownership moved to the real account.

## Members

Seven member records. All fictional. Dependency counts are live.

| Member | Linked account | Recipient rows | Attendance | Responses | Groups |
|---|---|---|---|---|---|
| Ivo Vatrogasac | `vatrogasac1` | 5 | 4 | 4 | 2 |
| Komandir Smjene | `komandir` | 1 | 0 | 0 | 1 |
| Pero Vatrogasac | `vatrogasac2` | 1 | 0 | 0 | 1 |
| Jovo Vatrogasac | `vatrogasac3` | 1 | 0 | 0 | 1 |
| Bivsi Clan | `ukinut` | 0 | 0 | 0 | 0 |
| Marko Probni | none | 0 | 0 | 0 | 1 |
| Ana Probna | none | 0 | 0 | 0 | 0 |

## Everything else

| Table | Rows | Notes |
|---|---|---|
| `interventions` | 5 | All CLOSED, all 13-14 Sept. Two are `kind: TEST`. |
| `intervention_recipients` | 8 | Across the five interventions. |
| `attendance_intervals` | 4 | All Ivo Vatrogasac. |
| `intervention_responses` | 4 | All Ivo Vatrogasac. |
| `vehicle_movements` | 4 | NV-1 x3, AC-2 x1. |
| `vehicles` | 3 | AC-2, NV-1, TV-3. Fictional callsigns. |
| `groups` | 2 | "Prva smjena" (4 members), "Nosioci IDA aparata" (2). |
| `notification_outbox` | 10 | Tied to the five interventions. |
| `notification_delivery_attempts` | 3 | |
| `web_push_subscriptions` | 2 | Both `vatrogasac1`, from an iPhone. One still active. |
| `citizen_reports` | 0 | Nothing to clean. |

## What the database will and will not allow

This decides the order, and it is not a matter of preference. Foreign keys to
`members` are split:

- **`on delete restrict`** - `intervention_recipients`, `intervention_responses`,
  `attendance_intervals`, `notification_outbox`, `member_availability`,
  `member_availability_history`, `intervention_journey`,
  `intervention_journey_history`.
- **`on delete cascade`** - `group_members`, `intervention_acknowledgements`.

So **deleting a member that has ever been called out will be refused outright**,
not silently cascaded. Ivo Vatrogasac cannot be deleted while any of the five
interventions exist. The interventions have to go first.

## Proposed order, for approval

Nothing below has been run. Each step is separately approvable, and the earlier
steps are the safe ones.

**Step 1 - the two unused member records.** Marko Probni and Ana Probna have no
operational history at all. Ana has nothing; Marko is in one group, which
cascades. Lowest risk, no interventions involved.

**Step 2 - the demo push subscriptions.** Two rows, both fictional. Removing them
costs nothing and stops a demo device being counted as a recipient. Worth doing
before the owner registers his own phone, so the first real subscription is
unambiguous.

**Step 3 - the five interventions and their dependants.** Delete in dependency
order: `notification_delivery_attempts`, `notification_outbox`,
`attendance_intervals` (and its corrections), `intervention_responses`,
`intervention_acknowledgements`, `intervention_journey` (+ history),
`intervention_recipients`, `vehicle_movements`, then `interventions`. This is the
step that unblocks deleting the linked members, and the one that needs the most
care - it should be a single transaction so a failure leaves nothing half-removed.

**Step 4 - the remaining five member records**, once step 3 has released the
restrict constraints.

**Step 5 - the demo accounts.** Seven of the eight can go. `access_grants`,
`profiles` and `organization_memberships` follow the account.

**Step 6 - vehicles and groups**, if the owner wants a clean slate rather than
renaming them. AC-2, NV-1 and TV-3 are plausible callsigns and may be worth
keeping and correcting instead of deleting.

## Three things I would not do without a decision from you

**Do not delete `vlasnik@example.invalid` yet.** It is the previous OWNER, and
`role_audit` holds the two rows recording the transfer of ownership to the real
account. That audit trail is the only record in the system that the transfer
happened, and it is already weaker than it looks - see `docs/ai/WORK_LOG.md` for
why. Removing the account it points at should be a deliberate decision, not a
side effect of tidying up.

**Decide what to do about the name on `vatrogasac1@example.invalid` first.**
While that account carries the owner's name, anything showing "Dragan Doncic" in
the roster, the archive or an attendance record is ambiguous. If the account is
being deleted anyway this resolves itself; if it is being kept for testing, the
profile name should be corrected back to something obviously fictional.

**Consider keeping one demo firefighter.** Once everything above is gone there is
no way to exercise a call-out end to end without creating real records against
real people. One clearly-labelled fictional account is cheap insurance. That is a
judgement call, not a recommendation.
