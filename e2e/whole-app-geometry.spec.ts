/** A short journey through every offered screen, including the forms a new user sees.
 *
 * The existing viewport suite measures the operational trio, while edge-scroll
 * measures long owner tables. This catches a shared shell or form regression as
 * somebody moves between all six real destinations. The server is intercepted
 * by the fixture; no real account or call-out is changed.
 */
import { expect, test, type Page } from '@playwright/test';
import { installFixtureProject } from './fixture-server';

const APP = 'http://127.0.0.1:4174';
const SIZES = [
  { name: 'narrow phone', width: 320, height: 568 },
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'portrait tablet', width: 834, height: 1112 },
  { name: 'laptop', width: 1280, height: 800 },
] as const;

async function checkGeometry(page: Page, screen: string, width: number) {
  const result = await page.evaluate(() => {
    const fields = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'main input:not([type="checkbox"]):not([type="radio"]), main select, main textarea',
    )].filter((field) => field.getBoundingClientRect().width > 0 && getComputedStyle(field).visibility !== 'hidden');
    return {
      pageWidth: document.documentElement.scrollWidth,
      windowWidth: window.innerWidth,
      smallFields: fields.filter((field) => parseFloat(getComputedStyle(field).fontSize) < 16)
        .map((field) => `${field.tagName.toLowerCase()}#${field.id || '-'} ${getComputedStyle(field).fontSize}`),
      outsideFields: fields.filter((field) => {
        // The roster and account tables intentionally scroll inside their own
        // bounded holders; edge-scroll.spec.ts checks that their far columns
        // can actually be reached. Their offscreen cells are not page overflow.
        if (field.closest('.table-wrap, .account-table-wrap')) return false;
        const box = field.getBoundingClientRect();
        return box.left < -1 || box.right > window.innerWidth + 1;
      }).map((field) => `${field.tagName.toLowerCase()}#${field.id || '-'} ${Math.round(field.getBoundingClientRect().left)}..${Math.round(field.getBoundingClientRect().right)}`),
    };
  });
  expect(result.pageWidth, `${screen}: the document extends past ${width}px`).toBeLessThanOrEqual(result.windowWidth + 1);
  expect(result.outsideFields, `${screen}: an editable control is off screen`).toEqual([]);
  if (width < 900) {
    expect(result.smallFields, `${screen}: iOS may auto-zoom a focused field`).toEqual([]);
  }
}

for (const size of SIZES) {
  test(`owner visits every real screen on ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await installFixtureProject(page, { role: 'OWNER', longText: true });
    for (const screen of ['poziv', 'mobilizacija', 'arhiva', 'evidencija', 'nalozi', 'podesavanja']) {
      await page.goto(`${APP}/#/${screen}`);
      await expect(page.getByTestId(`nav-${screen}`)).toHaveAttribute('aria-current', 'page');
      if (screen === 'poziv') await expect(page.getByRole('heading', { name: /Vjezba: provjera opreme/ })).toBeVisible();
      if (screen === 'mobilizacija') await expect(page.getByTestId('callout-title')).toBeVisible();
      if (screen === 'arhiva') await expect(page.getByTestId('archive-title')).toBeVisible();
      if (screen === 'evidencija') await expect(page.locator('.registry')).toBeVisible();
      if (screen === 'nalozi') await expect(page.getByRole('heading', { name: 'Registrovani nalozi' })).toBeVisible();
      if (screen === 'podesavanja') await expect(page.getByTestId('language-me')).toBeVisible();
      await checkGeometry(page, screen, size.width);
    }
  });

  test(`new account form stays usable on ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await installFixtureProject(page, { signedIn: false });
    await page.goto(`${APP}/#/nalozi`);
    await expect(page.getByRole('button', { name: 'Nemam nalog' })).toBeVisible();
    await checkGeometry(page, 'sign-in form', size.width);
    await page.getByRole('button', { name: 'Nemam nalog' }).click();
    await expect(page.getByLabel('Ime i prezime (obavezno)')).toBeVisible();
    await checkGeometry(page, 'registration form', size.width);
    await page.goto(`${APP}/#/podesavanja`);
    await expect(page.getByTestId('language-me')).toBeVisible();
    await checkGeometry(page, 'signed-out settings', size.width);
  });
}
