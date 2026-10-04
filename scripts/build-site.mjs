import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';

const PREVIOUS_APP_URL = 'https://boka-operativa-phone-test.netlify.app/';
const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export function appAddress(input, preview = false) {
  if (!input) throw new Error('Provide --app-url with the verified hosted application URL.');
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('App URL must use HTTPS without credentials, query or hash.');
  }
  if (!preview && /(^|[.-])test([.-]|$)/i.test(url.hostname)) {
    throw new Error('A test address requires --preview and must not be printed as the final QR.');
  }
  return url.href;
}

export async function buildSite({ appUrl, preview = false, outDir = 'dist-site' }) {
  const address = appAddress(appUrl, preview);
  const output = resolve(outDir);
  // Copy only the public guide, never the app bundle or operational data.
  await mkdir(resolve(output, 'assets'), { recursive: true });
  await cp('site/site.css', resolve(output, 'site.css'));
  await cp('site/assets/firenexa.svg', resolve(output, 'assets/firenexa.svg'));
  await cp('site/videos', resolve(output, 'videos'), { recursive: true });
  const options = { errorCorrectionLevel: 'M', margin: 4, width: 512 };
  await QRCode.toFile(resolve(output, 'assets/app-qr.svg'), address, { ...options, type: 'svg' });
  await QRCode.toFile(resolve(output, 'assets/app-qr.png'), address, options);
  const safeAddress = escapeHtml(address);
  let html = (await readFile('site/index.html', 'utf8')).replaceAll(PREVIOUS_APP_URL, safeAddress);
  html = html.replace('<!-- APP_QR -->', `<div class="app-qr" data-testid="app-qr">
    <img src="./assets/app-qr.svg" width="148" height="148" alt="QR kod za otvaranje FireNexa aplikacije">
    <div><strong>Otvori na telefonu</strong>
      <p>Skeniraj kamerom ili otvori <a href="${safeAddress}">link aplikacije</a>.</p>
      <p>${preview ? 'QR za pretpregled. Nije za trajno stampanje.' : 'Adresa aplikacije je ista u QR kodu i svim linkovima.'}</p>
      <a href="./assets/app-qr.png" download="firenexa-qr.png">Preuzmi QR kod</a>
    </div>
  </div>`);
  if (!preview) {
    html = html.replaceAll('testnu aplikaciju', 'aplikaciju').replaceAll('testni link', 'link aplikacije');
    html = html.replace(
      'Dostupan je pretpregled za pripremu clanova. Zavrsna adresa i izdanje bice objavljeni ovdje prije operativne upotrebe.',
      'Prijavi se svojim nalogom. Pristup pozivima zavisi od clanstva i uloge koju dodjeljuje vlasnik.',
    );
  }
  await writeFile(resolve(output, 'index.html'), html);
  for (const name of ['android.html', 'koriscenje.html']) {
    const guide = (await readFile(`site/${name}`, 'utf8')).replaceAll(PREVIOUS_APP_URL, safeAddress);
    await writeFile(resolve(output, name), guide);
  }
  await writeFile(resolve(output, 'publication.json'), JSON.stringify({
    appUrl: address, preview, qrTarget: address,
  }, null, 2) + '\n');
  return { appUrl: address, preview, output };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  try {
    const result = await buildSite({
      appUrl: args.includes('--app-url') ? value('--app-url') : undefined,
      preview: args.includes('--preview'),
      outDir: args.includes('--out-dir') ? value('--out-dir') : undefined,
    });
    process.stdout.write(`Public guide built: ${result.output}\nApp/QR target: ${result.appUrl}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
