/**
 * Real sign-in, registration and profile completion.
 *
 * The screen this replaced switched to a local `READY` step the moment
 * `signInWithPassword` resolved. That proved a password was correct and nothing
 * else - not that the account was approved, not that its profile was finished,
 * not that it had not been suspended. Here there is no local "signed in" state
 * at all: every branch below is chosen from the access snapshot the server
 * produced, and the only thing this component can do is ask the provider to
 * reload it.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useAccess } from '@/auth/AccessProvider';
import { accessObstacle } from '@/auth/access';
import {
  loadOwnOrganizationMemberships,
  type OwnOrganizationMembership,
} from '@/auth/directory';
import {
  MULTI_SERVICE_ADMIN_AVAILABLE,
  PASSWORD_RESET_AVAILABLE,
  completeOwnProfile,
  registerWithEmail,
  signInWithEmail,
} from '@/auth/supabaseClient';
import { isPlausibleFullName } from '@/access/policy';
import {
  isValidProfileBirthDate,
  localTodayIso,
  normalizeProfilePhone,
} from '@/auth/profile';
import { useText } from '@/i18n/useText';
import { Field, Notice } from './primitives';
import { PasswordRecovery } from './PasswordRecovery';

type Mode = 'SIGN_IN' | 'REGISTER';

export function AccountAccessSetup() {
  const t = useText();
  const { access, reload, signOut } = useAccess();
  const [recovering, setRecovering] = useState(false);
  const [mode, setMode] = useState<Mode>('SIGN_IN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [ownMemberships, setOwnMemberships] = useState<
    readonly OwnOrganizationMembership[] | null | undefined
  >(MULTI_SERVICE_ADMIN_AVAILABLE ? null : []);
  /**
   * How many times in a row the server could not be reached.
   *
   * Counted here rather than in the data layer because the right sentence
   * depends on it: once is a passing network, twice on a device that is
   * otherwise online is usually something blocking the request. Reset by a
   * success or by any answer the server actually gave.
   */
  const [unreachableRuns, setUnreachableRuns] = useState(0);

  const obstacle = accessObstacle(access);
  const signedInUserId = access.kind === 'SIGNED_IN' ? access.userId : null;

  useEffect(() => {
    let cancelled = false;
    if (!MULTI_SERVICE_ADMIN_AVAILABLE || signedInUserId === null) {
      setOwnMemberships([]);
      return () => {
        cancelled = true;
      };
    }

    setOwnMemberships(null);
    void loadOwnOrganizationMemberships()
      .then((memberships) => {
        if (!cancelled) setOwnMemberships(memberships);
      })
      .catch(() => {
        // Membership display grants nothing. Keep failure distinct from an
        // empty citizen membership so an SZS user is never mislabeled merely
        // because this secondary read failed.
        if (!cancelled) setOwnMemberships(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [signedInUserId]);

  const szsMembership = ownMemberships?.find(
    (membership) => membership.organization === 'SZS',
  );
  const membershipSummary = (() => {
    if (ownMemberships === null) return t.accountAccess.checkingServices;
    if (ownMemberships === undefined) return t.accountAccess.servicesUnavailable;
    if (ownMemberships.length === 0) return t.accountAccess.noServiceMembership;
    return ownMemberships
      .map(
        (membership) =>
          `${t.accounts.organizationLabel[membership.organization]} — ${t.accounts.roleLabel[membership.role]}`,
      )
      .join(' · ');
  })();

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setMessage('');
    setPassword('');
    setConfirmPassword('');
    setUnreachableRuns(0);
  }

  /**
   * One sentence for a failed attempt, chosen without ever reading the error.
   *
   * A refusal is an answer and stays generic: a different message for "no such
   * address" and "wrong password" would turn this form into a way to test who
   * belongs to the society. A failure to REACH the server is not an answer at
   * all, so saying so leaks nothing - the request never got there to be judged.
   *
   * Nothing built from the error itself reaches the screen. These are fixed
   * strings, which is what guarantees no raw Supabase message, request URL, key
   * or token can ever be displayed.
   */
  function explain(outcome: { readonly unreachable?: boolean }): string {
    if (outcome.unreachable !== true) {
      setUnreachableRuns(0);
      return t.accountAccess.credentialError;
    }
    const runs = unreachableRuns + 1;
    setUnreachableRuns(runs);
    return runs >= 2 ? t.accountAccess.networkBlocked : t.accountAccess.networkError;
  }

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError(t.accountAccess.invalidEmail);
      return;
    }
    let normalizedPhone: string | null = null;
    if (mode === 'REGISTER') {
      if (!isPlausibleFullName(fullName)) {
        setError(t.accountAccess.invalidFullName);
        return;
      }
      normalizedPhone = normalizeProfilePhone(phone);
      if (normalizedPhone === null) {
        setError(t.accountAccess.invalidPhone);
        return;
      }
      if (!isValidProfileBirthDate(dateOfBirth)) {
        setError(t.accountAccess.invalidBirthDate);
        return;
      }
      if (password.length < 12) {
        setError(t.accountAccess.shortPassword);
        return;
      }
      if (password !== confirmPassword) {
        setError(t.accountAccess.passwordMismatch);
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'SIGN_IN') {
        const outcome = await signInWithEmail(email, password);
        setPassword('');
        if (!outcome.ok) {
          setError(explain(outcome));
          return;
        }
        setUnreachableRuns(0);
        // The provider reloads from the server; nothing here decides access.
        await reload();
        return;
      }

      const outcome = await registerWithEmail(email, password, {
        fullName,
        phone: normalizedPhone!,
        dateOfBirth,
      });
      setPassword('');
      setConfirmPassword('');
      if (!outcome.ok) {
        setError(explain(outcome));
        return;
      }
      setUnreachableRuns(0);
      if (outcome.sessionStarted) {
        await reload();
        return;
      }
      // Deliberately one message for "already registered" and "confirmation
      // required": telling them apart would turn this form into a way to test
      // whether an address belongs to a member of the society.
      setMode('SIGN_IN');
      setMessage(
        t.accountAccess.requestReceived,
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitProfile(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!isPlausibleFullName(fullName)) {
      setError(t.accountAccess.invalidFullName);
      return;
    }
    const normalizedPhone = normalizeProfilePhone(phone);
    if (normalizedPhone === null) {
      setError(t.accountAccess.invalidPhone);
      return;
    }
    if (!isValidProfileBirthDate(dateOfBirth)) {
      setError(t.accountAccess.invalidBirthDate);
      return;
    }
    setBusy(true);
    try {
      const outcome = await completeOwnProfile({
        fullName,
        phone: normalizedPhone,
        dateOfBirth,
      });
      if (!outcome.ok) {
        setError(t.accountAccess.profileSaveFailed);
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  if (recovering && obstacle === 'SIGN_IN_REQUIRED') {
    return <PasswordRecovery initialEmail={email} onBack={() => setRecovering(false)} />;
  }

  return (
    <section className="card account-connect" aria-labelledby="account-connect-h">
      <div className="card__head">
        <div>
          <p className="card__kicker">{t.accountAccess.kicker}</p>
          <h2 id="account-connect-h">{t.accountAccess.title}</h2>
        </div>
      </div>

      {message ? <Notice tone="info">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {obstacle === 'NOT_CONFIGURED' ? (
        <Notice tone="info">
          {t.accountAccess.notConfigured}
        </Notice>
      ) : null}

      {obstacle === 'LOADING' ? <p role="status">{t.accountAccess.checking}</p> : null}

      {obstacle === 'SERVER_UNREACHABLE' ? (
        <>
          <Notice tone="error">
            {t.accountAccess.serverUnavailable}
          </Notice>
          <button className="btn" type="button" onClick={() => void reload()} disabled={busy}>
            {t.accountAccess.retry}
          </button>
        </>
      ) : null}

      {obstacle === 'ACCOUNT_BROKEN' ? (
        <>
          <Notice tone="error">
            {t.accountAccess.accountBroken}
          </Notice>
          <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
            {t.accountAccess.signOut}
          </button>
        </>
      ) : null}

      {obstacle === 'SIGN_IN_REQUIRED' ? (
        <>
          <form className="account-auth-form" onSubmit={submitCredentials}>
            {mode === 'REGISTER' ? (
              <>
                <Field controlId="accountRegisterFullName" label={t.accountAccess.fullName} required>
                  {(props) => (
                    <input
                      {...props}
                      autoComplete="name"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                    />
                  )}
                </Field>
                <Field
                  controlId="accountRegisterPhone"
                  label={t.accountAccess.phone}
                  hint={t.accountAccess.phoneHint}
                  required
                >
                  {(props) => (
                    <input
                      {...props}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                    />
                  )}
                </Field>
              </>
            ) : null}
            <Field controlId="accountEmail" label={t.accountAccess.email} required>
              {(props) => (
                <input
                  {...props}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              )}
            </Field>
            {mode === 'REGISTER' ? (
              <Field controlId="accountBirthDate" label={t.accountAccess.birthDate} required>
                {(props) => (
                  <input
                    {...props}
                    type="date"
                    autoComplete="bday"
                    min="1900-01-01"
                    max={localTodayIso()}
                    value={dateOfBirth}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                  />
                )}
              </Field>
            ) : null}
            <Field
              controlId="accountPassword"
              label={t.accountAccess.password}
              hint={mode === 'REGISTER' ? t.accountAccess.passwordHint : undefined}
              required
            >
              {(props) => (
                <input
                  {...props}
                  type="password"
                  autoComplete={mode === 'REGISTER' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>
            {mode === 'REGISTER' ? (
              <Field controlId="accountConfirmPassword" label={t.accountAccess.confirmPassword} required>
                {(props) => (
                  <input
                    {...props}
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                )}
              </Field>
            ) : null}
            <div className="account-auth-actions">
              <button className="btn btn--primary" type="submit" disabled={busy}>
                {busy
                  ? t.accountAccess.wait
                  : mode === 'SIGN_IN'
                    ? t.accountAccess.signIn
                    : t.accountAccess.register}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => switchMode(mode === 'SIGN_IN' ? 'REGISTER' : 'SIGN_IN')}
                disabled={busy}
              >
                {mode === 'SIGN_IN' ? t.accountAccess.noAccount : t.accountAccess.haveAccount}
              </button>
            </div>
          </form>

          {PASSWORD_RESET_AVAILABLE ? (
            <button className="btn" type="button" disabled={busy} onClick={() => {
              setPassword('');
              setError('');
              setMessage('');
              setRecovering(true);
            }}>
              {t.recovery.forgot}
            </button>
          ) : (
            <Notice tone="info">
              {t.accountAccess.resetUnavailable}
            </Notice>
          )}
        </>
      ) : null}

      {obstacle === 'PROFILE_REQUIRED' ? (
        <form className="account-auth-form" onSubmit={submitProfile}>
          <Notice tone="info">
            {t.accountAccess.profileRequired}
          </Notice>
          <Field
            controlId="accountFullName"
            label={t.accountAccess.fullName}
            hint={t.accountAccess.displayOnly}
            required
          >
            {(props) => (
              <input
                {...props}
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            )}
          </Field>
          <Field
            controlId="accountPhone"
            label={t.accountAccess.phone}
            hint={t.accountAccess.phoneHint}
            required
          >
            {(props) => (
              <input
                {...props}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
          <Field controlId="accountProfileBirthDate" label={t.accountAccess.birthDate} required>
            {(props) => (
              <input
                {...props}
                type="date"
                autoComplete="bday"
                min="1900-01-01"
                max={localTodayIso()}
                value={dateOfBirth}
                onChange={(event) => setDateOfBirth(event.target.value)}
              />
            )}
          </Field>
          <div className="account-auth-actions">
            <button className="btn btn--primary" type="submit" disabled={busy}>
              {busy ? t.accountAccess.saving : t.accountAccess.saveProfile}
            </button>
            <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
              {t.accountAccess.signOut}
            </button>
          </div>
        </form>
      ) : null}

      {obstacle === 'SUSPENDED' ? (
        <>
          <Notice tone="error">
            {t.accountAccess.suspended}
          </Notice>
          <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
            {t.accountAccess.signOut}
          </button>
        </>
      ) : null}

      {obstacle === 'NO_SERVICE_ROLE' ? (
        <>
          {ownMemberships === null ? (
            <p role="status">{t.accountAccess.checkingServices}</p>
          ) : ownMemberships === undefined ? (
            <Notice tone="warn">{t.accountAccess.servicesUnavailable}</Notice>
          ) : (
            <Notice tone={szsMembership ? 'info' : 'warn'}>
              {szsMembership
                ? t.accountAccess.szsMembershipActive
                  .replace('{organization}', t.accounts.organizationLabel.SZS)
                  .replace('{role}', t.accounts.roleLabel[szsMembership.role])
                : t.accountAccess.citizenAccess}
            </Notice>
          )}
          <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
            {t.accountAccess.signOut}
          </button>
        </>
      ) : null}

      {obstacle === null && access.kind === 'SIGNED_IN' ? (
        <>
          <dl className="account-identity">
            <div>
              <dt>{t.accountAccess.signedInAs}</dt>
              <dd>{access.email}</dd>
            </div>
            <div>
              <dt>{t.accountAccess.fullName}</dt>
              <dd>{access.fullName ?? '-'}</dd>
            </div>
            <div>
              <dt>{t.accountAccess.serverRole}</dt>
              <dd>
                <strong>{access.role ? t.vocabulary.role[access.role] ?? access.role : t.accountAccess.unknownRole}</strong>
              </dd>
            </div>
            <div>
              <dt>{t.accountAccess.servicesAndRoles}</dt>
              <dd>{membershipSummary}</dd>
            </div>
          </dl>
          <p className="account-identity__note">
            {t.accountAccess.roleFromServer}
          </p>
          <div className="account-auth-actions">
            <button className="btn" type="button" onClick={() => void reload()} disabled={busy}>
              {t.accountAccess.checkAgain}
            </button>
            <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
              {t.accountAccess.signOut}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
