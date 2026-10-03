import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('the public guide loads and fits mobile and desktop widths', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('dist-site/index.html')).href);
  await expect(page.getByRole('heading', { name: 'Instalacija na telefon' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Otvori aplikaciju' }))
    .toHaveAttribute('href', 'https://boka-operativa-phone-test.netlify.app/');
  await expect(page.getByTestId('app-qr').getByRole('img')).toBeVisible();
  await expect(page.getByRole('link', { name: 'link aplikacije', exact: true }))
    .toHaveAttribute('href', 'https://boka-operativa-phone-test.netlify.app/');
  await expect(page.getByTestId('app-qr')).toContainText('Nije za trajno stampanje');
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole('link', { name: 'Koriscenje', exact: true }).click();
  await expect(page).toHaveURL(/#koriscenje$/);
  await expect(page.getByRole('heading', { name: 'Kako se koristi' })).toBeVisible();
});


test('generated QR guide stays readable and accessible at compact widths', async ({ page }) => {
  await page.goto(pathToFileURL(resolve('dist-site/index.html')).href);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const qr = page.getByTestId('app-qr').getByRole('img');
    await expect(qr).toBeVisible();
    expect(await qr.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
});
