import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, DRAFT_STORAGE_KEY, readStoredDraft, storeDraft } from './callOutDraft';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
const draft = {
  kind: 'POZAR', title: 'Požar', instructions: 'Okupljanje', location: 'Tivat',
  otherNote: '', assembly: '',
};

beforeEach(() => window.localStorage.clear());

describe('unsaved call-out text stays with its service', () => {
  it('keeps the existing DVD key so a half-written DVD call-out survives the update', () => {
    storeDraft(draft);
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(readStoredDraft(DVD)).toEqual(draft);
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
