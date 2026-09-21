/**
 * The two screens the owner reported, at the two sizes he named.
 *
 * Tagged @screenshots so `npm run e2e` skips them: these produce files to look
 * at, and the assertions that decide whether the layout is right live in
 * `mobile-settings-accounts.spec.ts` next door. A picture is evidence for a
 * person, not a test.
 */
import { test } from '@playwright/test';
import { openOperational } from './fixture-server';

const PHONES = [
  { name: '390x844-iphone', width: 390, height: 844 },
  { name: '360x800-android', width: 360, height: 800 },
] as const;

for (const phone of PHONES) {
  test.describe(`@screenshots ${phone.name}`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height } });

    test(`settings ${phone.name}`, async ({ page }) => {
      await openOperational(page, 'podesavanja', 'COMMANDER');
      await page.addStyleTag({ content: ':root { --safe-top: 47px !important; }' });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `docs/screenshots/mobile-settings-${phone.name}.png` });
    });

    test(`accounts long text ${phone.name}`, async ({ page }) => {
      await openOperational(page, 'nalozi', { role: 'OWNER', longText: true });
      await page.addStyleTag({ content: ':root { --safe-top: 47px !important; }' });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `docs/screenshots/mobile-accounts-${phone.name}.png`,
        fullPage: true,
      });
    });
  });
}
