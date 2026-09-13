import type { Route } from '../router';

/** Original decorative line icons; the adjacent text supplies every label. */
export function NavIcon({ route }: { route: Route }) {
  const paths: Record<Route, JSX.Element> = {
    poziv: <><path d="M12 2a7 7 0 0 0-7 7c0 4 3 6 3 9h8c0-3 3-5 3-9a7 7 0 0 0-7-7Z" /><path d="M9 21h6" /></>,
    mobilizacija: <><path d="M12 21s-7-4.5-7-10a7 7 0 0 1 14 0c0 5.5-7 10-7 10Z" /><circle cx="12" cy="11" r="2.5" /></>,
    arhiva: <><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></>,
    dojava: <><path d="M12 3 3 20h18L12 3Z" /><path d="M12 9v4m0 3h.01" /></>,
    dezurni: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 15h7m-7 5h7" /></>,
    clan: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    vozila: <><path d="M3 6h11v12H3zM14 10h4l3 4v4h-7" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M5 3h5" /></>,
    prikaz: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M12 17v4m-5 0h10M6 8h5m-5 4h12" /></>,
    clanovi: <><circle cx="9" cy="7" r="3" /><path d="M2 21v-3a7 7 0 0 1 14 0v3m0-17a3 3 0 0 1 0 6m3 4a6 6 0 0 1 3 5v2" /></>,
    evidencija: <><path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /><path d="M14 4v6h6M7 13h8m-8 4h5" /></>,
    nalozi: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2.5" /><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 9h3m-3 4h3" /></>,
    istorija: <><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7m2-4v6l4 2" /></>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[route]}</svg>;
}
