import { expect, test } from '@playwright/test';
import { createCall, goTo, openApp, switchActor } from './helpers';

test('keyboard skip link preserves the member route and unsent answer', async ({ page }) => {
  await openApp(page);
  await createCall(page);
  await switchActor(page, 'Ivan Radulovic');
  await goTo(page, 'clan');
  await page.getByTestId('answer-DOLAZIM_KASNIJE').click();
  await page.getByTestId('eta-60').click();
  const before = page.url();
  // Focus the actual keyboard-only link, then activate it with Enter.
  await page.getByRole('link', { name: 'Preskoci na sadrzaj' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page).toHaveURL(before);
  await expect(page.getByTestId('answer-DOLAZIM_KASNIJE')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('eta-60')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('current-answer')).toHaveCount(0);
});

test('all six routes stay reachable without page overflow at compact widths', async ({ page }) => {
  await openApp(page);
  for (const width of [320, 720, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['dezurni', 'clan', 'vozila', 'prikaz', 'clanovi', 'istorija']) {
      const link = page.getByTestId(`nav-${route}`);
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await link.click();
      await expect(link).toHaveAttribute('aria-current', 'page');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});

test('overview vehicle count changes only with a recorded movement', async ({ page }) => {
  await openApp(page);
  const initial = await page.getByTestId('overview-vehicles').innerText();
  await createCall(page);
  await switchActor(page, 'Ivan Radulovic');
  await goTo(page, 'clan');
  await page.getByTestId('answer-DOLAZIM').click();
  await page.getByTestId('submit-response').click();
  await goTo(page, 'dezurni');
  await expect(page.getByTestId('overview-vehicles')).toHaveText(initial);
  await goTo(page, 'vozila');
  await page.getByTestId('depart-NV-1').click();
  await page.getByRole('button', { name: 'Potvrdi', exact: true }).click();
  await goTo(page, 'dezurni');
  const inStation = Number(initial.split('/')[0]);
  const total = Number(initial.split('/')[1]);
  await expect(page.getByTestId('overview-vehicles')).toHaveText(`${inStation - 1} / ${total}`);
});
