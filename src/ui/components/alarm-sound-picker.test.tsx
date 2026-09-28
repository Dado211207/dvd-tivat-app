/**
 * The Settings control for the call-out sound.
 *
 * It appears only for a signed-in person, starts on "no sound" so nobody is made
 * suddenly noisy, remembers a choice per account, and previews a sound when it is
 * chosen (the tap that both auditions it and unlocks audio for the session). The
 * player is injected so the test needs no Web Audio.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessProvider } from '@/auth/AccessProvider';
import type { AccessGateway } from '@/auth/access';
import { resetLanguageForTests } from '@/i18n/language';
import { readAlarmSound } from '@/notifications/alarmSounds';
import { AlarmSoundPicker } from './AlarmSoundPicker';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function signedInGateway(): AccessGateway {
  return {
    currentUser: async () => ({ id: 'user-1', email: 'clan@example.invalid' }),
    fetchProfile: async () => ({ fullName: 'Clan Probni', profileComplete: true }),
    fetchRole: async () => 'FIREFIGHTER',
    fetchAccountStatus: async () => 'ACTIVE',
  };
}

function signedOutGateway(): AccessGateway {
  return {
    currentUser: async () => null,
    fetchProfile: async () => null,
    fetchRole: async () => null,
    fetchAccountStatus: async () => 'ANONYMOUS',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetLanguageForTests();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
  });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const off = () => container.querySelector<HTMLInputElement>('[data-testid="alarm-sound-off"] input');
const sound = (id: string) =>
  container.querySelector<HTMLInputElement>(`[data-testid="alarm-sound-${id}"] input`);

describe('the alarm-sound picker', () => {
  it('shows nothing to a signed-out person', async () => {
    await render(
      <AccessProvider gateway={signedOutGateway()} configured storage={window.localStorage}>
        <AlarmSoundPicker storage={memoryStorage()} play={vi.fn()} />
      </AccessProvider>,
    );
    expect(container.querySelector('[data-testid="alarm-sound-off"]')).toBeNull();
  });

  it('starts on no sound, so an existing user is not suddenly noisy', async () => {
    await render(
      <AccessProvider gateway={signedInGateway()} configured storage={window.localStorage}>
        <AlarmSoundPicker storage={memoryStorage()} play={vi.fn()} />
      </AccessProvider>,
    );
    expect(off()?.checked).toBe(true);
    expect(sound('siren')?.checked).toBe(false);
  });

  it('persists a chosen sound and previews it on selection', async () => {
    const storage = memoryStorage();
    const play = vi.fn();
    await render(
      <AccessProvider gateway={signedInGateway()} configured storage={window.localStorage}>
        <AlarmSoundPicker storage={storage} play={play} />
      </AccessProvider>,
    );

    await act(async () => {
      sound('siren')!.click();
    });

    expect(sound('siren')?.checked).toBe(true);
    // Remembered for this account...
    expect(readAlarmSound(storage, 'user-1')).toBe('siren');
    // ...and auditioned on the tap that chose it.
    expect(play).toHaveBeenCalledWith('siren');
  });

  it('makes no sound when "no sound" is chosen', async () => {
    const storage = memoryStorage();
    const play = vi.fn();
    await render(
      <AccessProvider gateway={signedInGateway()} configured storage={window.localStorage}>
        <AlarmSoundPicker storage={storage} play={play} />
      </AccessProvider>,
    );
    // Choose a sound, then choose off again.
    await act(async () => {
      sound('chime')!.click();
    });
    play.mockClear();
    await act(async () => {
      off()!.click();
    });
    expect(off()?.checked).toBe(true);
    expect(readAlarmSound(storage, 'user-1')).toBe('off');
    expect(play).not.toHaveBeenCalled();
  });
});
