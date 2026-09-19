# Boka Operativa: product direction and multi-service plan

## Product name and identity

**Boka Operativa** is the proposed product name. It covers operational
coordination across local services, retains a clear Boka identity, and does not
sound like a public emergency-reporting channel. The current deployment still
serves DVD Tivat workflows; the wider name is not a claim that the Protection
and Rescue Service has joined or approved the system.

The new icon pairs a rescue shield, a cross and Adriatic waves. It uses the
existing dark blue and sea-glass palette and avoids a flame, siren or emergency
number. The manifest, browser tab, iOS home-screen name, in-app masthead and
push title use the same name.

## UI direction

The product should feel like a calm operational tool: one primary action per
screen, concise headings, clear status words, and supporting explanation only
where it helps someone make a decision. Red stays reserved for active urgency
and destructive confirmation. A status never relies on colour alone.

This pass removes the repeated route description from the application chrome,
reduces competing header/card weight, and makes the brand mark consistent on
installed devices. Field-level help now opens from a small information mark
instead of taking permanent space; the mark keeps a 44px touch area, and the
help text remains connected to the field for assistive technology. Existing
role gates and real operational routes remain the source of truth for who can
see and do what. Secondary tools remain available through the existing
disclosures and Settings entry.

The server-backed account and organisation screens now follow the selected
language too, including role and account states, audit text, form outcomes,
access warnings and time formatting. The secondary account audit and
registration walkthrough start closed so the owner reaches the account list
first.

The next visual review should cover these journeys as separate role-based
flows: member receives and answers a call; commander prepares, reviews and
publishes; commander follows responses and attendance; administrator maintains
the service roster and accounts. Keep the real operational areas visually
separate from the old simulation until the simulation is removed or rebuilt.

## Multi-service model

### Recommended shape

Use one shared product and one Supabase project with **organization-scoped
membership and records**. Avoid separate app copies or a global role such as
"commander" that silently grants authority in every service.

The account remains a person-level identity. Their memberships, role, member
record, group membership, vehicle access and availability belong to an
organization. A person may have one membership in DVD Tivat and a separate
membership in the Protection and Rescue Service. Each membership is granted
and suspended by that organization's authorized administrators.

An incident created by one organization is private to that organization by
default. To coordinate across services, an authorized commander creates an
explicit **joint operation** and selects the participating organizations and
the minimum operational details to share. Each invited organization accepts
through an authorized role. Members then see one joint-operation view with
their own service's actions clearly identified. The joint record has its own
participants, status, messages, timestamps and immutable audit history. It does
not make either organization's full member, vehicle or historical records
visible to the other.

### Likely additive data model

Confirm names against the live schema before writing a migration. A migration
design should add, rather than replace existing records:

- `organizations`: stable ID, display name, type, active state and timestamps.
- `organization_memberships`: user ID, organization ID, scoped role, active or
  suspended state, approval metadata and optional link to the organization's
  member record. Unique on user and organization.
- `joint_operations`: initiating organization, creator, status, created and
  published timestamps, and explicit shared incident fields.
- `joint_operation_participants`: operation ID, organization ID, invitation
  state, accepting authority, and organization-local operation reference.
- `joint_operation_member_assignments`: operation, organization membership,
  response and attendance fields needed for the shared operation only.
- `joint_operation_audit`: append-only event history with actor and
  organization context.

Existing `access_grants`, `members`, groups, vehicles, interventions,
attendance, notification subscriptions and audit records are DVD-scoped data.
Do not repurpose a global grant as a multi-organization membership. Preserve
the existing DVD records and map them to one DVD Tivat organization in a
reviewed backfill after a read-only inventory. The other service starts with
its own empty roster and receives no copied DVD records.

The current schema has a single global role grant and a unique link from a user
to one member row. Those assumptions must be removed only after every query,
RPC and policy has been changed to take an explicit organization context. A
short-lived compatibility layer may resolve existing DVD users to the DVD
organization during rollout; it must fail closed if context is missing or
ambiguous.

## Access, audit and notification rules

- RLS and write RPCs check the active user's membership and role for the
  requested organization on every operation. A client-supplied organization ID
  is a selector, never proof of access.
- Roster, groups, vehicles, availability and ordinary incidents are readable
  only to active members of their own organization and authorized roles.
- A joint operation is readable only to active members of organizations that
  accepted that operation. Shared views expose only fields listed in the
  accepted joint-operation record.
- Administrative actions, role changes, invitations, acceptance, suspension,
  incident publication, member response and attendance are audited with actor,
  organization and timestamp. Audit rows are append-only.
- A push subscription remains owned by a user and a device. Before sending,
  the server re-checks active membership, joint-operation participation and
  notification eligibility for that exact operation. Lock-screen payloads
  remain generic.
- Realtime channels and outbox work are scoped to an authorized operation and
  participant. No broad organization feed should leak the other service's
  activity.

## Delivery phases

1. **Product and schema discovery.** Confirm the second service's name,
   responsibilities, terminology, approval process and command structure.
   Inventory production schema, policies, RPCs, triggers, realtime and push
   paths read-only. Do not change production in this phase.
2. **Design prototype.** Test role-specific navigation and a joint-operation
   storyboard with fictional accounts. Keep DVD workflows unchanged. Review
   on phone-sized layouts and with keyboard/screen-reader checks.
3. **Schema and policy proof.** Build additive migrations and adversarial RLS
   tests on a disposable/local database. Prove cross-organization reads and
   writes fail by default, and prove accepted joint operations expose only
   explicitly shared records. Add a tested DVD compatibility/backfill plan.
4. **Invited second-service pilot.** Create the organization and its empty
   roster, invite authorized administrators, and onboard members only after
   both services approve. Run fictional joint-operation exercises. Keep
   phone/Viber dispatch as the operational fallback.
5. **Production adoption.** After both services sign off on policy, training,
   retention and incident procedures, apply the reviewed migration with a
   rollback plan and monitor audit, access-denial and delivery metrics.

## Decisions needed from service owners before production implementation

- The second service's official display name and who can approve its accounts.
- Which roles may create, accept, cancel and close a joint operation.
- Which incident fields and member identity fields can cross service lines.
- Whether each service sees the other's roster, and exactly which fields.
- Retention, correction and export rules for shared operational records.
- Whether a joint call-out can notify both services, and the human fallback if
  push is delayed or unavailable.

Until those decisions are approved, keep the second service as a design and
fictional-test target. Do not add a broad organization switch or production
database migration that could broaden access accidentally.
