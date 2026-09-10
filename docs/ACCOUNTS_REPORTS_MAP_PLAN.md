# DVD Tivat accounts, reports and map plan

**Status:** implementation plan and first reviewable foundation. The current application remains a local simulation. No real account, email, upload, push notification or dispatch channel exists until a dedicated backend is configured and the acceptance gates in section 12 pass.

## 1. Product decision

The application serves DVD Tivat only. It has two audiences sharing one product but not one view:

1. A citizen creates a verified account and submits an unverified report with a description, an explicitly confirmed incident point and optional photos.
2. Approved DVD Tivat personnel receive an informational alert, inspect the report and decide whether it is a duplicate, requires clarification, is rejected, or becomes a confirmed incident.
3. Only an authorised commander, administrator or owner can create a call-out. A citizen report is never itself proof that DVD Tivat accepted the report or dispatched a crew.
4. Members confirm whether they are coming to the base. Crew composition, vehicle departure and incident status remain separate records.

The public emergency message must continue to direct immediate danger to the official emergency channel. Montenegro's 112 service is presented as free and available around the clock by an official government information source.[^1] The product must not imply that an in-app report replaces 112 until the competent authorities explicitly approve such a role.

## 2. Account lifecycle

The proposed registration order is:

1. Enter email and password.
2. Receive a short verification code at that email and enter it in the application.
3. After successful verification, enter name and surname and accept the privacy notice.
4. Create the account with the `CITIZEN` role. There is no role selector in signup requests or user-editable metadata.
5. The owner may later change the account to `FIREFIGHTER`, `COMMANDER` or `ADMIN` after checking the person outside the application.

An email address identifies a login channel, not a firefighter. A typed full name is display data, not proof of identity. Duplicate names are allowed because permissions bind to the immutable authentication user id.

Passwords are handled only by the maintained authentication service. They must never be stored in this application's database, local storage, logs or analytics. Sessions use the provider's supported browser client, automatic refresh and secure recovery flows. The owner's account should use MFA before a pilot; Supabase supports higher-assurance MFA sessions and exposes an assurance level to the application.[^2]

### Verification email during the free prototype

Supabase Auth is the recommended first backend because it combines email/password authentication, Postgres, row-level security and private object storage in one service. The free tier is enough for a bounded prototype, but it is not an emergency-service reliability commitment. Supabase documents that its default email sender is best effort, has a low rate limit and is not intended for production; a custom SMTP service is required before inviting external testers at scale.[^3]

For the requested code-entry experience, configure the signup email template to show the provider's token rather than only a confirmation link, then verify it with the `signup` OTP type. The source foundation in `src/auth/supabaseClient.ts` implements that contract. Until `VITE_SUPABASE_URL` and the public anonymous key are supplied, the account backend stays unavailable and the application must continue describing itself as a simulation.

The public anonymous key may be used in the browser because database access is constrained by row-level security. A Supabase service-role key bypasses those policies and must never be placed in a `VITE_*` variable, client bundle or repository.[^4]

## 3. Roles and permissions

There are five roles. `OWNER` is a unique bootstrap authority, not a normal dropdown option.

| Capability | Citizen | Firefighter | Commander | Admin | Owner |
| --- | ---: | ---: | ---: | ---: | ---: |
| Submit a report | Yes | Yes | Yes | Yes | Yes |
| View own reports | Yes | Yes | Yes | Yes | Yes |
| View unverified operational reports | No | Yes | Yes | Yes | Yes |
| Respond to a call-out | No | Yes | Yes | Yes | Yes |
| Confirm or reject an incident | No | No | Yes | Yes | Yes |
| Send a call-out | No | No | Yes | Yes | Yes |
| Manage operational data | No | No | Yes | Yes | Yes |
| Manage general content | No | No | No | Yes | Yes |
| View every registered account | No | No | No | No | Yes |
| Assign or remove roles | No | No | No | No | Yes |
| Read the role-change audit | No | No | No | No | Yes |

The owner may assign `CITIZEN`, `FIREFIGHTER`, `COMMANDER` or `ADMIN`; the owner role cannot be delegated through the application. This satisfies the owner's requirement that nobody else can grant access. A later governance decision may introduce a second recovery owner, but it must be a deliberate, audited operation rather than a normal admin power.

Every protected request is authorised on the server. Hiding navigation is only interface behaviour and cannot be used as a security boundary. OWASP recommends deny-by-default permissions and checking them on every request, including object-level checks.[^5] Supabase similarly warns that user-editable signup metadata is unsuitable for authorisation.[^4]

Role changes record target account id, old role, new role, owner id and timestamp. The admin panel never exposes passwords. It shows account id, verified email, full name, status, current role and last role change. Suspension and role revocation take effect from current database state; they should not depend only on a possibly stale role copied into an access token.

## 4. Views by audience

### Citizen

- Report event
- My reports and their truthful status
- Account and privacy settings
- Emergency instruction with the official channel

The citizen cannot see the member roster, personnel availability, vehicle status, operational history, other citizens, exact locations from other reports or internal notes.

### Firefighter

- New unverified report alerts with the minimum information needed to recognise the event
- Confirmed call-out, base-first response and own response history
- Active incident map and directions
- Own profile and qualifications visible to authorised leaders

### Commander

- Report review queue and map
- Confirm/reject/merge workflow with a mandatory reason
- Call-out composition and frozen recipient list
- Member responses, base arrival, crew composition and vehicle movement
- Multiple concurrent incidents and explicit assignment warnings

### Admin

- Commander operational capabilities
- Manage groups, vehicles, training content and non-sensitive configuration
- No role-assignment permission and no complete account directory

### Owner

- All administrator capabilities
- Searchable account directory
- Grant, revoke and suspend access
- Role audit, security settings and recovery checks

## 5. Report and alert workflow

A citizen submission starts as `UNVERIFIED`. The product sends an informational alert to all active, approved `FIREFIGHTER`, `COMMANDER`, `ADMIN` and `OWNER` accounts. The alert must say **Neprovjerena prijava** and cannot use the same sound, colour or wording as an authorised call-out.

The notification preview should be generic, for example: “Nova neprovjerena prijava u aplikaciji DVD Tivat.” Personal details and exact media are fetched only after an authorised account opens the application. This reduces sensitive information on locked phone screens.

A commander or admin can move a report through:

- `UNVERIFIED`
- `UNDER_REVIEW`
- `CONFIRMED`
- `REJECTED`
- `CLOSED`

Each transition stores actor, time and reason. Similar reports may be suggested as possible duplicates, but the software must not automatically hide or merge them. A confirmed incident can produce a separate call-out. The call-out freezes the exact recipients and records delivery separately from member responses, crew departure and incident status.

Push notification delivery is useful but not guaranteed. Android documents that normal-priority messages can be delayed during power-saving states, while high-priority messages are intended for time-sensitive, user-visible notifications and may be deprioritised if misused.[^6] Therefore Viber or another approved fallback remains part of the pilot procedure until measured field evidence proves the new channel's reliability.

## 6. Incident map and location

The report form offers two explicit actions:

- **Use device location:** captures the device position after permission is granted.
- **Place map pin:** the citizen touches the actual incident point.

These are not treated as equivalent. A person may be reporting smoke visible across the bay; their device location is then the reporter's position, not the fire. The confirmation screen must show source, coordinates, capture time and the browser-reported accuracy radius. The W3C geolocation specification defines `accuracy` as an estimate in metres and includes a timestamp; it does not establish that the coordinate is the incident itself.[^7]

Map states use more than colour:

- amber circle + “Neprovjereno” for citizen reports;
- red incident symbol + “Potvrdjeno” only after authorised review;
- blue unit/vehicle symbol only for a separately recorded operational position;
- grey marker + “Zatvoreno” for closed incidents.

The first implementation uses Leaflet with OpenStreetMap tiles. OpenStreetMap requires visible attribution and describes its public tile service as best effort with no SLA; offline downloads, bulk prefetching and test sweeps are prohibited.[^8] The tile URL therefore remains replaceable, and automated tests block tile requests while still testing our marker interactions. Production must select a provider with an appropriate usage agreement and disclose the external map request.

Public Nominatim must not power live address autocomplete. Its policy caps an application at one request per second, forbids client-side autocomplete and requires caching and provider switching.[^9] The prototype uses direct map placement and typed landmarks. Address search can be added later with a contracted provider or a controlled, explicitly triggered lookup.

## 7. Photos

The citizen can add up to three images, but text and location remain independently submittable so a slow image upload does not erase the report. The server must:

- allow only an explicit JPEG, PNG or WebP list;
- limit each file to 8 MB and impose a decoded-pixel limit;
- inspect actual file signatures instead of trusting the browser MIME value;
- decode and re-encode the image, removing EXIF including embedded GPS;
- generate an object path unrelated to the original filename;
- store bytes in a private bucket and metadata in the database;
- issue short-lived authorised reads only to the reporter and approved staff.

OWASP recommends layered extension, type, signature, filename, size and storage controls because the `Content-Type` header is user controlled and cannot be trusted alone.[^10] HEIC is deferred until the selected server decoder can process and normalise it reliably; the interface must explain supported formats instead of accepting a file it cannot safely inspect.

Supabase database backups do not include Storage object bytes, so report-photo backup and restore needs its own procedure before a pilot.[^11]

## 8. Data model

The first migration creates:

- `profiles`: immutable auth id, full name, completion status and timestamps;
- `access_grants`: one current role and active state per account;
- `role_audit`: append-only role changes;
- `citizen_reports`: text, confirmed incident coordinates, source, accuracy and status;
- `report_media`: private object metadata only.

The authentication service owns email verification and password hashes. Uploaded bytes belong in private object storage. Browser local storage remains suitable only for temporary drafts and appearance preferences, never shared reports, accounts or permissions.

The one-time owner bootstrap is manual and tied to the exact verified auth user id. The migration deliberately does not promote the first registrant or trust an email string supplied by the browser.

## 9. Useful additions for DVD Tivat

The following belong after accounts and reporting work correctly:

1. Base arrival confirmation separate from “Dolazim”.
2. Crew assignment to the MAN vehicle or firefighting SUV before departure.
3. Qualification warnings such as driver, IDA or first aid, without claiming availability from a stored qualification.
4. Unanswered-call view and stale-response warning.
5. Multiple simultaneous incidents with a warning when the same person or vehicle is assigned twice.
6. Low-priority training and meeting announcements, visually distinct from incidents.
7. Hydrant or access-point reference data only from an approved source, with owner and last-verified date.
8. Offline draft recovery and an explicit “not sent” state.

Not in the first pilot: continuous member tracking, automatic AI dispatch, public display of exact active incident locations, background microphone listening, siren/door control, or removal of the existing fallback channel.

## 10. Mobile delivery

The responsive web prototype stays the fastest common validation surface for iPhone, Android and PC. A production mobile application should be evaluated with a small native build because reliable camera, location and push behaviour varies by platform. Expo/React Native is the preferred native candidate; its push setup still requires Firebase credentials on Android and Apple credentials for iOS.[^12]

An installable web app can be useful for presentation, but iPhone web installation and notifications must not be marketed as equivalent to a signed App Store application. The field pilot decides whether the common web code plus native wrappers is sufficient or whether the mobile client should be native from the start.

## 11. Cost and operations

The prototype can start on free allowances, but “free” describes quota, not operational suitability. Supabase currently advertises a free database, storage and monthly-active-user allowance, while free projects can be paused after inactivity.[^13] An incident system needs paid, monitored infrastructure before depending on it.

Expected paid components later are backend hosting, transactional email, map tiles/geocoding, mobile developer accounts, monitoring, backups and possibly SMS fallback. No final budget should be quoted before expected users, photo volume, notification volume, retention and service responsibility are agreed.

## 12. Acceptance gates

### Current reviewable foundation

- Pure role policy: new account is citizen; only owner grants roles; owner is not assignable.
- Recipient policy: all active approved operational accounts receive the unverified-report alert.
- Interactive map pin and distinct location source in the local simulation.
- Searchable owner-panel interaction using fictional accounts.
- Supabase client functions for signup, code verification, profile completion, login and logout.
- Database migration with deny-by-default row-level security foundation.

### Required before connecting real people

1. Create a dedicated backend project owned by the organisation, not a developer's personal account.
2. Configure numeric signup-code email, custom SMTP, allowed redirect origins and rate limits.
3. Apply and independently review the migration and private-storage policies.
4. Bootstrap the owner's exact verified user id and enable MFA.
5. Make every operational route use authenticated server state; remove the actor selector from connected builds.
6. Run positive and negative tests for every role against the real database policies.
7. Prove revocation and suspension take effect while another session is open.
8. Prove a citizen cannot enumerate accounts, members, reports or media.
9. Validate image bytes, metadata removal and failed-upload recovery on the server.
10. Test iPhone and Android location permissions, camera upload and notification denial/recovery.
11. Measure alert delivery while devices are locked, offline and in battery-saving modes; document the Viber fallback.
12. Approve privacy controller, retention periods, deletion/export requests, incident triage ownership and escalation procedure.
13. Complete a local legal/privacy review against the current Montenegrin framework. The regulator lists the applicable personal-data law and amendments, while a newer government item published in 2026 is explicitly a proposal and must not be treated as enacted solely from its publication.[^14]

## 13. Sources

[^1]: [Government of Montenegro / Ministry of Interior: Directorate for Protection and Rescue](https://www.gov.me/mup/vanredne-situacije)
[^2]: [Supabase: Multi-Factor Authentication](https://supabase.com/docs/guides/auth/auth-mfa)
[^3]: [Supabase: Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
[^4]: [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
[^5]: [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
[^6]: [Firebase Cloud Messaging: Set and manage Android message priority](https://firebase.google.com/docs/cloud-messaging/android-message-priority)
[^7]: [W3C Geolocation](https://www.w3.org/TR/geolocation/)
[^8]: [OpenStreetMap Foundation: Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
[^9]: [OpenStreetMap Foundation: Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
[^10]: [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
[^11]: [Supabase: Database Backups](https://supabase.com/docs/guides/platform/backups)
[^12]: [Expo: Push notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
[^13]: [Supabase Pricing](https://supabase.com/pricing)
[^14]: [Agency for Personal Data Protection and Free Access to Information: Regulations](https://www.azlp.me/me/propisi)
