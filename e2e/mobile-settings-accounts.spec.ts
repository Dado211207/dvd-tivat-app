/**
 * The two screens the viewport suite never covered.
 *
 * `viewport.spec.ts` measures `poziv`, `mobilizacija` and `arhiva`. The owner
 * tested the application on his own iPhone and reported faults on the two
 * screens not in that list: the status bar sitting over the top of Settings,
 * and the Accounts table cut off at the right edge with the status and role
 * columns unreachable. Neither screen had ever been measured at a phone width.
 *
 * On the simulated inset: `env(safe-area-inset-top)` is 0 in a desktop engine,
 * notch or no notch, so it cannot be reproduced here directly. What CAN be
 * checked - and is the actual defect - is whether the layout CONSUMES the inset
 * at all. The application funnels every inset through `--safe-top` in
 * `tokens.css`, so giving that token a real iPhone value and measuring what
 * lands underneath tests the whole chain below `env()`. It does not test that
 * iOS reports the value, which no headless browser can.
 */

import { expect, test, type Page } from '@playwright/test';
import { openOperational } from './fixture-server';

/** An iPhone 14 Pro reports 59px portrait; 47px is the older, smaller notch. */
const INSET_TOP = 47;

const PHONES = [
  { name: '390x844 - iPhone', width: 390, height: 844 },
  { name: '360x800 - Samsung-class Android', width: 360, height: 800 },
] as const;

async function applyInset(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `:root { --safe-top: ${INSET_TOP}px !important; }`,
  });
}

/** Every element that paints inside the inset strip, top of the page. */
async function underTheStatusBar(page: Page): Promise<string[]> {
  return page.evaluate((inset) => {
    const offenders: string[] = [];
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (element.closest('.sr-only')) continue;
      // Only leaf-ish elements that actually paint something a person reads.
      if (element.children.length > 0 && element.textContent === '') continue;
      const box = element.getBoundingClientRect();
      if (box.height === 0 || box.width === 0) continue;
      // A container that merely SPANS the strip is fine - it is the background.
      // What must not be there is content: text or a control.
      const paints =
        element.childElementCount === 0 && (element.textContent ?? '').trim() !== '';
      const isControl = ['BUTTON', 'SELECT', 'INPUT', 'A', 'LABEL'].includes(element.tagName);
      if (!paints && !isControl) continue;
      if (box.top < inset && box.bottom > 0) {
        offenders.push(
          `${element.tagName}.${element.className || '(no class)'} top=${Math.round(box.top)}`,
        );
      }
    }
    return offenders;
  }, INSET_TOP);
}

/** A table wider than a container that cannot scroll: columns nobody can read. */
async function unreachableColumns(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const lost: string[] = [];
    for (const table of Array.from(document.querySelectorAll('table'))) {
      const holder = table.parentElement;
      if (holder === null) continue;
      const scrolls =
        holder.scrollWidth > holder.clientWidth + 1 &&
        ['auto', 'scroll'].includes(getComputedStyle(holder).overflowX);
      if (table.scrollWidth > holder.clientWidth + 1 && !scrolls) {
        lost.push(
          `${table.getAttribute('class') ?? 'table'}: ${table.scrollWidth}px in ${holder.clientWidth}px`,
        );
      }
    }
    return lost;
  });
}

for (const phone of PHONES) {
  test.describe(`${phone.name}`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height } });

    test('Settings keeps its content clear of the status bar', async ({ page }) => {
      await openOperational(page, 'podesavanja', 'COMMANDER');
      await applyInset(page);
      await page.waitForTimeout(100);

      expect(
        await underTheStatusBar(page),
        'content is painting underneath the iOS status bar',
      ).toEqual([]);
    });

    test('Settings stays clear of the status bar once it is scrolled', async ({ page }) => {
      /*
       * The case the owner actually met.
       *
       * The masthead is `position: static` on a telephone, so it scrolls away.
       * In a browser tab that is harmless - the status bar is the browser's own
       * chrome. Installed on the home screen, which is also what iOS requires
       * before it will do Web Push at all, the web view extends under the status
       * bar, and whatever has scrolled up to the top of the page is what sits
       * beneath it.
       */
      await openOperational(page, 'podesavanja', 'COMMANDER');
      await applyInset(page);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(150);

      /*
       * Asked as occlusion rather than geometry, because that is the defect.
       * Content scrolling BEHIND a solid status bar is how every application on
       * the phone behaves; content scrolling behind a TRANSPARENT one is what
       * made the setting unreadable. So the question is what paints on top at
       * those points, not what happens to be positioned there.
       *
       * The cover is a pseudo-element, and `elementFromPoint` reports its host,
       * so `BODY` at a sampled point means the strip is covered and any other
       * tag means a piece of the page is showing through.
       */
      const showingThrough = await page.evaluate((inset) => {
        const seen: string[] = [];
        for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          for (const y of [2, Math.floor(inset / 2), inset - 2]) {
            const element = document.elementFromPoint(
              Math.floor(window.innerWidth * fraction),
              y,
            );
            const tag = element?.tagName ?? 'NONE';
            if (tag !== 'BODY' && !seen.includes(tag)) seen.push(`${tag} at y=${y}`);
          }
        }
        return seen;
      }, INSET_TOP);

      expect(showingThrough, 'the page is showing through the status bar').toEqual([]);
    });

    test('the language selector is reachable and not under the status bar', async ({ page }) => {
      await openOperational(page, 'podesavanja', 'COMMANDER');
      await applyInset(page);

      // The specific control the owner named. It is a pair of radio labels
      // rather than a `select`, deliberately - see SettingsView.
      const selector = page.getByTestId('language-me');
      await expect(selector).toBeVisible();
      const box = await selector.boundingBox();
      expect(box, 'the language selector has no box').not.toBeNull();
      expect(box!.y, 'the language selector starts under the status bar').toBeGreaterThanOrEqual(
        INSET_TOP,
      );
    });

    test('Accounts shows status and role without cutting them off', async ({ page }) => {
      await openOperational(page, 'nalozi', { role: 'OWNER', longText: true });
      await page.waitForTimeout(250);

      expect(
        await unreachableColumns(page),
        'the accounts table is wider than a container that cannot scroll',
      ).toEqual([]);

      const scrolls = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(scrolls, 'the page scrolls sideways').toBe(false);
    });

    test('Accounts uses the width of the screen', async ({ page }) => {
      await openOperational(page, 'nalozi', { role: 'OWNER', longText: true });
      await page.waitForTimeout(250);

      const used = await page.evaluate(() => {
        const main = document.querySelector('main');
        if (main === null) return 0;
        let widest = 0;
        for (const element of Array.from(main.querySelectorAll('*'))) {
          const box = element.getBoundingClientRect();
          if (box.width > widest) widest = box.width;
        }
        return widest;
      });

      // "Half the screen" was the report. Anything below three quarters of the
      // available width is the same fault, whatever its exact cause.
      expect(used, 'the accounts content is not using the screen').toBeGreaterThan(
        phone.width * 0.75,
      );
    });
  });
}
