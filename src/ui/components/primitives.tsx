/**
 * Small shared pieces.
 *
 * The rule these enforce: status is carried by TEXT plus a SYMBOL plus colour,
 * never by colour alone. Anyone with colour vision deficiency, and anyone
 * reading a screen on a sunlit station wall, gets the same information.
 */

import { useId, type ReactNode } from 'react';
import type { ExerciseStatus, MemberResponse, VehicleState } from '@/domain/types';
import {
  ANSWER_LABEL,
  ANSWER_SYMBOL,
  NO_ANSWER_LABEL,
  NO_ANSWER_SYMBOL,
  STATUS_LABEL,
  STATUS_SYMBOL,
  T,
  VEHICLE_STATE_LABEL,
  VEHICLE_STATE_SYMBOL,
} from '@/i18n/labels';

// ---------------------------------------------------------------------------

export function Chip({
  tone,
  symbol,
  children,
}: {
  tone: 'yes' | 'later' | 'no' | 'unknown' | 'alert' | 'accent' | 'neutral';
  symbol: string;
  children: ReactNode;
}) {
  return (
    <span className={`chip chip--${tone}`}>
      <span className="chip__sym" aria-hidden="true">
        {symbol}
      </span>
      <span>{children}</span>
    </span>
  );
}

/** One member's answer, or the absence of one. Silence is shown as silence. */
export function AnswerChip({ response }: { response: MemberResponse | undefined }) {
  if (!response) {
    return (
      <Chip tone="unknown" symbol={NO_ANSWER_SYMBOL}>
        {NO_ANSWER_LABEL}
      </Chip>
    );
  }

  const tone =
    response.answer === 'DOLAZIM' ? 'yes' : response.answer === 'DOLAZIM_KASNIJE' ? 'later' : 'no';

  const detail = [
    response.etaMinutes ? `${response.etaMinutes} min` : null,
    response.directToLocation ? 'direktno na lokaciju' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Chip tone={tone} symbol={ANSWER_SYMBOL[response.answer]}>
      {ANSWER_LABEL[response.answer]}
      {detail ? ` (${detail})` : ''}
    </Chip>
  );
}

export function StatusChip({ status }: { status: ExerciseStatus }) {
  const tone =
    status === 'ZAVRSENA'
      ? 'neutral'
      : status === 'OTKAZANA'
        ? 'no'
        : status === 'OTVORENA'
          ? 'alert'
          : 'accent';

  return (
    <Chip tone={tone} symbol={STATUS_SYMBOL[status]}>
      {STATUS_LABEL[status]}
    </Chip>
  );
}

export function VehicleChip({ state }: { state: VehicleState }) {
  return (
    <Chip tone={state === 'NA_ZADATKU' ? 'accent' : 'neutral'} symbol={VEHICLE_STATE_SYMBOL[state]}>
      {VEHICLE_STATE_LABEL[state]}
    </Chip>
  );
}

// ---------------------------------------------------------------------------

export function Total({
  tone,
  value,
  label,
  className,
}: {
  tone: 'yes' | 'later' | 'no' | 'unknown';
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <div className={`total total--${tone} ${className ?? ''}`}>
      <div className="total__num">{value}</div>
      <div className="total__label">{label}</div>
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: 'info' | 'error' | 'warn';
  children: ReactNode;
}) {
  const symbol = tone === 'error' ? '!' : tone === 'warn' ? '*' : 'i';
  return (
    <div className={`notice notice--${tone}`}>
      <span className="notice__sym" aria-hidden="true">
        {symbol}
      </span>
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children ? <p className="muted small">{children}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * A horizontally scrollable container that a keyboard user can actually scroll.
 *
 * Wide tables overflow at phone width. A scrollable box that cannot be focused
 * is unreachable without a mouse or a touch screen, so it takes a tab stop and,
 * where it has a name, a region role to announce what is being entered.
 */
export function ScrollRegion({
  label,
  className = 'table-wrap',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

interface FieldControlProps {
  id: string;
  'aria-invalid': boolean | undefined;
  'aria-describedby': string | undefined;
}

/**
 * Label, hint and error wired together. The control receives the ids it needs
 * so that a validation message is announced with the field rather than floating
 * somewhere unconnected.
 */
export function Field({
  label,
  hint,
  error,
  required,
  controlId,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** A stable id, so validation can move focus to this field. */
  controlId?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const generatedId = useId();
  const id = controlId ?? generatedId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={`field ${error ? 'field--invalid' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}{' '}
        <span className="field__req">({required ? T.required : T.optional})</span>
      </label>
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
      })}
      {error ? (
        <p className="field__error" id={errorId}>
          <span className="notice__sym" aria-hidden="true">
            !
          </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
