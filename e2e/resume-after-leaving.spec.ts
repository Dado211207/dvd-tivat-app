/**
 * Leaving the application and coming back to it.
 *
 * The owner reported that the screen "reloads" whenever he switches away and
 * back - alt-tab on a desktop, leaving Safari on the phone. The cause was found
 * and fixed once already: not a reload at all but a silent REMOUNT, because
 * `AccessProvider` built a fresh snapshot object on every session re-check and
 * `OperationalGate` listed it in its effect dependencies. `resume-stability.test.tsx`
 * drives that path directly and passes.
 *
 * What nothing covered was a real browser doing it. The closest existing test
 * types into the composer and crosses an IN-APP tab, which is a different thing
 * entirely. These drive `visibilitychange` in a real engine, against the built
 * application, and check the two outcomes a person would actually notice: the
 * document did not reload, and what they had typed is still there.
 *
 * `document.visibilityState` is read-only, so it is redefined before the event
 * is dispatched. That is what the application's own listener reads, so this
 * exercises the real handler rather than a stand-in.
 */

import { expect, test, type Page } from '@playwright/test';
import { openOperational } from './fixture-server';

const TYPED = 'Izmisljeni nacrt - ne smije nestati';

/** Hide the page, then show it, the way a browser does on a tab switch. */
async function leaveAndComeBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    const set = (value: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => value,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    set('hidden');
    window.dispatchEvent(new Event('blur'));
    set('visible');
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(400);
}

/** A value on `window` does not survive a document reload. */
async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __stillTheSameDocument?: true }).__stillTheSameDocument = true;
  });
}

async function sameDocument(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as unknown as { __stillTheSameDocument?: true }).__stillTheSameDocument === true,
  );
}

test.describe('coming back to the application', () => {
  test('the commander keeps a half-written call-out', async ({ page }) => {
    await openOperational(page, 'poziv', 'COMMANDER');
    await page.getByTestId('new-call-out-disclosure').locator(':scope > summary').click();
    await page.getByTestId('new-title').fill(TYPED);
    await markPage(page);

    await leaveAndComeBack(page);

    expect(await sameDocument(page), 'the document reloaded').toBe(true);
    await expect(
      page.getByTestId('new-title'),
      'what the commander had typed was thrown away',
    ).toHaveValue(TYPED);
  });

  test('the firefighter screen does not fall back to a loading state', async ({ page }) => {
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('callout-title')).toBeVisible();
    await markPage(page);

    await leaveAndComeBack(page);

    expect(await sameDocument(page), 'the document reloaded').toBe(true);
    // A re-read on resume is wanted and is deliberately silent. Showing the
    // spinner again is how the remount used to announce itself.
    await expect(page.locator('main')).not.toContainText(/ucitavanje|loading/i);
    await expect(page.getByTestId('callout-title')).toBeVisible();
  });

  test('the console keeps the tab the commander was on', async ({ page }) => {
    await openOperational(page, 'poziv', 'COMMANDER');
    await page.getByTestId('cmd-tab-pregled').click();
    const chosen = page.getByTestId('cmd-tab-pregled');
    await expect(chosen).toHaveAttribute('aria-selected', 'true');
    await markPage(page);

    await leaveAndComeBack(page);

    expect(await sameDocument(page), 'the document reloaded').toBe(true);
    await expect(chosen, 'the console went back to its first tab').toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
