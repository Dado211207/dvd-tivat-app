/**
 * Mobile screenshots of the four P6 account shapes, for a person to look at.
 *
 * Tagged @screenshots so `npm run e2e` skips them - they produce files, not
 * assertions; the assertions that prove these screens live in
 * `dual-service-switch.spec.ts`, `owner-both-services.spec.ts`,
 * `szs-lifecycle.spec.ts` and `operational.spec.ts`. Every screen is the REAL
 * application rendered against the fake project with fictional data, at a phone
 * width. Regenerate with:
 *
 *   npx playwright test e2e/p6-shape-screenshots.spec.ts --project=mobile
 *
 * They show what each shape sees; they do NOT prove server isolation (that is
 * RLS, in db-tests/) and are not a connected or hosted system.
 */
import { test } from '@playwright/test';
import {
  DUAL_DVD_MEMBER,
  DUAL_SZS_MEMBER,
  installFixtureProject,
} from './fixture-server';

const DIR = 'docs/screenshots/p6';
const PHONE = { width: 390, height: 844 } as const;

/** A realistic notch inset, matching the other mobile screenshots. */
async function frame(page: import('@playwright/test').Page): Promise<void> {
  await page.addStyleTag({ content: ':root { --safe-top: 47px !important; }' });
  await page.waitForTimeout(300);
}

const DVD_ONLY = {
  language: 'me' as const,
  memberships: [{ service: 'DVD' as const, role: 'COMMANDER' as const, memberId: DUAL_DVD_MEMBER }],
};
const SZS_ONLY = {
  language: 'me' as const,
  memberships: [{ service: 'SZS' as const, role: 'COMMANDER' as const, memberId: DUAL_SZS_MEMBER }],
};
const DUAL = {
  language: 'me' as const,
  memberships: [
    { service: 'DVD' as const, role: 'COMMANDER' as const, memberId: DUAL_DVD_MEMBER },
    { service: 'SZS' as const, role: 'COMMANDER' as const, memberId: DUAL_SZS_MEMBER },
  ],
};
const OWNER = {
  language: 'me' as const,
  owner: true,
  memberships: [
    { service: 'DVD' as const, role: 'OWNER' as const, memberId: null },
    { service: 'SZS' as const, role: 'OWNER' as const, memberId: null },
  ],
};

test.describe('@screenshots P6 account shapes (mobile)', () => {
  test.use({ viewport: { width: PHONE.width, height: PHONE.height } });

  test('DVD-only member - call-out screen, no service badge', async ({ page }) => {
    await installFixtureProject(page, DVD_ONLY);
    await page.goto('http://127.0.0.1:4174/#/poziv');
    await page.waitForSelector('main');
    await frame(page);
    await page.screenshot({ path: `${DIR}/1a-dvd-only-poziv.png`, fullPage: true });
  });

  test('SZS-only member - its own call-out screen, no service badge', async ({ page }) => {
    await installFixtureProject(page, SZS_ONLY);
    await page.goto('http://127.0.0.1:4174/#/poziv');
    await page.waitForSelector('main');
    await frame(page);
    await page.screenshot({ path: `${DIR}/1b-szs-only-poziv.png`, fullPage: true });
  });

  test('dual-service member - the acting-service badge on the call-out screen', async ({ page }) => {
    await installFixtureProject(page, DUAL);
    await page.goto('http://127.0.0.1:4174/#/poziv');
    await page.waitForSelector('main');
    await frame(page);
    await page.screenshot({ path: `${DIR}/1c-dual-poziv-badge.png`, fullPage: true });
  });

  test('dual-service member - the explicit service switch on Settings', async ({ page }) => {
    await installFixtureProject(page, DUAL);
    await page.goto('http://127.0.0.1:4174/#/podesavanja');
    await page.waitForSelector('main');
    await frame(page);
    await page.screenshot({ path: `${DIR}/1c-dual-podesavanja-switch.png`, fullPage: true });
  });

  test('owner - accounts directory with both service columns', async ({ page }) => {
    await installFixtureProject(page, OWNER);
    await page.goto('http://127.0.0.1:4174/#/nalozi');
    await page.waitForSelector('main');
    await frame(page);
    await page.screenshot({ path: `${DIR}/1d-owner-nalozi-both-columns.png`, fullPage: true });
  });

  test('owner - a member-only screen says so, not a blank', async ({ page }) => {
    await installFixtureProject(page, OWNER);
    await page.goto('http://127.0.0.1:4174/#/mobilizacija');
    await page.waitForSelector('main');
    await frame(page);
    await page.screenshot({ path: `${DIR}/1d-owner-no-member-record.png`, fullPage: true });
  });
});
