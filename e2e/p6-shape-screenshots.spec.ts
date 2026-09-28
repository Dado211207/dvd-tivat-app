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
 *   npx playwright test e2e/p6-shape-screenshots.spec.ts --project=desktop --grep @screenshots
 *
 * Each capture WAITS for the intended content (call-out, badge, switch, columns,
 * the no-member notice) before shooting, and captures the phone VIEWPORT (not
 * `fullPage`, which drops the fixed bottom nav mid-image) - or, for content below
 * the fold, the specific panel. They show what each shape sees; they do NOT prove
 * server isolation (that is RLS, in db-tests/) and are not a hosted system.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  DVD_CALLOUT_TITLE,
  SZS_CALLOUT_TITLE,
  installFixtureProject,
} from './fixture-server';

const APP = 'http://127.0.0.1:4174';
const DIR = 'docs/screenshots/p6';
const PHONE = { width: 390, height: 844 } as const;

/** A realistic notch inset, matching the other mobile screenshots. */
async function frame(page: Page): Promise<void> {
  await page.addStyleTag({ content: ':root { --safe-top: 47px !important; }' });
}

const DVD_ONLY = {
  language: 'me' as const,
  memberships: [{ service: 'DVD' as const, role: 'COMMANDER' as const, memberId: 'aaaa0d13-0000-4000-8000-000000000001' }],
};
const SZS_ONLY = {
  language: 'me' as const,
  memberships: [{ service: 'SZS' as const, role: 'COMMANDER' as const, memberId: 'bbbb0d13-0000-4000-8000-000000000002' }],
};
const DUAL = {
  language: 'me' as const,
  memberships: [
    { service: 'DVD' as const, role: 'COMMANDER' as const, memberId: 'aaaa0d13-0000-4000-8000-000000000001' },
    { service: 'SZS' as const, role: 'COMMANDER' as const, memberId: 'bbbb0d13-0000-4000-8000-000000000002' },
  ],
};
const OWNER = {
  language: 'me' as const,
  owner: true,
  memberships: [] as const,
};

test.describe('@screenshots P6 account shapes (mobile)', () => {
  test.use({ viewport: { width: PHONE.width, height: PHONE.height } });

  test('DVD-only member - call-out screen, no service badge', async ({ page }) => {
    await installFixtureProject(page, DVD_ONLY);
    await page.goto(`${APP}/#/poziv`);
    await frame(page);
    await expect(page.getByText(DVD_CALLOUT_TITLE).first()).toBeVisible();
    await expect(page.getByTestId('acting-service-badge')).toHaveCount(0);
    await page.screenshot({ path: `${DIR}/1a-dvd-only-poziv.png` });
  });

  test('SZS-only member - its own call-out screen, no service badge', async ({ page }) => {
    await installFixtureProject(page, SZS_ONLY);
    await page.goto(`${APP}/#/poziv`);
    await frame(page);
    await expect(page.getByText(SZS_CALLOUT_TITLE).first()).toBeVisible();
    await expect(page.getByTestId('acting-service-badge')).toHaveCount(0);
    await page.screenshot({ path: `${DIR}/1b-szs-only-poziv.png` });
  });

  test('dual-service member - the acting-service badge on the call-out screen', async ({ page }) => {
    await installFixtureProject(page, DUAL);
    await page.goto(`${APP}/#/poziv`);
    await frame(page);
    await expect(page.getByTestId('acting-service-badge')).toBeVisible();
    await expect(page.getByText(DVD_CALLOUT_TITLE).first()).toBeVisible();
    await page.screenshot({ path: `${DIR}/1c-dual-poziv-badge.png` });
  });

  test('dual-service member - the explicit service switch on Settings', async ({ page }) => {
    await installFixtureProject(page, DUAL);
    await page.goto(`${APP}/#/podesavanja`);
    await frame(page);
    await expect(page.getByTestId('acting-service-DVD')).toBeVisible();
    await expect(page.getByTestId('acting-service-SZS')).toBeVisible();
    await expect(page.getByTestId('acting-service-DVD').locator('input')).toBeChecked();
    await page.screenshot({ path: `${DIR}/1c-dual-podesavanja-switch.png` });
  });

  test('owner - accounts directory with both service columns', async ({ page }) => {
    await installFixtureProject(page, OWNER);
    await page.goto(`${APP}/#/nalozi`);
    await frame(page);
    await expect(page.getByRole('heading', { name: 'Registrovani nalozi' })).toBeVisible();
    // Wait for the owner's row to have resolved to OWNER in both service cells.
    const cells = page.locator('.account-service-cell');
    await expect(cells).toHaveCount(2);
    await expect(cells.nth(1)).toContainText('Vlasnik sistema');
    // The directory is below the fold; capture the panel itself so the columns
    // are shown in full. Hide the fixed bottom nav for this one shot so it does
    // not cut across the tall panel (it is not the subject here).
    await page.addStyleTag({ content: '.station-rail { display: none !important; }' });
    await page.locator('.account-directory').scrollIntoViewIfNeeded();
    await page.locator('.account-directory').screenshot({ path: `${DIR}/1d-owner-nalozi-both-columns.png` });
  });

  test('owner - a member-only screen says so, not a blank', async ({ page }) => {
    await installFixtureProject(page, OWNER);
    await page.goto(`${APP}/#/mobilizacija`);
    await frame(page);
    await expect(page.getByText('Vas nalog nije povezan sa clanom drustva.')).toBeVisible();
    await page.screenshot({ path: `${DIR}/1d-owner-no-member-record.png` });
  });
});
