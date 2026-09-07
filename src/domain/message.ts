/**
 * Composes the call text.
 *
 * This function is used in TWO places and that is the point: the confirmation
 * preview shows exactly what this returns, and the reducer stores exactly what
 * this returns. There is no second code path that could make the preview differ
 * from the message that was recorded.
 */

import type { ExerciseKind } from './types';

export const KIND_LABEL: Record<ExerciseKind, string> = {
  VJEZBA: 'VJEZBA',
  TEST: 'TEST',
  SIMULIRANA_INTERVENCIJA: 'SIMULIRANA INTERVENCIJA',
};

export interface MessageInput {
  kind: ExerciseKind;
  title: string;
  instructions: string;
  incidentLocation: string;
  reporterLocation: string;
}

export function composeMessage(input: MessageInput): string {
  const lines: string[] = [
    `[${KIND_LABEL[input.kind]}] ${input.title.trim()}`,
    `Uputstvo: ${input.instructions.trim()}`,
    `Lokacija dogadjaja: ${input.incidentLocation.trim()}`,
  ];

  // Kept on its own labelled line. The reporter's location is never allowed to
  // read as the place of the event.
  const reporter = input.reporterLocation.trim();
  if (reporter.length > 0) {
    lines.push(`Lokacija prijavioca: ${reporter}`);
  }

  lines.push('Napomena: simulacija u prototipu. Poruka nije poslata nikome.');
  return lines.join('\n');
}
