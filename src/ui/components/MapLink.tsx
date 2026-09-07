/**
 * Opening an external map is always a deliberate press.
 *
 * The prototype never opens a map automatically, never requests the device's
 * location, and never sends anything anywhere on its own. The link is built
 * from the typed incident text and nothing else.
 */

import { T } from '@/i18n/labels';

export function MapLink({ query }: { query: string }) {
  const trimmed = query.trim();
  if (trimmed === '') return null;

  const href = `https://www.openstreetmap.org/search?query=${encodeURIComponent(trimmed)}`;

  return (
    <a className="btn" href={href} target="_blank" rel="noopener noreferrer">
      {T.openInMaps}
      <span className="sr-only"> - {T.openInMapsHint}</span>
      <span aria-hidden="true">&#8599;</span>
    </a>
  );
}
