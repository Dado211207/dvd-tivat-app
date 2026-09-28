# P6 release preparation — acceptance and deployment (prepared, NOT executed)

This is the release material the multi-service (P6) work needs before DVD Tivat
relies on it. It is **prepared for review and authorisation only.** Nothing here
has been run against production, no migration has been applied, and no worker or
frontend has been deployed. It extends — does not replace — the general
`docs/RELEASE_ACCEPTANCE.md` (fill one of those in too) and the operational
walk-through in `docs/DEMO_RUNBOOK.md`.

The single hard precondition below (the production-copy equivalence gate through
039) **could not be run in the environment that prepared this** — there is no
production capture here, and one must never be created or committed. It is listed
as the first gate the release owner runs, with the real data, before anything else.

---

## 0. Preconditions (all must hold before any production change)

- [ ] **Production-copy equivalence gate through migration 039 passes.** Restore a
  fresh, read-only, pseudonymised copy of production into an isolated PostgreSQL,
  prove the copy is faithful first, then run `npm run gate:p4 -- <capture>` so it
  exercises the full 022→039 set. Zero read/command divergences and no unexplained
  expected-difference change. Do not substitute fixtures for the copy. Never commit
  the capture. *(This gate has been run before through 038; 039 must be included on
  a fresh copy — see the handoff. It was not run in the branch that wrote this doc.)*
- [ ] Independent review of the P6 PRs at their exact final heads. #70
  (integration) already carries the migration-039 and Stage-B client histories
  (the former #67 and #68), so review those on #70 — not as separate PRs. The
  client stack is #70 → #71 (acting-service audit) → #72 (in-app sound) → #74
  (mobile acceptance preview), with this doc (#73) and the Pages latch (#75) as
  siblings. Because #71/#72/#74 target their stacked bases rather than `main`,
  GitHub CI does **not** run on them individually; the integrated tree's green CI
  is proven by a combined release-candidate PR that targets `main` (its number
  and CI run are recorded in `docs/ai/MULTI_ORG_HANDOFF.md`). Coordinate the
  stack's merge order (below).
- [ ] Owner has authorised: the production migration run, the push-worker
  deployment, and turning on the SZS administration flag.
- [ ] A current production backup / PITR recovery point is confirmed and its
  restore has been exercised on a separate target (see `RELEASE_ACCEPTANCE.md`).
- [ ] [#75](https://github.com/Dado211207/dvd-tivat-app/pull/75), the Pages release
  latch, has been independently reviewed and merged **before #70**. Keep the
  repository Actions variable `P6_PAGES_RELEASE_READY` unset or false. Verify
  the next successful `main` CI run leaves the Pages build skipped. Check that
  `VITE_SUPABASE_URL` in repository Actions variables points to the intended
  project; the public URL is a build-time choice, not inferred from migrations.

---

## 1. Phone-testing acceptance — the four account shapes

Do this on real devices, on a **preview/staging** deployment built against a
non-production project, with fictional accounts, before production. Record device,
OS, and evidence for each line. "Isolation holds" always means: the other
service's roster, call-outs, availability, vehicles and archive are **not**
visible, and no action the server would refuse is offered.

### 1a. DVD-only member (the existing case — must be unchanged)

- [ ] Signs in, lands on a screen they can use for their role.
- [ ] **No** "acting as" badge and **no** service switch appear anywhere (there is
  only one service, so nothing to choose).
- [ ] Full call-out lifecycle works exactly as before P6 (draft → publish →
  answer → journey → check-in/out → confirm → close → archive).
- [ ] A refused/failed read shows an error, never an empty archive or "no call-out".

### 1b. SZS-only member

- [ ] Signs in; role and member identity resolve **in SZS**; no "acting as" badge
  (single service).
- [ ] Runs the full SZS call-out lifecycle end to end.
- [ ] Isolation holds against DVD throughout (a DVD call-out/roster is never seen).
- [ ] Attendance is credited to **SZS** in the archive and all-time totals.

### 1c. Dual-service member (two member records, D13)

- [ ] The "acting as DVD / SZS" **badge shows** on the command, mobilisation and
  archive screens, naming the current service, with a link to Settings.
- [ ] The Settings switch offers both services; switching is **explicit** and, once
  switched, every screen shows only the newly-selected service (roster, call-outs,
  availability, vehicles, archive, member identity).
- [ ] Switch **while a call-out is open, with an unsaved draft, and with pending
  requests**: no other-service data appears at any moment; the unsaved DVD draft is
  not lost or leaked into SZS; forms reset per service.
- [ ] **Notification for the other service:** while acting as DVD, receive/tap a
  push for an SZS call-out → the screen shows the explicit "this call-out is in
  SZS — switch" prompt (never a silent switch, never a blank screen); tapping it
  switches and opens the call-out.
- [ ] Attendance in each service is credited to **that** service; the six
  attendance facts are preserved.
- [ ] Realtime updates continue correctly after a switch (no stale other-service
  callback).

### 1d. Owner (administers both; may have no member record)

- [ ] Sees the Accounts directory with **both** DVD and SZS membership columns;
  can assign/remove either service's role (requires the SZS flag on — §2).
- [ ] Can act as either service (badge + switch present).
- [ ] With **no member record** in a service: operational read screens render, but
  actions that need a member (check-in, being a recipient) are correctly refused
  with the "no member record" message, not a blank screen.
- [ ] Suspending an account removes operational access in **both** services at once.

### 1e. Incomplete-profile / suspended / citizen

- [ ] Incomplete profile → prompted to complete it, no operational access.
- [ ] Suspended → told they are suspended, no access.
- [ ] Citizen (no role) → only their own account and device Settings.

### 1f. In-app call-out sound (#72), per device

- [ ] Default is **off**; existing users hear nothing new until they choose.
- [ ] Choosing a sound in Settings previews it; the choice is remembered on that
  device for that account and does not carry to another account on the same phone.
- [ ] With a sound chosen and the **app open on any route** (My call-out,
  Archive, Command, Registry or Settings), a newly arriving call-out **addressed
  to this member** sounds; call-outs already open when the app loaded do not, and
  one arrival makes exactly one sound. (The earlier revision sounded it only on
  the My call-out screen; #72 now makes it app-level, so the "other screens are
  silent" limitation is resolved rather than left as an open acceptance decision.)
- [ ] It sounds only what the signed-in **member** was paged for, resolved per
  service: a dual-service member hears either service even while acting in the
  other; a single-service member never hears the other; an owner with no member
  record hears nothing. Turning the choice on mid-session does not retroactively
  sound an already-open call-out.
- [ ] Foreground/visible only: with the tab **hidden or backgrounded** the in-app
  sound stays silent (that case is the phone's push sound, below). Two side-by-side
  **visible** tabs each play once — acceptable, since the choice is per-device.
- [ ] Confirm the honest wording holds on device: a call-out arriving while the app
  is **closed/backgrounded** uses the **phone's own** notification sound (set in
  the phone), not the in-app choice. Record this for iOS installed PWA and Android.

---

## 2. Deployment order (only after §0 and §1 pass and are authorised)

Apply in this order. Do each step, verify it, then proceed; do not batch across
the migration/frontend/worker boundaries.

1. **Database migrations.** Production is at migration `202609230021` (22 applied).
   Apply every migration from `202609240022` through `202609270039` **in filename
   order**, one at a time, verifying each. This set carries the P4 service
   isolation, P5 role-mirror retirement and P6 attendance-credit rule. Re-running
   is safe (idempotent) but apply the sequence once, in order. Confirm the final
   applied migration is `202609270039` and `check:migrations` reports no drift
   against the deployed set.
2. **Push worker (P4e).** Deploy the worker **only after** migration `202609250032`
   is applied — which it is, once step 1 completes through 039. Configure its VAPID
   / Web Push keys from the environment, never from the repo. Verify it can read the
   push outbox and send to a fictional opted-in device on the isolated staging
   project before any real member. Do not create a fictional production alert.
3. **Frontend (static build).** Build and publish the new client (GitHub Pages or
   Netlify, per `docs/` recommendation) **after** the schema is in place, so the new
   client never meets an old schema. For Pages, confirm `main` is the reviewed
   release SHA and the configured `VITE_SUPABASE_URL` is the intended project;
   then set `P6_PAGES_RELEASE_READY=true` and manually dispatch **Deploy
   demonstration build**. Setting the variable alone does not start a run.
   Verify the published URL and the final migration version. Turn the latch off
   again if further automatic releases must pause. Decide the SZS-admin flag
   before building (next line).
   - **SZS administration flag:** the owner's SZS role-assignment controls in
     Accounts are gated by `VITE_MULTI_SERVICE_ADMIN_ENABLED`. To let the owner
     create SZS members (and thus make the SZS workflow reachable at all), build the
     production frontend with this set to `true`. Leaving it unset ships the P6 code
     but keeps SZS assignment dark. This is a deliberate release decision, not a
     default — confirm it with the owner.
4. **Production smoke check, read-only.** Confirm schema version, service-scoped
   reads, account access, and worker health without creating fictional members,
   published call-outs or alerts. Run the DVD and SZS end-to-end exercises on
   staging in §1. Migration 034 retains published call-outs and answer history;
   ordinary cleanup cannot remove a published fictional call-out. Any production
   write exercise needs its own explicit approval and a retention plan.

---

## 3. Rollback

Rehearse each of these on a non-production target before the release (see
`RELEASE_ACCEPTANCE.md` → Production recovery).

- **Frontend:** redeploy the previous static build. It is immediate and carries no
  data risk; the previous client works against the new (backward-compatible) schema,
  so a frontend-only rollback is the first and safest lever if the UI misbehaves.
- **Push worker:** redeploy the previous worker, or stop it. Publication still
  records the in-app obligation and the outbox row; only the push send pauses, and
  the human fallback (§`RELEASE_ACCEPTANCE.md` Notifications) covers the gap.
- **Database:** these migrations tighten policies and add guards; several rewrite
  RLS and definer functions, so there is no clean forward "undo" migration prepared
  here. A schema rollback is therefore a **restore to the pre-deployment PITR /
  backup point** confirmed in §0 — which loses any rows written after it, so it is a
  last resort and the reason the staging exercise in §1 precedes any production
  change. If only one late migration misbehaves, prefer a new forward fix migration
  (reviewed, gated) over a full restore.

---

## 4. What is explicitly NOT in this release

- Joint (cross-service) call-outs and product questions Q1–Q4 are **P7**, not P6.
- The in-app sound (#72) does not change background push sound — that is the
  device's, on every platform (see the PR and the Settings note).
- No demo-data purge is bundled here; migration 034 refuses deleting published
  call-outs, so any demo cleanup is a separate, separately-approved exceptional
  action (see `docs/DEMO_DATA_INVENTORY.md`).
