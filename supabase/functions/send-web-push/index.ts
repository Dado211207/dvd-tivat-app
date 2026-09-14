import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';
import {
  alertPayload,
  attemptsRemain,
  holdForNow,
  isRepeat,
  MAX_ATTEMPTS,
  stillEligible,
  subscriptionUsable,
} from './policy.ts';

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://dado211207.github.io';

function headers(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-worker-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function response(request: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

function requiredSecret(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

/**
 * Compares the scheduler's secret without leaking its length or prefix through
 * timing. `===` on a string short-circuits at the first differing byte, which
 * over enough requests is measurable; this always walks the full width.
 */
function secretMatches(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request) });
  if (request.method !== 'POST') return response(request, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (request.headers.get('origin') && request.headers.get('origin') !== allowedOrigin) {
    return response(request, 403, { error: 'ORIGIN_NOT_ALLOWED' });
  }

  try {
    const supabaseUrl = requiredSecret('SUPABASE_URL');
    const anonKey = requiredSecret('SUPABASE_ANON_KEY');
    const serviceKey = requiredSecret('SUPABASE_SERVICE_ROLE_KEY');
    const workerSecret = requiredSecret('PUSH_WORKER_SECRET');
    const vapidSubject = requiredSecret('VAPID_SUBJECT');
    const vapidPublic = requiredSecret('VAPID_PUBLIC_KEY');
    const vapidPrivate = requiredSecret('VAPID_PRIVATE_KEY');

    let body: { intervention_id?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      return response(request, 400, { error: 'INVALID_JSON' });
    }
    if (body.intervention_id !== undefined && !isUuid(body.intervention_id)) {
      return response(request, 400, { error: 'INVALID_INTERVENTION_ID' });
    }

    const scheduler = secretMatches(request.headers.get('x-push-worker-secret'), workerSecret);
    if (!scheduler) {
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ')) return response(request, 401, { error: 'AUTH_REQUIRED' });

      const caller = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: role, error: roleError } = await caller.rpc('current_dvd_role');
      if (roleError || !['OWNER', 'ADMIN', 'COMMANDER'].includes(String(role))) {
        return response(request, 403, { error: 'COMMAND_REQUIRED' });
      }
      if (!isUuid(body.intervention_id)) {
        return response(request, 400, { error: 'INTERVENTION_ID_REQUIRED' });
      }
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let outboxQuery = service
      .from('notification_outbox')
      .select('id, intervention_id, member_id, state, attempt_count, created_at, updated_at')
      .eq('channel', 'WEB_PUSH')
      .is('delivery_closed_at', null)
      .in('state', ['QUEUED', 'SENT_TO_PROVIDER', 'PROVIDER_ACCEPTED', 'PROVIDER_REJECTED'])
      .lt('attempt_count', MAX_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(50);
    if (isUuid(body.intervention_id)) outboxQuery = outboxQuery.eq('intervention_id', body.intervention_id);

    const { data: rows, error: rowsError } = await outboxQuery;
    if (rowsError) throw new Error('OUTBOX_READ_FAILED');

    let accepted = 0;
    let rejected = 0;
    let skipped = 0;

    for (const row of rows ?? []) {
      const state = String(row.state);
      const repeat = isRepeat(state);
      // Both waits, and the attempt ceiling, live in `policy.ts` where they are
      // tested. The filter above narrows the read; this is the real decision.
      if (holdForNow(state, row.updated_at as string | null, Date.now())) {
        skipped += 1;
        continue;
      }
      if (!attemptsRemain(Number(row.attempt_count))) {
        skipped += 1;
        continue;
      }

      /*
       * Somebody who has already opened the call-out is not alarmed again.
       *
       * This used to run only before a REPEAT, which left a real hole on the
       * recovery path: a QUEUED row whose immediate wake-up failed can sit for
       * minutes, and the member may have opened the intervention through the
       * in-app path in the meantime. The scheduler would then set off an alarm
       * about something they are already looking at. Checked for every row now,
       * first attempt included.
       */
      const { data: opened } = await service
        .from('intervention_acknowledgements')
        .select('intervention_id')
        .eq('intervention_id', row.intervention_id)
        .eq('member_id', row.member_id)
        .maybeSingle();
      if (opened) {
        await service.from('notification_outbox').update({
          delivery_closed_at: new Date().toISOString(),
          delivery_close_reason: 'MEMBER_OPENED',
          updated_at: new Date().toISOString(),
        }).eq('id', row.id).eq('state', state).eq('attempt_count', row.attempt_count);
        skipped += 1;
        continue;
      }

      const { data: member } = await service
        .from('members')
        .select('user_id, active')
        .eq('id', row.member_id)
        .single();

      const userId = member?.user_id;
      const [{ data: profile }, { data: grant }] = userId
        ? await Promise.all([
            service.from('profiles').select('profile_complete').eq('user_id', userId).maybeSingle(),
            service.from('access_grants').select('active, role').eq('user_id', userId).maybeSingle(),
          ])
        : [{ data: null }, { data: null }];

      const eligible = stillEligible({
        memberActive: member?.active,
        userId,
        profileComplete: profile?.profile_complete,
        grantActive: grant?.active,
        grantRole: grant?.role,
      });

      const nextAttempt = Number(row.attempt_count) + 1;
      const claimedAt = new Date().toISOString();
      const { data: claimed, error: claimError } = await service
        .from('notification_outbox')
        .update({ state: 'SENT_TO_PROVIDER', attempt_count: nextAttempt, updated_at: claimedAt })
        .eq('id', row.id)
        .eq('state', state)
        .eq('attempt_count', row.attempt_count)
        .select('id')
        .maybeSingle();
      if (claimError) throw new Error('OUTBOX_CLAIM_FAILED');
      if (!claimed) {
        skipped += 1;
        continue;
      }

      if (!eligible) {
        await service.from('notification_delivery_attempts').insert({
          outbox_id: row.id,
          provider: 'WEB_PUSH',
          provider_status: 'ACCESS_REVOKED',
          provider_message: null,
        });
        await service.from('notification_outbox').update({
          state: 'FAILED', updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        rejected += 1;
        continue;
      }

      const { data: subscriptions } = await service
        .from('web_push_subscriptions')
        .select('id, endpoint, p256dh, auth_secret, expiration_time')
        .eq('user_id', userId)
        .is('revoked_at', null);

      const activeSubscriptions = (subscriptions ?? []).filter((subscription) =>
        subscriptionUsable(subscription.expiration_time as string | null, Date.now()));
      if (activeSubscriptions.length === 0) {
        await service.from('notification_delivery_attempts').insert({
          outbox_id: row.id, provider: 'WEB_PUSH', provider_status: 'NO_ACTIVE_SUBSCRIPTION',
          provider_message: null,
        });
        await service.from('notification_outbox').update({
          state: 'FAILED', updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        rejected += 1;
        continue;
      }

      const { data: intervention } = await service
        .from('interventions')
        .select('published_at')
        .eq('id', row.intervention_id)
        .single();
      // The only place a payload is built. See `alertPayload` for the whole
      // argument about what a locked screen may be allowed to say.
      const payload = alertPayload({
        interventionId: String(row.intervention_id),
        publishedAt: intervention?.published_at ? Date.parse(intervention.published_at) : Date.now(),
        repeat,
      });

      let rowAccepted = false;
      for (const subscription of activeSubscriptions) {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
            },
            payload,
            { TTL: 180, urgency: 'high', topic: `dvd-${String(row.intervention_id).slice(0, 20)}` },
          );
          rowAccepted = true;
          await service.from('web_push_subscriptions').update({
            last_used_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }).eq('id', subscription.id);
          await service.from('notification_delivery_attempts').insert({
            outbox_id: row.id, provider: 'WEB_PUSH', provider_status: 'ACCEPTED', provider_message: null,
          });
        } catch (error) {
          const statusCode = Number((error as { statusCode?: unknown }).statusCode ?? 0);
          if (statusCode === 404 || statusCode === 410) {
            await service.from('web_push_subscriptions').update({
              revoked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            }).eq('id', subscription.id);
          }
          await service.from('notification_delivery_attempts').insert({
            outbox_id: row.id,
            provider: 'WEB_PUSH',
            provider_status: statusCode > 0 ? `HTTP_${statusCode}` : 'TRANSPORT_ERROR',
            provider_message: null,
          });
        }
      }

      await service.from('notification_outbox').update({
        state: rowAccepted ? 'PROVIDER_ACCEPTED' : 'PROVIDER_REJECTED',
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      if (rowAccepted) accepted += 1;
      else rejected += 1;
    }

    return response(request, 200, { accepted, rejected, skipped });
  } catch {
    return response(request, 503, { error: 'PUSH_WORKER_UNAVAILABLE' });
  }
});
