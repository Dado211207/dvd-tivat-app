/**
 * What the person actually reads when notifications will not turn on.
 *
 * The classification lives in `push.ts` and is tested there. This is the other
 * half: that the reason survives the trip to the screen. The defect being
 * pinned was visible only here - the owner of this system read "check the
 * connection" on a working connection, and the application never told him the
 * real reason was that his account had no member record.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/strings.en';
import { setActiveLanguage } from '@/i18n/language';
import { me } from '@/i18n/strings.me';
import { PushNotificationPanel } from './PushNotificationPanel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enableWebPush = vi.fn();

vi.mock('@/notifications/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/notifications/push')>();
  return {
    ...real,
    pushCapability: () => 'AVAILABLE' as const,
    currentPushSubscription: async () => null,
    enableWebPush: () => enableWebPush(),
    disableWebPush: async () => undefined,
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  enableWebPush.mockReset();
  setActiveLanguage('me');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setActiveLanguage('me');
});

/** Mounts the panel and presses the one button on it. */
async function pressEnable(): Promise<string> {
  await act(async () => {
    root.render(<PushNotificationPanel />);
  });
  const button = container.querySelector('button');
  if (button === null) throw new Error('the panel offered no button to press');
  await act(async () => {
    button.click();
  });
  // The notice's own decorative "!" glyph is a sibling of the message, so the
  // message div is what gets read rather than the whole notice.
  return container.querySelector('[data-testid="push-failure"] > div')?.textContent ?? '';
}

describe('the screen says why notifications did not turn on', () => {
  it('tells an unlinked account to add and link its member record', async () => {
    enableWebPush.mockRejectedValue(new Error('PUSH_MEMBER_REQUIRED'));

    const shown = await pressEnable();

    expect(shown).toBe(me.push.memberRequired);
    // The precise defect: this sentence must not appear for a server refusal.
    expect(shown).not.toBe(me.push.failed);
    expect(shown).not.toMatch(/provjerite vezu/i);
  });

  it('tells an account with no operational role what is missing', async () => {
    enableWebPush.mockRejectedValue(new Error('PUSH_ACCESS_REQUIRED'));

    const shown = await pressEnable();

    expect(shown).toBe(me.push.accessRequired);
    expect(shown).not.toMatch(/provjerite vezu/i);
  });

  it('does not blame the connection for a refusal it cannot name', async () => {
    enableWebPush.mockRejectedValue(new Error('PUSH_SERVER_REFUSED'));

    const shown = await pressEnable();

    expect(shown).toBe(me.push.serverRefused);
    expect(shown).not.toMatch(/provjerite vezu/i);
  });

  it('does blame the connection when the server was never reached', async () => {
    enableWebPush.mockRejectedValue(new Error('PUSH_UNREACHABLE'));

    const shown = await pressEnable();

    expect(shown).toBe(me.push.unreachable);
    expect(shown).toMatch(/provjerite vezu/i);
  });

  it('keeps the old wording for a throw that carries no reason at all', async () => {
    enableWebPush.mockRejectedValue(new Error('something nobody anticipated'));

    // Inventing a cause would be the same failure in the other direction.
    expect(await pressEnable()).toBe(me.push.failed);
  });

  it('says the same thing in English', async () => {
    setActiveLanguage('en');
    enableWebPush.mockRejectedValue(new Error('PUSH_MEMBER_REQUIRED'));

    const shown = await pressEnable();

    expect(shown).toBe(en.push.memberRequired);
    expect(shown).not.toMatch(/check the connection/i);
  });
});
