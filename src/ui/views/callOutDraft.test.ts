/**
 * The half-typed call-out that must not disappear.
 *
 * Between opening the form and pressing "Sacuvaj nacrt" there is no record of a
 * call-out anywhere, so anything that takes the page away takes the address of
 * the fire with it. These tests are about that gap: what survives, what is
 * deliberately not kept, and what happens in a browser that refuses to store
 * anything at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDraft,
  draftHasContent,
  readStoredDraft,
  storeDraft,
  DRAFT_STORAGE_KEY,
  EMPTY_DRAFT,
  type CallOutDraft,
} from './callOutDraft';

const TYPED: CallOutDraft = {
  kind: 'POZAR',
  otherNote: '',
  title: 'Izmisljeni pozar u izmisljenoj ulici',
  location: 'Izmisljena adresa 1, Tivat',
  assembly: 'Baza DVD Tivat',
  instructions: 'Ponijeti naprtnjace.',
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('keeping a draft across a reload', () => {
  it('returns exactly what was typed', () => {
    expect(storeDraft(TYPED)).toBe(true);
    expect(readStoredDraft()).toEqual(TYPED);
  });

  it('has nothing to return before anybody types', () => {
    expect(readStoredDraft()).toBeNull();
  });

  it('forgets it once the draft reaches the server', () => {
    storeDraft(TYPED);
    clearDraft();
    expect(readStoredDraft()).toBeNull();
    // Not merely absent from the accessor - genuinely gone from the device. A
    // shared station tablet must not keep an incident readable to whoever opens
    // the console next.
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('does not keep an empty form', () => {
    // Storing a default kind and five empty strings would make the form report
    // that it remembered something, which is worse than remembering nothing.
    storeDraft(EMPTY_DRAFT);
    expect(readStoredDraft()).toBeNull();
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('clears a stored draft when the form is emptied again', () => {
    storeDraft(TYPED);
    storeDraft(EMPTY_DRAFT);
    expect(readStoredDraft()).toBeNull();
  });
});

describe('what counts as content', () => {
  it('is any one of the typed fields, not the kind', () => {
    // The kind has a default, so a commander who has opened the form and
    // touched nothing still has a `kind`. That is not a draft.
    expect(draftHasContent(EMPTY_DRAFT)).toBe(false);
    expect(draftHasContent({ ...EMPTY_DRAFT, kind: 'DRUGO' })).toBe(false);

    for (const key of ['title', 'location', 'assembly', 'instructions', 'otherNote'] as const) {
      expect(draftHasContent({ ...EMPTY_DRAFT, [key]: 'x' }), key).toBe(true);
    }
  });

  it('ignores whitespace', () => {
    expect(draftHasContent({ ...EMPTY_DRAFT, title: '   ' })).toBe(false);
  });
});

describe('a browser that will not cooperate', () => {
  /*
   * Private windows, blocked site data and some embedded webviews THROW on
   * `localStorage` rather than returning null. A commander in one of those must
   * still get a working form - losing the safety net is bad, losing the form is
   * an incident nobody can call out at all.
   *
   * The spy goes on `Storage.prototype`, not on the `window.localStorage`
   * instance: spying on the instance silently does nothing in jsdom, and a mock
   * that silently does nothing is a test that silently proves nothing.
   */
  it('reports that a draft will not survive, rather than throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(storeDraft(TYPED)).toBe(false);
  });

  it('opens on an empty form when reading throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readStoredDraft()).toBeNull();
  });

  it('does not throw when forgetting is refused', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearDraft()).not.toThrow();
  });
});

describe('storage that holds something unexpected', () => {
  /*
   * A browser's storage is editable, and an older version of this application
   * may have written a different shape. Every field is narrowed on the way out,
   * because putting `undefined` into a controlled text input detaches it from
   * React and the commander gets a field that will not accept typing.
   */
  it('ignores text that is not JSON', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, 'not json at all');
    expect(readStoredDraft()).toBeNull();
  });

  it('ignores JSON that is not an object', () => {
    for (const value of ['null', '"a string"', '42', '[1,2,3]']) {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, value);
      expect(readStoredDraft(), value).toBeNull();
    }
  });

  it('narrows every field to a string, keeping what is usable', () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ title: 'Izmisljeno', location: 42, instructions: null, extra: 'ignored' }),
    );
    const restored = readStoredDraft();
    expect(restored).not.toBeNull();
    expect(restored?.title).toBe('Izmisljeno');
    expect(restored?.location).toBe('');
    expect(restored?.instructions).toBe('');
    expect(restored?.kind, 'a missing kind falls back to the default').toBe(EMPTY_DRAFT.kind);
    expect(Object.keys(restored ?? {}).sort()).toEqual(Object.keys(EMPTY_DRAFT).sort());
  });

  it('treats a stored entry with nothing usable in it as no draft', () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ location: 42 }));
    expect(readStoredDraft()).toBeNull();
  });
});
