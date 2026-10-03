/**
 * The call-out sound is an APP-LEVEL alarm: a newly-arrived call-out sounds on
 * whatever route is open, not only on "Moj poziv".
 *
 * This drives the real UI against the realtime fixture: a firefighter who chose a
 * sound sits on the SETTINGS screen (never the call-out screen), a commander in a
 * second, independent session publishes a call-out to them, and the firefighter's
 * hidden alarm signal records that it fired - all without navigating. The default
 * (no sound) is proven not to arm the listener at all.
 *
 * Not the hosted project: the fixture speaks the client's contract, nothing real.
 */

import { expect, test, type Page } from '@playwright/test';
import { COMMANDER, FIREFIGHTER, FIREFIGHTER_USER, createLiveProject } from './live-project';

const APP = 'http://127.0.0.1:4174';

/** Generous on purpose: passes whether the alarm channel is LIVE or falls back to the 12 s poll. */
const ARRIVAL_BUDGET = 15_000;

/** Publish one call-out to the firefighter, the way a commander does it. */
async function publishToFirefighter(commander: Page, title: string): Promise<void> {
  await commander.getByTestId('new-title').fill(title);
  await commander.getByTestId('new-location').fill('Poligon (izmisljena lokacija)');
  await commander.getByTestId('new-instructions').fill('Okupljanje u bazi.');
  await commander.getByTestId('quick-review').click();
  await commander.getByRole('button', { name: 'Objavi', exact: true }).click();
}

test('a chosen sound fires for a call-out that arrives while on Settings', async ({ browser }) => {
  const project = createLiveProject();
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await project.install(contextA, COMMANDER);
  await project.install(contextB, FIREFIGHTER);

  // The firefighter has chosen a sound on this device. Set before load, so the
  // app-level listener arms on mount.
  await contextB.addInitScript((userId) => {
    window.localStorage.setItem(`dvd-tivat.alarm-sound:${userId}`, 'siren');
  }, FIREFIGHTER_USER);

  const commander = await contextA.newPage();
  const firefighter = await contextB.newPage();
  await commander.goto(`${APP}/#/poziv`);
  // The firefighter is on SETTINGS - deliberately not the call-out screen.
  await firefighter.goto(`${APP}/#/podesavanja`);
  await commander.waitForSelector('main');
  await firefighter.waitForSelector('main');

  // Armed and past its baseline, with no operational screen mounted.
  const alarm = firefighter.getByTestId('callout-alarm');
  await expect(alarm).toHaveAttribute('data-ready', 'true', { timeout: 15_000 });
  await expect(alarm).toHaveAttribute('data-plays', '0');

  await publishToFirefighter(commander, 'Novi poziv dok sam u podesavanjima');

  // The firefighter hears it while still on Settings - the whole point.
  await expect(alarm).toHaveAttribute('data-plays', '1', { timeout: ARRIVAL_BUDGET });
  await expect(firefighter).toHaveURL(/#\/podesavanja/);

  await contextA.close();
  await contextB.close();
});

test('with the default (no sound) the listener does not arm at all', async ({ browser }) => {
  const project = createLiveProject();
  const contextB = await browser.newContext();
  await project.install(contextB, FIREFIGHTER);

  const firefighter = await contextB.newPage();
  await firefighter.goto(`${APP}/#/mobilizacija`);
  await firefighter.waitForSelector('main');
  // Default is off: nothing is mounted, so the signal element is absent.
  await expect(firefighter.getByTestId('callout-alarm')).toHaveCount(0);

  await contextB.close();
});
