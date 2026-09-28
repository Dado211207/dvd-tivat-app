/**
 * The installation owner (P6 acceptance 1d): administers BOTH services and may
 * have no member record in either. `is_installation_owner` makes both services
 * available and `current_role_in` answers OWNER for each, but
 * `current_member_id_in` answers null - there is no roster row for this account.
 *
 * So the owner can act as either service and read its operational screens, but a
 * screen whose whole purpose is a member's own participation (the "my call-out"
 * screen: acknowledging, answering, checking in) must say plainly that this
 * account is not a member - never a blank screen, and never a silent grant of a
 * member-only action. Real isolation and the null member answer are the
 * database's, proven in `db-tests/`; this proves the client renders each case.
 */

import { expect, test } from '@playwright/test';
import { DVD_CALLOUT_TITLE, installFixtureProject } from './fixture-server';

const APP = 'http://127.0.0.1:4174';

/** Owner of the installation, member of neither service, in Montenegrin. */
const OWNER = {
  language: 'me' as const,
  owner: true,
  memberships: [
    { service: 'DVD' as const, role: 'OWNER' as const, memberId: null },
    { service: 'SZS' as const, role: 'OWNER' as const, memberId: null },
  ],
};

test('the owner can act as either service and read its operational screens', async ({ page }) => {
  await installFixtureProject(page, OWNER);
  await page.goto(`${APP}/#/poziv`);
  await page.waitForSelector('main');

  // The switch is offered (two services), and the read screen renders for the
  // owner even though they hold no member record - the DVD call-out is on screen.
  await expect(page.getByTestId('acting-service-badge')).toBeVisible();
  await expect(page.getByText(DVD_CALLOUT_TITLE).first()).toBeVisible();

  await page.goto(`${APP}/#/podesavanja`);
  await expect(page.getByTestId('acting-service-DVD')).toBeVisible();
  await expect(page.getByTestId('acting-service-SZS')).toBeVisible();
});

test('the owner sees both service columns in the accounts directory', async ({ page }) => {
  await installFixtureProject(page, OWNER);
  await page.goto(`${APP}/#/nalozi`);
  await page.waitForSelector('main');

  await expect(page.getByRole('heading', { name: 'Registrovani nalozi' })).toBeVisible();
  // Both services get a column, because the owner administers both.
  await expect(page.getByRole('columnheader', { name: 'DVD Tivat' })).toBeVisible();
  await expect(
    page.getByRole('columnheader', { name: 'Sluzba zastite i spasavanja Tivat' }),
  ).toBeVisible();
});

test('a member-only screen refuses the owner with no member record, not a blank', async ({ page }) => {
  await installFixtureProject(page, OWNER);
  await page.goto(`${APP}/#/mobilizacija`);
  await page.waitForSelector('main');

  // The one thing the owner cannot do without a roster row: be the member on the
  // "my call-out" screen. Said in words, not left blank.
  await expect(page.getByText('Vas nalog nije povezan sa clanom drustva.')).toBeVisible();
});
