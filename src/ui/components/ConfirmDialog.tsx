/**
 * Modal built on the native <dialog> element.
 *
 * Using the platform dialog rather than a hand-rolled one means focus trapping,
 * Escape handling, background inertness and the backdrop come from the browser.
 * Reimplementing those is where home-made modals usually become unusable with a
 * keyboard or a screen reader.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { T } from '@/i18n/labels';
import { ScrollRegion } from './primitives';

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmTone?: 'primary' | 'danger';
  confirmDisabled?: boolean;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  confirmTone = 'primary',
  confirmDisabled = false,
  cancelLabel = T.cancel,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Fires on Escape as well as dialog.close(); route it through the same
      // cancel path so state never drifts from what is on screen.
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className="dialog__head">
        <h2 className="dialog__title" id={titleId}>
          {title}
        </h2>
      </div>
      {/* The body scrolls on a small screen, and a scrollable region that cannot
          be focused is unreachable with a keyboard. */}
      <ScrollRegion className="dialog__body" label={title}>
        {children}
      </ScrollRegion>
      <div className="dialog__foot">
        <button type="button" className="btn" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn btn--${confirmTone}`}
          onClick={onConfirm}
          disabled={confirmDisabled}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
