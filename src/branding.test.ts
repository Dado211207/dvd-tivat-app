/**
 * P8 (AC2): the application's own name and PWA metadata no longer hardcode "DVD
 * Tivat". The service name survives in exactly two intended places — the
 * `organizations` row (server data) and the i18n organisation label — and the
 * abandoned citizen-reporting prototype stays DVD-shaped by decision (plan §10),
 * so this guards the metadata that describes the operational app itself.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('operational branding is service-neutral (AC2)', () => {
  it('the page metadata does not name DVD Tivat', () => {
    expect(read('index.html')).not.toContain('DVD Tivat');
  });

  it('the web manifest does not name DVD Tivat', () => {
    const manifest = read('public/manifest.webmanifest');
    expect(manifest).not.toContain('DVD Tivat');
    // The app's own name is already service-neutral and must stay so.
    expect(JSON.parse(manifest).name).toBe('Boka Operativa');
  });

  it('keeps the service name only as the i18n organisation label (the intended place)', () => {
    // Not scrubbed everywhere: the label a person reads to tell the services
    // apart must still say "DVD Tivat". This asserts the exclusion is deliberate.
    expect(read('src/i18n/strings.en.ts')).toContain("DVD: 'DVD Tivat'");
    expect(read('src/i18n/strings.me.ts')).toContain("DVD: 'DVD Tivat'");
  });
});
