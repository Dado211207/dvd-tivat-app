/**
 * Settings, driven the way a person drives it.
 *
 * The screen has one job that matters operationally - change the language and
 * keep it changed - and three properties that are easy to lose:
 *
 *  - the choice reaches the whole application, not just this screen;
 *  - it survives a reload, and says so honestly when it cannot;
 *  - it is reachable and operable without a mouse and without a role.
 *
 * The last one is the reason Settings sits outside the operational gate. The
 * person most in need of a refusal message they can read is the one who has
 * been refused, and a language switch behind a role check is a language switch
 * they cannot reach.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeLanguage, resetLanguageForTests } from '@/i18n/language';
import { en } from '@/i18n/strings.en';
import { me } from '@/i18n/strings.me';
import { SettingsView } from './SettingsView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function show(): Promise<void> {
  await act(async () => {
    root.render(<SettingsView />);
  });
}

function click(element: Element | null): Promise<void> {
  return act(async () => {
    (element as HTMLElement).click();
  });
}

const languageRadio = (language: 'me' | 'en') =>
  container.querySelector<HTMLInputElement>(`[data-testid="language-${language}"] input`);

beforeEach(() => {
  window.localStorage.clear();
  resetLanguageForTests();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  // Restored BEFORE the unmount: a test that made storage throw would
  // otherwise take React's teardown down with it, and every later test in the
  // file would fail for a reason that has nothing to do with what it asserts.
  vi.restoreAllMocks();
  await act(async () => root.unmount());
  container.remove();
  resetLanguageForTests();
});

describe('choosing a language', () => {
  it('opens in Crnogorski with that option already chosen', async () => {
    await show();
    expect(languageRadio('me')?.checked, 'the default must be visibly the default').toBe(true);
    expect(languageRadio('en')?.checked).toBe(false);
    expect(container.textContent).toContain(me.settings.languageTitle);
  });

  it('switches the whole screen into English on one tap', async () => {
    await show();
    await click(languageRadio('en'));

    expect(activeLanguage()).toBe('en');
    expect(container.textContent).toContain(en.settings.languageTitle);
    // The notification panel brings its own heading now, so this is the string
    // a person actually reads on the screen.
    expect(container.textContent).toContain(en.push.title);
    expect(
      container.textContent,
      'no Montenegrin sentence may survive the switch',
    ).not.toContain(me.push.title);
  });

  it('and back again', async () => {
    await show();
    await click(languageRadio('en'));
    await click(languageRadio('me'));
    expect(activeLanguage()).toBe('me');
    expect(container.textContent).toContain(me.push.title);
  });

  it('remembers the choice on this device', async () => {
    await show();
    await click(languageRadio('en'));
    expect(window.localStorage.getItem('dvd-tivat.language')).toBe('en');
    expect(container.querySelector('[data-testid="language-saved"]')).not.toBeNull();
  });

  it('says nothing about saving until somebody has chosen something', async () => {
    // A confirmation on arrival confirms nothing; a warning on arrival alarms
    // somebody who has not asked for anything yet. Both are only true in
    // response to an act.
    await show();
    expect(container.querySelector('[data-testid="language-saved"]')).toBeNull();
    expect(container.textContent).not.toContain(me.settings.languageNotSaved);
  });

  it('warns when the browser cannot remember it, and still switches', async () => {
    // Private mode, blocked site data, an embedded web view: `localStorage`
    // throws rather than returning null. The language must still change for
    // this visit, and the person must be told it will not last.
    // Spied on the PROTOTYPE, not on `window.localStorage`. jsdom's storage is
    // exotic enough that defining an own property on the instance does not
    // take, and a mock that silently does nothing is a test that silently
    // proves nothing.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    resetLanguageForTests();

    await show();
    await click(languageRadio('en'));

    expect(activeLanguage(), 'the switch itself must still work').toBe('en');
    expect(container.textContent).toContain(en.settings.languageNotSaved);
  });
});

describe('what the screen promises and does not promise', () => {
  it('says the language is this device only, and is not sent anywhere', async () => {
    await show();
    expect(container.textContent).toContain(me.settings.lead);
  });

  it('says that what members wrote is not translated', async () => {
    // Somebody who switches to English and still sees a Montenegrin
    // intervention title has to know that is the record speaking, not a
    // half-finished translation.
    await show();
    expect(container.textContent).toContain(me.settings.contentNotTranslated);
  });

  it('carries the reminder that this is not how you call the fire service', async () => {
    // Settings is where somebody goes to work out what an application is, and
    // the answer must not be "the way to report a fire".
    await show();
    expect(container.textContent).toContain(me.settings.aboutFallback);
  });

  it('keeps the simulation closed, warned, and free of citizen reporting', async () => {
    await show();
    const details = container.querySelector('details');
    expect(details, 'the simulation must be behind a disclosure').not.toBeNull();
    expect(details?.open, 'and it must start closed').toBe(false);
    expect(details?.textContent).toContain(me.settings.prototypeWarning);

    // Still reachable: moved, not deleted.
    expect(container.querySelector('[data-testid="prototype-prikaz"]')).not.toBeNull();
    // With the one exception. This application must never read as a way to
    // report a fire.
    expect(container.querySelector('[data-testid="prototype-dojava"]')).toBeNull();
  });
});

describe('usable without a mouse', () => {
  it('is a real radio group with a legend, not a set of styled divs', async () => {
    await show();
    const fieldset = container.querySelector('fieldset');
    expect(fieldset?.querySelector('legend')?.textContent).toBe(me.settings.languageLegend);

    for (const language of ['me', 'en'] as const) {
      const input = languageRadio(language);
      expect(input?.type, `${language} must be a radio`).toBe('radio');
      expect(input?.name, 'both must be in one group, so arrow keys work').toBe('language');
      // Wrapped in its own `<label>`, so the accessible name is the language's
      // own word and the whole chip is the target.
      expect(input?.closest('label')?.textContent).toContain(language === 'me' ? 'Crnogorski' : 'English');
    }
  });

  it('gives every section a heading its region is labelled by', async () => {
    await show();
    const sections = [...container.querySelectorAll('section[aria-labelledby]')];
    expect(sections.length).toBeGreaterThanOrEqual(4);
    for (const section of sections) {
      const id = section.getAttribute('aria-labelledby') ?? '';
      const heading = container.querySelector(`#${id}`);
      expect(heading, `${id} must exist`).not.toBeNull();
      expect(heading?.textContent?.trim()).not.toBe('');
    }
  });

  it('announces the saved confirmation rather than only colouring it', async () => {
    await show();
    await click(languageRadio('en'));
    const saved = container.querySelector('[data-testid="language-saved"]');
    expect(saved?.getAttribute('role'), 'a change nobody can see must be announced').toBe('status');
  });
});
