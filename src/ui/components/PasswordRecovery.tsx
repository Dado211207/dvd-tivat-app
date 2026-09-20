import { useEffect, useRef, useState, type FormEvent } from 'react';
import { requestRecoveryCode, resetPasswordWithCode } from '@/auth/passwordRecovery';
import { useText } from '@/i18n/useText';
import { Field, Notice } from './primitives';

export function PasswordRecovery({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const t = useText();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [stage, setStage] = useState<'request' | 'code' | 'done'>('request');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const remaining = Math.max(0, Math.ceil((retryAt - clock) / 1000));

  useEffect(() => { heading.current?.focus(); }, [stage]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function sendCode() {
    if (submitting.current || Date.now() < retryAt) return;
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError(t.accountAccess.invalidEmail); return; }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await requestRecoveryCode(email);
      if (result === 'unreachable') {
        setError(t.accountAccess.networkError);
      } else {
        const now = Date.now();
        setClock(now);
        setRetryAt(now + 60_000);
        setCode('');
        setPassword('');
        setConfirmation('');
        setStage('code');
      }
    } finally { submitting.current = false; setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (stage === 'request') { await sendCode(); return; }
    if (stage !== 'code') return;
    setError('');
    if (!/^\d{6,10}$/.test(code.trim())) { setError(t.recovery.invalidCode); return; }
    if (password.length < 12) { setError(t.accountAccess.shortPassword); return; }
    if (password !== confirmation) { setError(t.recovery.mismatch); return; }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await resetPasswordWithCode(email, code, password);
      setCode(''); setPassword(''); setConfirmation('');
      if (result === 'ok') setStage('done');
      else setError(result === 'unreachable' ? t.accountAccess.networkError : result === 'update-failed' ? t.recovery.updateFailed : t.recovery.invalidCode);
    } finally { submitting.current = false; setBusy(false); }
  }

  return <section className="card account-connect" aria-labelledby="recovery-heading">
    <h2 id="recovery-heading" ref={heading} tabIndex={-1}>{t.recovery.title}</h2>
    {error ? <Notice tone="error">{error}</Notice> : null}
    {stage === 'done' ? <Notice tone="info">{t.recovery.done}</Notice> : <>
      <Notice tone="info">{stage === 'code' ? t.recovery.received : t.recovery.intro}</Notice>
      <form className="account-auth-form" onSubmit={submit} aria-busy={busy}>
        <Field controlId="recoveryEmail" label={t.accountAccess.email} required>{props =>
          <input {...props} type="email" autoComplete="email" value={email} disabled={busy || stage === 'code'} onChange={event => setEmail(event.target.value)} />
        }</Field>
        {stage === 'code' ? <>
          <Field controlId="recoveryCode" label={t.recovery.code} required>{props =>
            <input {...props} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} value={code} disabled={busy} onChange={event => setCode(event.target.value)} />
          }</Field>
          <Field controlId="recoveryPassword" label={t.recovery.newPassword} hint={t.accountAccess.passwordHint} required>{props =>
            <input {...props} type="password" autoComplete="new-password" minLength={12} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} />
          }</Field>
          <Field controlId="recoveryConfirmation" label={t.recovery.confirmPassword} required>{props =>
            <input {...props} type="password" autoComplete="new-password" minLength={12} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
          }</Field>
        </> : null}
        <div className="account-auth-actions">
          <button className="btn btn--primary" type="submit" disabled={busy || (stage === 'request' && remaining > 0)}>
            {busy ? t.accountAccess.wait : stage === 'request' ? t.recovery.send : t.recovery.save}
          </button>
          {stage === 'code' ? <>
            <button className="btn" type="button" disabled={busy || remaining > 0} onClick={() => void sendCode()}>{t.recovery.resend}</button>
            <button className="btn" type="button" disabled={busy} onClick={() => {
              setCode(''); setPassword(''); setConfirmation(''); setError(''); setStage('request');
            }}>{t.recovery.changeEmail}</button>
          </> : null}
        </div>
        {remaining > 0 ? <p>{t.recovery.cooldown.replace('{seconds}', String(remaining))}</p> : null}
      </form>
    </>}
    <button className="btn" type="button" disabled={busy} onClick={onBack}>{t.recovery.back}</button>
  </section>;
}
