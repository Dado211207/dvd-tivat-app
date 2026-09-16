/**
 * A half-typed call-out, kept on the commander's own device until it is saved.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * Everything else on the commander's console is server state. This is the one
 * thing that is not: between opening the form and pressing "Sacuvaj nacrt"
 * there is no record anywhere, so a reload, a phone locking, an accidental back
 * gesture or the browser reclaiming the tab loses every word of it. During an
 * incident that is somebody retyping an address while a fire burns.
 *
 * React state already survives switching tabs and publishing, because every tab
 * panel stays mounted - see `CommandView`. It does not survive the page going
 * away, and that is what this covers.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT STORES, AND WHERE
 * ---------------------------------------------------------------------------
 *
 * Only the fields of an unsaved call-out, only in this browser's own storage,
 * and only until the draft reaches the server - `clearDraft` runs the moment
 * `createDraft` succeeds. Nothing is sent anywhere, nothing is shared between
 * devices, and nothing here is read by any other part of the application.
 *
 * It is operational text, so it is worth being plain about the trade: a shared
 * station tablet keeps one unsaved draft readable to the next person who opens
 * the console on it. That is the same exposure as leaving the form on screen,
 * it lasts only until the draft is saved, and it is a smaller cost than losing
 * an address mid-incident. A signed-out session is not a reason to keep it, so
 * anything that clears site data clears this too.
 *
 * Every accessor is wrapped: private windows, blocked site data and embedded
 * webviews all THROW on `localStorage` rather than returning null, and a
 * commander whose browser refuses storage must still get a working form.
 */

export const DRAFT_STORAGE_KEY = 'dvd-tivat.callout-draft';

export interface CallOutDraft {
  readonly kind: string;
  readonly otherNote: string;
  readonly title: string;
  readonly location: string;
  readonly assembly: string;
  readonly instructions: string;
}

export const EMPTY_DRAFT: CallOutDraft = {
  kind: 'POZAR',
  otherNote: '',
  title: '',
  location: '',
  assembly: '',
  instructions: '',
};

/** True once the commander has typed anything worth keeping. */
export function draftHasContent(draft: CallOutDraft): boolean {
  return (
    draft.title.trim() !== '' ||
    draft.location.trim() !== '' ||
    draft.assembly.trim() !== '' ||
    draft.instructions.trim() !== '' ||
    draft.otherNote.trim() !== ''
  );
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Read back whatever is there, trusting none of its shape.
 *
 * Stored JSON is data this code wrote, but a browser's storage is editable and
 * a previous version of this application may have written a different shape.
 * Every field is narrowed to a string, so a malformed entry degrades to an
 * empty form rather than putting `undefined` into a text input and detaching it
 * from React's control.
 */
export function readStoredDraft(): CallOutDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const draft: CallOutDraft = {
      kind: asString(record['kind']) === '' ? EMPTY_DRAFT.kind : asString(record['kind']),
      otherNote: asString(record['otherNote']),
      title: asString(record['title']),
      location: asString(record['location']),
      assembly: asString(record['assembly']),
      instructions: asString(record['instructions']),
    };
    // An entry holding nothing but a default kind is not a draft anybody wants
    // restored; it would only make the form look like it remembered something.
    return draftHasContent(draft) ? draft : null;
  } catch {
    return null;
  }
}

/** Returns whether it will survive a reload, so the screen can say so honestly. */
export function storeDraft(draft: CallOutDraft): boolean {
  try {
    if (!draftHasContent(draft)) {
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      return true;
    }
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Nothing to do and nothing to report: the draft is already on the server
    // by the time this runs, so a browser that refuses to forget costs nothing.
  }
}
