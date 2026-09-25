# Web Push deployment

This function sends a privacy-safe operational alert for queued `WEB_PUSH`
outbox rows. Source code alone is not a deployed notification service.

## Server-only configuration

Set these as Supabase Edge Function secrets. Never put them in a `VITE_*`
variable, GitHub Pages build, tracked file, issue, log or screenshot:

- `VAPID_PRIVATE_KEY`
- `PUSH_WORKER_SECRET` — a separate high-entropy value for the scheduler
- `SUPABASE_SERVICE_ROLE_KEY` — normally supplied by the Edge runtime

Also set:

- `VAPID_PUBLIC_KEY`
- `VAPID_SUBJECT` — the public application URL is suitable
- `ALLOWED_ORIGIN=https://dado211207.github.io`

Deploy `send-web-push` with the repository's `supabase/config.toml`. JWT
verification is disabled at the gateway because a scheduled invocation has no
user JWT; the function itself requires either the server-only
`x-push-worker-secret` header or a signed-in account with command in the
service of the call-out the request names, read from the stored call-out.

Deploy it together with migration `202609250032` or later: the worker asks the
database `push_delivery_verdict()` about every queued alert and, without that
function, counts each one as failed and sends nothing.

## Where the service boundary is

The worker holds the service-role key, which bypasses row-level security. No
policy bounds what it reads or sends, so:

- whether an alert may still be sent is answered by `push_delivery_verdict()`
  from the stored alert, call-out and member, in the service of the call-out -
  never from anything a request carries;
- an alert whose call-out or member is not in its service is set aside unsent
  (`delivery_close_reason = 'SERVICE_MISMATCH'`);
- a device belongs to the account, so somebody serving in two services has one
  device, reached as whichever member each call-out was sent to.

`deliver.ts` holds the queries and the wake-up check; `index.ts` only builds the
clients. `db-tests/push_service.test.ts` runs `deliver.ts` as the service role
against the test database, with a push service that records and sends nothing.

## Public build configuration

Set the matching public key as the GitHub Actions repository variable
`VITE_WEB_PUSH_PUBLIC_KEY`. It is intentionally public and is the only VAPID key
that may enter the browser bundle.

## Bounded repeat

Configure Supabase Cron to POST to the function every minute with
`x-push-worker-secret`. Store that header value in Supabase Vault or the
dashboard's protected secret mechanism; do not paste it into SQL tracked by
this repository.

The immediate post-publication request performs attempt one. A scheduled run
may perform exactly one repeat after 90 seconds, and only if the recipient has
not opened that intervention. Atomic state/attempt matching prevents concurrent
workers from both claiming the same attempt.

## Acceptance before operational use

1. Apply and fingerprint migration `202609150012` on the hosted project.
2. Deploy the function and configure the secrets and one-minute schedule.
3. Deploy Pages with the matching public VAPID key.
4. On every test device, sign in and explicitly enable notifications.
5. Publish a fictional call-out while the installed PWA is closed.
6. Record provider attempt, notification arrival, sound/vibration observed,
   notification press, protected deep link and member opening as separate facts.
7. Repeat on iPhone Home Screen PWA and Android, including locked screen, silent
   mode, Focus/Do Not Disturb, Wi-Fi and mobile data.

A passing browser test does not prove a physical phone alarm. Web Push cannot
promise a custom siren or override device sound, Focus, battery or platform
policy. Keep the society's approved telephone/Viber fallback until field
measurements support a different operational decision.
