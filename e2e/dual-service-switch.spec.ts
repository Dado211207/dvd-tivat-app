/**
 * The dual-service member (P6 acceptance 1c): one person with a member record in
 * BOTH DVD and SZS, who does everything operational for ONE service at a time and
 * switches between them explicitly on Settings.
 *
 * This drives the real UI against the fake project. Each service has its own
 * call-out and roster, labelled with its `organization_id`; every operational
 * read the client makes carries `?organization_id=eq.<org>`, so a screen that
 * shows the other service's data would be a client that asked the wrong question.
 * The database's own isolation (RLS) is proven separately in `db-tests/`; this
 * proves the client scopes to the acting service and re-scopes on a switch, and
 * that an unsaved draft stays with the service it was typed for.
 */

import { expect, test, type Page } from '@playwright/test';
import {
  DUAL_DVD_MEMBER,
  DUAL_SZS_MEMBER,
  DVD_CALLOUT_TITLE,
  SZS_CALLOUT_TITLE,
  installFixtureProject,
} from './fixture-server';

const APP = 'http://127.0.0.1:4174';

/** A commander who serves in both services, on this device, in Montenegrin. */
const DUAL = {
  language: 'me' as const,
  memberships: [
    { service: 'DVD' as const, role: 'COMMANDER' as const, memberId: DUAL_DVD_MEMBER },
    { service: 'SZS' as const, role: 'COMMANDER' as const, memberId: DUAL_SZS_MEMBER },
  ],
};

/** Make the explicit switch the way a person does: on the Settings screen. */
async function switchTo(page: Page, service: 'DVD' | 'SZS'): Promise<void> {
  await page.goto(`${APP}/#/podesavanja`);
  const radio = page.getByTestId(`acting-service-${service}`);
  await expect(radio).toBeVisible();
  await radio.click();
  // The switch reloads the access snapshot from the server; wait for it to land.
  await expect(radio.locator('input')).toBeChecked();
}

test('a dual-service commander gets the badge and both services to choose', async ({ page }) => {
  await installFixtureProject(page, DUAL);
  await page.goto(`${APP}/#/poziv`);
  await page.waitForSelector('main');

  // The "acting as" badge appears only when there is a choice to make.
  await expect(page.getByTestId('acting-service-badge')).toBeVisible();

  // The default acting service is the first available (DVD): its call-out is on
  // screen, and the SZS call-out is nowhere on it.
  await expect(page.getByText(DVD_CALLOUT_TITLE).first()).toBeVisible();
  await expect(page.getByText(SZS_CALLOUT_TITLE)).toHaveCount(0);

  // Settings offers both services as an explicit choice.
  await page.goto(`${APP}/#/podesavanja`);
  await expect(page.getByTestId('acting-service-DVD')).toBeVisible();
  await expect(page.getByTestId('acting-service-SZS')).toBeVisible();
  await expect(page.getByTestId('acting-service-DVD').locator('input')).toBeChecked();
});

test('switching to SZS re-scopes the call-out screen and never shows DVD data', async ({ page }) => {
  await installFixtureProject(page, DUAL);

  await switchTo(page, 'SZS');
  await page.goto(`${APP}/#/poziv`);
  await page.waitForSelector('main');
  await expect(page.getByText(SZS_CALLOUT_TITLE).first()).toBeVisible();
  await expect(page.getByText(DVD_CALLOUT_TITLE)).toHaveCount(0);

  // Switching back restores DVD's scope, and SZS is gone again.
  await switchTo(page, 'DVD');
  await page.goto(`${APP}/#/poziv`);
  await page.waitForSelector('main');
  await expect(page.getByText(DVD_CALLOUT_TITLE).first()).toBeVisible();
  await expect(page.getByText(SZS_CALLOUT_TITLE)).toHaveCount(0);
});

/** Reveal the collapsed "new call-out" composer, if it is not already open. */
async function openComposer(page: Page): Promise<void> {
  const disclosure = page.getByTestId('new-call-out-disclosure');
  await expect(disclosure).toBeVisible();
  const open = await disclosure.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!open) await disclosure.locator(':scope > summary').click();
  await expect(page.getByTestId('new-title')).toBeVisible();
}

test('an unsaved DVD draft stays with DVD and never leaks into SZS', async ({ page }) => {
  await installFixtureProject(page, DUAL);
  await page.goto(`${APP}/#/poziv`);
  await page.waitForSelector('main');

  const draftTitle = 'Nacrt samo za DVD (izmišljeno)';
  await openComposer(page);
  await page.getByTestId('new-title').fill(draftTitle);
  await expect(page.getByTestId('new-title')).toHaveValue(draftTitle);

  // In SZS the composer is that service's own, empty: the DVD draft is not here.
  await switchTo(page, 'SZS');
  await page.goto(`${APP}/#/poziv`);
  await page.waitForSelector('main');
  await openComposer(page);
  await expect(page.getByTestId('new-title')).toHaveValue('');

  // Back in DVD the draft is still waiting, not lost to the switch.
  await switchTo(page, 'DVD');
  await page.goto(`${APP}/#/poziv`);
  await page.waitForSelector('main');
  await openComposer(page);
  await expect(page.getByTestId('new-title')).toHaveValue(draftTitle);
});
