/**
 * The server-backed screens, populated, in a real browser.
 *
 * Everything else that touches them stops short of this. The jsdom tests render
 * the components but have no layout and no CSS; the hosted test exercises the
 * data layer but no interface; the other browser tests run against a build with
 * no project configured, so every operational screen stops at the gate.
 *
 * These run against a second build pointed at a project that does not exist,
 * with every request to it answered by `fixture-server.ts`. Nothing real is
 * contacted and no credential is needed, so this runs in CI like everything
 * else.
 *
 * What is asserted here is what only a real browser can show: that the screens
 * fit a phone without sideways scrolling, that every control is big enough to
 * hit, that an axe scan passes on the POPULATED state rather than on an empty
 * one, and that the sentences which must never be wrong are actually on screen.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openOperational } from './fixture-server';

const RULESETS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Proof that the screen under test is actually up.
 *
 * An error notice is perfectly accessible and perfectly narrow, so an axe scan
 * or a layout check that ran on one would pass while proving nothing. Each of
 * these targets something only the real, populated screen renders - and
 * something VISIBLE: the first version of this matched the intervention title
 * inside a `<select>`, which is in the document and hidden, and every commander
 * test failed on a screen that was working.
 */
function anchorFor(page: Page, route: string) {
  if (route === 'mobilizacija') return page.getByTestId('callout-title');
  if (route === 'arhiva') return page.getByTestId('archive-title');
  return page.getByRole('heading', { name: /Vjezba: provjera opreme/ });
}

test.describe('the commander console', () => {
  test('shows the call-out it was given', async ({ page }) => {
    await openOperational(page, 'poziv');
    await expect(anchorFor(page, 'poziv')).toBeVisible();
    await expect(page.getByText('Ova kopija nije povezana sa serverom')).toHaveCount(0);
  });

  test('gives each fact its own column and never reads one off another', async ({ page }) => {
    await openOperational(page, 'poziv');
    await page.getByRole('tab', { name: 'Pregled' }).click();

    const table = page.getByTestId('overview-table');
    await expect(table).toBeVisible();
    await expect(table.locator('thead th')).toHaveText([
      'Clan',
      'Otvorio',
      'Odgovor',
      'Kretanje',
      'Prisustvo',
    ]);

    // Ivo reported being on scene and has an interval nobody has confirmed.
    const ivo = table.getByRole('row', { name: /Ivo Vatrogasac/ });
    await expect(ivo).toContainText('Na licu mjesta');
    await expect(ivo).toContainText('Ceka potvrdu');
    await expect(ivo).not.toContainText('Potvrdjeno');

    // Pero declined. Declining writes nothing into attendance.
    const pero = table.getByRole('row', { name: /Pero Vatrogasac/ });
    await expect(pero).toContainText('Ne mogu');
    await expect(pero).toContainText('Nema zapisa');
  });

  test('confirming a board needs no note', async ({ page }) => {
    await openOperational(page, 'poziv');
    await page.getByRole('tab', { name: 'Prisustvo' }).click();

    await expect(page.getByTestId('pick-all-pending')).toBeVisible();
    const confirm = page.getByTestId('confirm-many');
    await expect(confirm).toBeVisible();
    // No field to fill before it can be pressed, once something is selected.
    await page.getByTestId('pick-all-pending').click();
    await expect(confirm).toBeEnabled();
  });

  test('says vehicle movements do not create attendance', async ({ page }) => {
    await openOperational(page, 'poziv');
    await page.getByRole('tab', { name: 'Vozila' }).click();
    await expect(page.getByText(/Ne prijavljuje nicije prisustvo/i)).toBeVisible();
  });

  test('is refused to a firefighter, with a reason', async ({ page }) => {
    await openOperational(page, 'poziv', 'FIREFIGHTER');
    await expect(page.getByText(/nije za vasu ulogu/i)).toBeVisible();
    await expect(anchorFor(page, 'poziv')).toHaveCount(0);
  });
});

test.describe('the firefighter screen', () => {
  test('shows the call-out with each action as its own step', async ({ page }) => {
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('callout-title')).toBeVisible();
    for (const id of ['available-yes', 'available-no', 'answer-DOLAZIM', 'check-in']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test('says in words that reporting movement is not reporting attendance', async ({ page }) => {
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByText(/ne prijavljuje prisustvo/i)).toBeVisible();
  });

  test('shows a recorded arrival as waiting for the commander', async ({ page }) => {
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByText(/ceka potvrdu/i).first()).toBeVisible();
  });
});

test.describe('the archive', () => {
  test('lists each fact on its own line with its own time', async ({ page }) => {
    await openOperational(page, 'arhiva');
    const events = page.getByTestId('archive-timeline').locator('li');
    await expect(events.filter({ hasText: 'je otvorio poziv' })).toHaveCount(1);
    await expect(events.filter({ hasText: 'je odgovorio' })).toHaveCount(2);
    await expect(events.filter({ hasText: 'javio kretanje' })).toHaveCount(1);
  });

  test('counts nothing for an interval nobody confirmed', async ({ page }) => {
    await openOperational(page, 'arhiva');
    const total = page.getByTestId('archive-total');
    await expect(total).toContainText('0 min');
    await expect(total).not.toContainText('1 h 30 min');
  });

  test('keeps confirmed and unconfirmed in separate columns', async ({ page }) => {
    await openOperational(page, 'arhiva');
    const row = page.getByTestId('archive-totals').locator('tbody tr').first();
    await expect(row).toContainText('1 h 30 min');
    await expect(row).toContainText('neuracunato');
  });
});

/**
 * The phone is the device this is used on. A control that cannot be hit with a
 * thumb, or a page that scrolls sideways, is a defect on an intervention.
 */
test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of ['poziv', 'mobilizacija', 'arhiva']) {
    test(`${route} fits the screen and every control can be hit`, async ({ page }) => {
      await openOperational(page, route, route === 'mobilizacija' ? 'FIREFIGHTER' : 'COMMANDER');
      await expect(anchorFor(page, route)).toBeVisible();

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        'the page must not scroll sideways',
      ).toBe(true);

      const controls = page.locator('main button:visible, main a:visible');
      const count = await controls.count();
      expect(count, 'there must be something to press').toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        const box = await controls.nth(i).boundingBox();
        if (box === null) continue;
        expect(
          box.height,
          `control ${i} ("${(await controls.nth(i).innerText()).slice(0, 30)}") is ${box.height}px tall`,
        ).toBeGreaterThanOrEqual(40);
      }
    });
  }
});

test.describe('accessibility of the populated screens', () => {
  for (const route of ['poziv', 'mobilizacija', 'arhiva']) {
    test(`${route} passes an axe scan with data on it`, async ({ page }) => {
      await openOperational(page, route, route === 'mobilizacija' ? 'FIREFIGHTER' : 'COMMANDER');
      await expect(anchorFor(page, route)).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(RULESETS).analyze();
      expect(results.violations, `${route}: ${JSON.stringify(results.violations, null, 2)}`).toEqual(
        [],
      );
    });
  }

  test('the commander tabs pass a scan on each tab', async ({ page }) => {
    await openOperational(page, 'poziv');
    await expect(anchorFor(page, 'poziv')).toBeVisible();
    for (const tab of ['Pregled', 'Prisustvo', 'Vozila']) {
      await page.getByRole('tab', { name: tab }).click();
      const results = await new AxeBuilder({ page }).withTags(RULESETS).analyze();
      expect(results.violations, `${tab}: ${JSON.stringify(results.violations, null, 2)}`).toEqual(
        [],
      );
    }
  });
});
