import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

for (const preview of [true, false]) {
  test.describe(preview ? 'preview guide' : 'final guide', () => {
    let directory: string;
    const address = preview
      ? 'https://boka-operativa-phone-test.netlify.app/'
      : 'https://dado211207.github.io/dvd-tivat-app/';

    test.beforeAll(() => {
      // Each worker gets its own output; never rewrite a package awaiting deploy.
      directory = mkdtempSync(resolve(tmpdir(), 'firenexa-guide-browser-'));
      execFileSync(process.execPath, ['scripts/build-site.mjs', '--app-url', address,
        '--out-dir', directory, ...(preview ? ['--preview'] : [])]);
    });
    test.afterAll(() => {
      if (directory) rmSync(directory, { recursive: true, force: true });
    });

    test('the public guide loads and fits mobile and desktop widths', async ({ page }) => {
      await page.goto(pathToFileURL(resolve(directory, 'index.html')).href);
      await expect(page.getByRole('heading', { name: 'Instalacija na telefon' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Pozovi ekipu', level: 3 })).toBeVisible();
      await expect(page.locator('.role-card').first()).toContainText('Otvori Poziv');
      await expect(page.getByRole('link', { name: 'Otvori aplikaciju' }))
        .toHaveAttribute('href', address);
      await expect(page.getByTestId('app-qr').getByRole('img')).toBeVisible();
      await expect(page.getByRole('link', { name: 'link aplikacije', exact: true }))
        .toHaveAttribute('href', address);
      await expect(page.locator(`a[href="${address}"]`)).toHaveCount(4);
      if (preview) {
        await expect(page.getByTestId('app-qr')).toContainText('Nije za trajno stampanje');
      } else {
        await expect(page.getByTestId('app-qr')).not.toContainText('Nije za trajno stampanje');
        await expect(page.locator('a[href*="phone-test"]')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText('Zavrsna adresa i izdanje');
      }
      await expect.poll(() => page.evaluate(() =>
        document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.getByRole('link', { name: 'Koriscenje', exact: true }).click();
      await expect(page).toHaveURL(/#koriscenje$/);
      await expect(page.getByRole('heading', { name: 'Kako se koristi' })).toBeVisible();
      await expect(page.locator('video')).toHaveCount(1);
    });


    test('generated QR guide stays readable and accessible at compact widths', async ({ page }) => {
      await page.goto(pathToFileURL(resolve(directory, 'index.html')).href);
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
  });
}
