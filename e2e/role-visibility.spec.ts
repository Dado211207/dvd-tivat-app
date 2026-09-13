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
    for (const route of ['poziv', 'mobilizacija', 'arhiva', 'evidencija', 'nalozi']) {
      await expect(page.getByTestId(`nav-${route}`), route).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Svi registrovani nalozi' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Promjene uloga i pristupa' })).toHaveCount(0);
    await expect(page.getByText('Samo vlasnik sistema')).toHaveCount(0);

    // Their own account information is still there, which is the point of the
    // screen for them.
    await expect(page.getByRole('heading', { name: /Nalog i pristup|Vas nalog|Prijava/i }).first())
      .toBeVisible();
  });

  test('the owner still gets the directory', async ({ page }) => {
    await openOperational(page, 'nalozi', 'OWNER');
    await expect(page.getByRole('heading', { name: 'Svi registrovani nalozi' })).toBeVisible();
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
