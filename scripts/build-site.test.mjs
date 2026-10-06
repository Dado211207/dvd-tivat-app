import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { appAddress, buildSite } from './build-site.mjs';

test('final guide requires an explicit HTTPS address and refuses a test hostname', () => {
  for (const address of [undefined, 'http://example.com', 'https://user:pass@example.com',
    'https://example.com/?token=private', 'https://example.com/#/poziv',
    'https://boka-operativa-phone-test.netlify.app/', 'https://firenexa-app.netlify.app/',
    'https://firenexa.netlify.app/']) {
    assert.throws(() => appAddress(address));
  }
  assert.equal(appAddress('https://boka-operativa-phone-test.netlify.app/', true),
    'https://boka-operativa-phone-test.netlify.app/');
  assert.equal(appAddress('https://firenexa-app.netlify.app/', true),
    'https://firenexa-app.netlify.app/');
  assert.equal(appAddress('https://dado211207.github.io/dvd-tivat-app/'),
    'https://dado211207.github.io/dvd-tivat-app/');
});

test('one configured address replaces every app link and supplies both QR assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'firenexa-site-'));
  try {
    const address = 'https://dado211207.github.io/dvd-tivat-app/';
    await buildSite({ appUrl: address, outDir: directory });
    const html = await readFile(join(directory, 'index.html'), 'utf8');
    assert.ok(!html.includes('boka-operativa-phone-test.netlify.app'));
    assert.ok(!html.includes('firenexa-app.netlify.app'));
    assert.ok(!html.includes('{{FIRENEXA_APP_URL}}'));
    assert.ok(!html.includes('<!-- APP_QR -->'));
    assert.ok(!html.includes('testnu aplikaciju'));
    assert.ok(!html.includes('Zavrsna adresa i izdanje'));
    assert.ok(html.includes('./videos/iphone.mp4'));
    assert.ok(!html.includes('./videos/android.mp4'));
    assert.ok(!html.includes('./videos/usage.mp4'));
    assert.ok((await stat(join(directory, 'videos/iphone.mp4'))).size > 100_000);
    for (const name of ['android', 'koriscenje']) {
      assert.ok(html.includes(`./${name}.html`));
      const guide = await readFile(join(directory, `${name}.html`), 'utf8');
      assert.ok(!guide.includes('boka-operativa-phone-test.netlify.app'));
      assert.ok(!guide.includes('firenexa-app.netlify.app'));
      assert.ok(!guide.includes('{{FIRENEXA_APP_URL}}'));
      assert.ok(guide.includes(`href="${address}"`));
      assert.ok(guide.includes('<h2>'));
    }
    assert.equal(html.split(`href="${address}"`).length - 1, 4);
    assert.ok(html.includes('data-testid="app-qr"'));
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'publication.json'), 'utf8')),
      { appUrl: address, preview: false, qrTarget: address });
    assert.ok((await readFile(join(directory, 'assets/app-qr.svg'), 'utf8')).includes('<svg'));
    assert.equal((await readFile(join(directory, 'assets/app-qr.png'))).subarray(1, 4).toString(), 'PNG');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a rebuild purges stale files so a dropped video is never republished', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'firenexa-site-'));
  try {
    await mkdir(join(directory, 'videos'), { recursive: true });
    await writeFile(join(directory, 'videos/android.mp4'), 'stale rejected illustrated tutorial');
    await writeFile(join(directory, 'stale.html'), 'leftover');
    await buildSite({ appUrl: 'https://example.invalid/firenexa/', outDir: directory });
    await assert.rejects(stat(join(directory, 'videos/android.mp4')), 'a dropped video must not survive a rebuild');
    await assert.rejects(stat(join(directory, 'stale.html')), 'a dropped page must not survive a rebuild');
    assert.ok((await stat(join(directory, 'videos/iphone.mp4'))).size > 100_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
