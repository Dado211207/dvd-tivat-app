/**
 * The call-out sound this account chose on this device, kept current.
 *
 * Reads the per-account choice from storage and re-reads it whenever the Settings
 * picker writes a new one in the same tab (`subscribeAlarmSoundChange`). So the
 * app-level alarm listener honours a change made on the Settings screen without a
 * reload or a remount, and a shared device that switches account remounts the
 * listener (keyed by user id), which re-seeds this from the new account's choice.
 * Absent storage or an unknown value degrades to the silent default.
 */

import { useEffect, useState } from 'react';
import { readAlarmSound, subscribeAlarmSoundChange } from './alarmSounds';

type MaybeStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

function defaultStorage(): MaybeStorage {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function useAlarmSound(userId: string, storage: MaybeStorage = defaultStorage()): string {
  const [choice, setChoice] = useState(() => readAlarmSound(storage, userId));
  useEffect(() => {
    // Re-seed on mount for this account, then follow same-tab writes.
    setChoice(readAlarmSound(storage, userId));
    return subscribeAlarmSoundChange(() => setChoice(readAlarmSound(storage, userId)));
  }, [userId, storage]);
  return choice;
}
