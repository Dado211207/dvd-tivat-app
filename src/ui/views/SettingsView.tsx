/**
 * Everything that belongs to THIS DEVICE and nothing that belongs to an account.
 *
 * The distinction is the whole design of the screen. A firefighter's role, their
 * membership and their attendance are facts the server holds and checks; the
 * language they read and whether this particular phone makes a noise are not
 * facts about them at all, they are settings of one browser on one device. Two
 * kinds of thing that look alike in a menu and behave nothing alike.
 *
 * So this screen sits outside the operational gate deliberately. Somebody who is
 * signed out, awaiting approval or suspended still needs to be able to read the
 * application in their own language, and putting the language behind a role
 * check would mean the one person most in need of a comprehensible refusal
 * message is the one who cannot change its language.
 */

import { LANGUAGE_NAME, LANGUAGES, type Language } from '@/i18n/language';
import { timeZoneIsSupported } from '@/i18n/time';
import { useLanguage, useText } from '@/i18n/useText';
import { useState } from 'react';
import { PushNotificationPanel } from '../components/PushNotificationPanel';
import { Notice } from '../components/primitives';
import { hrefFor, type Route } from '../router';

/**
 * The simulation screens, in the order they make sense to look at.
 *
 * `dojava` is NOT here and must not be added. It is an abandoned research
 * prototype for citizen reporting, and this application must never read as a
 * way to report a fire - the official emergency telephone number is the only
 * one that is. The route still resolves for anybody holding an old link, and
 * opens on its own refusal.
 */
const PROTOTYPE_ROUTES: readonly Route[] = ['prikaz', 'dezurni', 'clan', 'clanovi', 'vozila', 'istorija'];

export function SettingsView() {
  const t = useText();
  const { language, setLanguage } = useLanguage();

  /**
   * Null until the person has actually changed something.
   *
   * A "saved" confirmation shown on arrival would be confirming nothing, and a
   * "cannot be saved" warning shown on arrival would alarm somebody who has not
   * asked for anything yet. Both are only true in response to an act.
   */
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const choose = (next: Language) => {
    if (next === language) return;
    setPersisted(setLanguage(next));
  };

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="settings-language">
        <h2 className="panel__title" id="settings-language">{t.settings.languageTitle}</h2>
        <p className="muted small">{t.settings.lead}</p>

        {/*
          A radio group, not a dropdown. Two options on a phone at arm's length
          are two large targets that state what they are; a `select` hides the
          alternative behind a tap and gives a smaller hit area for no gain.
        */}
        <fieldset className="choice-set">
          <legend className="choice-set__legend">{t.settings.languageLegend}</legend>
          <div className="choice-set__options">
            {LANGUAGES.map((option) => (
              <label
                key={option}
                className={`choice${option === language ? ' choice--on' : ''}`}
                data-testid={`language-${option}`}
              >
                <input
                  type="radio"
                  name="language"
                  value={option}
                  checked={option === language}
                  onChange={() => choose(option)}
                />
                {/* The language's own name, never translated: somebody looking
                    for English has to be able to find the word "English". */}
                <span className="choice__label">{LANGUAGE_NAME[option]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="muted small">{t.settings.languageHint}</p>

        {persisted === true ? (
          <p className="muted small" role="status" data-testid="language-saved">
            {t.settings.languageSaved}
          </p>
        ) : null}
        {persisted === false ? (
          <Notice tone="warn">{t.settings.languageNotSaved}</Notice>
        ) : null}

        {/*
          Said plainly rather than discovered. Somebody who switches to English
          and still sees a Montenegrin intervention title has to know that is the
          record speaking, not a half-finished translation.
        */}
        <p className="muted small">{t.settings.contentNotTranslated}</p>
      </section>

      <section className="panel" aria-labelledby="settings-notifications">
        <h2 className="panel__title" id="settings-notifications">
          {t.settings.notificationsTitle}
        </h2>
        <PushNotificationPanel variant="full" />
      </section>

      <section className="panel" aria-labelledby="settings-display">
        <h2 className="panel__title" id="settings-display">{t.settings.displayTitle}</h2>
        {timeZoneIsSupported() ? (
          <p className="muted small">{t.settings.displayZone}</p>
        ) : (
          <Notice tone="warn">{t.settings.displayZoneMissing}</Notice>
        )}
      </section>

      {/*
        Where the simulation lives now.

        It used to be a group in the main rail, one tap from a real call-out.
        Not deleted - the routes resolve, the code is intact, and every one of
        those screens still opens on its own notice - but moved somewhere nobody
        passes through while running an intervention, and closed by default so
        that reaching it is a decision rather than a mis-tap.
      */}
      <section className="panel" aria-labelledby="settings-prototype">
        <h2 className="panel__title" id="settings-prototype">{t.settings.prototypeTitle}</h2>
        <details className="disclosure">
          <summary className="disclosure__summary">{t.settings.prototypeSummary}</summary>
          <div className="disclosure__body">
            <Notice tone="warn">{t.settings.prototypeWarning}</Notice>
            <ul className="link-list">
              {PROTOTYPE_ROUTES.map((route) => (
                <li key={route}>
                  <a href={hrefFor(route)} data-testid={`prototype-${route}`}>
                    {t.routes[route].name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </section>

      <section className="panel" aria-labelledby="settings-about">
        <h2 className="panel__title" id="settings-about">{t.settings.aboutTitle}</h2>
        {/* The one sentence on this screen that is not a setting. It is here
            because Settings is where somebody goes when they are trying to work
            out what this application is, and the answer must not be "the way to
            report a fire". */}
        <Notice tone="warn">{t.settings.aboutFallback}</Notice>
        <dl className="fact-list">
          <div className="fact-line">
            <dt>{t.settings.aboutStorage}</dt>
            <dd>{t.settings.aboutStorageValue}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
