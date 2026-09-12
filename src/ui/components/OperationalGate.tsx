/**
 * The gate every real, server-backed operational screen sits behind.
 *
 * One place decides whether an operational screen may render, and it answers
 * from the server's snapshot only. The local actor selector has no influence
 * here whatsoever - it cannot reach this file, and the screens below it never
 * read it. That separation is the point: a demonstration control must never be
 * able to open a real screen.
 *
 * Hiding a screen is courtesy, not security. Every command underneath refuses
 * the same caller server-side, so this exists to explain *why* somebody is kept
 * out and what they can do about it - not to be the thing keeping them out.
 *
 * The obstacle list is `accessObstacle()`'s, plus one this file adds: an
 * approved account with no linked member record. That account has authority but
 * no operational identity, so a call-out cannot be addressed to it and it cannot
 * check in. It is a different problem from "no role" and needs a different
 * sentence - the administrator has to link it, and the person needs to be told
 * that rather than shown an empty screen.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { accessObstacle, hasOperationalAccess, type OperationalRole } from '@/auth/access';
import { useAccess } from '@/auth/AccessProvider';
import { fetchOwnMemberId } from '@/auth/operations';
import { Notice } from './primitives';
import { hrefFor } from '../router';

export interface OperationalContext {
  readonly role: OperationalRole;
  readonly userId: string;
  readonly fullName: string;
  /** Null when the account is approved but not linked to a member record. */
  readonly memberId: string | null;
}

type MemberLoad =
  | { readonly kind: 'LOADING' }
  | { readonly kind: 'READY'; readonly memberId: string | null }
  | { readonly kind: 'FAILED' };

export interface OperationalGateProps {
  /** Roles allowed to see this screen. The server still decides every command. */
  readonly allow: readonly OperationalRole[];
  /** Set when the screen cannot work without a linked member record. */
  readonly requiresMember?: boolean;
  readonly children: (context: OperationalContext) => ReactNode;
}

export function OperationalGate({ allow, requiresMember, children }: OperationalGateProps) {
  const { access, reload } = useAccess();
  const obstacle = accessObstacle(access);
  const [member, setMember] = useState<MemberLoad>({ kind: 'LOADING' });

  // Guards a slow read from overwriting a newer one, and a set after unmount.
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadMember = useCallback(async () => {
    const ticket = ++generation.current;
    setMember({ kind: 'LOADING' });
    try {
      const memberId = await fetchOwnMemberId();
      if (mounted.current && ticket === generation.current) setMember({ kind: 'READY', memberId });
    } catch {
      if (mounted.current && ticket === generation.current) setMember({ kind: 'FAILED' });
    }
  }, []);

  const signedInUserId = access.kind === 'SIGNED_IN' ? access.userId : null;
  useEffect(() => {
    if (!hasOperationalAccess(access)) {
      setMember({ kind: 'READY', memberId: null });
      return;
    }
    void loadMember();
    // Re-read when the account changes, not on every render of the snapshot.
  }, [signedInUserId, access, loadMember]);

  const retry = () => {
    void reload();
    void loadMember();
  };

  if (obstacle !== null) {
    return <Blocked obstacle={obstacle} onRetry={retry} />;
  }
  if (!hasOperationalAccess(access)) {
    // Unreachable while accessObstacle covers every roleless case; kept as a
    // fail-closed default rather than a cast that assumes it.
    return <Blocked obstacle="AWAITING_APPROVAL" onRetry={retry} />;
  }

  // `hasOperationalAccess` narrows the snapshot to SIGNED_IN but its `role` is
  // still typed nullable, because the server genuinely returns null for an
  // account with no operational grant. Check it rather than cast it: a cast
  // here would be asserting the exact thing this screen must not assume.
  const role = access.role;
  if (role === null) return <Blocked obstacle="AWAITING_APPROVAL" onRetry={retry} />;

  if (!allow.includes(role)) {
    return (
      <Notice tone="info">
        <strong>Ovaj ekran nije za vasu ulogu.</strong> Prijavljeni ste kao{' '}
        <strong>{ROLE_TEXT[role]}</strong>. Ovaj ekran koriste:{' '}
        {allow.map((r) => ROLE_TEXT[r]).join(', ')}. Server bi svaku radnju odavde ionako odbio.
      </Notice>
    );
  }

  if (member.kind === 'LOADING') {
    return <p role="status">Ucitavanje operativnih podataka...</p>;
  }
  if (member.kind === 'FAILED') {
    return (
      <Notice tone="error">
        <strong>Server trenutno nije dostupan.</strong> Podaci nisu ucitani, pa ovaj ekran ne
        prikazuje stanje.{' '}
        <button type="button" className="btn btn--ghost" onClick={retry}>
          Pokusaj ponovo
        </button>
      </Notice>
    );
  }

  if (requiresMember && member.memberId === null) {
    return (
      <Notice tone="warn">
        <strong>Vas nalog nije povezan sa clanom drustva.</strong> Zbog toga vas ne mozemo staviti
        na spisak pozvanih, niti mozete prijaviti svoje prisustvo. Administrator to povezuje na
        ekranu <strong>Evidencija drustva</strong>. Do tada ovaj ekran nema sta da prikaze za vas.{' '}
        <button type="button" className="btn btn--ghost" onClick={retry}>
          Provjeri ponovo
        </button>
      </Notice>
    );
  }

  return (
    <>
      {children({
        role,
        userId: access.userId,
        fullName: access.fullName ?? access.email,
        memberId: member.memberId,
      })}
    </>
  );
}

const ROLE_TEXT: Record<OperationalRole, string> = {
  OWNER: 'Vlasnik',
  ADMIN: 'Administrator',
  COMMANDER: 'Komandir',
  FIREFIGHTER: 'Vatrogasac',
};

/**
 * Why somebody is being kept out, and the one thing they can do next.
 *
 * Each case names an action rather than a state. "Niste prijavljeni" with no
 * route to the sign-in screen is a dead end on a phone at the station.
 */
function Blocked({ obstacle, onRetry }: { obstacle: string; onRetry: () => void }) {
  switch (obstacle) {
    case 'NOT_CONFIGURED':
      return (
        <Notice tone="warn">
          <strong>Ova kopija nije povezana sa serverom.</strong> Operativni ekrani rade samo kada su
          podeseni pristupni podaci projekta. Prototip i dalje radi lokalno.
        </Notice>
      );
    case 'LOADING':
      return <p role="status">Provjera pristupa...</p>;
    case 'SIGN_IN_REQUIRED':
      return (
        <Notice tone="info">
          <strong>Prijavite se da biste vidjeli ovaj ekran.</strong> Operativni podaci se citaju sa
          servera tek kada server potvrdi ko ste.{' '}
          <a className="btn btn--primary" href={hrefFor('nalozi')}>
            Idi na prijavu
          </a>
        </Notice>
      );
    case 'SERVER_UNREACHABLE':
      return (
        <Notice tone="error">
          <strong>Server nije dostupan.</strong> Ne prikazujemo nista umjesto stvarnog stanja, jer
          zastarjeli podaci na intervenciji su gori od praznog ekrana.{' '}
          <button type="button" className="btn btn--ghost" onClick={onRetry}>
            Pokusaj ponovo
          </button>
        </Notice>
      );
    case 'ACCOUNT_BROKEN':
      return (
        <Notice tone="error">
          <strong>Nalog nije potpun.</strong> Server nema vas profil. Javite se vlasniku naloga -
          ovo se ne popravlja iz aplikacije.
        </Notice>
      );
    case 'PROFILE_REQUIRED':
      return (
        <Notice tone="info">
          <strong>Dopunite profil.</strong> Upisite ime i prezime da bi vas server mogao prepoznati
          kao clana.{' '}
          <a className="btn btn--primary" href={hrefFor('nalozi')}>
            Dopuni profil
          </a>
        </Notice>
      );
    case 'SUSPENDED':
      return (
        <Notice tone="error">
          <strong>Vas pristup je ukinut.</strong> Operativni ekrani su zatvoreni, a server odbija
          svaku radnju. Razlog i vrijeme su zabiljezeni; javite se vlasniku naloga.
        </Notice>
      );
    case 'AWAITING_APPROVAL':
    default:
      return (
        <Notice tone="info">
          <strong>Nalog ceka odobrenje.</strong> Vlasnik dodjeljuje ulogu, i tek tada se operativni
          ekrani otvaraju.{' '}
          <button type="button" className="btn btn--ghost" onClick={onRetry}>
            Provjeri pristup ponovo
          </button>
        </Notice>
      );
  }
}
