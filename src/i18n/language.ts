/**
 * Which language this device shows, and where that choice lives.
 *
 * ---------------------------------------------------------------------------
 * THE CHOICE IS THE DEVICE'S, NOT THE ACCOUNT'S
 * ---------------------------------------------------------------------------
 *
 * Nothing about the language is sent to the server, stored against a member, or
 * carried between devices. It is a reading preference, and making it account
 * state would mean a new column, a new write path, a new row level security
 * rule and a new thing that can fail during a call-out - all so that a person
 * reads the same words on their tablet as on their phone. That is not a
 * problem this society has.
 *
 * It also keeps a promise the rest of the system makes: the database holds
 * facts about interventions and members, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * WHY A MODULE-LEVEL STORE AND NOT ONLY REACT CONTEXT
 * ---------------------------------------------------------------------------
 *
 * Times are formatted by plain functions that are called from places with no
 * component around them, and threading a language argument through every one of
 * them would put the choice in fifty signatures. So the active language lives
 * here, once, and React subscribes to it through `useSyncExternalStore` rather
 * than owning it. One source, two readers.
 */

export const LANGUAGES = ['me', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * Crnogorski, for a Montenegrin fire society.
 *
 * Deliberately not the browser's language. This product is used by the members
 * of one society in one town; a device whose system language happens to be
 * English - a second-hand phone, a factory default nobody changed - should not
 * silently decide that a firefighter reads English at three in the morning.
 * English is offered, and chosen, never assumed.
 */
export const DEFAULT_LANGUAGE: Language = 'me';

/** The language name, written in that language. Never translated. */
export const LANGUAGE_NAME: Record<Language, string> = {
  me: 'Crnogorski',
  en: 'English',
};

/**
 * The BCP 47 tag for the `lang` attribute and for `Intl`.
 *
 * Montenegrin is written here in the Latin script, and this interface writes it
 * without diacritics by a long-standing convention of the project.
 */
export const LANGUAGE_TAG: Record<Language, string> = {
  me: 'sr-Latn-ME',
  en: 'en-GB',
};

const STORAGE_KEY = 'dvd-tivat.language';

export function normaliseLanguage(value: unknown): Language | null {
  return (LANGUAGES as readonly unknown[]).includes(value) ? (value as Language) : null;
}

/**
 * Reads the stored choice, or the default.
 *
 * Wrapped because storage is not always there to be read: a private window, a
 * browser with site data blocked, and an embedded webview all throw on access
 * rather than returning null. The application must open in Crnogorski in that
 * case, not fail to open.
 */
export function readStoredLanguage(): Language {
  try {
    return normaliseLanguage(window.localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Returns whether the choice will survive a reload, so the screen can say so. */
export function storeLanguage(language: Language): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
    return true;
  } catch {
    return false;
  }
}

let active: Language = DEFAULT_LANGUAGE;
let initialised = false;
const listeners = new Set<() => void>();

/** The language in force right now. Safe to call from anywhere, including tests. */
export function activeLanguage(): Language {
  if (!initialised) {
    active = readStoredLanguage();
    initialised = true;
  }
  return active;
}

/**
 * Changes the language everywhere at once and remembers it on this device.
 *
 * Also updates the document's `lang`, which is not decoration: a screen reader
 * uses it to choose a voice, and reading Montenegrin sentences with an English
 * pronunciation is the kind of accessibility defect that never shows up in a
 * screenshot.
 */
export function setActiveLanguage(language: Language): boolean {
  activeLanguage();
  active = language;
  const persisted = storeLanguage(language);
  try {
    document.documentElement.lang = LANGUAGE_TAG[language];
  } catch {
    // A document is not guaranteed in every test environment.
  }
  for (const listener of [...listeners]) listener();
  return persisted;
}

export function subscribeToLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Puts the stored choice into effect on the document.
 *
 * Called once at start-up. The `lang` attribute is not decoration: a screen
 * reader chooses a voice from it, and reading Montenegrin sentences with an
 * English pronunciation is the kind of accessibility defect that never shows up
 * in a screenshot.
 */
export function applyStoredLanguage(): Language {
  const language = activeLanguage();
  try {
    document.documentElement.lang = LANGUAGE_TAG[language];
  } catch {
    // A document is not guaranteed in every test environment.
  }
  return language;
}

/** Test seam. Restores the module to "nothing has been read yet". */
export function resetLanguageForTests(): void {
  active = DEFAULT_LANGUAGE;
  initialised = false;
  listeners.clear();
}
