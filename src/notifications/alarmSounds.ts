/**
 * The sound a call-out makes ON THIS DEVICE, WHILE THE APP IS OPEN.
 *
 * ---------------------------------------------------------------------------
 * WHAT A WEB APP CAN AND CANNOT PROMISE ABOUT SOUND
 * ---------------------------------------------------------------------------
 *
 * This is the one honest boundary the whole feature is built around.
 *
 * - **App open (foreground):** the page can play a sound of its own choosing.
 *   That is what this module does, and it is the only sound the application
 *   itself controls.
 * - **App closed or backgrounded (a Web Push notification):** the sound is the
 *   phone's, not ours. `ServiceWorkerRegistration.showNotification` has no way to
 *   name a sound file - the `silent` flag only turns the device's own sound on or
 *   off - so which noise a notification makes is a setting on the phone, on every
 *   platform including an installed iOS PWA. The Settings screen says exactly this
 *   rather than implying a choice the platform does not offer.
 *
 * So these sounds are SYNTHESISED with the Web Audio API rather than shipped as
 * audio files: they are unambiguously original (nothing to licence or attribute),
 * they add nothing to the bundle, and there is no file to fail to load on a phone
 * with one bar of signal. Kept short and gentle on purpose - a station phone that
 * shrieks is a phone that gets muted.
 *
 * ---------------------------------------------------------------------------
 * THE AUTOPLAY RULE
 * ---------------------------------------------------------------------------
 *
 * A browser will not let a page make noise until the person has interacted with
 * it at least once (the "user activation" rule). A sound fired by a live update,
 * with no prior tap, is blocked and its promise rejects. So every path here fails
 * SILENTLY and reports whether it actually sounded: the Settings preview doubles
 * as the tap that unlocks audio for the session, and the caller never treats a
 * blocked sound as an error.
 */

/** The two families the picker groups sounds under. */
export type AlarmSoundKind = 'ordinary' | 'alarm';

/** The stored value meaning "make no sound in the app". The default. */
export const ALARM_SOUND_OFF = 'off';

interface ToneStep {
  /** Pitch in Hz. */
  readonly freq: number;
  /** Start offset from the beginning of the sound, in milliseconds. */
  readonly atMs: number;
  /** How long the tone sounds, in milliseconds. */
  readonly durMs: number;
  /** Oscillator shape. `sine` is soft; `square`/`triangle` cut through noise. */
  readonly type?: OscillatorType;
  /** Peak loudness, 0..1. Kept well below 1 so nothing is piercing. */
  readonly peak?: number;
}

export interface AlarmSoundDef {
  readonly id: string;
  readonly kind: AlarmSoundKind;
  readonly tones: readonly ToneStep[];
}

/**
 * Three gentle sounds and three insistent ones.
 *
 * The ordinary set is for somebody who wants a quiet acknowledgement; the alarm
 * set is for somebody who needs to be pulled away from something else. None runs
 * longer than about a second - a call-out already shows on the screen, this only
 * has to turn a head.
 */
export const ALARM_SOUNDS: readonly AlarmSoundDef[] = [
  // --- ordinary ---------------------------------------------------------------
  {
    id: 'chime',
    kind: 'ordinary',
    tones: [{ freq: 880, atMs: 0, durMs: 450, type: 'sine', peak: 0.22 }],
  },
  {
    id: 'twotone',
    kind: 'ordinary',
    tones: [
      { freq: 659.25, atMs: 0, durMs: 200, type: 'sine', peak: 0.22 },
      { freq: 987.77, atMs: 210, durMs: 320, type: 'sine', peak: 0.22 },
    ],
  },
  {
    id: 'softarp',
    kind: 'ordinary',
    tones: [
      { freq: 523.25, atMs: 0, durMs: 150, type: 'sine', peak: 0.2 },
      { freq: 659.25, atMs: 150, durMs: 150, type: 'sine', peak: 0.2 },
      { freq: 783.99, atMs: 300, durMs: 300, type: 'sine', peak: 0.2 },
    ],
  },
  // --- alarm ------------------------------------------------------------------
  {
    id: 'pulse',
    kind: 'alarm',
    tones: [0, 200, 400, 600].map((atMs) => ({
      freq: 880,
      atMs,
      durMs: 110,
      type: 'square' as const,
      peak: 0.16,
    })),
  },
  {
    id: 'siren',
    kind: 'alarm',
    tones: [
      { freq: 700, atMs: 0, durMs: 180, type: 'triangle', peak: 0.2 },
      { freq: 1000, atMs: 180, durMs: 180, type: 'triangle', peak: 0.2 },
      { freq: 700, atMs: 360, durMs: 180, type: 'triangle', peak: 0.2 },
      { freq: 1000, atMs: 540, durMs: 220, type: 'triangle', peak: 0.2 },
    ],
  },
  {
    id: 'urgent',
    kind: 'alarm',
    tones: [0, 130, 260, 520, 650, 780].map((atMs) => ({
      freq: 1046.5,
      atMs,
      durMs: 80,
      type: 'square' as const,
      peak: 0.15,
    })),
  },
];

/** Every id a stored preference may legitimately hold. */
export const ALARM_SOUND_IDS: readonly string[] = [ALARM_SOUND_OFF, ...ALARM_SOUNDS.map((s) => s.id)];

/** Narrow a value from storage; anything unrecognised falls back to silence. */
export function asAlarmSoundId(value: string | null | undefined): string {
  return typeof value === 'string' && ALARM_SOUND_IDS.includes(value) ? value : ALARM_SOUND_OFF;
}

// ---------------------------------------------------------------------------
// Per-account, per-device memory of the choice.
// ---------------------------------------------------------------------------

/**
 * Keyed by user id, so two people who share one phone do not inherit each other's
 * alarm - the same rule the acting-service memory follows. Every read and write is
 * wrapped: a private window, cleared site data or a browser that refuses storage
 * must degrade to the silent default, never throw.
 */
const STORAGE_PREFIX = 'dvd-tivat.alarm-sound:';

type MaybeStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

export function readAlarmSound(storage: MaybeStorage, userId: string): string {
  try {
    return asAlarmSoundId(storage?.getItem(STORAGE_PREFIX + userId));
  } catch {
    return ALARM_SOUND_OFF;
  }
}

export function writeAlarmSound(storage: MaybeStorage, userId: string, soundId: string): void {
  try {
    storage?.setItem(STORAGE_PREFIX + userId, asAlarmSoundId(soundId));
  } catch {
    /* Storage refused; the choice simply is not remembered on this device. */
  }
}

// ---------------------------------------------------------------------------
// Playing a sound.
// ---------------------------------------------------------------------------

/** One shared context, created lazily; a page may only have a few. */
let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    const Ctor =
      typeof window === 'undefined'
        ? undefined
        : window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (sharedContext === null) sharedContext = new Ctor();
    return sharedContext;
  } catch {
    return null;
  }
}

/**
 * Play a sound by id. Resolves `true` only if it actually sounded.
 *
 * Returns `false` - never throws - when the id is unknown or "off", when Web
 * Audio is unavailable, or when the browser has not yet been unlocked by a user
 * gesture (the context stays `suspended`). The caller uses the boolean to decide
 * whether to nudge the person to press the preview, and never as an error.
 */
export async function playAlarmSound(soundId: string): Promise<boolean> {
  const def = ALARM_SOUNDS.find((sound) => sound.id === soundId);
  if (!def) return false;
  const ctx = audioContext();
  if (!ctx) return false;
  try {
    // `resume()` only succeeds inside (or after) a user gesture. Outside one it
    // leaves the context suspended, and we make no noise rather than queue a
    // sound that the browser would drop anyway.
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
    }
    if (ctx.state !== 'running') return false;

    const start = ctx.currentTime;
    for (const step of def.tones) {
      const at = start + step.atMs / 1000;
      const dur = step.durMs / 1000;
      const peak = step.peak ?? 0.2;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = step.type ?? 'sine';
      osc.frequency.value = step.freq;
      // A short attack and release, so each tone is a note rather than a click.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, dur / 2));
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}
