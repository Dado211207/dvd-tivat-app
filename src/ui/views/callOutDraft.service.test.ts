import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, DRAFT_STORAGE_KEY, LEGACY_DRAFT_STORAGE_KEY, readStoredDraft, storeDraft } from './callOutDraft';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
const draft = {
  kind: 'POZAR', title: 'Požar', instructions: 'Okupljanje', location: 'Tivat',
  otherNote: '', assembly: '',
};

beforeEach(() => window.localStorage.clear());

describe('unsaved call-out text stays with its service', () => {
  it('uses the neutral key and preserves a half-written DVD call-out from the old key', () => {
    window.localStorage.setItem(LEGACY_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    expect(readStoredDraft(DVD)).toEqual(draft);
    expect(window.localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!)).toEqual(draft);
    storeDraft(draft);
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(readStoredDraft(DVD)).toEqual(draft);
  });

  it('migrates SZS separately and clears both names when a draft is saved', () => {
    window.localStorage.setItem(`${LEGACY_DRAFT_STORAGE_KEY}:${SZS}`, JSON.stringify(draft));
    expect(readStoredDraft(SZS)).toEqual(draft);
    expect(readStoredDraft(DVD)).toBeNull();
    clearDraft(SZS);
    expect(window.localStorage.getItem(`${LEGACY_DRAFT_STORAGE_KEY}:${SZS}`)).toBeNull();
    expect(window.localStorage.getItem(`${DRAFT_STORAGE_KEY}:${SZS}`)).toBeNull();
  });

  it('never restores DVD text into SZS or clears the other service on save', () => {
    storeDraft(draft, DVD);
    expect(readStoredDraft(SZS)).toBeNull();
    storeDraft({ ...draft, title: 'SZS poziv' }, SZS);
    expect(readStoredDraft(DVD)?.title).toBe('Požar');
    clearDraft(SZS);
    expect(readStoredDraft(SZS)).toBeNull();
    expect(readStoredDraft(DVD)?.title).toBe('Požar');
  });
});
