import { beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  rpc: vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null })),
  invoke: vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null })),
}));

vi.mock('@/auth/supabaseClient', () => ({
  accountBackend: () => ({ rpc: backend.rpc, functions: { invoke: backend.invoke } }),
}));

import {
  enableWebPush,
  pushCapability,
  requestPushDelivery,
} from './push';

function installPushBrowser(options: {
  permission?: NotificationPermission;
  userAgent?: string;
  standalone?: boolean;
  existingSubscription?: boolean;
} = {}) {
  const unsubscribe = vi.fn(async () => true);
  const subscription = {
    endpoint: 'https://push.example.test/device/1234567890',
    expirationTime: null,
    toJSON: () => ({ keys: { p256dh: 'A'.repeat(65), auth: 'B'.repeat(24) } }),
    unsubscribe,
  } as unknown as PushSubscription;
  const oldUnsubscribe = vi.fn(async () => true);
  const oldSubscription = {
    endpoint: 'https://push.example.test/device/previous-account',
    expirationTime: null,
    toJSON: () => ({ keys: { p256dh: 'C'.repeat(65), auth: 'D'.repeat(24) } }),
    unsubscribe: oldUnsubscribe,
  } as unknown as PushSubscription;
  const subscribe = vi.fn(async () => subscription);
  const getSubscription = vi.fn(async () => options.existingSubscription ? oldSubscription : null);
  const registration = { pushManager: { subscribe, getSubscription } };

  vi.stubGlobal('navigator', {
    userAgent: options.userAgent ?? 'Mozilla/5.0 Chrome/140',
    standalone: options.standalone ?? false,
    serviceWorker: { ready: Promise.resolve(registration) },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', {
    permission: options.permission ?? 'default',
    requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
  });
  vi.stubEnv(
    'VITE_WEB_PUSH_PUBLIC_KEY',
    'BAHG83sVfVr4AkBbEq7ZToutj72OaZ_v9_WcCGamyx_JTDN599x38fbnGT4C3GCRaftZHgZOtkmVNhg2DL5e7ms',
  );

  return { subscribe, getSubscription, subscription, unsubscribe, oldSubscription, oldUnsubscribe };
}

describe('device-bound Web Push client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    backend.rpc.mockReset();
    backend.rpc.mockResolvedValue({ error: null });
    backend.invoke.mockReset();
    backend.invoke.mockResolvedValue({ error: null });
    window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
  });

  it('requires installation before asking for notification permission on iPhone', () => {
    installPushBrowser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    expect(pushCapability()).toBe('INSTALL_ON_IOS');
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('subscribes only after a user action and stores the device under the signed-in account', async () => {
    const browser = installPushBrowser();
    await enableWebPush();

    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) }),
    );
    expect(backend.rpc).toHaveBeenCalledWith(
      'register_web_push_subscription',
      expect.objectContaining({
        requested_endpoint: browser.subscription.endpoint,
        requested_p256dh: 'A'.repeat(65),
        requested_auth_secret: 'B'.repeat(24),
      }),
    );
  });

  it('does not create a subscription when permission is denied', async () => {
    const browser = installPushBrowser({ permission: 'denied' });
    await expect(enableWebPush()).rejects.toThrow('PUSH_PERMISSION_DENIED');
    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('replaces a previous account subscription in a shared browser without reassigning it', async () => {
    const browser = installPushBrowser({ permission: 'granted', existingSubscription: true });
    backend.rpc
      .mockResolvedValueOnce({ error: new Error('PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT') })
      .mockResolvedValueOnce({ error: null });

    await expect(enableWebPush()).resolves.toBe(browser.subscription);
    expect(browser.oldUnsubscribe).toHaveBeenCalledTimes(1);
    expect(browser.subscribe).toHaveBeenCalledTimes(1);
    expect(backend.rpc).toHaveBeenCalledTimes(2);
  });

  it('reports worker invocation failure without undoing the published call-out', async () => {
    installPushBrowser();
    backend.invoke.mockResolvedValueOnce({ error: new Error('unreachable') });
    await expect(requestPushDelivery('11111111-1111-4111-8111-111111111111')).resolves.toBe(false);
    expect(backend.invoke).toHaveBeenCalledWith('send-web-push', {
      body: { intervention_id: '11111111-1111-4111-8111-111111111111' },
    });
  });
});
