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

/**
 * The screens a signed-in person actually operates on, taken from `App.tsx`'s
 * `ROUTE_BACKING`: the five SERVER-backed views plus the one DEVICE-backed view,
 * and the shell (`App.tsx`) that frames them. The SIMULATED routes
 * (`dojava/dezurni/clan/vozila/prikaz/clanovi/istorija`) are the abandoned
 * research prototype, which stays DVD-shaped by decision (plan §10), so they and
 * the two components only they reach (`StationOverview`, `AdminDataPanel`) are
 * deliberately NOT in this set.
 */
const OPERATIONAL_SOURCES = [
  'src/App.tsx', // the shell: navigation, account chrome, connection and simulation bars
  'src/ui/views/CommandView.tsx', // poziv (SERVER)
  'src/ui/views/MobilisationView.tsx', // mobilizacija (SERVER)
  'src/ui/views/ArchiveView.tsx', // arhiva (SERVER)
  'src/ui/views/AccountsView.tsx', // nalozi (SERVER)
  'src/ui/views/RegistryView.tsx', // evidencija (SERVER)
  'src/ui/views/SettingsView.tsx', // podesavanja (DEVICE)
];

/** A line is a comment (prose, never rendered) when it opens with `//`, `*` or `/*`. */
const isCommentLine = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

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

  it('never renders a hardcoded "DVD Tivat" on an operational screen (AC2 grep)', () => {
    // AC2 is stated in the plan as a grep: no user-visible string may hardcode
    // "DVD Tivat" outside the `organizations` row and the i18n label. The service
    // name reaches an operational screen only through the i18n `organizationLabel`
    // keyed by the acting service's code - never written into the screen itself -
    // so a dual-service commander is never told they are in the wrong service by a
    // frozen label. A rendered occurrence is always a string literal or JSX text,
    // never a comment, so "DVD Tivat" is allowed only on comment lines here; any
    // other line naming it is the regression this guards against.
    const offenders: string[] = [];
    for (const file of OPERATIONAL_SOURCES) {
      read(file)
        .split('\n')
        .forEach((line, index) => {
          if (line.includes('DVD Tivat') && !isCommentLine(line)) {
            offenders.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
