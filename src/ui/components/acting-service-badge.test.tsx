/**
 * The "acting as DVD / SZS" badge on the operational screens (P6, D14).
 *
 * Two properties, the mirror of the switch's own: it appears ONLY when there is a
 * real choice - a single-service member has no ambiguity and sees nothing - and
 * when it appears it names the service in front of the person and points at the one
 * place a switch is made. It never switches anything itself.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccessProvider } from '@/auth/AccessProvider';
import type { AccessGateway } from '@/auth/access';
import { organizationIdOf } from '@/auth/serviceContext';
import { resetLanguageForTests } from '@/i18n/language';
import { ActingServiceBadge } from './ActingServiceBadge';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  resetLanguageForTests();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function gateway(config: {
  memberships: readonly string[];
  isOwner?: boolean;
  roleByService: Readonly<Record<string, string | null>>;
}): AccessGateway {
  return {
    currentUser: async () => ({ id: 'user-1', email: 'probni@example.invalid' }),
    fetchProfile: async () => ({ fullName: 'Probni Korisnik', profileComplete: true }),
    fetchRole: async () => {
      throw new Error('legacy path must not run');
    },
    fetchAccountStatus: async () => 'ACTIVE',
    fetchServiceContext: async () => ({
      memberships: config.memberships,
      isOwner: config.isOwner ?? false,
    }),
    fetchRoleIn: async (organizationId) =>
      organizationId === organizationIdOf('DVD')
        ? config.roleByService.DVD ?? null
        : config.roleByService.SZS ?? null,
  };
}

async function render(g: AccessGateway) {
  await act(async () => {
    root.render(
      <AccessProvider gateway={g} configured storage={window.localStorage}>
        <ActingServiceBadge />
      </AccessProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const badge = () => container.querySelector('[data-testid="acting-service-badge"]');

describe('the acting-service badge', () => {
  it('shows nothing to a single-service member', async () => {
    await render(gateway({ memberships: ['DVD'], roleByService: { DVD: 'FIREFIGHTER' } }));
    expect(badge()).toBeNull();
  });

  it('names the current service and links to the switch for a dual-service member', async () => {
    await render(
      gateway({ memberships: ['DVD', 'SZS'], roleByService: { DVD: 'ADMIN', SZS: 'COMMANDER' } }),
    );
    const el = badge();
    expect(el).not.toBeNull();
    // Acting as DVD by default (the fixed order puts DVD first); it must name DVD.
    expect(el?.textContent).toContain('DVD');
    expect(el?.textContent).not.toContain('SZS');
    // The change affordance goes to Settings, where the one switch lives.
    const change = el?.querySelector('a');
    expect(change?.getAttribute('href')).toContain('podesavanja');
  });

  it('shows for the owner, who administers both services with no membership', async () => {
    await render(
      gateway({ memberships: [], isOwner: true, roleByService: { DVD: 'OWNER', SZS: 'OWNER' } }),
    );
    expect(badge()).not.toBeNull();
  });
});
