/**
 * What each role is actually shown.
 *
 * Two findings from the device test, both about a firefighter being offered
 * somebody else's screen:
 *
 *   * the commander's console was in their navigation, and refused them when
 *     they opened it;
 *   * their own account page carried the empty shell of the owner's account
 *     directory, with an explanation that they could not see it.
 *
 * Neither was a security fault - the server withholds the data from a
 * non-owner whatever the browser renders - and that is exactly why they are
 * tested HERE rather than in `db-tests/`. This file is about what a person
 * sees. The server-side refusals have their own tests, and the last test below
 * checks that hiding the destination did not become the thing keeping anybody
 * out: a firefighter who types the commander's URL is still stopped.
 */

import { expect, test } from '@playwright/test';
import { openOperational } from './fixture-server';

test.describe('the navigation offers only what the role can use', () => {
  test('a firefighter is not offered the commander console', async ({ page }) => {
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('callout-title')).toBeVisible();

    await expect(page.getByTestId('nav-poziv')).toHaveCount(0);
    await expect(page.getByTestId('nav-evidencija')).toHaveCount(0);

    // What they DO keep: their own call-out, the archive, their own account.
    await expect(page.getByTestId('nav-mobilizacija')).toBeVisible();
    await expect(page.getByTestId('nav-arhiva')).toBeVisible();
    await expect(page.getByTestId('nav-nalozi')).toBeVisible();
  });

  test('a commander keeps the console and is not offered society records', async ({ page }) => {
    await openOperational(page, 'poziv', 'COMMANDER');
    await expect(page.getByRole('heading', { name: /Vjezba: provjera opreme/ })).toBeVisible();

    await expect(page.getByTestId('nav-poziv')).toBeVisible();
    await expect(page.getByTestId('nav-mobilizacija')).toBeVisible();
    await expect(page.getByTestId('nav-evidencija')).toHaveCount(0);
  });

  test('the owner is offered everything', async ({ page }) => {
    await openOperational(page, 'poziv', 'OWNER');
    for (const route of ['poziv', 'mobilizacija', 'arhiva', 'evidencija', 'nalozi', 'podesavanja']) {
      await expect(page.getByTestId(`nav-${route}`), route).toBeVisible();
    }
  });

  test('settings are offered to a firefighter too, because they are this device', async ({ page }) => {
    // Language and notifications are settings of one browser, not facts about
    // an account. Putting them behind a role check would mean the person most
    // in need of a refusal message they can read is the one who cannot change
    // its language.
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('nav-podesavanja')).toBeVisible();
  });

  test('a citizen is offered only their account and device settings', async ({ page }) => {
    await openOperational(page, 'nalozi', { role: null, accountStatus: 'ACTIVE' });

    for (const route of ['poziv', 'mobilizacija', 'arhiva', 'evidencija']) {
      await expect(page.getByTestId(`nav-${route}`), route).toHaveCount(0);
    }
    await expect(page.getByTestId('nav-nalozi')).toBeVisible();
    await expect(page.getByTestId('nav-podesavanja')).toBeVisible();
    await expect(page.getByText(/aktivan kao gradjanski nalog/i)).toBeVisible();
  });

  /**
   * What the hosted review actually looked at: the deployed sidebar.
   *
   * It found "Prijava gradjana" there, under a heading reading "Nije u
   * upotrebi". A heading saying a destination is unused does not stop anybody
   * tapping it, and this application must never read as a way to report a fire.
   */
  test('citizen reporting is not a destination for anybody', async ({ page }) => {
    for (const role of ['OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER'] as const) {
      await openOperational(page, 'poziv', role);
      await expect(page.getByTestId('nav-dojava'), role).toHaveCount(0);
      const rail = page.getByRole('complementary');
      await expect(rail, role).not.toContainText('Prijava gradjana');
      await expect(rail, role).not.toContainText('Nije u upotrebi');
    }
  });

  test('no simulation at all is offered in the rail', async ({ page }) => {
    // A commander who runs a call-out on the local simulation by accident finds
    // nothing on the server afterwards. The station display used to stay on the
    // argument that it duplicated nothing - true, and beside the point: a group
    // label is not a separation, and one tap is one tap. Every simulation is
    // behind a closed disclosure on Settings now.
    await openOperational(page, 'poziv', 'COMMANDER');
    for (const route of ['dezurni', 'clan', 'vozila', 'clanovi', 'istorija', 'prikaz']) {
      await expect(page.getByTestId(`nav-${route}`), route).toHaveCount(0);
    }
  });

  test('the active destination is marked', async ({ page }) => {
    await openOperational(page, 'arhiva', 'COMMANDER');
    await expect(page.getByTestId('archive-title')).toBeVisible();
    await expect(page.getByTestId('nav-arhiva')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('nav-poziv')).not.toHaveAttribute('aria-current', 'page');
  });
});

test.describe('the account screen shows a member their own account and nobody else’s', () => {
  test('a firefighter sees no owner-only section at all', async ({ page }) => {
    await openOperational(page, 'nalozi', 'FIREFIGHTER');
    await page.waitForSelector('main');

    // Not "hidden behind an explanation" - not present. An empty section headed
    // with somebody else's job reads as a screen that failed to load.
    await expect(page.getByRole('heading', { name: 'Registrovani nalozi' })).toHaveCount(0);
    await expect(page.getByText('Promjene uloga i pristupa', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Samo vlasnik sistema')).toHaveCount(0);

    // Their own account information is still there, which is the point of the
    // screen for them.
    await expect(page.getByRole('heading', { name: /Nalog i pristup|Vas nalog|Prijava/i }).first())
      .toBeVisible();
  });

  test('the owner still gets the directory', async ({ page }) => {
    await openOperational(page, 'nalozi', 'OWNER');
    await expect(page.getByRole('heading', { name: 'Registrovani nalozi' })).toBeVisible();
  });
});

test.describe('hiding a destination is not what keeps anybody out', () => {
  test('a firefighter who types the commander URL is still refused', async ({ page }) => {
    // The navigation entry is gone, so this is the only way to reach it - and
    // it must still be refused, by the gate and, for every command, by the
    // server. If this ever renders the console, hiding the link has quietly
    // become the control, which is the failure mode the brief warns about.
    await openOperational(page, 'poziv', 'FIREFIGHTER');
    await page.waitForSelector('main');

    await expect(page.getByText(/nije za vasu ulogu/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Vjezba: provjera opreme/ })).toHaveCount(0);
    await expect(page.getByTestId('publish')).toHaveCount(0);
  });
});
