# Web Push latency: where the time goes, and how to measure it

The owner published a real call-out, received it on an iPhone, heard the sound
and felt the vibration — and reported a **substantial delay** between pressing
publish and the phone reacting.

This document is the diagnosis: what was found by reading the code, what was
changed, what could not be measured from here, and the exact queries the owner
can run to answer the remaining question with evidence rather than impression.

---

## 1. The five intervals a "delay" is actually made of

A single stopwatch reading from *publish* to *phone buzzes* contains at least
five different things, with five different owners and five different fixes.
Treating them as one number is how a society ends up scheduling a worker more
frequently and fixing nothing.

| # | Interval | From → To | Who owns it | Server-measurable? |
|---|---|---|---|---|
| 1 | **Queueing** | commander taps publish → `notification_outbox.created_at` | this application | yes (it is one transaction; effectively zero) |
| 2 | **Pick-up** | `created_at` → the worker claims the row (`updated_at`) | this application | **yes** |
| 3 | **Attempt** | claim → the send to the push service starts (`attempted_at`) | this application | **yes** |
| 4 | **Provider** | the attempt → the push service accepts it | Apple / Google / Mozilla | partly (see §5) |
| 5 | **Handset** | provider accepts → the phone displays and sounds | iOS/Android, the network, silent mode, Focus, Low Power Mode | **no — never** |

Interval 5 cannot be measured by any server, and no amount of instrumentation
will change that. A push service accepting a message is not a phone ringing.
§6 gives the owner a way to record it by hand during a real-device test.

---

## 2. What was wrong (found by reading the code)

### 2a. Every alert was sent strictly one at a time

`send-web-push/index.ts` had two nested sequential loops: one over outbox rows,
one over each member's devices, with a full HTTPS round trip to a push service
inside both.

A call-out to eight firefighters therefore alerted the eighth person only after
seven prior round trips had completed. At a plausible 200–400 ms per round trip
that is 1.5–3 seconds of pure, avoidable stagger — and the person alerted last
is, by construction, the one the delay is worst for.

**Fixed.** Both loops now run through `mapWithConcurrency` with a bounded pool
of eight. Bounded rather than unbounded because a push service is a shared
resource and a thundering herd is how a society gets rate-limited on the one
night it matters. Every result is settled, so one refused device cannot abandon
another member's alert — the bug an unguarded `Promise.all` would have
introduced while "fixing" the speed.

### 2b. The commander's screen waited for the whole fan-out, with no deadline

`requestPushDelivery` awaited the Edge Function's full response before the
publish confirmation appeared. The publication is already committed at that
point, so the wait bought nothing and cost the commander a spinner for the
duration of every push in the batch.

**Fixed.** The wait now ends after `PUSH_WAKE_TIMEOUT_MS` (5 s). The request is
**not** cancelled — the Supabase client offers no way to — so the worker carries
on sending server-side. Only the waiting stops.

### 2c. Nothing recorded WHICH path sent the alert

This is the important one, and it is why the delay could not previously be
diagnosed at all.

There are two ways an alert gets sent:

- **immediate** — the commander's browser calls `send-web-push` the instant the
  call-out is published;
- **scheduled** — a `pg_cron` job calls the same function once a minute, as
  recovery for anything the immediate path missed.

If the immediate wake-up fails silently — a CORS refusal, an expired token, a
network drop on the commander's phone, an origin mismatch — **everything still
works**, just up to a minute later. That single failure mode explains a
"substantial delay" completely, and `provider_status = 'ACCEPTED'` was recorded
identically for both paths, so there was no way to tell them apart afterwards.

**Fixed.** `provider_status` now records `ACCEPTED_IMMEDIATE` or
`ACCEPTED_SCHEDULED`. `attempted_at` is also written explicitly at the instant
the attempt *starts*, rather than defaulting to the instant the provider
answered, so intervals 2+3 can be separated from interval 4.

No migration was needed: `provider_status` is free text with no check
constraint, `attempted_at` already exists and is settable, and nothing in the
interface reads either column.

### 2d. A row that threw abandoned the rest of the batch

`OUTBOX_CLAIM_FAILED` propagated to the function's outer catch and returned 503,
discarding every remaining member in the batch. One broken row is not a reason
to stop calling out the rest of the crew. Failures are now counted and left for
the scheduler; the response body reports them as `failed`.

---

## 3. What was NOT changed, and why

- **The scheduler still runs once a minute.** It is recovery and repeat, not the
  primary path. Running it more often would paper over a broken immediate
  wake-up rather than reveal one, and the brief is explicit: no schedule change
  without evidence.
- **One repeat, still.** `MAX_ATTEMPTS = 2` and `REPEAT_AFTER_MS = 90_000` are
  untouched. Two is the whole promise the interface makes to a firefighter.
- **Atomic claims, duplicate protection, send-time eligibility re-checks,
  revoked-subscription handling** — all unchanged. Concurrency does not weaken
  them: rows within one invocation are distinct by construction, and the
  conditional claim still settles the race that matters, which is between this
  invocation and the scheduler's.
- **The payload.** Still three fields, still naming an intervention and saying
  nothing whatever about it.

---

## 4. What could not be measured from here

**No hosted timing baseline was captured.** The Supabase MCP connection
available to this environment returned first "requires approval" and then
`You do not have permission to perform this action` on every attempt to read
`notification_outbox` and `notification_delivery_attempts`.

So the following are **unknown** and are stated as unknown:

- how many active subscriptions exist hosted;
- how many WEB_PUSH outbox rows the owner's test produced;
- what the actual `created_at → attempted_at` interval was;
- **whether the owner's delayed notification came through the immediate path or
  the scheduled one** — which is the single most valuable fact, and the reason
  §2c exists.

The changes in §2 are justified by reading the code, not by hosted measurement.
§5 is how the owner closes that gap in about two minutes.

---

## 5. How to measure it — no migration, no new tooling

Run these in the Supabase SQL editor after publishing one **clearly fictional
test** call-out to **one** device you are holding. Never to real firefighters.

### 5a. The one question that matters first

```sql
select
  a.provider_status,
  count(*) as attempts,
  round(avg(extract(epoch from (a.attempted_at - o.created_at)))::numeric, 2) as avg_seconds,
  round(max(extract(epoch from (a.attempted_at - o.created_at)))::numeric, 2) as worst_seconds
from public.notification_delivery_attempts a
join public.notification_outbox o on o.id = a.outbox_id
where o.channel = 'WEB_PUSH'
  and a.attempted_at > now() - interval '1 hour'
group by a.provider_status
order by attempts desc;
```

Read it like this:

- **`ACCEPTED_IMMEDIATE`, avg_seconds under ~2** — the backend is doing its job.
  The delay the owner felt is interval 4 or 5: the push service, the network, or
  iOS. Nothing further to fix on this side; go to §6.
- **`ACCEPTED_SCHEDULED`** — the immediate wake-up did not happen. **This is the
  bug**, and it is worth up to a full minute on its own. Go to §5c.
- **A mixture** — some publications reach the function and some do not.
  Intermittent network from the commander's phone is the likely cause; §5c still
  applies.
- **`HTTP_4xx` / `HTTP_5xx` / `TRANSPORT_ERROR`** — the push service refused.
  The status carries the code; the body is deliberately never stored.
- **`NO_ACTIVE_SUBSCRIPTION`** — the member has no usable device registered.
  Nothing was sent and nothing was going to be.

### 5b. One call-out, row by row

```sql
select
  o.id,
  o.state,
  o.attempt_count,
  o.created_at                                   as queued_at,
  min(a.attempted_at)                            as first_attempt_at,
  extract(epoch from (min(a.attempted_at) - o.created_at)) as backend_seconds,
  string_agg(distinct a.provider_status, ', ')   as statuses
from public.notification_outbox o
left join public.notification_delivery_attempts a on a.outbox_id = o.id
where o.channel = 'WEB_PUSH'
  and o.intervention_id = '<the fictional test intervention id>'
group by o.id, o.state, o.attempt_count, o.created_at
order by o.created_at;
```

`backend_seconds` is intervals 2+3 — the society's own delay, with the push
service's time excluded.

### 5c. If it says `ACCEPTED_SCHEDULED`

The commander's browser is not reaching the Edge Function. Check, in order:

1. **`ALLOWED_ORIGIN`** on the Edge Function must exactly equal the origin the
   application is served from (`https://dado211207.github.io`). A mismatch
   returns 403 to the browser and nothing else anywhere.
2. **The browser console on the commander's device** at the moment of
   publishing. A CORS failure or a 401 shows there and nowhere else — the
   function's own logs never see a request that was refused before it arrived.
3. **The Edge Function logs** for an invocation timestamped within a second or
   two of the publication. No invocation at all means the request did not
   arrive; an invocation that returned 401/403 means it arrived and was refused.
4. **The commander's session.** `functions.invoke` sends the signed-in access
   token; an expired one is refused with `AUTH_REQUIRED`.

### 5d. Provider round-trip time, if intervals 2+3 come back small

Not stored per attempt — deliberately, since it would have needed a migration
for a number that only matters once the backend has been ruled out. If §5a says
the backend is fast and the phone is still slow, the next step is the Edge
Function's own logs: the invocation duration minus `backend_seconds` is the
provider round trip, and that is enough to decide whether to instrument further.

---

## 6. Recording the handset time by hand

Interval 5 is not server-measurable. During a real-device test, with a fictional
call-out sent to one device you are holding:

1. Note the wall-clock second you press **Objavi poziv** (a stopwatch app is
   easier than reading a clock).
2. Note the wall-clock second the phone actually shows the notification.
3. Read `queued_at` and `first_attempt_at` from §5b.

That gives all five intervals:

```
publish → queued_at        interval 1 (should be milliseconds)
queued_at → first_attempt  intervals 2+3  (the backend; §5a)
first_attempt → displayed  intervals 4+5  (provider + handset + OS)
```

Record the device, OS version, whether the app was installed to the Home Screen,
and whether silent mode / Focus / Low Power Mode were on. **Low Power Mode and
Focus both delay or suppress push delivery on iOS**, and a delay measured with
either of them on is a measurement of the phone's settings, not of this system.

---

## 7. What the interface is allowed to claim

Unchanged, and worth restating because this document is about making delivery
faster:

- Publishing a call-out writes obligations. It does not prove anybody was
  reached.
- A push service accepting a message is not a phone ringing.
- Push cannot override silent mode, Focus or Do Not Disturb, and the Settings
  screen says so.
- Web Push is opt-in, per device, and best-effort. **The approved telephone /
  Viber fallback remains the thing a real alarm rests on.**
- This application is not a replacement for calling the official fire service.
