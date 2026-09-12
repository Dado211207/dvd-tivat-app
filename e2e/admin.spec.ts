import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { goTo, openApp, switchActor } from './helpers';

/**
 * The account directory used to be reachable by choosing "administrator" in the
 * actor selector, which made the most sensitive screen in the application the
 * easiest one to open. The selector is a costume; it must not move access.
 *
 * It is now isolated rather than merely ignored: on a server-backed route it is
 * not rendered at all, so the choice made on a simulated screen cannot follow
 * somebody onto a real one. This test picks the simulated administrator FIRST,
 * where the control exists, and then crosses over.
 *
 * This build has no project configured (CI has no `.env.local`, deliberately),
 * so the screen reports exactly that instead of pretending to be signed in.
 */
test('the account directory cannot be reached through the simulation selector', async ({ page }) => {
  await openApp(page, 'dezurni');

  // Every simulated actor, including the one that used to unlock the panel.
  for (const actor of ['Marko Perovic', 'Ana Vukovic', 'Nikola Djukic']) {
    await switchActor(page, actor);
    await goTo(page, 'nalozi');

    await expect(page.getByText('Server nije podesen u ovoj verziji')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Svi registrovani nalozi' })).toHaveCount(0);
    // No role selector, no suspend button, no account rows - nothing that would
    // suggest this actor holds owner rights.
    await expect(page.getByRole('button', { name: 'Ukini pristup' })).toHaveCount(0);
    // And the costume itself is not on this screen to be changed into.
    await expect(page.getByTestId('actor-select')).toHaveCount(0);

    await goTo(page, 'dezurni');
  }

  await goTo(page, 'nalozi');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

/**
 * The isolation itself, stated once as its own rule rather than only as a
 * consequence observed on two screens.
 */
test('the simulation selector exists only on simulated screens', async ({ page }) => {
  await openApp(page, 'dezurni');
  await expect(page.getByTestId('actor-select')).toBeVisible();

  for (const route of ['poziv', 'mobilizacija', 'arhiva', 'evidencija', 'nalozi']) {
    await goTo(page, route);
    await expect(page.getByTestId('actor-select')).toHaveCount(0);
    // Not merely hidden from sight: absent from the accessibility tree too, so
    // it cannot be tabbed to or announced.
    await expect(page.getByLabel(/Simulirani ucesnik/)).toHaveCount(0);
  }

  for (const route of ['dezurni', 'clan', 'vozila', 'prikaz', 'clanovi', 'istorija']) {
    await goTo(page, route);
    await expect(page.getByTestId('actor-select')).toBeVisible();
  }
});

test('the accounts screen never claims a role it has not been given', async ({ page }) => {
  await openApp(page, 'nalozi');

  // Nothing on the screen reads as a signed-in person: no server-confirmed
  // identity, no role, and none of the owner-only controls.
  await expect(page.getByText('Uloga sa servera')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Odjavi se' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ukini pristup' })).toHaveCount(0);
  await expect(page.getByLabel('Email')).toHaveCount(0);
});

/**
 * The roster screen is the one place real member, group and vehicle records are
 * entered. It is ADMIN or OWNER authority, and - like the account directory -
 * the simulation selector must not reach it.
 */
test('the society roster cannot be reached through the simulation selector', async ({ page }) => {
  await openApp(page, 'evidencija');

  // Nothing that would let somebody believe they are editing the real roster.
  await expect(page.getByRole('button', { name: 'Dodaj clana' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dodaj vozilo' })).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Spisak clanova' })).toHaveCount(0);

  for (const actor of ['Marko Perovic', 'Ana Vukovic', 'Nikola Djukic']) {
    // 'Marko Perovic' is the simulated administrator. Picking him used to be
    // how the most sensitive screen was opened; it must move nothing.
    await goTo(page, 'dezurni');
    await switchActor(page, actor);
    await goTo(page, 'evidencija');
    await expect(page.getByRole('button', { name: 'Dodaj clana' })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Spisak clanova' })).toHaveCount(0);
  }

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
});

test('the roster screen is not labelled as a local simulation', async ({ page }) => {
  // It reads and writes real server records, so it must not carry the
  // simulation warning that every device-local screen carries.
  await openApp(page, 'evidencija');
  await expect(page.getByText('Ovaj ekran jos radi na lokalnoj simulaciji')).toHaveCount(0);
});

test('an operational screen says it is still a local simulation', async ({ page }) => {
  await openApp(page, 'dezurni');
  await expect(page.getByText('Ovaj ekran jos radi na lokalnoj simulaciji')).toBeVisible();

  // The one screen backed by the server does not carry that warning.
  await openApp(page, 'nalozi');
  await expect(page.getByText('Ovaj ekran jos radi na lokalnoj simulaciji')).toHaveCount(0);
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
