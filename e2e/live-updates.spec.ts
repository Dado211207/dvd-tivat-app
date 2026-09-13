/**
 * Staying current, in a real browser.
 *
 * The hook's own rules - one channel per scope, a burst collapsing into one
 * read, no polling of a hidden tab - are unit tested against a fake channel,
 * where the timers can be driven. What only a browser can show is the part a
 * person sees: that the screen says how it is staying current, and that the
 * manual button is still there when it is not.
 *
 * There is no Realtime server behind the fixture project - `page.route` does
 * not intercept a WebSocket, and the host is deliberately not a project anybody
 * owns - so the socket fails here exactly as it would behind a proxy that
 * blocks one. That makes this a genuine test of the fallback rather than a
 * simulated one.
 */

import { expect, test } from '@playwright/test';
import { openOperational } from './fixture-server';

test.describe('the screen says how it is staying current', () => {
  for (const [route, role] of [
    ['poziv', 'COMMANDER'],
    ['mobilizacija', 'FIREFIGHTER'],
  ] as const) {
    test(`${route} reports its update mode and never overstates it`, async ({ page }) => {
      await openOperational(page, route, role);
      const state = page.getByTestId('live-state');
      await expect(state).toBeVisible();

      // With no Realtime server reachable it must end up on the timer. The
      // point of the assertion is the word it must NOT use: a twelve-second
      // poll is not "uzivo", and a commander deciding how much to trust the
      // screen in front of them needs that difference.
      await expect(state).toHaveAttribute('data-live', 'POLLING', { timeout: 30_000 });
      await expect(state).toContainText('12 sekundi');
      await expect(state).not.toContainText(/uzivo/i);
    });
  }

  test('the manual refresh button is still there', async ({ page }) => {
    // Explicitly required to stay: automatic updates are the good path, and a
    // person must always have something to press when they do not trust it.
    await openOperational(page, 'poziv', 'COMMANDER');
    await expect(page.getByRole('button', { name: 'Osvjezi sa servera' })).toBeVisible();
  });
});

test.describe('an automatic re-read does not disturb the person using the screen', () => {
  test('the active tab and a half-typed call-out survive it', async ({ page }) => {
    await openOperational(page, 'poziv', 'COMMANDER');
    await expect(page.getByRole('heading', { name: /Vjezba: provjera opreme/ })).toBeVisible();

    // Type something and leave it unsent, then move to another tab. This is the
    // state a commander is in when a firefighter answers.
    await page.getByTestId('new-title').fill('Pozar u Donjoj Lastvi (izmisljeno)');
    await page.getByRole('tab', { name: 'Pregled' }).click();
    await expect(page.getByTestId('overview-table')).toBeVisible();

    // Sit through at least two polling cycles.
    await page.waitForTimeout(26_000);

    await expect(
      page.getByTestId('overview-table'),
      'the tab must not have been reset by a background read',
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Poziv' }).click();
    await expect(
      page.getByTestId('new-title'),
      'an unsent draft must survive an automatic re-read',
    ).toHaveValue('Pozar u Donjoj Lastvi (izmisljeno)');
  });

  test('no loading line flashes while it happens', async ({ page }) => {
    await openOperational(page, 'poziv', 'COMMANDER');
    await expect(page.getByRole('heading', { name: /Vjezba: provjera opreme/ })).toBeVisible();
    await expect(page.getByText('Ucitavanje sa servera...')).toHaveCount(0);

    // Watch across a polling cycle. A silent re-read must stay silent: a
    // loading line appearing every twelve seconds is precisely what reads as
    // "the screen keeps resetting itself".
    const seen: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      seen.push(await page.getByText('Ucitavanje sa servera...').count());
      await page.waitForTimeout(1000);
    }
    expect(Math.max(...seen), 'a background read must not announce itself').toBe(0);
  });
});
