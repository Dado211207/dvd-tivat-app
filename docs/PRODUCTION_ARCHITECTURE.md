# Production architecture path

Status: **decision document, not an implemented system.** The current repository remains a local
browser prototype. This document defines the safest sequence for turning an accepted workflow into
a real DVD Tivat product without pretending that accounts, delivery or emergency reliability
already exist.

The owner's current expectation is a single-society application for DVD Tivat. The society has not
confirmed that constraint. Nothing below introduces multi-society routing, but the core records keep
a `societyId` boundary so a later institutional requirement does not force unrelated members into
one security domain.

---

## 1. Entry conditions

Production work does not start merely because the prototype looks complete. Before real member or
citizen data is entered, DVD Tivat must decide in writing:

1. whether an existing or official dispatch system is mandatory;
2. who may create, cancel and close a call-out;
3. whether citizen reports are wanted at all, and who reviews them;
4. what the trusted fallback is when this product, a phone or the network fails;
5. data controller, access, retention and deletion responsibilities;
6. who pays for hosting, app-store accounts, messages and ongoing maintenance;
7. which notification behaviours count as an acceptable trial pass.

Until those answers exist, every screen remains labelled as simulation and every record stays
fictional.

---

## 2. Target shape

The production product is four clients around one server-owned truth:

- **member mobile app** — receives addressed calls, displays facts and records that member's answer;
- **duty/admin app** — reviews reports, composes calls, manages the roster and watches responses;
- **station display** — read-only, minimum necessary information, revocable device registration;
- **citizen intake** — a deliberately separate public surface if the society approves it;
- **API and workers** — authenticate, authorise, store, broadcast, deliver and audit every change.

The client may hide an unavailable action for convenience, but only the server decides whether the
authenticated identity may perform it. No browser role selector survives into production.

---

## 3. Server-owned data and invariants

Use a relational database with transactions and migrations. Exact hosting vendor is a later,
reversible decision; the required behaviour is not.

| Record | Production responsibility |
|---|---|
| `Identity` | Login subject, verified contact method, account state and recovery metadata |
| `SocietyMembership` | Links one identity to DVD Tivat, roles and active status |
| `MemberProfile` | Operational display name, specialties and group membership |
| `Group` | Server-maintained recipient set; changes never rewrite an old call |
| `Vehicle` | Roster record, separate from every movement |
| `Incident` | Human-controlled operational state and lifecycle |
| `Call` + `CallRecipient` | Exact confirmed text and frozen recipient snapshot |
| `DeliveryAttempt` | Provider acceptance, device acknowledgement, failure or unknown — never a human answer |
| `MemberResponse` | The authenticated member's latest answer plus immutable revisions |
| `VehicleMovement` | Explicit departure and return, independent of attendance and incident state |
| `CitizenReport` | Untrusted intake, review state, coarse anti-abuse data and retention deadline |
| `MediaObject` | Private object key, type, size, digest, scan state and deletion deadline |
| `AuditEvent` | Append-only actor, action, target, request id, timestamp and result |
| `DeviceRegistration` | Push token, platform, owner, last seen and revocation state |

The current prototype's six-fact separation remains mandatory: composing a call, provider
acceptance, device acknowledgement, human response, vehicle departure and incident closure are six
different records. No background job is allowed to infer one from another.

Every mutating API request carries an idempotency key. A retried mobile request returns the original
result instead of creating a second call, response or movement. Updates use an explicit revision or
database lock so concurrent devices cannot silently overwrite each other.

---

## 4. Identity and authorisation

- Use a maintained identity provider or well-supported authentication service; do not build password
  storage in this repository.
- Require verified sign-in and server-issued sessions with rotation and revocation.
- Enforce society membership, active status and permission on every request.
- Members may answer only calls whose frozen recipient list contains their own membership id.
- Administrator and dispatcher powers are separate grants even if one person holds both.
- Station displays use a restricted device credential, never a person's permanent session.
- Removing a member or device revokes access immediately without erasing the historical record.
- Privileged changes require audit entries and should support stronger authentication before pilot.

The local prototype editor is useful for validating forms only. Its `ADMIN` display check is not
security code and must not be copied as permission enforcement.

---

## 5. Realtime updates and offline behaviour

The API commits first, then publishes a small event carrying the changed record id and revision.
Clients fetch authorised state from the API; the event itself is not trusted as the record.

- WebSocket or an equivalent managed realtime channel updates the duty screen and station display.
- Reconnect resumes from a server cursor or performs a full authorised refresh.
- A member answer may be queued offline with its original idempotency key and clearly shown as
  **not sent** until the server accepts it.
- Call creation, cancellation and operational status changes are not shown as successful while
  offline.
- Conflicts return an explicit newer revision; the client does not silently choose a winner.

---

## 6. Notifications are delivery attempts, not truth

Push notifications require a server worker, platform credentials and registered devices. The worker
creates a `DeliveryAttempt` before sending, records what the provider actually returned, and never
turns that into a member response.

Required states remain separate: queued, provider accepted, device acknowledged where the platform
can prove it, failed, expired and unknown. The duty view must show unknown as unknown. Escalation or
fallback timing is a DVD Tivat operational decision and must not be invented in code.

Android and iOS need physical-device trials on locked screens, silent/Focus modes, battery saving,
network loss, sign-out and device replacement. Store-policy permissions and any exceptional alert
entitlement must be verified from current first-party documentation immediately before that phase.

---

## 7. Citizen reports and photographs

If DVD Tivat approves real public intake, it is an **untrusted report queue**, not an automatic
alarm or dispatch instruction.

1. A citizen explicitly shares description, event place, optional device coordinates and optional
   media.
2. The server validates size and type, rate-limits abuse, assigns a request id and stores media in a
   private object store using an opaque key.
3. Media is quarantined until malware/content processing completes. Original filenames and storage
   URLs are never public.
4. A duty officer sees the report as unverified, reviews it and chooses whether to start the normal
   confirmed call workflow.
5. A call freezes its own verified text and recipients; it does not stay linked to mutable citizen
   input as operational truth.
6. Retention automatically removes rejected/expired report media according to the approved policy.

The public form must state whether it is monitored continuously and must direct immediate danger to
the official emergency channel approved by the society. Do not publish a real intake endpoint until
staffing, abuse handling and legal responsibility are settled.

---

## 8. Security, privacy and operations

- TLS only; secrets in the hosting platform's secret store, never in the client or repository.
- Private object storage with short-lived authorised downloads and no guessable public paths.
- Least-privilege database and worker credentials; separate production and test projects.
- Structured logs that exclude report text, coordinates, photos, tokens and contact details.
- Encrypted backups plus a restore exercise; a backup never tested by restore is not evidence.
- Dependency, migration and access review in CI; production changes require reviewed pull requests.
- Health monitoring covers API, database, worker queue and push-provider failures separately.
- Documented incident response, contact person, recovery steps and manual fallback.
- Retention jobs and account deletion are tested, observable and reversible where law requires.

The public GitHub repository continues to contain fictional fixtures only. Production configuration
and data live outside it.

---

## 9. Build sequence after prototype approval

| Stage | Deliverable | Exit evidence |
|---|---|---|
| P0 | Decisions and threat/data review | Written answers to §1; approved fallback and retention |
| P1 | API, database, identity and audit | Forged requests rejected; two accounts share one call; restore tested |
| P2 | Duty/admin web pilot | Roster and call workflow on fictional data; concurrency and rollback tests |
| P3 | Member mobile feasibility | Measured Android/iOS physical-device results including failures |
| P4 | Notification worker | Delivery states proven; no delivery becomes a response; fallback exercised |
| P5 | Optional citizen intake | Abuse, private media, review and deletion tested; no auto-dispatch |
| P6 | Supervised DVD exercises | At least three fictional exercises with the trusted fallback in parallel |
| P7 | Operational decision | DVD Tivat accepts/rejects use and names maintenance responsibility |

App-store submission, real alerts and production deployment are outside the current authorisation.
They occur only after the earlier stages pass and the owner explicitly approves them.

---

## 10. Prototype-to-production reuse

Keep the pure TypeScript entities, command validation concepts and message preview rules. Replace
the in-memory/localStorage state transition with authenticated API commands. The server becomes the
authoritative reducer; clients render server results and retain only short-lived drafts.

Do not migrate prototype `localStorage` into production. It is fictional, top-level validated only
and may contain arbitrary browser edits. Production begins with a clean database and controlled
import of society-approved roster data through the authenticated admin surface.
