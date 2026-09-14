import { accountBackend } from '@/auth/supabaseClient';

export type PushCapability =
  | 'AVAILABLE'
  | 'NOT_CONFIGURED'
  | 'INSTALL_ON_IOS'
  | 'UNSUPPORTED';

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayModeStandalone =
    typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return iosStandalone || displayModeStandalone;
}

export function pushCapability(): PushCapability {
  if (isIos() && !isStandalone()) return 'INSTALL_ON_IOS';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'UNSUPPORTED';
  }
  const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey)) return 'NOT_CONFIGURED';
  return 'AVAILABLE';
}

function applicationServerKey(): Uint8Array<ArrayBuffer> {
  const raw = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY?.trim() ?? '';
  if (raw === '') throw new Error('PUSH_NOT_CONFIGURED');
  const padded = raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(raw.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  const buffer = new ArrayBuffer(bytes.byteLength);
  const key = new Uint8Array(buffer);
  key.set(bytes);
  return key;
}

async function saveSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error('PUSH_KEYS_MISSING');

  const expiration = subscription.expirationTime
    ? new Date(subscription.expirationTime).toISOString()
    : null;
  const { error } = await accountBackend().rpc('register_web_push_subscription', {
    requested_endpoint: subscription.endpoint,
    requested_p256dh: p256dh,
    requested_auth_secret: auth,
    requested_expiration_time: expiration,
    requested_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) {
    const message = typeof error.message === 'string' ? error.message : '';
    if (message.includes('PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT')) {
      throw new Error('PUSH_SUBSCRIPTION_CONFLICT');
    }
    throw new Error('PUSH_REGISTRATION_FAILED');
  }
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (pushCapability() !== 'AVAILABLE') return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enableWebPush(): Promise<PushSubscription> {
  if (pushCapability() !== 'AVAILABLE') throw new Error('PUSH_UNAVAILABLE');

  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== 'granted') throw new Error('PUSH_PERMISSION_DENIED');

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  let created = subscription === null;
  const subscribe = () => registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(),
    });
  subscription ??= await subscribe();

  try {
    await saveSubscription(subscription);
    return subscription;
  } catch (error) {
    // A shared browser profile can still hold the previous signed-in user's
    // endpoint. The server correctly refuses reassignment. Replace that local
    // browser subscription with a new capability URL, without weakening the
    // ownership rule or exposing the previous account.
    if (!created && String(error).includes('PUSH_SUBSCRIPTION_CONFLICT')) {
      await subscription.unsubscribe();
      subscription = await subscribe();
      created = true;
      try {
        await saveSubscription(subscription);
        return subscription;
      } catch (replacementError) {
        await subscription.unsubscribe().catch(() => false);
        throw replacementError;
      }
    }
    if (created) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
}

/**
 * Re-registers a subscription this browser ALREADY holds, and never creates one.
 *
 * The distinction is the whole point. A browser can keep a push subscription
 * the server has lost - a restored profile, a failed registration call, a row
 * removed by hand - and re-sending it is repair. CREATING one here would not be
 * repair, it would be enabling push without being asked.
 *
 * The first draft of this function did create one, and the consequence was
 * worse than the inefficiency: `disableWebPush` unsubscribes locally, so the
 * next time the member opened their call-out screen this function found no
 * subscription, made a new one, and registered it. Turning the alarm off lasted
 * until the next page load. Opt-in has to mean opt-in, so an absent
 * subscription is now simply an absent subscription.
 */
export async function repairWebPushRegistration(): Promise<boolean> {
  if (pushCapability() !== 'AVAILABLE' || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription === null) return false;
  await saveSubscription(subscription);
  return true;
}

export async function disableWebPush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription === null) return;

  const { error } = await accountBackend().rpc('revoke_web_push_subscription', {
    requested_endpoint: subscription.endpoint,
  });
  if (error) throw new Error('PUSH_REVOCATION_FAILED');
  await subscription.unsubscribe();
}

/**
 * How long the commander's screen waits for the worker before moving on.
 *
 * The publication is already committed at this point, so this is not a deadline
 * for the call-out - it is a deadline for the ACKNOWLEDGEMENT. A commander who
 * has just sent a crew to a fire must see the confirmed call-out immediately,
 * not a spinner tied to how fast a push service on another continent answers.
 *
 * Five seconds is long enough for a healthy round trip and short enough that
 * nobody stands waiting. The request is NOT cancelled when it expires - the
 * client library offers no way to - so the worker carries on sending on the
 * server. Only the waiting stops, which is the part a commander can see.
 */
export const PUSH_WAKE_TIMEOUT_MS = 5_000;

/**
 * Wake the server worker after publication. The call-out is already committed
 * if this fails; the outbox stays QUEUED for the scheduled retry and the UI
 * must never turn a failed worker request into a failed publication.
 *
 * Returns whether the worker ANSWERED IN TIME. That is all it can honestly
 * mean: the server took the request and replied. It is not delivery, not
 * acceptance by a push service, and certainly not a phone making a noise.
 */
export async function requestPushDelivery(interventionId: string): Promise<boolean> {
  const wake = accountBackend()
    .functions.invoke('send-web-push', { body: { intervention_id: interventionId } })
    .then(({ error }) => error === null)
    .catch(() => false);

  let expiry: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    expiry = setTimeout(() => resolve(false), PUSH_WAKE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([wake, deadline]);
  } finally {
    clearTimeout(expiry);
  }
}
