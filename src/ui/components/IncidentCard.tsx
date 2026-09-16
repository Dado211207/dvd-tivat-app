/**
 * ONE presentation of an incident, shared by everybody who looks at one.
 *
 * The firefighter and the commander were reading the same four facts in two
 * completely different shapes: the firefighter got a large card led by the
 * title, the commander got a definition list with an uppercase label column
 * beside every value. On a 390px phone that list gave each value roughly half
 * the width, so a location wrapped to three lines next to a label sitting on
 * one - and a commander and a firefighter standing next to each other at an
 * incident were looking at two different-looking descriptions of it.
 *
 * Whoever is reading, the questions are the same and in the same order: what
 * happened, where, where do we gather, what are we told to do. So there is one
 * component and one answer.
 *
 * The heading is an `h2` styled as the largest thing on the screen. Heading
 * level is structure, not size; the page's single `h1` belongs to the shell.
 */

import { type Intervention } from '@/auth/operations';
import { formatTime } from '@/i18n/labels';
import { useText } from '@/i18n/useText';
import { Notice } from './primitives';

export interface IncidentCardProps {
  readonly intervention: Intervention;
  /**
   * Prefix for this card's test ids and heading id.
   *
   * Two screens, two long-standing conventions in the suites that watch them -
   * `callout-title` on the firefighter's screen, `selected-location` on the
   * commander's. Renaming either would have meant editing tests to match a
   * refactor, which is how a refactor stops being checked by them.
   */
  readonly testId?: string;
}

export function IncidentCard({ intervention, testId = 'callout' }: IncidentCardProps) {
  const t = useText();
  const titleId = `${testId}-incident-title`;

  /*
   * CLOSED and CANCELLED, not "not open".
   *
   * `isOpenStatus` answers a different question - is this intervention running -
   * and a DRAFT is not running either. Reading the notice off it told a
   * commander looking at their own unpublished draft that "this intervention is
   * closed and cannot be changed", which is false and is the opposite of what
   * they are about to do with it. The firefighter's screen never sees a draft,
   * so sharing this component with the console is what surfaced it.
   */
  const finished = intervention.status === 'CLOSED' || intervention.status === 'CANCELLED';

  return (
    <section className="incident" aria-labelledby={titleId}>
      <p className="incident__kind">
        {t.vocabulary.interventionKind[intervention.kind] ?? intervention.kind}
        {intervention.otherKindNote ? ` - ${intervention.otherKindNote}` : ''}
      </p>
      <h2 className="incident__title" id={titleId} data-testid={`${testId}-title`}>
        {intervention.title}
      </h2>
      <p className="incident__where" data-testid={`${testId}-location`}>
        {intervention.incidentLocation}
      </p>
      {intervention.assemblyPoint ? (
        <p className="incident__assembly">
          <span className="incident__assembly-label">{t.mobilisation.assembly}</span>
          <strong>{intervention.assemblyPoint}</strong>
        </p>
      ) : null}
      <p className="incident__instructions">{intervention.instructions}</p>
      {/* "Objavljeno - objavljeno 13.09.2026." is what this printed before: the
          status label and the publication-time label are the same word, so the
          time carries the meaning on its own once the status is beside it. */}
      <p className="incident__meta">
        {t.vocabulary.interventionStatus[intervention.status] ?? intervention.status}
        {intervention.publishedAt ? ` - ${formatTime(intervention.publishedAt)}` : ''}
      </p>
      {finished ? <Notice tone="info">{t.callout.closedNotice}</Notice> : null}
    </section>
  );
}
