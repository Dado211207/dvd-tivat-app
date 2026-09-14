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

export async function repairWebPushRegistration(): Promise<boolean> {
  if (pushCapability() !== 'AVAILABLE' || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(),
    }));
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
 * Wake the server worker after publication. The call-out is already committed
 * if this fails; the outbox stays QUEUED for the scheduled retry and the UI
 * must never turn a failed worker request into a failed publication.
 */
export async function requestPushDelivery(interventionId: string): Promise<boolean> {
  try {
    const { error } = await accountBackend().functions.invoke('send-web-push', {
      body: { intervention_id: interventionId },
    });
    return error === null;
  } catch {
    return false;
  }
}
