/**
 * Generates the screenshots in docs/screenshots/.
 *
 * They are produced from the fictional seed plus actions taken here, so nothing
 * real can end up in an image committed to a public repository. Run with
 * `npx playwright test screenshots --project=desktop`.
 */

import { expect, test, type Page } from '@playwright/test';
import { createCall, goTo, openApp, switchActor } from './helpers';
import { openOperational } from './fixture-server';

const DIR = 'docs/screenshots';

async function capture(page: Page, name: string, fullPage = true) {
  // A sticky rail is painted at the current scroll offset in a full-page
  // capture. Start at the top so the image describes one coherent page.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${DIR}/${name}`, fullPage });
}

// Tagged separately from assertions. CI captures these as a review artifact;
// it never commits images automatically. Regenerate with `npm run screenshots`.
test.describe('screenshots', { tag: '@screenshots' }, () => {
  test('captures every main view with populated fictional data', async ({ page }) => {
    await openApp(page);
    await capture(page, '00-dvd-tivat-overview.png', false);

    // 1. Composer with recipients chosen, before anything is sent.
    await page.getByLabel(/^Naslov/).fill('Vjezba: dimna komora, rad sa IDA aparatima');
    await page
      .getByLabel(/^Uputstvo za clanove/)
      .fill('Okupljanje u bazi DVD Tivat. Ponijeti licnu zastitnu opremu i IDA aparate.');
    await page.getByLabel(/^Lokacija dogadjaja/).fill('Poligon za vjezbe (izmisljena lokacija)');
    await page.getByLabel(/^Lokacija prijavioca/).fill('Vatrogasni dom (izmisljeno)');
    await page.getByRole('checkbox', { name: /Nosioci IDA aparata/ }).check();
    await page.getByRole('checkbox', { name: /^Nikola Djukic/ }).check();
    await capture(page, '01-dezurni-nova-vjezba.png');

    // 2. The confirmation preview: exact message, exact recipients.
    await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: `${DIR}/02-pregled-prije-slanja.png` });
    await page.getByRole('button', { name: 'Potvrdi i uputi poziv' }).click();

    // 3. The member's screen before answering.
    await switchActor(page, 'Ivan Radulovic');
    await goTo(page, 'clan');
    await expect(page.getByTestId('member-call-title')).toBeVisible();
    await capture(page, '03-clan-poziv.png');

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
    await page.getByTestId('submit-response').click();
    // Nikola Djukic deliberately never answers: silence is a real state.

    // 4. Vehicles.
    await switchActor(page, 'Ana Vukovic');
    await goTo(page, 'vozila');
    await page.getByTestId('depart-MAN-1').click();
    await page.getByLabel(/^Svrha/).fill('Vjezba - dovoz opreme');
    await page.getByRole('button', { name: 'Potvrdi' }).click();
    await capture(page, '05-vozila.png');

    // 5. The duty officer watching the response come in.
    await goTo(page, 'dezurni');
    await page.getByRole('button', { name: 'Ekipa krenula', exact: true }).click();
    await capture(page, '04-dezurni-odzivi.png');

    // 6. The station display.
    await goTo(page, 'prikaz');
    await expect(page.getByTestId('display-title')).toBeVisible();
    await capture(page, '06-prikaz-u-domu.png');

    // 7. Roster.
    await goTo(page, 'clanovi');
    await capture(page, '07-clanovi.png');
    await switchActor(page, 'Marko Perovic');
    await capture(page, '07a-upravljanje-probnim-podacima.png');

    // 7b. The one server-backed screen. This build has no project configured -
    // which is exactly what CI and a fresh checkout see - so it shows the honest
    // "not configured" state rather than a signed-in session that does not exist.
    await goTo(page, 'nalozi');
    await capture(page, '07b-nalozi-i-pristup.png');

    // 8. History and the activity log, after closing.
    await goTo(page, 'dezurni');
    await page.getByRole('button', { name: 'Zatvori vjezbu' }).click();
    await page.getByLabel(/^Razlog/).fill('Vjezba zavrsena po planu.');
    await page.getByRole('button', { name: 'Potvrdi', exact: true }).click();
    await goTo(page, 'istorija');
    await capture(page, '08-istorija.png');
  });

  test('captures the member view at phone size', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await createCall(page, {
      title: 'Vjezba: dimna komora, rad sa IDA aparatima',
      instructions: 'Okupljanje u bazi DVD Tivat. Ponijeti licnu zastitnu opremu i IDA aparate.',
      location: 'Poligon za vjezbe (izmisljena lokacija)',
    });

    await switchActor(page, 'Ivan Radulovic');
    await goTo(page, 'clan');
    await expect(page.getByTestId('member-call-title')).toBeVisible();
    await capture(page, '09-clan-telefon.png');
    await page.getByTestId('answer-DOLAZIM_KASNIJE').click();
    await page.getByTestId('eta-30').click();
    await page.getByTestId('submit-response').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${DIR}/10-clan-pregled-odgovora.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `${DIR}/11-clan-tamna-tema.png` });
  });

  test('captures the citizen report intake at phone size', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, 'dojava');
    await page.getByLabel(/^Opis/).fill('Gust dim se vidi iza izmisljene zgrade.');
    await page.getByLabel(/^Mjesto dogadjaja/).fill('Izmisljeni orijentir kod obale');
    await capture(page, '12-prijava-gradjana-telefon.png');
  });
});

/**
 * The server-backed screens, captured from the fixture build.
 *
 * These are the screens the product is actually about, and they cannot be
 * captured from the ordinary build: with no project configured they all stop at
 * the gate. The fixture answers for a project that does not exist, so the data
 * in these images is invented in exactly the same way the rest is.
 */
test.describe('screenshots', { tag: '@screenshots' }, () => {
  test('captures the operational screens', async ({ page }) => {
    await openOperational(page, 'poziv');
    await expect(page.getByRole('heading', { name: /Vjezba: provjera opreme/ })).toBeVisible();
    await capture(page, '08-poziv-intervencija.png');

    await page.getByRole('tab', { name: 'Pregled' }).click();
    await expect(page.getByTestId('overview-table')).toBeVisible();
    await capture(page, '09-pregled-odziva.png');

    await page.getByRole('tab', { name: 'Prisustvo' }).click();
    await expect(page.getByTestId('pick-all-pending')).toBeVisible();
    await capture(page, '10-prisustvo-potvrda.png');

    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('callout-title')).toBeVisible();
    await capture(page, '11-moj-poziv.png');

    await openOperational(page, 'arhiva');
    await expect(page.getByTestId('archive-title')).toBeVisible();
    await capture(page, '12-arhiva-ucesce.png');
  });
});
