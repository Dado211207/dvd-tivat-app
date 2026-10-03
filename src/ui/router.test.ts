import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ROUTE, PROTOTYPE_ROUTES, resolveRoute } from './router';

afterEach(() => vi.unstubAllEnvs());

describe('retired simulation links', () => {
  it('lands old links on the operational console in regular builds', () => {
    vi.stubEnv('VITE_PROTOTYPE_ENABLED', undefined);
    for (const route of PROTOTYPE_ROUTES) {
      expect(resolveRoute(`#/${route}?draft=old`)).toBe(DEFAULT_ROUTE);
    }
    expect(resolveRoute('#/mobilizacija')).toBe('mobilizacija');
    expect(resolveRoute('#/podesavanja')).toBe('podesavanja');
  });

  it('allows historical screens only in an explicit review build', () => {
    vi.stubEnv('VITE_PROTOTYPE_ENABLED', 'true');
    for (const route of PROTOTYPE_ROUTES) expect(resolveRoute(`#/${route}`)).toBe(route);
  });
});
