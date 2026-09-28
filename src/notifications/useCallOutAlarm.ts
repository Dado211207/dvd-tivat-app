/**
 * Make a sound when a NEW call-out appears while the firefighter's screen is open.
 *
 * The rule that matters: it fires on a call-out that WAS NOT THERE A MOMENT AGO,
 * never on the ones already open when the screen loads. Somebody opening the app
 * to a call-out that has been running for an hour must not have it shriek at them;
 * somebody watching the screen when a fresh call-out arrives should hear it. So the
 * first list the hook sees only establishes the baseline, silently, and only an id
 * that appears AFTER that baseline sounds.
 *
 * The set of ids is passed in already scoped by the caller - it is the open
 * call-outs the server returned for this member in every service they belong to -
 * so this hook makes no authority decision and reaches no other service. It plays
 * whatever the person chose; `off` (the default) plays nothing.
 *
 * `play` is injected so the decision logic can be tested without Web Audio, which
 * does not exist in a test DOM. In the app it defaults to the real synthesiser.
 */

import { useEffect, useRef } from 'react';
import { ALARM_SOUND_OFF, playAlarmSound } from './alarmSounds';

export function useCallOutAlarm(
  openInterventionIds: readonly string[],
  soundId: string,
  play: (id: string) => void | Promise<boolean | void> = playAlarmSound,
  ready = true,
  baselineToken = 0,
): void {
  // A stable key so the effect runs when the SET of open ids changes, not on
  // every render that happens to rebuild the array.
  const key = [...openInterventionIds].sort().join('|');
  // Null until the first list arrives: that first list is the baseline and must
  // never sound, however many call-outs are already open in it.
  const known = useRef<Set<string> | null>(null);
  const lastBaselineToken = useRef(baselineToken);

  useEffect(() => {
    // The screen starts with an empty local placeholder before its first
    // server read. That placeholder is not a baseline: treating it as one
    // sounds every already-running call-out when the page first loads.
    if (!ready) return;
    const ids = new Set(key === '' ? [] : key.split('|'));
    if (lastBaselineToken.current !== baselineToken) {
      // Returning to a hidden tab is a catch-up read. Treat its successful
      // snapshot as the new baseline; only later arrivals may sound.
      lastBaselineToken.current = baselineToken;
      known.current = ids;
      return;
    }
    const previous = known.current;
    known.current = ids;
    if (previous === null) return; // baseline only
    if (soundId === ALARM_SOUND_OFF) return;
    for (const id of ids) {
      if (!previous.has(id)) {
        void play(soundId);
        return; // one sound per change, however many arrived at once
      }
    }
  }, [key, soundId, play, ready, baselineToken]);
}
