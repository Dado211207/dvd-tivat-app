import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessProvider, useAccess, type AccessContextValue } from './AccessProvider';
import type { AccessGateway } from './access';
import { RequireRole } from '@/ui/components/RequireRole';
import { signOut as backendSignOut } from './supabaseClient';

vi.mock('./supabaseClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('./supabaseClient')>(),
  signOut: vi.fn(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(backendSignOut).mockReset();
});

describe('sign-out while an earlier access read is in flight', () => {
  it('never restores the former account during sign-out', async () => {
    let releaseStale!: () => void;
    const stale = new Promise<void>((resolve) => { releaseStale = resolve; });
    let releaseSignOut!: () => void;
    const signingOut = new Promise<void>((resolve) => { releaseSignOut = resolve; });
    vi.mocked(backendSignOut).mockReturnValue(signingOut);
    let reads = 0;
    let signedOut = false;
    const gateway: AccessGateway = {
      currentUser: async () => {
        reads += 1;
        if (reads === 2) await stale;
        return signedOut ? null : { id: 'user-1', email: 'owner@example.invalid' };
      },
      fetchProfile: async () => ({ fullName: 'Owner', profileComplete: true }),
      fetchRole: async () => 'OWNER',
      fetchAccountStatus: async () => 'ACTIVE',
    };
    let access!: AccessContextValue;
    function Capture() { access = useAccess(); return null; }
    await act(async () => {
      root.render(<AccessProvider gateway={gateway} configured><Capture />
        <RequireRole allow={['OWNER']}><p>PRIVATE</p></RequireRole>
      </AccessProvider>);
    });
    expect(container.textContent).toContain('PRIVATE');

    await act(async () => { void access.reload(); await Promise.resolve(); });
    expect(reads).toBe(2);
    await act(async () => { void access.signOut(); await Promise.resolve(); });
    expect(container.textContent).not.toContain('PRIVATE');

    await act(async () => { releaseStale(); await stale; });
    expect(container.textContent).not.toContain('PRIVATE');

    signedOut = true;
    await act(async () => { releaseSignOut(); await signingOut; });
    expect(container.textContent).not.toContain('PRIVATE');
  });

  it('rechecks access if the server refuses to sign out', async () => {
    vi.mocked(backendSignOut).mockRejectedValue(new Error('network'));
    let reads = 0;
    const gateway: AccessGateway = {
      currentUser: async () => {
        reads += 1;
        return { id: 'user-1', email: 'owner@example.invalid' };
      },
      fetchProfile: async () => ({ fullName: 'Owner', profileComplete: true }),
      fetchRole: async () => 'OWNER',
      fetchAccountStatus: async () => 'ACTIVE',
    };
    let access!: AccessContextValue;
    function Capture() { access = useAccess(); return null; }
    await act(async () => {
      root.render(<AccessProvider gateway={gateway} configured><Capture />
        <RequireRole allow={['OWNER']}><p>PRIVATE</p></RequireRole>
      </AccessProvider>);
    });
    expect(container.textContent).toContain('PRIVATE');
    await act(async () => {
      await expect(access.signOut()).rejects.toThrow('network');
    });
    expect(reads).toBe(2);
    expect(container.textContent).toContain('PRIVATE');
  });
});
