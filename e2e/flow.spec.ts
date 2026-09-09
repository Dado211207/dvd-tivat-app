/**
 * The whole exercise, driven through the real interface at desktop and phone
 * sizes. Where a unit test proves a rule, this proves that the rule is reachable
 * and visible to the person using the application.
 */

import { expect, test } from '@playwright/test';
import { createCall, goTo, openApp, switchActor } from './helpers';

test('opens directly into the duty officer working screen', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('heading', { name: 'Nova vjezba' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Primaoci' })).toBeVisible();
  // The simulation warning is present before anything else is done.
  await expect(page.getByText('SIMULACIJA', { exact: true })).toBeVisible();
});

test('citizen report is reviewed, saved locally and never becomes a call', async ({ page }) => {
  await openApp(page, 'dojava');

  await page.getByTestId('review-citizen-report').click();
  await expect(page.locator('#reportDescription')).toBeFocused();
  await expect(page.getByTestId('notice')).toContainText('Opisite sta vidite');

  await page.getByLabel(/^Opis/).fill('Gust dim se vidi iza izmisljene zgrade.');
  await page.getByLabel(/^Mjesto dogadjaja/).fill('Izmisljeni orijentir');
  await page.locator('#reportPhoto').setInputFiles({
    name: 'probna-slika.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=',
      'base64',
    ),
  });

  await page.getByTestId('review-citizen-report').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Gust dim');
  await expect(dialog).toContainText('Izmisljeni orijentir');
  await expect(dialog).toContainText('Ukljucena samo u ovom pregledu');
  await page.getByRole('button', { name: 'Sacuvaj lokalnu simulaciju' }).click();

  const reports = page.getByTestId('citizen-report-list');
  await expect(reports.getByRole('listitem')).toHaveCount(1);
  await expect(reports).toContainText('Sacuvana lokalno');
  await expect(reports).toContainText('bajtovi nijesu sacuvani');

  await page.getByRole('button', { name: 'Oznaci kao pregledanu u simulaciji' }).click();
  await expect(reports).toContainText('Pregledana u simulaciji');
  await expect(reports).toContainText('ne znaci da je prijava prihvacena');

  await page.getByTestId('prepare-call-from-report').click();
  await expect(page.getByLabel(/^Naslov/)).toHaveValue('Dojava: Pozar ili dim');
  await expect(page.getByLabel(/^Uputstvo za clanove/)).toHaveValue(/Gust dim/);
  await expect(page.getByLabel(/^Lokacija dogadjaja/)).toHaveValue('Izmisljeni orijentir');
  await expect(page.getByTestId('selected-count')).toContainText('0');
  await expect(page.getByRole('heading', { name: 'Nova vjezba' })).toBeVisible();
  await expect(page.getByTestId('active-title')).toHaveCount(0);
});

test('citizen location is requested only after an explicit action', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:4173' });
  // Deliberately fictional open-water coordinates; no private place enters a
  // public test, screenshot or CI artifact.
  await context.setGeolocation({ latitude: 1.234567, longitude: 2.345678, accuracy: 14 });
  await openApp(page, 'dojava');

  await expect(page.getByText(/1\.234567/)).toHaveCount(0);
  await page.getByTestId('use-location').click();
  // The same coordinates also exist in the closed review dialog's DOM. Target
  // the visible live result so strict locators do not confuse hidden preview
  // content with what the person can currently see.
  await expect(page.locator('.report-location__result')).toContainText('1.234567, 2.345678');

  await page.getByLabel(/^Opis/).fill('Dim se vidi sa izmisljene lokacije.');
  await page.getByTestId('review-citizen-report').click();
  await expect(page.getByRole('dialog')).toContainText('1.234567, 2.345678');
});

test('full exercise: send, answer, change answer, vehicle, status, close, history', async ({
  page,
}) => {
  await openApp(page);

  // --- compose -------------------------------------------------------------
  await page.getByLabel(/^Naslov/).fill('Vjezba: dimna komora');
  await page.getByLabel(/^Uputstvo za clanove/).fill('Okupljanje u bazi DVD Tivat.');
  await page.getByLabel(/^Lokacija dogadjaja/).fill('Poligon (izmisljena lokacija)');
  await page.getByLabel(/^Lokacija prijavioca/).fill('Dom (izmisljeno)');
  await page.getByRole('checkbox', { name: /Nosioci IDA aparata/ }).check();

  await expect(page.getByTestId('selected-count')).toContainText('4');

  // --- preview shows exactly what will be recorded --------------------------
  await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('preview-message')).toContainText('[VJEZBA] Vjezba: dimna komora');
  await expect(page.getByTestId('preview-message')).toContainText('Mjesto okupljanja: Baza DVD Tivat');
  await expect(page.getByTestId('preview-message')).toContainText('Lokacija dogadjaja: Poligon');
  await expect(page.getByTestId('preview-message')).toContainText('Lokacija prijavioca: Dom');
  await expect(page.getByTestId('preview-recipients').getByRole('listitem')).toHaveCount(4);
  await expect(dialog).toContainText('Isporuka nije pokusana');

  await page.getByRole('button', { name: 'Potvrdi i uputi poziv' }).click();

  // --- sending fabricated nothing ------------------------------------------
  await expect(page.getByTestId('active-title')).toHaveText('Vjezba: dimna komora');
  await expect(page.locator('.total--yes .total__num')).toHaveText('0');
  await expect(page.locator('.total--unknown .total__num')).toHaveText('4');
  await expect(page.getByTestId('recipient-rows').getByRole('row')).toHaveCount(4);
  await expect(page.getByTestId('recipient-rows')).toContainText('Isporuka nije pokusana');

  // --- a member answers -----------------------------------------------------
  await switchActor(page, 'Ivan Radulovic');
  await goTo(page, 'clan');
  await expect(page.getByTestId('member-call-title')).toHaveText('Vjezba: dimna komora');
  await page.getByTestId('answer-DOLAZIM').click();
  await page.getByTestId('submit-response').click();
  await expect(page.getByTestId('current-answer')).toContainText('Dolazim');

  // --- a member who was not called sees nothing -----------------------------
  await switchActor(page, 'Jelena Boskovic');
  await expect(page.getByText('Za vas trenutno nema otvorenog poziva')).toBeVisible();

  // --- "coming later" needs a time band -------------------------------------
  await switchActor(page, 'Petar Krivokapic');
  await page.getByTestId('answer-DOLAZIM_KASNIJE').click();
  await page.getByTestId('eta-30').click();
  await page.getByTestId('submit-response').click();
  await expect(page.getByTestId('current-answer')).toContainText('30 min');

  // --- changing an answer affects only that member --------------------------
  await page.getByRole('button', { name: 'Promijeni odgovor' }).click();
  await page.getByTestId('answer-NE_MOGU').click();
  await page.getByTestId('submit-response').click();
  await expect(page.getByTestId('current-answer')).toContainText('Ne mogu');

  await goTo(page, 'dezurni');
  await expect(page.locator('.total--yes .total__num')).toHaveText('1');
  await expect(page.locator('.total--later .total__num')).toHaveText('0');
  await expect(page.locator('.total--no .total__num')).toHaveText('1');
  await expect(page.locator('.total--unknown .total__num')).toHaveText('2');

  // --- vehicles are independent of attendance -------------------------------
  await goTo(page, 'vozila');
  await expect(page.getByTestId('vehicle-state-MAN-1')).toContainText('U bazi');
  await page.getByTestId('depart-MAN-1').click();
  await page.getByRole('button', { name: 'Potvrdi' }).click();
  await expect(page.getByTestId('vehicle-state-MAN-1')).toContainText('Izaslo');
  await expect(page.getByTestId('vehicle-state-TERENAC-1')).toContainText('U bazi');

  // --- status changes only when the officer says so -------------------------
  await goTo(page, 'dezurni');
  await expect(page.getByTestId('active-title')).toBeVisible();
  await page.getByRole('button', { name: 'Na terenu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Na terenu', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // --- the station display reflects the same facts --------------------------
  await goTo(page, 'prikaz');
  await expect(page.getByTestId('display-title')).toHaveText('Vjezba: dimna komora');
  await expect(page.getByTestId('display-vehicles')).toContainText('Izaslo');
  await expect(page.getByTestId('display-responses')).toContainText('Ivan Radulovic');

  // --- closing keeps the record ---------------------------------------------
  await goTo(page, 'dezurni');
  await page.getByRole('button', { name: 'Zatvori vjezbu' }).click();
  await page.getByLabel(/^Razlog/).fill('Vjezba zavrsena.');
  await page.getByRole('button', { name: 'Potvrdi', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Nova vjezba' })).toBeVisible();

  await goTo(page, 'istorija');
  await expect(page.getByTestId('history-rows')).toContainText('Vjezba: dimna komora');
  await expect(page.getByTestId('activity-rows')).toContainText('Odgovor promijenjen');
  await expect(page.getByTestId('activity-rows')).toContainText('Vozilo izaslo');
});

test('a member reviews every answer and its details before submitting', async ({ page }) => {
  await openApp(page);
  await createCall(page);
  await switchActor(page, 'Ivan Radulovic');
  await goTo(page, 'clan');

  // Selecting an answer is only a local draft. Nothing is recorded until the
  // member explicitly submits the answer after reviewing its details.
  await page.getByTestId('answer-DOLAZIM').click();
  await expect(page.getByTestId('current-answer')).toHaveCount(0);
  await expect(page.getByText(/Dolazite u.*Baza DVD Tivat/)).toBeVisible();
  await page.getByTestId('submit-response').click();
  await expect(page.getByTestId('current-answer')).toContainText('Dolazim');
  await expect(page.getByTestId('current-answer')).not.toContainText('direktno na lokaciju');

  // The same explicit confirmation applies while editing; the base-first
  // route cannot be changed from the member screen.
  await page.getByRole('button', { name: 'Promijeni odgovor' }).click();
  await page.getByTestId('answer-DOLAZIM').click();
  await expect(page.getByTestId('current-answer')).toHaveCount(0);
  await page.getByTestId('submit-response').click();
  await expect(page.getByTestId('current-answer')).toContainText('Dolazim');
  await expect(page.getByTestId('current-answer')).not.toContainText('direktno na lokaciju');

  await page.getByRole('button', { name: 'Promijeni odgovor' }).click();
  await page.getByTestId('answer-DOLAZIM_KASNIJE').click();
  await page.getByTestId('eta-60').click();
  await page.getByTestId('submit-response').click();
  await expect(page.getByTestId('current-answer')).toContainText('60 min');

  // "Ne mogu" cannot retain a destination choice from an earlier answer.
  await page.getByRole('button', { name: 'Promijeni odgovor' }).click();
  await page.getByTestId('answer-NE_MOGU').click();
  await expect(page.getByTestId('current-answer')).toHaveCount(0);
  await page.getByTestId('submit-response').click();
  await expect(page.getByTestId('current-answer')).toContainText('Ne mogu');
  await expect(page.getByTestId('current-answer')).not.toContainText('direktno na lokaciju');
});

test('an unsent member draft never crosses to another simulated actor', async ({ page }) => {
  await openApp(page);
  await createCall(page);
  await switchActor(page, 'Ivan Radulovic');
  await goTo(page, 'clan');

  await page.getByTestId('answer-DOLAZIM_KASNIJE').click();
  await page.getByTestId('eta-60').click();
  await expect(page.getByTestId('submit-response')).toBeVisible();

  // Changing the simulated person represents a different user. Their form
  // must begin empty and must not expose Ivan's unsent answer or ETA.
  await switchActor(page, 'Petar Krivokapic');
  await expect(page.getByTestId('current-member')).toHaveText('Petar Krivokapic');
  await expect(page.getByTestId('submit-response')).toHaveCount(0);
  await expect(page.getByTestId('eta-60')).toHaveCount(0);
  await expect(page.getByTestId('answer-DOLAZIM')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('answer-DOLAZIM_KASNIJE')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByTestId('answer-NE_MOGU')).toHaveAttribute('aria-pressed', 'false');

  // The old draft was never submitted and is discarded rather than restored
  // when the first simulated person is selected again.
  await switchActor(page, 'Ivan Radulovic');
  await expect(page.getByTestId('submit-response')).toHaveCount(0);

  await switchActor(page, 'Ana Vukovic');
  await goTo(page, 'dezurni');
  await expect(page.locator('.total--unknown .total__num')).toHaveText('4');
});

test('a closed exercise cannot be answered', async ({ page }) => {
  await openApp(page);
  await createCall(page);

  await page.getByRole('button', { name: 'Zatvori vjezbu' }).click();
  await page.getByLabel(/^Razlog/).fill('Kraj.');
  await page.getByRole('button', { name: 'Potvrdi', exact: true }).click();

  await switchActor(page, 'Ivan Radulovic');
  await goTo(page, 'clan');
  await expect(page.getByText('Za vas trenutno nema otvorenog poziva')).toBeVisible();
});

test('a cancelled exercise stops answers and stays in history', async ({ page }) => {
  await openApp(page);
  await createCall(page);

  await page.getByRole('button', { name: 'Otkazi vjezbu' }).click();
  await page.getByLabel(/^Razlog/).fill('Lazna uzbuna.');
  await page.getByRole('button', { name: 'Potvrdi', exact: true }).click();

  await switchActor(page, 'Ivan Radulovic');
  await goTo(page, 'clan');
  await expect(page.getByText('Za vas trenutno nema otvorenog poziva')).toBeVisible();

  await goTo(page, 'istorija');
  await expect(page.getByTestId('history-rows')).toContainText('Otkazana');
});

test('refuses an incomplete call and moves focus to the offending field', async ({ page }) => {
  await openApp(page);

  await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('notice')).toContainText('Unesite naslov');
  await expect(page.locator('#f-title')).toBeFocused();

  await page.getByLabel(/^Naslov/).fill('Naslov');
  await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();
  await expect(page.locator('#f-instructions')).toBeFocused();

  await page.getByLabel(/^Uputstvo za clanove/).fill('Uputstvo');
  await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();
  await expect(page.locator('#f-incidentLocation')).toBeFocused();

  // Everything filled but nobody selected: still refused.
  await page.getByLabel(/^Lokacija dogadjaja/).fill('Lokacija');
  await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('notice')).toContainText('Niste izabrali nijednog primaoca');
});

test('cancelling the preview sends nothing', async ({ page }) => {
  await openApp(page);
  await page.getByLabel(/^Naslov/).fill('Nece biti poslato');
  await page.getByLabel(/^Uputstvo za clanove/).fill('Uputstvo');
  await page.getByLabel(/^Lokacija dogadjaja/).fill('Lokacija');
  await page.getByRole('checkbox', { name: /Nosioci IDA aparata/ }).check();

  await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();
  await page.getByRole('button', { name: 'Odustani' }).click();

  await expect(page.getByRole('heading', { name: 'Nova vjezba' })).toBeVisible();
  await expect(page.getByTestId('active-title')).toHaveCount(0);
});

test('individual and group selection deduplicates', async ({ page }) => {
  await openApp(page);
  await page.getByRole('checkbox', { name: /Nosioci IDA aparata/ }).check();
  await expect(page.getByTestId('selected-count')).toContainText('4');

  // Ivan Radulovic is already in that group.
  await page.getByRole('checkbox', { name: /^Ivan Radulovic/ }).check();
  await expect(page.getByTestId('selected-count')).toContainText('4');

  // Someone outside the group does add one.
  await page.getByRole('checkbox', { name: /^Jelena Boskovic/ }).check();
  await expect(page.getByTestId('selected-count')).toContainText('5');
});

test('reset restores the seeded demo data after confirmation', async ({ page }) => {
  await openApp(page);
  await createCall(page, { title: 'Bice obrisano' });

  await goTo(page, 'istorija');
  await page.getByTestId('reset-button').click();
  await page.getByRole('button', { name: 'Resetuj probne podatke' }).last().click();

  await expect(page.getByTestId('activity-rows')).toContainText('Podaci resetovani');
  await expect(page.getByTestId('history-rows')).not.toContainText('Bice obrisano');
  await expect(page.getByTestId('history-rows')).toContainText('dimna komora');

  await goTo(page, 'dezurni');
  await expect(page.getByRole('heading', { name: 'Nova vjezba' })).toBeVisible();
});

test('state survives a page reload in the same browser', async ({ page }) => {
  await openApp(page);
  await createCall(page, { title: 'Ostaje poslije osvjezavanja' });

  await page.reload();
  await expect(page.getByTestId('active-title')).toHaveText('Ostaje poslije osvjezavanja');
});

test('keyboard only: reach the composer, open the preview and escape it', async ({ page }) => {
  await openApp(page);

  await page.getByLabel(/^Naslov/).focus();
  await page.keyboard.type('Vjezba tastaturom');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Uputstvo');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Lokacija');

  // Tab to the group checkbox and select it with Space.
  const checkbox = page.getByRole('checkbox', { name: /Nosioci IDA aparata/ });
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();

  const submit = page.getByRole('button', { name: 'Pregledaj i posalji' });
  await submit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();

  // Escape closes the native dialog and cancels the send.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByTestId('active-title')).toHaveCount(0);
});

test('the skip link is reachable with the keyboard', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Preskoci na sadrzaj' })).toBeFocused();
});

test('external map link requires a click and opens in a new tab', async ({ page }) => {
  await openApp(page);
  await createCall(page, { location: 'Poligon (izmisljena lokacija)' });

  const link = page.getByRole('link', { name: /Otvori lokaciju u mapama/ }).first();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  // Nothing navigated on its own.
  expect(page.url()).toContain('#/dezurni');
});
