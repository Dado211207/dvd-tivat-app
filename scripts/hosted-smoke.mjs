/* global document, innerWidth, caches */
/** Read-only browser review of the published FireNexa app and public guide.
 * No login credentials, registration, incident or push operations are submitted.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Explicit targets let a draft guide be checked before it replaces the live guide.
const APP = process.env.FIRENEXA_SMOKE_APP_URL ?? 'https://firenexa-app.netlify.app/';
const GUIDE = process.env.FIRENEXA_SMOKE_GUIDE_URL ?? 'https://firenexa.netlify.app/';
const widths = [320, 390, 768, 1112, 1440];
const routes = ['poziv', 'mobilizacija', 'arhiva', 'evidencija', 'nalozi', 'podesavanja'];
const report = { app: APP, guide: GUIDE, checkedAt: new Date().toISOString(), checks: [], errors: [] };
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
// Only for an execution proxy with an untrusted CA. Default browser TLS remains strict.
const proxyCaException = process.env.FIRENEXA_PROXY_CA_EXCEPTION === 'true';
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  ...(proxy ? { proxy } : {}),
  args: proxyCaException ? ['--ignore-certificate-errors'] : [],
});

async function check(label, action) {
  try { await action(); report.checks.push(label); console.log(`PASS ${label}`); }
  catch (error) { report.errors.push({ label, message: error.message }); console.log(`FAIL ${label}: ${error.message}`); }
}

try {
  const context = await browser.newContext({ ignoreHTTPSErrors: proxyCaException });
  const mutations = [];
  context.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(new URL(request.url()).pathname);
  });
  await context.route('**/*', async (route) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      mutations.push(new URL(route.request().url()).pathname);
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(45000);
  const fatal = [];
  page.on('pageerror', (error) => fatal.push(error.message));
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await check(`app ${route} width ${width}`, async () => {
        await page.goto(`${APP}#/${route}`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId(`nav-${route}`).waitFor();
        assert.equal(await page.getByTestId(`nav-${route}`).getAttribute('aria-current'), 'page');
        await page.locator('main h1').waitFor({ state: 'attached' });
        if (route === 'evidencija') {
          await page.locator('#registry-refused-h').waitFor();
        } else if (route === 'nalozi') {
          await page.locator('#accountEmail').waitFor();
        } else if (route === 'podesavanja') {
          await page.getByTestId('language-me').waitFor();
        } else {
          await page.locator('main a[href="#/nalozi"]').waitFor();
        }
        assert.equal(await page.locator('main h1').count(), 1);
        assert.equal(await page.title(), 'FireNexa');
        assert.equal(await page.locator('[data-testid^="prototype-"]').count(), 0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      });
    }
  }
  for (const route of ['dojava', 'dezurni', 'clan', 'vozila', 'prikaz', 'clanovi', 'istorija']) {
    await check(`retired link ${route}`, async () => {
      await page.goto(`${APP}#/${route}`);
      assert.equal(await page.getByTestId('nav-poziv').getAttribute('aria-current'), 'page');
      await page.locator('main a[href="#/nalozi"]').waitFor();
    });
  }
  await check('signin required, native validation and keyboard skip', async () => {
    await page.goto(`${APP}#/nalozi`);
    await page.locator('#accountEmail').waitFor();
    await page.locator('#accountEmail').fill('not-an-email');
    await page.locator('.account-auth-form button[type="submit"]').click();
    assert.equal(await page.locator('#accountEmail').evaluate((input) => input.validity.valid), false);
    await page.getByRole('link', { name: 'Preskoci na sadrzaj' }).focus();
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('main').evaluate((main) => main === document.activeElement));
    assert.equal(await page.locator('#accountEmail').inputValue(), 'not-an-email');
  });
  await check('app signed-out accessibility', async () => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })), []);
  });
  await check('offline shell, settings and language survive reload', async () => {
    // Routing disables browser HTTP caching and interferes with offline testing.
    // No credentials exist in this context; Settings changes only local preferences.
    await context.unrouteAll({ behavior: 'wait' });
    await page.goto(`${APP}#/podesavanja`);
    await page.getByTestId('language-me').waitFor();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('language-me').waitFor();
    const cacheUrls = await page.evaluate(async () => {
      const names = await caches.keys();
      const entries = await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url)));
      return entries.flat();
    });
    assert.ok(cacheUrls.length > 0);
    assert.ok(cacheUrls.every((url) => new URL(url).origin === new URL(APP).origin));
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('offline-bar').waitFor();
    await page.getByTestId('language-en').locator('input').check();
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.ok(await page.getByTestId('language-en').locator('input').isChecked());
    await context.setOffline(false);
    await page.getByTestId('language-me').locator('input').check();
  });
  await context.setOffline(false);
  await check('no JavaScript crashes or attempted live writes', async () => {
    assert.deepEqual(fatal, []);
    assert.deepEqual(mutations, []);
  });
  const guideContext = await browser.newContext({ ignoreHTTPSErrors: proxyCaException });
  const guide = await guideContext.newPage();
  await check('guide publication metadata targets the reviewed app', async () => {
    const response = await guideContext.request.get(new URL('publication.json', GUIDE).href);
    assert.equal(response.status(), 200);
    const publication = await response.json();
    assert.equal(publication.appUrl, APP);
    assert.equal(publication.qrTarget, APP);
    if (new URL(APP).hostname === 'firenexa-app.netlify.app') {
      assert.equal(publication.preview, false);
    }
  });
  for (const width of widths) {
    await check(`guide width ${width}`, async () => {
      await guide.setViewportSize({ width, height: 900 });
      await guide.goto(GUIDE, { waitUntil: 'networkidle' });
      assert.equal(await guide.getByRole('link', { name: 'Otvori aplikaciju' }).getAttribute('href'), APP);
      const qr = guide.getByTestId('app-qr').getByRole('img');
      assert.ok(await qr.evaluate((image) => image.complete && image.naturalWidth > 0));
      assert.ok(await guide.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.equal(await guide.locator('video').count(), 3);
    });
  }
  await check('guide videos and transcripts', async () => {
    for (const [index, name] of ['iphone', 'android', 'usage'].entries()) {
      assert.equal(await guide.locator('video').nth(index).getAttribute('src'), `./videos/${name}.mp4`);
      const response = await guideContext.request.get(new URL(`videos/${name}.txt`, GUIDE).href);
      assert.equal(response.status(), 200);
      assert.match(await response.text(), /ilustracija/i);
    }
  });
  await check('guide accessibility and all local anchors resolve', async () => {
    const results = await new AxeBuilder({ page: guide }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.deepEqual(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })), []);
    const missing = await guide.evaluate(() => [...document.querySelectorAll('a[href^="#"]')]
      .map((link) => link.getAttribute('href').slice(1)).filter((id) => !document.getElementById(id)));
    assert.deepEqual(missing, []);
  });
  await guideContext.close();
  await context.close();
} finally {
  await browser.close();
  const path = process.env.FIRENEXA_SMOKE_REPORT ?? '/tmp/firenexa-hosted-smoke.json';
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.checks.length} hosted checks passed; ${report.errors.length} failed. Report: ${path}`);
  if (report.errors.length) { console.log(JSON.stringify(report.errors, null, 2)); process.exitCode = 1; }
}
