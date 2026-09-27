/**
 * One SZS-only browser session from draft to archive. The fake project keeps
 * the rows written by each button; SQL authority is separately tested against
 * PostgreSQL in db-tests/. A DVD call-out is present as a decoy in the fake
 * server's table, and must never enter the SZS screen's selected-service read.
 */
import { expect, test } from '@playwright/test';
import { installFixtureProject } from './fixture-server';

test('SZS commander publishes, answers, attends, confirms, closes and archives their own call-out', async ({ page }) => {
  await installFixtureProject(page, { service: 'SZS', role: 'COMMANDER', lifecycle: true });
  await page.goto('http://127.0.0.1:4174/#/poziv');
  await expect(page.getByTestId('new-call-out-wizard')).toBeVisible();
  await expect(page.getByText('DVD poziv koji SZS ne smije vidjeti')).toHaveCount(0);

  await page.getByTestId('new-title').fill('SZS vježba spašavanja');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('new-location').fill('Tivat');
  await page.getByTestId('new-instructions').fill('Okupljanje na poligonu');
  await page.getByTestId('create-draft').click();
  await expect(page.getByText('SZS vježba spašavanja').first()).toBeVisible();

  await page.getByTestId('recipient-picker').getByRole('checkbox').first().check();
  await page.getByTestId('to-review').click();
  await page.getByTestId('publish').click();
  await page.getByRole('dialog').getByRole('button', { name: /objavi|pozovi|potvrdi/i }).click();
  await expect(page.getByTestId('intervention-actions')).toBeVisible();

  await page.goto('http://127.0.0.1:4174/#/mobilizacija');
  await expect(page.getByTestId('callout-title')).toContainText('SZS vježba spašavanja');
  await page.getByTestId('acknowledge').click();
  await page.getByTestId('answer-DOLAZIM').click();
  await page.getByTestId('journey-NA_LICU_MJESTA').click();
  await page.getByTestId('check-in').click();
  await page.getByTestId('check-out').click();

  await page.goto('http://127.0.0.1:4174/#/poziv');
  await page.getByRole('tab', { name: 'Prisustvo' }).click();
  await page.getByTestId('pick-all-pending').click();
  await page.getByTestId('confirm-many').click();
  await page.getByRole('tab', { name: 'Poziv' }).click();
  await page.getByTestId('close-intervention').click();
  await page.getByTestId('close-reason').fill('Vježba završena');
  await page.getByRole('dialog').getByRole('button', { name: /zatvori|potvrdi/i }).click();

  await page.goto('http://127.0.0.1:4174/#/arhiva');
  await expect(page.getByTestId('archive-title')).toContainText('SZS vježba spašavanja');
  await expect(page.getByText('DVD poziv koji SZS ne smije vidjeti')).toHaveCount(0);
});
