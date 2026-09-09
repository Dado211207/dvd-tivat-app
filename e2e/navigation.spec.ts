import { expect, test } from '@playwright/test';
import { createCall, goTo, openApp, switchActor } from './helpers';

test('keyboard skip link preserves the member route and unsent answer', async ({ page }) => {
  await openApp(page);
  await createCall(page);
  await switchActor(page, 'Ivan Radulovic');
  await goTo(page, 'clan');
  await page.getByTestId('answer-DOLAZIM_KASNIJE').click();
  await page.getByTestId('eta-60').click();
  const before = page.url();
  // Focus the actual keyboard-only link, then activate it with Enter.
  await page.getByRole('link', { name: 'Preskoci na sadrzaj' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page).toHaveURL(before);
  await expect(page.getByTestId('answer-DOLAZIM_KASNIJE')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('eta-60')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('current-answer')).toHaveCount(0);
});

test('all seven routes stay reachable without page overflow at compact widths', async ({ page }) => {
  await openApp(page);
  for (const width of [320, 720, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['dojava', 'dezurni', 'clan', 'vozila', 'prikaz', 'clanovi', 'istorija']) {
      const link = page.getByTestId(`nav-${route}`);
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await link.click();
      await expect(link).toHaveAttribute('aria-current', 'page');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});

test('overview vehicle count changes only with a recorded movement', async ({ page }) => {
  await openApp(page);
  const initial = await page.getByTestId('overview-vehicles').innerText();
  await createCall(page);
  await switchActor(page, 'Ivan Radulovic');
  await goTo(page, 'clan');
  await page.getByTestId('answer-DOLAZIM').click();
  await page.getByTestId('submit-response').click();
  await goTo(page, 'dezurni');
  await expect(page.getByTestId('overview-vehicles')).toHaveText(initial);
  await goTo(page, 'vozila');
  await page.getByTestId('depart-MAN-1').click();
  await page.getByRole('button', { name: 'Potvrdi', exact: true }).click();
  await goTo(page, 'dezurni');
  const inStation = Number(initial.split('/')[0]);
  const total = Number(initial.split('/')[1]);
  await expect(page.getByTestId('overview-vehicles')).toHaveText(`${inStation - 1} / ${total}`);
});

for (const phone of [
  { name: 'iPhone', width: 390, height: 844 },
  { name: 'Android', width: 412, height: 915 },
]) {
  test(`${phone.name} viewport keeps the base-first response and primary controls usable`, async ({ page }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await openApp(page);
    await expect(page.getByTestId('overview-members')).toHaveText('52');
    await createCall(page);
    await switchActor(page, 'Ivan Radulovic');
    await goTo(page, 'clan');
    await page.getByTestId('answer-DOLAZIM').click();
    await expect(page.getByText(/Dolazite u.*Baza DVD Tivat/)).toBeVisible();
    const submit = page.getByTestId('submit-response');
    await submit.scrollIntoViewIfNeeded();
    const box = await submit.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('the 52-member recipient roster is searchable without losing hidden selections', async ({ page }) => {
  await openApp(page);
  const search = page.getByLabel('Pretrazi probne clanove');
  await search.fill('Probni clan 52');
  const roster = page.getByTestId('recipient-member-list');
  await expect(roster.getByRole('checkbox')).toHaveCount(1);
  await roster.getByRole('checkbox', { name: /Probni clan 52/ }).check();
  await expect(page.getByTestId('selected-count')).toContainText('1');
  await search.fill('nema ovog clana');
  await expect(roster).toContainText('Nema aktivnog probnog clana');
  await expect(page.getByTestId('selected-count')).toContainText('1');
});

test('member copy distinguishes an unsent answer, a recorded answer and an edit', async ({ page }) => {
  await openApp(page);
  await createCall(page);
  await switchActor(page, 'Ivan Radulovic');
  await goTo(page, 'clan');
  const note = page.getByTestId('response-storage-note');
  await expect(note).toContainText('Odgovor jos nije zabiljezen');
  await page.getByTestId('answer-DOLAZIM').click();
  await expect(note).toContainText('Odgovor jos nije zabiljezen');
  await page.getByTestId('submit-response').click();
  await expect(note).toContainText('Odgovor je zabiljezen samo u ovom pregledacu');
  await page.getByRole('button', { name: 'Promijeni odgovor' }).click();
  await expect(note).toContainText('Izmjena jos nije zabiljezena');
  await page.getByRole('button', { name: 'Odustani', exact: true }).click();
  await expect(note).toContainText('Odgovor je zabiljezen samo u ovom pregledacu');
});
