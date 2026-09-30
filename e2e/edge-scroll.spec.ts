/** Edge scrolling and long-content geometry on the server-backed screens.
 * Chromium emulates viewport and touch layout here; this does not claim to be
 * a physical Safari/iPadOS/Android gesture test.
 */
import { expect, test } from '@playwright/test';
import { installFixtureProject } from './fixture-server';

const APP = 'http://127.0.0.1:4174';
const SIZES = [
  { name: 'small phone', width: 320, height: 568 },
  { name: 'Android phone', width: 360, height: 800 },
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'large phone', width: 430, height: 932 },
  { name: 'tablet portrait', width: 834, height: 1112 },
  { name: 'tablet landscape', width: 1112, height: 834 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1920, height: 1080 },
] as const;

for (const size of SIZES) {
  test(`long accounts and Settings do not drag outside ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await installFixtureProject(page, { role: 'OWNER', longText: true });

    for (const route of ['nalozi', 'podesavanja', 'evidencija']) {
      await page.goto(`${APP}/#/${route}`);
      await expect(page.getByTestId(`nav-${route}`)).toHaveAttribute('aria-current', 'page');
      if (route === 'nalozi') {
        await expect(page.getByRole('heading', { name: 'Registrovani nalozi' })).toBeVisible();
      } else if (route === 'podesavanja') {
        await expect(page.getByTestId('language-me')).toBeVisible();
      } else {
        await expect(page.locator('main')).not.toBeEmpty();
      }
      // Wait for the asynchronous server-backed content, not just the shell.
      await expect(page.locator('main')).not.toContainText('Ova kopija nije povezana sa serverom');
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        edge: getComputedStyle(document.documentElement).overscrollBehavior,
        height: document.documentElement.scrollHeight,
        visibleHeight: window.innerHeight,
        offenders: [...document.querySelectorAll<HTMLElement>('main *')]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.left < window.innerWidth &&
              box.right > window.innerWidth + 1 && getComputedStyle(element).display !== 'none';
          })
          .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
          .slice(0, 14)
          .map((element) => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return `${element.tagName}.${element.className || '-'}: ${Math.round(box.left)}..${Math.round(box.right)}px, overflow=${style.overflowX}`;
          }),
      }));
      expect(geometry.width, `${route} extends past the ${size.name} viewport: ${geometry.offenders.join(', ')}`)
        .toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.edge, `${route} allows page edge bounce/refresh`).toBe('none');

      // Edge control must not block normal scrolling of long content.
      if (geometry.height > geometry.visibleHeight + 50) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect.poll(() => page.evaluate(() => window.scrollY), {
          message: `${route} cannot reach its bottom`,
        }).toBeGreaterThan(0);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
  });
}
