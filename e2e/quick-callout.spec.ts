import { expect, test } from '@playwright/test';
import { DUAL_DVD_MEMBER, DUAL_SZS_MEMBER, installFixtureProject } from './fixture-server';

test('an SZS commander who also serves DVD chooses DVD, SZS or both without picking members', async ({ page }) => {
  await installFixtureProject(page, {
    memberships: [
      { service: 'DVD', role: 'FIREFIGHTER', memberId: DUAL_DVD_MEMBER },
      { service: 'SZS', role: 'COMMANDER', memberId: DUAL_SZS_MEMBER },
    ],
  });
  await page.goto('http://127.0.0.1:4174/#/podesavanja');
  await page.getByTestId('acting-service-SZS').click();
  await expect(page.getByTestId('acting-service-SZS').locator('input')).toBeChecked();
  await page.goto('http://127.0.0.1:4174/#/poziv');
  const disclosure = page.getByTestId('new-call-out-disclosure');
  await disclosure.locator(':scope > summary').click();
  const form = disclosure.getByTestId('new-call-out-wizard');
  await form.getByTestId('new-title').fill('Brza zajednicka vjezba');
  await form.getByTestId('new-location').fill('Poligon');
  await form.getByTestId('new-instructions').fill('Samo vjezba.');
  const audience = form.getByTestId('audience-picker');
  await expect(audience.getByRole('radio')).toHaveCount(3);
  await expect(audience.locator('input[value="OWN"]')).toBeChecked();
  await audience.getByRole('radio', { name: 'DVD Tivat', exact: true }).check();
  await form.getByTestId('quick-review').click();
  const review = page.getByRole('dialog');
  await expect(review).toContainText('Brza zajednicka vjezba');
  await expect(review).toContainText('DVD Tivat');
  await expect(review).not.toContainText('Sluzba zastite i spasavanja Tivat');
  await expect(page.getByTestId('recipient-picker')).toHaveCount(0);
});

test('both services remain selectable when the command service has no eligible members', async ({ page }) => {
  await installFixtureProject(page, {
    memberships: [
      { service: 'DVD', role: 'FIREFIGHTER', memberId: DUAL_DVD_MEMBER },
      { service: 'SZS', role: 'COMMANDER', memberId: DUAL_SZS_MEMBER },
    ],
    emptyEligibleServices: ['SZS'],
  });
  await page.goto('http://127.0.0.1:4174/#/podesavanja');
  await page.getByTestId('acting-service-SZS').click();
  await page.goto('http://127.0.0.1:4174/#/poziv');
  const disclosure = page.getByTestId('new-call-out-disclosure');
  await disclosure.locator(':scope > summary').click();
  const form = disclosure.getByTestId('new-call-out-wizard');
  await form.getByTestId('new-title').fill('Zajednicka proba');
  await form.getByTestId('new-location').fill('Poligon');
  await form.getByTestId('new-instructions').fill('Samo proba.');
  await expect(form.getByTestId('quick-review')).toBeDisabled();
  await form.getByTestId('audience-picker').locator('input[value="BOTH"]').check();
  await expect(form.getByTestId('own-service-eligibility-warning')).toBeVisible();
  await expect(form.getByTestId('quick-review')).toBeEnabled();
  await form.getByTestId('quick-review').click();
  await expect(page.getByRole('dialog')).toContainText('Zajednicka proba');
});
