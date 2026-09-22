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
import { fetchOwnMemberId, type ReadFailure } from '@/auth/operations';
import { Notice } from './primitives';
import { hrefFor } from '../router';

export interface OperationalContext {
  readonly role: OperationalRole;
  readonly userId: string;
  readonly fullName: string;
  /** Null when the account is approved but not linked to a member record. */
  readonly memberId: string | null;
}

/**
 * Three answers, because there are three situations.
 *
 * `READY` with a null `memberId` means the server looked and found no member
 * record. `FAILED` means nobody looked. Those had the same representation until
 * `fetchOwnMemberId` stopped swallowing its error, and the consequence was that
 * a read which never happened rendered "your account is not linked to a member
 * of the society" - an assertion about the roster, made without reading it.
 *
 * `FAILED` carries the reason because the two reasons need different things
 * from the person: an outage is waited out, a refusal never resolves on its own
 * and has to be fixed with access rights on the server.
 */
type MemberLoad =
  | { readonly kind: 'LOADING' }
  | { readonly kind: 'READY'; readonly memberId: string | null }
  | { readonly kind: 'FAILED'; readonly reason: ReadFailure };

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
    // A failed BACKGROUND re-read keeps the last known answer. The screens
    // below report their own server errors; tearing the gate down over a
    // refresh that failed would lose the person's place for nothing.
    const keepOrFail = (reason: ReadFailure) => (current: MemberLoad): MemberLoad =>
      current.kind === 'READY' ? current : { kind: 'FAILED', reason };
    try {
      const result = await fetchOwnMemberId();
      if (!mounted.current || ticket !== generation.current) return;
      if (result.ok) setMember({ kind: 'READY', memberId: result.value });
      else setMember(keepOrFail(result.reason));
    } catch {
      // The read reports refusals and outages in its result now, so reaching
      // here means something below it threw - no network at all, or a client
      // library fault. Neither is the server refusing, so it is UNAVAILABLE.
      if (mounted.current && ticket === generation.current) setMember(keepOrFail('UNAVAILABLE'));
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
      // NOT `READY` with a null member. `READY` means the server answered about
      // this account, and nobody has asked it yet - an account still being
      // checked, or one with no operational role at all, is simply unread.
      //
      // While this said READY, the "keep the last known answer" rule below saw
      // a previous answer that had never been read, and a FIRST read that came
      // back refused was discarded in favour of it. The gate then rendered the
      // screen as though the account were linked. Nobody reads `member` on this
      // path - every roleless case is stopped by `Blocked` above - so the only
      // thing this state has to be is honest.
      setMember({ kind: 'LOADING' });
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
    return <Blocked obstacle="NO_DVD_ROLE" onRetry={retry} t={t} />;
  }

  // `hasOperationalAccess` narrows the snapshot to SIGNED_IN but its `role` is
  // still typed nullable, because the server genuinely returns null for an
  // account with no operational grant. Check it rather than cast it: a cast
  // here would be asserting the exact thing this screen must not assume.
  const role = access.role;
  if (role === null) return <Blocked obstacle="NO_DVD_ROLE" onRetry={retry} t={t} />;

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
    /*
     * Both reasons get a way out of this screen, and they say different things.
     *
     * The first draft removed the button on a refusal, reasoning that pressing
     * it could not change a server's "no" and would only invite somebody to
     * press it until they concluded the fault was theirs. That was wrong, and
     * for a dispatch screen it was the worse mistake: it left a firefighter
     * with NO action at all. The only way forward was to kill the application
     * and reopen it - on a phone, during a call-out.
     *
     * What actually prevents the pressing-it-forever trap is the sentence, not
     * the absence of a button. And the button is genuinely useful: `retry`
     * re-reads the access snapshot as well, so the moment an administrator
     * restores the grant, one press picks it up. Refusals are not permanent -
     * somebody changed something, and somebody can change it back.
     *
     * So the wording carries the difference. A refusal says the server answered
     * and refused, that waiting will not help, and who to ask; its button is
     * labelled "check again" rather than "try again", because what changes is
     * the access rights, not the attempt.
     */
    const refused = member.reason === 'REFUSED';
    return (
      <Notice tone="error" testId="member-check-failed">
        <strong>
          {refused ? t.gate.memberCheckRefusedTitle : t.gate.memberCheckFailedTitle}
        </strong>{' '}
        {refused ? t.gate.memberCheckRefusedText : t.gate.memberCheckFailedText}{' '}
        <button type="button" className="btn btn--ghost" onClick={retry}>
          {refused ? t.gate.recheck : t.gate.retry}
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
    case 'NO_DVD_ROLE':
    default:
      return (
        <Notice tone="info">
          <strong>{t.gate.noDvdRoleTitle}</strong> {t.gate.noDvdRoleText}{' '}
          <button type="button" className="btn btn--ghost" onClick={onRetry}>
            {t.gate.recheckAccess}
          </button>
        </Notice>
      );
  }
}
