import { beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  rpc: vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null })),
  invoke: vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null })),
}));

vi.mock('@/auth/supabaseClient', () => ({
  accountBackend: () => ({ rpc: backend.rpc, functions: { invoke: backend.invoke } }),
}));

import {
  disableWebPush,
  enableWebPush,
  PUSH_WAKE_TIMEOUT_MS,
  pushCapability,
  repairWebPushRegistration,
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

  it('preserves the server reason when the account is not linked to a member', async () => {
    const browser = installPushBrowser({ permission: 'granted' });
    backend.rpc.mockResolvedValueOnce({ error: new Error('ELIGIBLE_MEMBER_REQUIRED') });

    await expect(enableWebPush()).rejects.toThrow('PUSH_MEMBER_REQUIRED');
    expect(browser.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('preserves the server reason when DVD operational access is missing', async () => {
    const browser = installPushBrowser({ permission: 'granted' });
    backend.rpc.mockResolvedValueOnce({ error: new Error('OPERATIONAL_ACCESS_REQUIRED') });

    await expect(enableWebPush()).rejects.toThrow('PUSH_ACCESS_REQUIRED');
    expect(browser.unsubscribe).toHaveBeenCalledTimes(1);
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

  it('stops waiting for a worker that does not answer, without failing the call-out', async () => {
    // The commander has just sent a crew to a fire. The publication is already
    // committed; holding their screen on a push service somewhere else is a
    // product defect, not caution. The wake-up carries on server-side.
    vi.useFakeTimers();
    try {
      installPushBrowser();
      let settled: boolean | 'pending' = 'pending';
      backend.invoke.mockImplementationOnce(() => new Promise(() => {}));

      const request = requestPushDelivery('11111111-1111-4111-8111-111111111111')
        .then((value) => (settled = value));

      await vi.advanceTimersByTimeAsync(PUSH_WAKE_TIMEOUT_MS - 1);
      expect(settled, 'must not give up early').toBe('pending');

      await vi.advanceTimersByTimeAsync(2);
      await request;
      // False means "not confirmed", and the caller phrases it that way. It
      // must never mean the call-out failed.
      expect(settled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports success when the worker answers inside the deadline', async () => {
    vi.useFakeTimers();
    try {
      installPushBrowser();
      backend.invoke.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve({ error: null }), 200)),
      );
      const request = requestPushDelivery('11111111-1111-4111-8111-111111111111');
      await vi.advanceTimersByTimeAsync(250);
      await expect(request).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Turning the alarm off has to stay off.
 *
 * The first version of `repairWebPushRegistration` created a subscription when
 * it found none, which read as harmless repair and was not: `disableWebPush`
 * unsubscribes locally, so the next time the member opened their call-out
 * screen the repair made a fresh subscription and registered it. The opt-out
 * lasted until the next page load, and nobody would have been told.
 *
 * Repair now means re-registering a subscription the browser ALREADY holds.
 */
describe('repair never enables push for somebody who did not ask', () => {
  it('does nothing at all when this browser holds no subscription', async () => {
    const browser = installPushBrowser({ permission: 'granted' });

    await expect(repairWebPushRegistration()).resolves.toBe(false);

    expect(browser.subscribe, 'repair must never create a subscription').not.toHaveBeenCalled();
    expect(backend.rpc, 'and must never register one').not.toHaveBeenCalled();
  });

  it('re-registers a subscription the browser already holds', async () => {
    // The case repair exists for: the device still has its endpoint, the server
    // lost the row. Nothing is created; the existing endpoint is sent again.
    const browser = installPushBrowser({ permission: 'granted', existingSubscription: true });

    await expect(repairWebPushRegistration()).resolves.toBe(true);

    expect(browser.subscribe).not.toHaveBeenCalled();
    expect(backend.rpc).toHaveBeenCalledWith(
      'register_web_push_subscription',
      expect.objectContaining({ requested_endpoint: browser.oldSubscription.endpoint }),
    );
  });

  it('survives the whole disable-then-revisit journey', async () => {
    // End to end, as a member actually experiences it: switch it off, come
    // back to the screen, and it is still off.
    const browser = installPushBrowser({ permission: 'granted', existingSubscription: true });
    await disableWebPush();
    expect(backend.rpc).toHaveBeenCalledWith(
      'revoke_web_push_subscription',
      expect.objectContaining({ requested_endpoint: browser.oldSubscription.endpoint }),
    );
    expect(browser.oldUnsubscribe).toHaveBeenCalled();

    // The browser now holds nothing, which is what a revisit sees.
    backend.rpc.mockClear();
    const revisit = installPushBrowser({ permission: 'granted' });
    await expect(repairWebPushRegistration()).resolves.toBe(false);
    expect(revisit.subscribe).not.toHaveBeenCalled();
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it('never asks for permission on its own', async () => {
    // Permission is requested from a user action and nowhere else. Repair runs
    // on mount, so it must return before it could ever prompt.
    for (const permission of ['default', 'denied'] as const) {
      const browser = installPushBrowser({ permission, existingSubscription: true });
      await expect(repairWebPushRegistration()).resolves.toBe(false);
      expect(Notification.requestPermission).not.toHaveBeenCalled();
      expect(browser.subscribe).not.toHaveBeenCalled();
      expect(backend.rpc).not.toHaveBeenCalled();
    }
  });

  it('stays out of the way on a browser that cannot do push at all', async () => {
    installPushBrowser({ permission: 'granted', userAgent: 'Mozilla/5.0 (iPhone)' });
    // An iPhone in the browser, not installed: the panel shows installation
    // guidance and nothing may be registered behind it.
    expect(pushCapability()).toBe('INSTALL_ON_IOS');
    await expect(repairWebPushRegistration()).resolves.toBe(false);
    expect(backend.rpc).not.toHaveBeenCalled();
  });
});
