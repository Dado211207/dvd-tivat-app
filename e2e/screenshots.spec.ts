/**
 * Generates the screenshots in docs/screenshots/.
 *
 * They are produced from the fictional seed plus actions taken here, so nothing
 * real can end up in an image committed to a public repository. Run with
 * `npx playwright test screenshots --project=desktop`.
 */

import { expect, test } from '@playwright/test';
import { createCall, goTo, openApp, switchActor } from './helpers';

const DIR = 'docs/screenshots';

// Tagged so CI can skip it: these tests write files into the repository, and a
// CI run must not leave the working tree dirty. Regenerate locally with
// `npm run screenshots`.
test.describe('screenshots', { tag: '@screenshots' }, () => {
  test('captures every main view with populated fictional data', async ({ page }) => {
    await openApp(page);

    // 1. Composer with recipients chosen, before anything is sent.
    await page.getByLabel(/^Naslov/).fill('Vjezba: dimna komora, rad sa IDA aparatima');
    await page
      .getByLabel(/^Uputstvo za clanove/)
      .fill('Okupljanje u domu. Ponijeti licnu zastitnu opremu i IDA aparate.');
    await page.getByLabel(/^Lokacija dogadjaja/).fill('Poligon za vjezbe (izmisljena lokacija)');
    await page.getByLabel(/^Lokacija prijavioca/).fill('Vatrogasni dom (izmisljeno)');
    await page.getByRole('checkbox', { name: /Nosioci IDA aparata/ }).check();
    await page.getByRole('checkbox', { name: /^Nikola Djukic/ }).check();
    await page.screenshot({ path: `${DIR}/01-dezurni-nova-vjezba.png`, fullPage: true });

    // 2. The confirmation preview: exact message, exact recipients.
    await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: `${DIR}/02-pregled-prije-slanja.png` });
    await page.getByRole('button', { name: 'Potvrdi i uputi poziv' }).click();

    // 3. The member's screen before answering.
    await switchActor(page, 'Ivan Radulovic');
    await goTo(page, 'clan');
    await expect(page.getByTestId('member-call-title')).toBeVisible();
    await page.screenshot({ path: `${DIR}/03-clan-poziv.png`, fullPage: true });

    // Populate a mixed, realistic-looking set of answers.
    await page.getByTestId('answer-DOLAZIM').click();
    await page.getByTestId('submit-response').click();

    await switchActor(page, 'Petar Krivokapic');
    await page.getByTestId('answer-DOLAZIM_KASNIJE').click();
    await page.getByTestId('eta-30').click();
    await page.getByTestId('submit-response').click();

    await switchActor(page, 'Vuk Mitrovic');
    await page.getByTestId('answer-NE_MOGU').click();
    await page.getByTestId('submit-response').click();

    await switchActor(page, 'Luka Jovanovic');
    await page.getByTestId('answer-DOLAZIM').click();
    await page.getByTestId('direct-to-location').check();
    await page.getByTestId('submit-response').click();
    // Nikola Djukic deliberately never answers: silence is a real state.

    // 4. Vehicles.
    await switchActor(page, 'Ana Vukovic');
    await goTo(page, 'vozila');
    await page.getByTestId('depart-NV-1').click();
    await page.getByLabel(/^Svrha/).fill('Vjezba - dovoz opreme');
    await page.getByRole('button', { name: 'Potvrdi' }).click();
    await page.screenshot({ path: `${DIR}/05-vozila.png`, fullPage: true });

    // 5. The duty officer watching the response come in.
    await goTo(page, 'dezurni');
    await page.getByRole('button', { name: 'Ekipa krenula', exact: true }).click();
    await page.screenshot({ path: `${DIR}/04-dezurni-odzivi.png`, fullPage: true });

    // 6. The station display.
    await goTo(page, 'prikaz');
    await expect(page.getByTestId('display-title')).toBeVisible();
    await page.screenshot({ path: `${DIR}/06-prikaz-u-domu.png`, fullPage: true });

    // 7. Roster.
    await goTo(page, 'clanovi');
    await page.screenshot({ path: `${DIR}/07-clanovi.png`, fullPage: true });

    // 8. History and the activity log, after closing.
    await goTo(page, 'dezurni');
    await page.getByRole('button', { name: 'Zatvori vjezbu' }).click();
    await page.getByLabel(/^Razlog/).fill('Vjezba zavrsena po planu.');
    await page.getByRole('button', { name: 'Potvrdi', exact: true }).click();
    await goTo(page, 'istorija');
    await page.screenshot({ path: `${DIR}/08-istorija.png`, fullPage: true });
  });

  test('captures the member view at phone size', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await createCall(page, {
      title: 'Vjezba: dimna komora, rad sa IDA aparatima',
      instructions: 'Okupljanje u domu. Ponijeti licnu zastitnu opremu i IDA aparate.',
      location: 'Poligon za vjezbe (izmisljena lokacija)',
    });

    await switchActor(page, 'Ivan Radulovic');
    await goTo(page, 'clan');
    await expect(page.getByTestId('member-call-title')).toBeVisible();
    await page.screenshot({ path: `${DIR}/09-clan-telefon.png`, fullPage: true });
  });
});
