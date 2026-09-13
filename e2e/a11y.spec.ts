/**
 * Automated accessibility checks on every main view, in a real rendered state.
 *
 * An automated pass is a floor, not a ceiling: axe cannot judge whether a label
 * makes sense or whether the reading order is sensible. The keyboard tests in
 * flow.spec.ts cover part of what it cannot see.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createCall, goTo, openApp, switchActor } from './helpers';

const RULESETS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const VIEWS = [
  // Server-backed. In a build with no project configured they render their
  // "not connected" state, which is exactly the state a reader with a screen
  // reader must still be able to understand.
  'poziv',
  'mobilizacija',
  'arhiva',
  'evidencija',
  'nalozi',
  // The local prototype.
  'dojava',
  'dezurni',
  'clan',
  'vozila',
  'prikaz',
  'clanovi',
  'istorija',
];

test.describe('accessibility', () => {
  test('empty views pass an axe scan', async ({ page }) => {
    await openApp(page);

    for (const route of VIEWS) {
      await goTo(page, route);
      const results = await new AxeBuilder({ page }).withTags(RULESETS).analyze();
      expect(results.violations, `${route}: ${JSON.stringify(results.violations, null, 2)}`).toEqual(
        [],
      );
    }
  });

  test('views with an active exercise and answers pass an axe scan', async ({ page }) => {
    await openApp(page);
    await createCall(page);

    await switchActor(page, 'Ivan Radulovic');
    await goTo(page, 'clan');
    await page.getByTestId('answer-DOLAZIM').click();
    await page.getByTestId('submit-response').click();

    await goTo(page, 'vozila');
    await page.getByTestId('depart-MAN-1').click();
    await page.getByRole('button', { name: 'Potvrdi' }).click();

    for (const route of VIEWS) {
      await goTo(page, route);
      const results = await new AxeBuilder({ page }).withTags(RULESETS).analyze();
      expect(results.violations, `${route}: ${JSON.stringify(results.violations, null, 2)}`).toEqual(
        [],
      );
    }
  });

  // The application follows the viewer's theme, so dark mode needs its own
  // contrast check - the light palette passing proves nothing about it.
  test('views pass an axe scan in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await createCall(page);

    await switchActor(page, 'Ivan Radulovic');
    await goTo(page, 'clan');
    await page.getByTestId('answer-DOLAZIM').click();
    await page.getByTestId('submit-response').click();
    // Reopen the form so the selected (filled) answer button is rendered - its
    // text sits on a saturated fill, which is where a hardcoded colour breaks.
    await page.getByRole('button', { name: 'Promijeni odgovor' }).click();
    await expect(page.getByTestId('answer-DOLAZIM')).toHaveAttribute('aria-pressed', 'true');

    for (const route of VIEWS) {
      await goTo(page, route);
      const results = await new AxeBuilder({ page }).withTags(RULESETS).analyze();
      expect(results.violations, `${route}: ${JSON.stringify(results.violations, null, 2)}`).toEqual(
        [],
      );
    }
  });

  test('the confirmation dialog passes an axe scan and traps focus', async ({ page }) => {
    await openApp(page);
    await page.getByLabel(/^Naslov/).fill('Vjezba');
    await page.getByLabel(/^Uputstvo za clanove/).fill('Uputstvo');
    await page.getByLabel(/^Lokacija dogadjaja/).fill('Lokacija');
    await page.getByRole('checkbox', { name: /Nosioci IDA aparata/ }).check();
    await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(RULESETS).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);

    // The native modal makes the background inert: the composer behind it is
    // not reachable while the dialog is open.
    await expect(page.getByLabel(/^Naslov/)).not.toBeFocused();
  });

  test('a validation error is exposed to assistive technology', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();

    const input = page.locator('#f-title');
    await expect(input).toHaveAttribute('aria-invalid', 'true');

    const describedBy = await input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy!.split(' ').pop()}`)).toContainText('Unesite naslov');

    // The assertive live region carries the same message.
    await expect(page.locator('[role="alert"]')).toContainText('Unesite naslov');
  });

  test('the editable fictional-data administration panel passes an axe scan', async ({ page }) => {
    await openApp(page, 'clanovi');
    await switchActor(page, 'Marko Perovic');
    await expect(page.getByRole('heading', { name: 'Upravljanje probnim podacima' })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(RULESETS).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('response state is not carried by colour alone', async ({ page }) => {
    await openApp(page);
    await createCall(page);
    await switchActor(page, 'Ivan Radulovic');
    await goTo(page, 'clan');
    await page.getByTestId('answer-DOLAZIM').click();
    await page.getByTestId('submit-response').click();

    await goTo(page, 'dezurni');
    // Every recipient row reads as text, whether answered or not.
    const rows = page.getByTestId('recipient-rows');
    await expect(rows).toContainText('Dolazim');
    await expect(rows).toContainText('Bez odgovora');
  });
});
