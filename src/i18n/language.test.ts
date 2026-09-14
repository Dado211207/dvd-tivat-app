/**
 * The language choice, against the situations that actually occur on a phone.
 *
 * Three properties matter and none of them is "the words changed":
 *
 *  - Crnogorski is what a firefighter gets unless they asked for otherwise.
 *  - The choice survives a reload on the device that made it.
 *  - Storage that refuses to answer does not stop the application opening.
 *
 * The last one is not hypothetical. A private window, a browser with site data
 * blocked and several embedded web views all THROW on `localStorage` rather
 * than returning null, and a preference module that does not expect that takes
 * the whole screen down with it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activeLanguage,
  applyStoredLanguage,
  DEFAULT_LANGUAGE,
  LANGUAGE_NAME,
  LANGUAGE_TAG,
  LANGUAGES,
  normaliseLanguage,
  readStoredLanguage,
  resetLanguageForTests,
  setActiveLanguage,
  storeLanguage,
  subscribeToLanguage,
} from './language';

const KEY = 'dvd-tivat.language';

function withStorage(store: Storage): void {
  vi.stubGlobal('window', { ...window, localStorage: store });
}

/** A browser that refuses to answer at all, which is what private mode does. */
function refusingStorage(): Storage {
  const refuse = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return {
    get length() {
      return refuse();
    },
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  } as unknown as Storage;
}

beforeEach(() => {
  window.localStorage.clear();
  resetLanguageForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLanguageForTests();
});

describe('a Montenegrin fire society reads Crnogorski unless it says otherwise', () => {
  it('opens in Crnogorski with nothing stored', () => {
    expect(DEFAULT_LANGUAGE).toBe('me');
    expect(readStoredLanguage()).toBe('me');
    expect(activeLanguage()).toBe('me');
  });

  it('never takes the device language as the answer', () => {
    // A second-hand phone, a factory default nobody changed: neither is a
    // statement that a firefighter reads English at three in the morning.
    // English is offered and chosen, never assumed.
    vi.stubGlobal('navigator', { ...navigator, language: 'en-US', languages: ['en-US', 'en'] });
    resetLanguageForTests();
    expect(activeLanguage()).toBe('me');
  });

  it('offers exactly two languages, each named in its own words', () => {
    expect([...LANGUAGES]).toEqual(['me', 'en']);
    // Never translated: somebody hunting for English has to find the word
    // "English", whatever the interface is currently showing them.
    expect(LANGUAGE_NAME.me).toBe('Crnogorski');
    expect(LANGUAGE_NAME.en).toBe('English');
  });
});

describe('the choice survives a reload on the device that made it', () => {
  it('stores and reads back the chosen language', () => {
    expect(setActiveLanguage('en')).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe('en');

    // A reload is a fresh module, which is exactly what this seam models.
    resetLanguageForTests();
    expect(activeLanguage()).toBe('en');
  });

  it('ignores a stored value that is not a language we have', () => {
    // Somebody else's key, a half-written value, a version that offered a
    // third language. Falling back beats rendering `undefined`.
    for (const junk of ['de', '', 'null', '["en"]', 'ME']) {
      window.localStorage.setItem(KEY, junk);
      resetLanguageForTests();
      expect(activeLanguage(), junk).toBe('me');
    }
  });

  it('refuses anything that is not one of the two', () => {
    expect(normaliseLanguage('en')).toBe('en');
    expect(normaliseLanguage('me')).toBe('me');
    for (const value of [null, undefined, 0, 'sr', {}, ['en']]) {
      expect(normaliseLanguage(value), String(value)).toBeNull();
    }
  });
});

describe('a browser that will not remember anything', () => {
  it('still opens, in Crnogorski', () => {
    withStorage(refusingStorage());
    resetLanguageForTests();
    expect(() => activeLanguage()).not.toThrow();
    expect(activeLanguage()).toBe('me');
  });

  it('still changes the language for this visit, and says it could not be saved', () => {
    withStorage(refusingStorage());
    resetLanguageForTests();

    // False is the screen's cue to warn. The language itself still changes -
    // refusing to switch because the choice cannot be remembered would be the
    // worse half of the bargain.
    expect(setActiveLanguage('en')).toBe(false);
    expect(activeLanguage()).toBe('en');
  });

  it('reports the same failure from `storeLanguage` directly', () => {
    withStorage(refusingStorage());
    expect(storeLanguage('en')).toBe(false);
  });
});

describe('everything that is showing changes at once', () => {
  it('tells every subscriber, and stops once they leave', () => {
    // A screen half in one language and half in the other is worse than either,
    // and it is what a per-component copy of the choice produces.
    let calls = 0;
    const stop = subscribeToLanguage(() => {
      calls += 1;
    });

    setActiveLanguage('en');
    expect(calls).toBe(1);

    setActiveLanguage('me');
    expect(calls).toBe(2);

    stop();
    setActiveLanguage('en');
    expect(calls, 'an unsubscribed listener must not be called').toBe(2);
  });

  it('survives a listener that unsubscribes while being told', () => {
    // React does exactly this on unmount during a re-render, and a plain
    // `for (const l of set)` would skip the next listener when it happens.
    const seen: string[] = [];
    const stopFirst = subscribeToLanguage(() => {
      seen.push('first');
      stopFirst();
    });
    subscribeToLanguage(() => seen.push('second'));

    setActiveLanguage('en');
    expect(seen).toEqual(['first', 'second']);
  });
});

describe('the document says which language it is in', () => {
  it('sets a real BCP 47 tag, because a screen reader picks a voice from it', () => {
    // Reading Montenegrin sentences with an English pronunciation is an
    // accessibility defect that never appears in a screenshot.
    applyStoredLanguage();
    expect(document.documentElement.lang).toBe(LANGUAGE_TAG.me);

    setActiveLanguage('en');
    expect(document.documentElement.lang).toBe('en-GB');

    setActiveLanguage('me');
    expect(document.documentElement.lang).toBe('sr-Latn-ME');
  });
});
