/**
 * The call-out sound is foreground-only, and honest about it (P6 acceptance 1f,
 * the background-resume case). A call-out that arrives while the tab is hidden is
 * the phone's own push notification's job; when the person returns to the tab,
 * the in-app alarm must NOT replay it. Only a call-out that arrives while the tab
 * is genuinely being watched should sound.
 *
 * This drives the real UI against the realtime fixture: a firefighter who chose a
 * sound backgrounds the tab, a commander in a second session publishes to them,
 * and on return the hidden alarm signal shows it never fired for that arrival.
 */

import { expect, test, type Page } from '@playwright/test';
import { COMMANDER, FIREFIGHTER, FIREFIGHTER_USER, createLiveProject } from './live-project';

const APP = 'http://127.0.0.1:4174';

/** Publish one call-out to the firefighter, the way a commander does it. */
async function publishToFirefighter(commander: Page, title: string): Promise<void> {
  // After the first publish a call-out is focused and the composer collapses;
  // reopen it so a second and third call-out can be composed the same way.
  const disclosure = commander.getByTestId('new-call-out-disclosure');
  if ((await disclosure.count()) > 0) {
    const isOpen = await disclosure.evaluate((el) => (el as HTMLDetailsElement).open);
    if (!isOpen) await disclosure.locator(':scope > summary').click();
  }
  await commander.getByTestId('new-title').fill(title);
  await commander.getByTestId('new-location').fill('Poligon (izmisljena lokacija)');
  await commander.getByTestId('new-instructions').fill('Okupljanje u bazi.');
  await commander.getByTestId('quick-review').click();
  await commander.getByRole('button', { name: 'Objavi', exact: true }).click();
}

/** Drive the tab's visibility the way the browser does when it is backgrounded. */
async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (isHidden ? 'hidden' : 'visible'),
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** Read the alarm's fired-count as a number. */
async function plays(page: Page): Promise<number> {
  const value = await page.getByTestId('callout-alarm').getAttribute('data-plays');
  return Number(value ?? '0');
}

test('a call-out that arrived while hidden does not sound on return', async ({ browser }) => {
  const project = createLiveProject();
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await project.install(contextA, COMMANDER);
  await project.install(contextB, FIREFIGHTER);

  await contextB.addInitScript((userId) => {
    window.localStorage.setItem(`dvd-tivat.alarm-sound:${userId}`, 'siren');
  }, FIREFIGHTER_USER);

  const commander = await contextA.newPage();
  const firefighter = await contextB.newPage();
  await commander.goto(`${APP}/#/poziv`);
  await firefighter.goto(`${APP}/#/podesavanja`);
  await commander.waitForSelector('main');
  await firefighter.waitForSelector('main');

  const alarm = firefighter.getByTestId('callout-alarm');
  await expect(alarm).toHaveAttribute('data-ready', 'true', { timeout: 15_000 });
  await expect(alarm).toHaveAttribute('data-plays', '0');

  // The tab goes to the background; a call-out arrives while it is hidden.
  await setHidden(firefighter, true);
  await publishToFirefighter(commander, 'Poziv dok je aplikacija u pozadini');
  await firefighter.waitForTimeout(3_000);

  // Coming back: the phone's push already alerted; the in-app alarm must not
  // replay it. It stays silent for the call-out discovered on return.
  await setHidden(firefighter, false);
  await firefighter.waitForTimeout(3_000);
  expect(await plays(firefighter)).toBe(0);

  await contextA.close();
  await contextB.close();
});

// The complement of this - that a genuinely later arrival, after the resume
// re-baseline, still sounds - is proven deterministically as a unit test
// (`src/notifications/call-out-alarm.test.tsx`, "quietly catches up after a
// hidden tab becomes visible, then sounds later arrivals"). Reproducing it here
// would need three sequential publishes through the commander UI whose timing
// against the realtime debounce makes a browser test flaky for no added signal.
