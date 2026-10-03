/**
 * AC2, adapted for FireNexa: the operational application's own identity is the
 * product name "FireNexa", and no operational screen hardcodes a SERVICE name.
 *
 * The product is FireNexa (Fire & Rescue Response Platform). The two services it
 * coordinates - DVD Tivat and SZS Tivat - are named to a person ONLY through the
 * i18n `organizationLabel`, keyed by the acting service's code, so a frozen label
 * can never tell a dual-service commander they are in the wrong service. A service
 * name baked into an operational screen is the regression this guards against. The
 * retired "Boka Operativa" brand must not reappear in the operational app either.
 *
 * Scope note: the SIMULATED prototype routes (the abandoned citizen-reporting
 * research) stay DVD-shaped by decision and are deliberately NOT in the operational
 * set below - this guards the screens a signed-in member actually operates on,
 * taken from `App.tsx`'s `ROUTE_BACKING` (the five SERVER views, the one DEVICE
 * view, and the shell).
 *
 * This is the AC2 regression test originally added on the parallel branch
 * (commit 8cfb7f7, `src/branding.test.ts`), re-pointed at FireNexa and this
 * branch's operational screens; the old branch had no such guard.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

/**
 * The screens a signed-in person operates on, from `App.tsx`'s `ROUTE_BACKING`:
 * the five SERVER-backed views, the one DEVICE-backed view, and the shell that
 * frames them. The SIMULATED routes (`dojava/dezurni/clan/vozila/prikaz/clanovi/
 * istorija`) are the abandoned prototype and are excluded on purpose.
 */
const OPERATIONAL_SOURCES = [
  'src/App.tsx', // the shell: navigation, account chrome, connection/simulation bars
  'src/ui/views/CommandView.tsx', // poziv (SERVER)
  'src/ui/views/MobilisationView.tsx', // mobilizacija (SERVER)
  'src/ui/views/ArchiveView.tsx', // arhiva (SERVER)
  'src/ui/views/AccountsView.tsx', // nalozi (SERVER)
  'src/ui/views/RegistryView.tsx', // evidencija (SERVER)
  'src/ui/views/SettingsView.tsx', // podesavanja (DEVICE)
];

/**
 * A service name hardcoded on an operational screen (it belongs in the i18n
 * organisation label), or the retired product brand (it must not come back).
 */
const FORBIDDEN_ON_OPERATIONAL_SCREENS = ['DVD Tivat', 'Boka Operativa'];

/** A line is a comment (prose, never rendered) when it opens with `//`, `*` or `/*`. */
const isCommentLine = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

describe('operational identity is FireNexa and service-neutral (AC2)', () => {
  it('names the product FireNexa in the page metadata, not a service or the retired brand', () => {
    const html = read('index.html');
    expect(html).toContain('<title>FireNexa</title>');
    expect(html).toContain('content="FireNexa"'); // apple-mobile-web-app-title
    expect(html).not.toContain('DVD Tivat');
    expect(html).not.toContain('Boka Operativa');
  });

  it('names the product FireNexa in the web manifest', () => {
    const manifest = read('public/manifest.webmanifest');
    const parsed = JSON.parse(manifest) as { name: string; short_name: string };
    expect(parsed.name).toBe('FireNexa');
    expect(parsed.short_name).toBe('FireNexa');
    expect(manifest).not.toContain('DVD Tivat');
    expect(manifest).not.toContain('Boka Operativa');
  });

  it('keeps the product name in a single constant', () => {
    // So a rename is one edit, and the operational grep below has one source of truth.
    expect(read('src/i18n/labels.ts')).toContain("APP_NAME = 'FireNexa'");
  });

  it('keeps each service name only as the i18n organisation label (the intended place)', () => {
    // Not scrubbed everywhere: the label a person reads to tell the services apart
    // must still say "DVD Tivat". This asserts the exclusion is deliberate.
    expect(read('src/i18n/strings.en.ts')).toContain("DVD: 'DVD Tivat'");
    expect(read('src/i18n/strings.me.ts')).toContain("DVD: 'DVD Tivat'");
  });

  it('never hardcodes a service name or the retired brand on an operational screen (AC2 grep)', () => {
    // A rendered occurrence is always a string literal or JSX text, never a comment,
    // so the forbidden tokens are allowed only on comment lines here; any other line
    // naming one is the regression this guards against, reported with its location.
    const offenders: string[] = [];
    for (const file of OPERATIONAL_SOURCES) {
      read(file)
        .split('\n')
        .forEach((line, index) => {
          if (isCommentLine(line)) return;
          for (const token of FORBIDDEN_ON_OPERATIONAL_SCREENS) {
            if (line.includes(token)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
