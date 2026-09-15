/**
 * How a screen reads its own words.
 *
 * There is no provider component. The language lives in `language.ts` as a
 * module store because plain functions - every date formatter in the
 * application - have to read it without a component around them, and a provider
 * that wrapped the tree without owning anything would only be a place for a
 * future reader to look for state that is not there.
 *
 * `useSyncExternalStore` subscribes each component directly, so changing the
 * language repaints everything at once instead of leaving half the screen in
 * the previous language until it happens to re-render for another reason.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { activeLanguage, setActiveLanguage, subscribeToLanguage, type Language } from './language';
import { en } from './strings.en';
import { me, type Strings } from './strings.me';

const BUNDLES: Record<Language, Strings> = { me, en };

/** The whole string bundle, in the language now in force. */
export function useText(): Strings {
  return BUNDLES[useSyncExternalStore(subscribeToLanguage, activeLanguage, activeLanguage)];
}

/** The chosen language, and the one way to change it. */
export function useLanguage(): {
  language: Language;
  /** Returns false when this browser refused to remember the choice. */
  setLanguage: (language: Language) => boolean;
} {
  const language = useSyncExternalStore(subscribeToLanguage, activeLanguage, activeLanguage);
  const setLanguage = useCallback((next: Language) => setActiveLanguage(next), []);
  return { language, setLanguage };
}

/** The bundle for a language, for code that is not a component. */
export function textFor(language: Language): Strings {
  return BUNDLES[language];
}

/** The bundle in force, for code that is not a component. */
export function activeText(): Strings {
  return BUNDLES[activeLanguage()];
}
