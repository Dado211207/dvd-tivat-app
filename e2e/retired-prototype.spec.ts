import { expect, test } from '@playwright/test';
import { installFixtureProject } from './fixture-server';

test('regular application redirects old simulation links and keeps settings operational', async ({ page }) => {
  await installFixtureProject(page);
  for (const route of ['dojava', 'dezurni', 'clan', 'vozila', 'prikaz', 'clanovi', 'istorija']) {
    await page.goto(`http://127.0.0.1:4174/#/${route}`);
    await expect(page.getByTestId('nav-poziv')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('new-call-out-disclosure')).toBeVisible();
    await expect(page.locator('[data-testid^="prototype-"]')).toHaveCount(0);
  }
  await page.goto('http://127.0.0.1:4174/#/podesavanja');
  await expect(page.locator('[aria-labelledby="settings-prototype"]')).toHaveCount(0);
  await expect(page.getByTestId('language-me')).toBeVisible();
  await expect(page.locator('footer')).not.toContainText('fiktiv');
});
