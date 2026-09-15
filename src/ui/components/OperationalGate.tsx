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
import type { Strings } from '@/i18n/strings.me';
import { useText } from '@/i18n/useText';
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
  const t = useText();
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
    // Only the FIRST read may show a spinner. Once this gate has an answer it
    // keeps rendering `children` while it re-reads, because replacing them with
    // a spinner unmounts the whole screen underneath - and every `useState` in
    // it: the active tab, the selected intervention, half-typed text. That is
    // what made the application look like it reloaded on returning to the tab.
    setMember((current) => (current.kind === 'READY' ? current : { kind: 'LOADING' }));
    try {
      const memberId = await fetchOwnMemberId();
      if (mounted.current && ticket === generation.current) setMember({ kind: 'READY', memberId });
    } catch {
      if (mounted.current && ticket === generation.current) {
        // A failed BACKGROUND re-read keeps the last known answer. The screens
        // below report their own server errors; tearing the gate down over a
        // refresh that failed would lose the person's place for nothing.
        setMember((current) => (current.kind === 'READY' ? current : { kind: 'FAILED' }));
      }
    }
  }, []);

  // Keyed on WHAT THE SNAPSHOT SAYS, never on the object it says it in.
  // `loadAccess` builds a new object on every read - a token refresh, a tab
  // regaining focus - and depending on that object meant re-reading, and
  // remounting, every time the person came back to the application.
  const signedInUserId = access.kind === 'SIGNED_IN' ? access.userId : null;
  const signedInRole = access.kind === 'SIGNED_IN' ? access.role : null;
  const signedInStatus = access.kind === 'SIGNED_IN' ? access.accountStatus : null;
  const operational = hasOperationalAccess(access);
  useEffect(() => {
    if (!operational) {
      setMember({ kind: 'READY', memberId: null });
      return;
    }
    void loadMember();
  }, [operational, signedInUserId, signedInRole, signedInStatus, loadMember]);

  const retry = () => {
    void reload();
    void loadMember();
  };

  if (obstacle !== null) {
    return <Blocked obstacle={obstacle} onRetry={retry} t={t} />;
  }
  if (!hasOperationalAccess(access)) {
    // Unreachable while accessObstacle covers every roleless case; kept as a
    // fail-closed default rather than a cast that assumes it.
    return <Blocked obstacle="AWAITING_APPROVAL" onRetry={retry} t={t} />;
  }

  // `hasOperationalAccess` narrows the snapshot to SIGNED_IN but its `role` is
  // still typed nullable, because the server genuinely returns null for an
  // account with no operational grant. Check it rather than cast it: a cast
  // here would be asserting the exact thing this screen must not assume.
  const role = access.role;
  if (role === null) return <Blocked obstacle="AWAITING_APPROVAL" onRetry={retry} t={t} />;

  if (!allow.includes(role)) {
    // Named with the server's own meaning in both languages. "Komandir" is the
    // role that may publish a call-out, and "Commander" has to be that same
    // role - a refusal that softens what a role means is a refusal nobody can
    // act on.
    const roleName = (id: OperationalRole) => t.vocabulary.role[id] ?? id;
    return (
      <Notice tone="info">
        <strong>{t.gate.wrongRoleTitle}</strong> {t.gate.wrongRoleSignedInAs}{' '}
        <strong>{roleName(role)}</strong>. {t.gate.wrongRoleUsedBy}{' '}
        {allow.map(roleName).join(', ')}. {t.gate.wrongRoleServerWouldRefuse}
      </Notice>
    );
  }

  if (member.kind === 'LOADING') {
    return <p role="status">{t.gate.loadingOperational}</p>;
  }
  if (member.kind === 'FAILED') {
    return (
      <Notice tone="error">
        <strong>{t.gate.dataUnavailableTitle}</strong> {t.gate.dataUnavailableText}{' '}
        <button type="button" className="btn btn--ghost" onClick={retry}>
          {t.gate.retry}
        </button>
      </Notice>
    );
  }

  if (requiresMember && member.memberId === null) {
    return (
      <Notice tone="warn">
        <strong>{t.gate.noMemberTitle}</strong> {t.gate.noMemberText} {t.gate.noMemberUntilThen}{' '}
        <button type="button" className="btn btn--ghost" onClick={retry}>
          {t.gate.recheck}
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

/**
 * Why somebody is being kept out, and the one thing they can do next.
 *
 * Each case names an action rather than a state. "Niste prijavljeni" with no
 * route to the sign-in screen is a dead end on a phone at the station.
 *
 * The wording is the reason Settings sits outside every gate: somebody refused
 * here is precisely the person who most needs to be able to read the refusal,
 * and the language switch has to stay reachable from a screen like this one.
 */
function Blocked({
  obstacle,
  onRetry,
  t,
}: {
  obstacle: string;
  onRetry: () => void;
  t: Strings;
}) {
  switch (obstacle) {
    case 'NOT_CONFIGURED':
      return (
        <Notice tone="warn">
          <strong>{t.gate.notConfiguredTitle}</strong> {t.gate.notConfiguredText}
        </Notice>
      );
    case 'LOADING':
      return <p role="status">{t.gate.loadingAccess}</p>;
    case 'SIGN_IN_REQUIRED':
      return (
        <Notice tone="info">
          <strong>{t.gate.signInRequiredTitle}</strong> {t.gate.signInRequiredText}{' '}
          <a className="btn btn--primary" href={hrefFor('nalozi')}>
            {t.gate.goToSignIn}
          </a>
        </Notice>
      );
    case 'SERVER_UNREACHABLE':
      return (
        <Notice tone="error">
          <strong>{t.gate.serverUnreachableTitle}</strong> {t.gate.serverUnreachableText}{' '}
          <button type="button" className="btn btn--ghost" onClick={onRetry}>
            {t.gate.retry}
          </button>
        </Notice>
      );
    case 'ACCOUNT_BROKEN':
      return (
        <Notice tone="error">
          <strong>{t.gate.accountBrokenTitle}</strong> {t.gate.accountBrokenText}
        </Notice>
      );
    case 'PROFILE_REQUIRED':
      return (
        <Notice tone="info">
          <strong>{t.gate.profileRequiredTitle}</strong> {t.gate.profileRequiredText}{' '}
          <a className="btn btn--primary" href={hrefFor('nalozi')}>
            {t.gate.completeProfile}
          </a>
        </Notice>
      );
    case 'SUSPENDED':
      return (
        <Notice tone="error">
          <strong>{t.gate.suspendedTitle}</strong> {t.gate.suspendedText}
        </Notice>
      );
    case 'AWAITING_APPROVAL':
    default:
      return (
        <Notice tone="info">
          <strong>{t.gate.awaitingApprovalTitle}</strong> {t.gate.awaitingApprovalText}{' '}
          <button type="button" className="btn btn--ghost" onClick={onRetry}>
            {t.gate.recheckAccess}
          </button>
        </Notice>
      );
  }
}
