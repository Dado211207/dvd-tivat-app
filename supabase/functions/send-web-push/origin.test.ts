import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, responseOrigin } from './origin';

describe('signed-in browser origins for the push wake-up', () => {
  it('accepts the FireNexa app and existing installed app even when ALLOWED_ORIGIN is still the Pages origin', () => {
    const configured = 'https://dado211207.github.io';
    for (const origin of [
      'https://firenexa-app.netlify.app',
      'https://boka-operativa-phone-test.netlify.app',
      configured,
    ]) {
      expect(isAllowedOrigin(origin, configured)).toBe(true);
      expect(responseOrigin(origin, configured)).toBe(origin);
    }
  });

  it('accepts one separately configured installation without reflecting arbitrary origins', () => {
    const configured = 'https://another-install.example';
    expect(isAllowedOrigin(configured, configured)).toBe(true);
    expect(responseOrigin(configured, configured)).toBe(configured);
    for (const origin of ['https://attacker.example', 'https://firenexa-app.netlify.app.attacker.example', 'http://firenexa-app.netlify.app']) {
      expect(isAllowedOrigin(origin, configured)).toBe(false);
      expect(responseOrigin(origin, configured)).not.toBe(origin);
    }
  });
});
