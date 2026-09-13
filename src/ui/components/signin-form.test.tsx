/**
 * The sign-in form, when the server cannot be reached.
 *
 * The pure part - which errors count as unreachable, and what the three fixed
 * messages may contain - is tested in `src/auth/signin-errors.test.ts`. What is
 * tested here is the only stateful decision: the form counts consecutive
 * unreachable attempts, and the second one adds the possibility of a content
 * blocker. Once is a passing network and saying "it might be your shield" would
 * be a guess; twice on a device that is otherwise online is worth mentioning.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessGateway } from '@/auth/access';
import { AccessProvider } from '@/auth/AccessProvider';
import { AccountAccessSetup } from './AccountAccessSetup';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const signIn = vi.fn();

vi.mock('@/auth/supabaseClient', async (importOriginal) => {
  // The messages themselves are the real ones, so this cannot pass against a
  // sentence that no longer exists.
  const real = await importOriginal<typeof import('@/auth/supabaseClient')>();
  return { ...real, signInWithEmail: (...args: unknown[]) => signIn(...args) };
});

/** Signed out, with a project configured: the state that shows the form. */
const SIGNED_OUT: AccessGateway = {
  currentUser: async () => null,
  fetchProfile: async () => null,
  fetchRole: async () => null,
  fetchAccountStatus: async () => 'ANONYMOUS',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  signIn.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function typeInto(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(selector);
  if (field === null) throw new Error(`no field ${selector}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function attemptSignIn() {
  const form = container.querySelector('form');
  if (form === null) throw new Error('no sign-in form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function openForm() {
  await act(async () => {
    root.render(
      <AccessProvider gateway={SIGNED_OUT} configured>
        <AccountAccessSetup />
      </AccessProvider>,
    );
  });
  await settle();
  typeInto('input[type="email"]', 'komandir@example.invalid');
  typeInto('input[type="password"]', 'ispravna-lozinka-123');
}

describe('when the request never reaches the server', () => {
  it('does not send anybody off to check a password that is fine', async () => {
    signIn.mockResolvedValue({ ok: false, unreachable: true });
    await openForm();
    await attemptSignIn();

    const text = container.textContent ?? '';
    expect(text).toMatch(/nije stigao do servera/i);
    expect(text, 'this is the sentence that wasted the reporter’s evening').not.toMatch(
      /Provjerite email i lozinku/i,
    );
  });

  it('mentions a content blocker only once it has happened twice', async () => {
    signIn.mockResolvedValue({ ok: false, unreachable: true });
    await openForm();

    await attemptSignIn();
    expect(
      container.textContent ?? '',
      'once is a passing network; naming a shield would be a guess',
    ).not.toMatch(/Brave|blokiranje sadrzaja/i);

    typeInto('input[type="password"]', 'ispravna-lozinka-123');
    await attemptSignIn();
    expect(container.textContent ?? '').toMatch(/Brave Shields|blokiranje sadrzaja/i);
  });

  it('forgets the run as soon as the server actually answers', async () => {
    await openForm();

    signIn.mockResolvedValue({ ok: false, unreachable: true });
    await attemptSignIn();
    typeInto('input[type="password"]', 'ispravna-lozinka-123');

    // The server answered this time: a refusal, and the generic sentence.
    signIn.mockResolvedValue({ ok: false });
    await attemptSignIn();
    expect(container.textContent ?? '').toMatch(/Provjerite email i lozinku/i);
    expect(container.textContent ?? '').not.toMatch(/nije stigao do servera/i);

    // And the next network failure starts counting again from one, rather than
    // jumping straight to the shield hint on the strength of an unrelated
    // earlier failure.
    typeInto('input[type="password"]', 'ispravna-lozinka-123');
    signIn.mockResolvedValue({ ok: false, unreachable: true });
    await attemptSignIn();
    expect(container.textContent ?? '').not.toMatch(/Brave|blokiranje sadrzaja/i);
  });

  it('still offers a way to try again', async () => {
    signIn.mockResolvedValue({ ok: false, unreachable: true });
    await openForm();
    await attemptSignIn();

    const submit = container.querySelector<HTMLButtonElement>('form button[type="submit"]');
    expect(submit, 'the form must remain usable after a failure').not.toBeNull();
    expect(submit?.disabled).toBe(false);
  });

  it('never puts a raw error on the screen', async () => {
    // Whatever the transport said, the screen shows one of three fixed
    // sentences. Nothing is built from the error, so nothing can leak.
    signIn.mockResolvedValue({ ok: false, unreachable: true });
    await openForm();
    await attemptSignIn();

    const text = container.textContent ?? '';
    expect(text).not.toMatch(/TypeError|Failed to fetch|supabase\.co|sb_publishable|eyJ/i);
  });
});
