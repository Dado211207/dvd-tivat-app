/**
 * The rule the alarm hook exists for: sound a call-out that JUST APPEARED, never
 * one that was already open when the screen loaded, and never when the choice is
 * off. The player is injected, so this tests the decision, not Web Audio.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallOutAlarm } from './useCallOutAlarm';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({
  ids,
  sound,
  play,
  ready = true,
}: {
  ids: readonly string[];
  sound: string;
  play: (id: string) => void;
  ready?: boolean;
}) {
  useCallOutAlarm(ids, sound, play, ready);
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(ids: readonly string[], sound: string, play: (id: string) => void, ready = true) {
  await act(async () => {
    root.render(<Harness ids={ids} sound={sound} play={play} ready={ready} />);
  });
}

describe('the call-out alarm', () => {
  it('does not mistake the screen’s initial empty loading state for a completed first read', async () => {
    const play = vi.fn();
    await render([], 'siren', play, false);
    await render(['already-open'], 'siren', play, true);
    expect(play).not.toHaveBeenCalled();
    await render(['already-open', 'just-arrived'], 'siren', play, true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not sound the call-outs already open when the screen loads', async () => {
    const play = vi.fn();
    await render(['a', 'b'], 'chime', play);
    expect(play).not.toHaveBeenCalled();
  });

  it('sounds a call-out that appears after the baseline', async () => {
    const play = vi.fn();
    await render(['a'], 'chime', play);
    await render(['a', 'b'], 'chime', play);
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith('chime');
  });

  it('sounds once even when several call-outs arrive at the same time', async () => {
    const play = vi.fn();
    await render(['a'], 'siren', play);
    await render(['a', 'b', 'c'], 'siren', play);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not sound when the choice is off', async () => {
    const play = vi.fn();
    await render(['a'], 'off', play);
    await render(['a', 'b'], 'off', play);
    expect(play).not.toHaveBeenCalled();
  });

  it('does not sound when a call-out closes (an id leaving is not an arrival)', async () => {
    const play = vi.fn();
    await render(['a', 'b'], 'pulse', play);
    await render(['a'], 'pulse', play);
    expect(play).not.toHaveBeenCalled();
  });

  it('does not re-sound the same open call-out on an unrelated re-render', async () => {
    const play = vi.fn();
    await render(['a'], 'chime', play);
    await render(['a', 'b'], 'chime', play);
    expect(play).toHaveBeenCalledTimes(1);
    // Same set again: nothing new, so no further sound.
    await render(['a', 'b'], 'chime', play);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not retroactively sound an open call-out when the choice turns on', async () => {
    const play = vi.fn();
    // Off while a call-out is already open...
    await render(['a'], 'off', play);
    // ...then the person picks a sound. The call-out is not new, so it stays quiet.
    await render(['a'], 'chime', play);
    expect(play).not.toHaveBeenCalled();
  });
});
