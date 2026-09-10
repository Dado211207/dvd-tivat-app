import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openApp, switchActor } from './helpers';

test('only the owner simulation can open the account directory and assign a role', async ({ page }) => {
  await openApp(page, 'nalozi');
  await expect(page.getByText('Ovaj spisak je sakriven.')).toBeVisible();

  await switchActor(page, 'Marko Perovic');
  await expect(page.getByRole('heading', { name: 'Svi registrovani nalozi' })).toBeVisible();

  const role = page.getByLabel('Uloga za Probni Korisnik 01');
  await expect(role).toHaveValue('CITIZEN');
  await role.selectOption('FIREFIGHTER');
  await expect(role).toHaveValue('FIREFIGHTER');
  await expect(page.locator('[aria-live="polite"]')).toContainText('Vatrogasac');
});

test('an administrator can maintain fictional members, groups and vehicles locally', async ({ page }) => {
  await openApp(page, 'clanovi');
  await expect(page.getByText('Ovaj dio se prikazuje samo kada je izabran')).toBeVisible();

  await switchActor(page, 'Marko Perovic');
  await expect(page.getByRole('heading', { name: 'Upravljanje probnim podacima' })).toBeVisible();

  await page.getByTestId('admin-group-select').selectOption('');
  await page.locator('#demoGroupName').fill('Probna nocna smjena');
  await page.getByTestId('save-demo-group').click();
  await expect(page.getByRole('table', { name: 'Grupe i broj clanova' })).toContainText('Probna nocna smjena');

  await page.getByTestId('admin-vehicle-select').selectOption('');
  await page.locator('#demoVehicleCallsign').fill('PV-9');
  await page.locator('#demoVehicleType').fill('Logistika');
  await page.locator('#demoVehicleName').fill('Probno logisticko vozilo');
  await page.getByTestId('save-demo-vehicle').click();
  await expect(page.getByRole('table', { name: 'Izmisljeni vozni park' })).toContainText('PV-9');

  await page.getByTestId('admin-member-select').selectOption('');
  await page.locator('#demoMemberName').fill('Probni Clan 15');
  await page.getByRole('group', { name: 'Specijalnosti (opciono)' }).getByRole('checkbox', { name: 'Prva pomoc' }).check();
  await page.getByRole('group', { name: 'Probne grupe (opciono)' }).getByRole('checkbox', { name: 'Probna nocna smjena' }).check();
  await page.getByTestId('save-demo-member').click();

  const roster = page.getByTestId('roster-rows');
  await expect(roster).toContainText('Probni Clan 15');
  await expect(roster).toContainText('Probna nocna smjena');

  await page.getByTestId('admin-member-select').selectOption({ label: 'Probni Clan 15' });
  await page.getByRole('checkbox', { name: 'Aktivan u probnom spisku' }).uncheck();
  await page.getByTestId('save-demo-member').click();
  await expect(roster.getByRole('row', { name: /Probni Clan 15/ })).toContainText('Neaktivan');

  // The full editable state is scanned, not only the locked non-admin message.
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});
