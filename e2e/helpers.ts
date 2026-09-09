import type { Page } from '@playwright/test';

/**
 * Each test starts from the seeded demonstration data in a clean browser
 * profile, so one test cannot leave state behind for another.
 */
export async function openApp(page: Page, route = 'dezurni') {
  await page.goto(`/#/${route}`);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForSelector('main');
}

export async function goTo(page: Page, route: string) {
  await page.getByTestId(`nav-${route}`).click();
}

export async function switchActor(page: Page, name: string) {
  const select = page.getByTestId('actor-select');
  // Option labels carry the proposed role too, so match on the name and read
  // back the value rather than guessing the full label.
  const value = await select.locator('option', { hasText: name }).first().getAttribute('value');
  if (!value) throw new Error(`No simulated member matching "${name}"`);
  await select.selectOption(value);
}

export interface CallInput {
  title?: string;
  instructions?: string;
  location?: string;
  reporterLocation?: string;
  group?: string;
}

/** Fills the composer and confirms the preview - the whole send path. */
export async function createCall(page: Page, input: CallInput = {}) {
  const {
    title = 'Vjezba: provjera opreme',
    instructions = 'Okupljanje u bazi DVD Tivat, ponijeti opremu.',
    location = 'Poligon (izmisljena lokacija)',
    reporterLocation,
    group = 'Nosioci IDA aparata',
  } = input;

  await page.getByLabel(/^Naslov/).fill(title);
  await page.getByLabel(/^Uputstvo za clanove/).fill(instructions);
  await page.getByLabel(/^Lokacija dogadjaja/).fill(location);
  if (reporterLocation) await page.getByLabel(/^Lokacija prijavioca/).fill(reporterLocation);

  await page.getByRole('checkbox', { name: new RegExp(group) }).check();
  await page.getByRole('button', { name: 'Pregledaj i posalji' }).click();
  await page.getByRole('button', { name: 'Potvrdi i uputi poziv' }).click();
}
