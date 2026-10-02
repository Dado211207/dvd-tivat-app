import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('the public guide loads and fits mobile and desktop widths', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('site/index.html')).href);
  await expect(page.getByRole('heading', { name: 'Instalacija na telefon' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Otvori testnu aplikaciju' }))
    .toHaveAttribute('href', 'https://boka-operativa-phone-test.netlify.app/');
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('link', { name: 'Koriscenje', exact: true }).click();
  await expect(page).toHaveURL(/#koriscenje$/);
  await expect(page.getByRole('heading', { name: 'Kako se koristi' })).toBeVisible();
});
