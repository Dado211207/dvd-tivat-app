/**
 * Choosing the sound a call-out makes on THIS device, while the app is open.
 *
 * It lives on Settings beside the push panel because it is the same kind of thing:
 * a property of one browser on one phone, not a fact about an account. It is
 * remembered per signed-in user, so a shared station phone does not give one
 * firefighter another's alarm, and it is shown only to a signed-in person - there
 * is no operational sound to choose for somebody who is signed out.
 *
 * Selecting a sound plays it, which is both the preview and the tap the browser
 * needs before it will make any noise later (the autoplay rule - see
 * `alarmSounds.ts`). The note states the one thing people get wrong about web
 * notifications: this sound is for when the app is OPEN; a notification that
 * arrives with the app closed uses the phone's own sound, set in the phone.
 */

import { useState } from 'react';
import { useAccess } from '@/auth/AccessProvider';
import { useText } from '@/i18n/useText';
import {
  ALARM_SOUNDS,
  ALARM_SOUND_OFF,
  playAlarmSound,
  readAlarmSound,
  writeAlarmSound,
  type AlarmSoundKind,
} from '@/notifications/alarmSounds';

type MaybeStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

function defaultStorage(): MaybeStorage {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export interface AlarmSoundPickerProps {
  /** Injected in tests; production uses this device's localStorage. */
  readonly storage?: MaybeStorage;
  /** Injected in tests, so a preview does not need Web Audio. */
  readonly play?: (id: string) => void | Promise<boolean | void>;
}

export function AlarmSoundPicker({ storage, play }: AlarmSoundPickerProps) {
  const { access } = useAccess();
  // Nothing to choose for somebody who is signed out: there is no operational
  // call-out to sound, and the choice is remembered against a user id.
  if (access.kind !== 'SIGNED_IN') return null;
  return <Picker userId={access.userId} storage={storage ?? defaultStorage()} play={play ?? playAlarmSound} />;
}

function Picker({
  userId,
  storage,
  play,
}: {
  userId: string;
  storage: MaybeStorage;
  play: (id: string) => void | Promise<boolean | void>;
}) {
  const t = useText();
  const [soundId, setSoundId] = useState(() => readAlarmSound(storage, userId));

  const choose = (id: string) => {
    writeAlarmSound(storage, userId, id);
    setSoundId(id);
    // Selecting is a user gesture, so this both auditions the choice and unlocks
    // audio for the session. `off` makes no sound, by definition.
    if (id !== ALARM_SOUND_OFF) void play(id);
  };

  const groups: readonly { kind: AlarmSoundKind; label: string }[] = [
    { kind: 'ordinary', label: t.settings.alarm.groupOrdinary },
    { kind: 'alarm', label: t.settings.alarm.groupAlarm },
  ];
  // The names object has fixed keys in the type; the sound ids are plain strings,
  // so read it through an index signature and fall back to the id if one is missing.
  const soundName = t.settings.alarm.names as Record<string, string>;

  return (
    <section className="panel" aria-labelledby="settings-alarm">
      <h2 className="panel__title" id="settings-alarm">
        {t.settings.alarm.title}
      </h2>
      <p className="muted small">{t.settings.alarm.lead}</p>

      <fieldset className="choice-set">
        <legend className="choice-set__legend">{t.settings.alarm.legend}</legend>

        <div className="choice-set__options">
          <label
            className={`choice${soundId === ALARM_SOUND_OFF ? ' choice--on' : ''}`}
            data-testid="alarm-sound-off"
          >
            <input
              type="radio"
              name="alarm-sound"
              value={ALARM_SOUND_OFF}
              checked={soundId === ALARM_SOUND_OFF}
              onChange={() => choose(ALARM_SOUND_OFF)}
            />
            <span className="choice__label">{t.settings.alarm.off}</span>
          </label>
        </div>

        {groups.map((group) => (
          <div key={group.kind} className="alarm-group">
            <p className="alarm-group__label muted small">{group.label}</p>
            <div className="choice-set__options">
              {ALARM_SOUNDS.filter((sound) => sound.kind === group.kind).map((sound) => (
                <label
                  key={sound.id}
                  className={`choice${soundId === sound.id ? ' choice--on' : ''}`}
                  data-testid={`alarm-sound-${sound.id}`}
                >
                  <input
                    type="radio"
                    name="alarm-sound"
                    value={sound.id}
                    checked={soundId === sound.id}
                    onChange={() => choose(sound.id)}
                  />
                  <span className="choice__label">{soundName[sound.id] ?? sound.id}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      <div className="row-actions">
        <button
          type="button"
          className="btn btn--ghost"
          data-testid="alarm-sound-preview"
          disabled={soundId === ALARM_SOUND_OFF}
          onClick={() => void play(soundId)}
        >
          {t.settings.alarm.preview}
        </button>
      </div>

      {/* The one thing people get wrong about web notifications, said plainly. */}
      <p className="muted small">{t.settings.alarm.foregroundNote}</p>
    </section>
  );
}
