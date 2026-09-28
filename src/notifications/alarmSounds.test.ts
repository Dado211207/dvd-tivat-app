/**
 * The call-out sound's data rules: which ids are legitimate, how the choice is
 * remembered, and that nothing here throws where storage or Web Audio is absent.
 *
 * The synthesis itself (oscillators, gain envelopes) needs a real AudioContext,
 * which a test DOM does not have; `playAlarmSound` is asserted only to FAIL SOFT
 * there, which is the property the callers depend on.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ALARM_SOUNDS,
  ALARM_SOUND_IDS,
  ALARM_SOUND_OFF,
  asAlarmSoundId,
  playAlarmSound,
  readAlarmSound,
  writeAlarmSound,
} from './alarmSounds';

/** A minimal in-memory Storage stand-in. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('the sound catalogue', () => {
  it('offers a few ordinary and a few alarm sounds, each with a distinct id', () => {
    const ordinary = ALARM_SOUNDS.filter((s) => s.kind === 'ordinary');
    const alarm = ALARM_SOUNDS.filter((s) => s.kind === 'alarm');
    expect(ordinary.length).toBeGreaterThanOrEqual(2);
    expect(alarm.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ALARM_SOUNDS.map((s) => s.id)).size).toBe(ALARM_SOUNDS.length);
    // Every sound actually has something to play.
    for (const sound of ALARM_SOUNDS) expect(sound.tones.length).toBeGreaterThan(0);
  });

  it('treats off as a legitimate id and the default', () => {
    expect(ALARM_SOUND_IDS).toContain(ALARM_SOUND_OFF);
    expect(asAlarmSoundId(undefined)).toBe(ALARM_SOUND_OFF);
    expect(asAlarmSoundId(null)).toBe(ALARM_SOUND_OFF);
    expect(asAlarmSoundId('nonsense')).toBe(ALARM_SOUND_OFF);
    expect(asAlarmSoundId('chime')).toBe('chime');
  });
});

describe('remembering the choice, per account, on this device', () => {
  it('defaults to off when nothing is stored', () => {
    expect(readAlarmSound(memoryStorage(), 'user-1')).toBe(ALARM_SOUND_OFF);
  });

  it('round-trips a valid choice', () => {
    const storage = memoryStorage();
    writeAlarmSound(storage, 'user-1', 'siren');
    expect(readAlarmSound(storage, 'user-1')).toBe('siren');
  });

  it('does not leak one account\'s choice to another on a shared device', () => {
    const storage = memoryStorage();
    writeAlarmSound(storage, 'user-1', 'urgent');
    // A second account on the same phone has made no choice and hears nothing.
    expect(readAlarmSound(storage, 'user-2')).toBe(ALARM_SOUND_OFF);
  });

  it('refuses to store an unrecognised id, keeping the value legitimate', () => {
    const storage = memoryStorage();
    writeAlarmSound(storage, 'user-1', 'nonsense');
    expect(readAlarmSound(storage, 'user-1')).toBe(ALARM_SOUND_OFF);
  });

  it('degrades to off, never throws, when storage is missing or refuses', () => {
    expect(readAlarmSound(null, 'user-1')).toBe(ALARM_SOUND_OFF);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readAlarmSound(throwing, 'user-1')).toBe(ALARM_SOUND_OFF);
    expect(() => writeAlarmSound(throwing, 'user-1', 'chime')).not.toThrow();
    expect(() => writeAlarmSound(null, 'user-1', 'chime')).not.toThrow();
  });
});

describe('playing a sound where Web Audio is unavailable', () => {
  it('returns false rather than throwing for an unknown id', async () => {
    await expect(playAlarmSound('nonsense')).resolves.toBe(false);
    await expect(playAlarmSound(ALARM_SOUND_OFF)).resolves.toBe(false);
  });

  it('returns false in a test DOM that has no AudioContext', async () => {
    // jsdom has no AudioContext; the player must fail soft, never throw.
    const original = (globalThis as { AudioContext?: unknown }).AudioContext;
    vi.stubGlobal('AudioContext', undefined);
    await expect(playAlarmSound('chime')).resolves.toBe(false);
    if (original !== undefined) vi.stubGlobal('AudioContext', original);
    else vi.unstubAllGlobals();
  });
});
