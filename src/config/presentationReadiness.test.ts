import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOCIETY_PROFILE } from './society';

const readDoc = (name: string) => readFileSync(join(process.cwd(), 'docs', name), 'utf8');

describe('first-test and presentation handoff', () => {
  it('keeps the checklist aligned with the public-safe operating profile', () => {
    const checklist = readDoc('FIRST_TEST_CHECKLIST.md');

    expect(checklist).toContain(SOCIETY_PROFILE.assemblyPoint);
    expect(checklist).toContain(SOCIETY_PROFILE.currentFallbackChannel);
    expect(checklist).toContain('390 x 844');
    expect(checklist).toContain('412 x 915');
    expect(checklist).toContain('Isporuka nije pokusana');
    expect(checklist).toContain('real member name');
  });

  it('keeps the spoken presentation honest about scale and missing capabilities', () => {
    const script = readDoc('PRESENTATION_SCRIPT.md');

    expect(script).toContain(`${SOCIETY_PROFILE.confirmedMemberCount} izmisljena clana`);
    expect(script).toContain('MAN-1');
    expect(script).toContain('TERENAC-1');
    expect(script).toContain('ne salje obavjestenja');
    expect(script).toContain('Viber i postojeci postupak ostaju obavezni');
    expect(script).toContain('iPhone i Android');
  });

  it('keeps public identity separate from unconfirmed operational facts', () => {
    const profile = readDoc('SOCIETY_PROFILE.md');

    expect(profile).toContain('Public context checked for the presentation');
    expect(profile).toContain(
      'do not independently confirm the membership, vehicles, call-out process',
    );
    expect(profile).toContain('No crest was imported from social media');
  });

  it('carries the confirmed baseline into the meeting decision record', () => {
    const meeting = readDoc('MEETING_DECISIONS.md');

    expect(meeting).toContain(`${SOCIETY_PROFILE.confirmedMemberCount} members`);
    expect(meeting).toContain(SOCIETY_PROFILE.assemblyPoint);
    expect(meeting).toContain(SOCIETY_PROFILE.currentFallbackChannel);
    expect(meeting).toContain('one MAN firefighting vehicle and one firefighting SUV');
    expect(meeting).toContain('Both iPhone and Android');
    expect(meeting).toContain('sends no alert');
  });
});
