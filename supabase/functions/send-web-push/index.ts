import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';
import { authoriseWake, deliverQueued, type Database } from './deliver.ts';

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
    const interventionId = isUuid(body.intervention_id) ? body.intervention_id : undefined;

    // The service role bypasses row-level security. `deliver.ts` uses the
    // subset of supabase-js it declares; the casts say so rather than claim the
    // library's generic types line up with it.
    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as Database;

    const scheduler = secretMatches(request.headers.get('x-push-worker-secret'), workerSecret);
    if (!scheduler) {
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ')) return response(request, 401, { error: 'AUTH_REQUIRED' });

      const caller = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as Database;
      // Command in the service of the STORED call-out, never anything the
      // request says about a service.
      const decision = await authoriseWake(service, caller, interventionId);
      if (decision === 'COMMAND_REQUIRED') return response(request, 403, { error: 'COMMAND_REQUIRED' });
      if (decision === 'INTERVENTION_ID_REQUIRED') {
        return response(request, 400, { error: 'INTERVENTION_ID_REQUIRED' });
      }
    }

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const tally = await deliverQueued(
      {
        service,
        scheduler,
        send: (target, payload, options) => webpush.sendNotification(target, payload, options),
      },
      interventionId,
    );
    // An alert nobody can write is never handed to the worker. Said where
    // whoever runs the service looks, on every run until somebody repairs it:
    // a count, nothing about whom.
    if (tally.mislabelled) console.warn(JSON.stringify({ event: 'PUSH_ALERTS_MISLABELLED', count: tally.mislabelled }));
    return response(request, 200, { ...tally });
  } catch {
    return response(request, 503, { error: 'PUSH_WORKER_UNAVAILABLE' });
  }
});
