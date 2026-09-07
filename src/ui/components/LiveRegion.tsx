/**
 * Announces command outcomes to assistive technology.
 *
 * Errors are assertive because a refused call-out must not go unnoticed;
 * confirmations are polite so they do not interrupt what is being read.
 * The `seq` counter re-renders identical text so a repeated outcome is
 * announced again rather than swallowed as "no change".
 */

import { useApp } from '@/state/AppStateContext';

export function LiveRegion() {
  const { notice } = useApp();

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {notice && notice.tone === 'info' ? <span key={notice.seq}>{notice.text}</span> : null}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive">
        {notice && notice.tone === 'error' ? <span key={notice.seq}>{notice.text}</span> : null}
      </div>
    </>
  );
}

/** The same outcome, shown visually. */
export function VisibleNotice() {
  const { notice } = useApp();
  if (!notice) return null;

  return (
    <div
      className={`notice notice--${notice.tone === 'error' ? 'error' : 'info'}`}
      data-testid="notice"
    >
      <span className="notice__sym" aria-hidden="true">
        {notice.tone === 'error' ? '!' : 'i'}
      </span>
      <div>{notice.text}</div>
    </div>
  );
}
