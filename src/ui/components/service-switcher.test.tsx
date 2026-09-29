/**
 * The acting-service switch, rendered the way a person on a phone meets it.
 *
 * Two properties this holds: it appears only when there is a real choice (so a
 * single-service member's Settings is unchanged), and choosing a service is an
 * explicit act on a labelled radio - never a silent flip - that changes the role
 * and service the rest of the app then reads.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccessProvider, useAccess } from '@/auth/AccessProvider';
import type { AccessGateway } from '@/auth/access';
import { organizationIdOf } from '@/auth/serviceContext';
import { resetLanguageForTests } from '@/i18n/language';
import { ServiceSwitcher } from './ServiceSwitcher';

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
    fetchServiceContext: async () => ({ memberships: config.memberships, isOwner: config.isOwner ?? false }),
    fetchRoleIn: async (organizationId) =>
      organizationId === organizationIdOf('DVD')
        ? config.roleByService.DVD ?? null
        : config.roleByService.SZS ?? null,
  };
}

/** Reports the acting service and role so a switch is observable in the DOM. */
function Probe() {
  const { access } = useAccess();
  const service = access.kind === 'SIGNED_IN' ? access.service ?? 'none' : '-';
  const role = access.kind === 'SIGNED_IN' ? access.role ?? 'null' : '-';
  return <p data-testid="probe">{`${service}/${role}`}</p>;
}

async function render(g: AccessGateway) {
  await act(async () => {
    root.render(
      <AccessProvider gateway={g} configured storage={window.localStorage}>
        <ServiceSwitcher />
        <Probe />
      </AccessProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const radio = (service: 'DVD' | 'SZS') =>
  container.querySelector<HTMLInputElement>(`[data-testid="acting-service-${service}"] input`);
const probe = () => container.querySelector('[data-testid="probe"]')?.textContent ?? '';

describe('the acting-service switch', () => {
  it('does not appear for a single-service member', async () => {
    await render(gateway({ memberships: ['DVD'], roleByService: { DVD: 'FIREFIGHTER' } }));
    expect(radio('DVD')).toBeNull();
    expect(radio('SZS')).toBeNull();
    // The member still acts as their one service - the switch is simply absent.
    expect(probe()).toBe('DVD/FIREFIGHTER');
  });

  it('offers both services to a dual-service member as a real radio group', async () => {
    await render(
      gateway({ memberships: ['DVD', 'SZS'], roleByService: { DVD: 'ADMIN', SZS: 'COMMANDER' } }),
    );
    expect(container.querySelector('fieldset legend')).not.toBeNull();
    expect(radio('DVD')?.checked).toBe(true);
    expect(radio('SZS')?.checked).toBe(false);
  });

  it('switches the acting service, and the role follows it, on an explicit choice', async () => {
    await render(
      gateway({ memberships: ['DVD', 'SZS'], roleByService: { DVD: 'ADMIN', SZS: 'COMMANDER' } }),
    );
    expect(probe()).toBe('DVD/ADMIN');
    await act(async () => {
      radio('SZS')!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(radio('SZS')?.checked).toBe(true);
    expect(probe()).toBe('SZS/COMMANDER');
  });

  it('shows the owner both services with no membership', async () => {
    await render(
      gateway({ memberships: [], isOwner: true, roleByService: { DVD: 'OWNER', SZS: 'OWNER' } }),
    );
    expect(radio('DVD')).not.toBeNull();
    expect(radio('SZS')).not.toBeNull();
  });
});
