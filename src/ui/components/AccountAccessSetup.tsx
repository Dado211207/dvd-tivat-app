import { useState, type FormEvent } from 'react';
import {
  completeOwnProfile,
  isAccountBackendConfigured,
  registerWithEmail,
  signInWithEmail,
  signOut,
  verifyRegistrationCode,
} from '@/auth/supabaseClient';
import { isPlausibleFullName } from '@/access/policy';
import { Field, Notice } from './primitives';

type Step = 'SIGN_IN' | 'REGISTER' | 'VERIFY' | 'PROFILE' | 'READY';

function safeError(): string {
  return 'Radnja nije zavrsena. Provjerite podatke i pokusajte ponovo.';
}

export function AccountAccessSetup() {
  const configured = isAccountBackendConfigured();
  const [step, setStep] = useState<Step>('SIGN_IN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (!configured) {
    return (
      <section className="card account-connect" aria-labelledby="account-connect-h">
        <div className="card__head">
          <div><p className="card__kicker">Produkcioni nalog</p><h2 id="account-connect-h">Server jos nije povezan</h2></div>
        </div>
        <Notice tone="info">
          Forma za email, lozinku i kod je pripremljena u izvoru, ali se ovdje ne prikazuje dok
          namjenski server i email slanje nijesu podeseni. Ovaj lokalni prototip ne trazi stvarne podatke.
        </Notice>
      </section>
    );
  }

  function start(next: Step) {
    setStep(next);
    setError('');
    setMessage('');
    setPassword('');
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Unesite ispravnu email adresu.');
    if (password.length < 12) return setError('Lozinka mora imati najmanje 12 znakova.');
    setBusy(true);
    try {
      await registerWithEmail(email, password);
      setPassword('');
      setStep('VERIFY');
      setMessage('Kod je zatrazen. Provjerite email i unesite kod ispod.');
    } catch {
      setError(safeError());
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code.trim())) return setError('Unesite sestocifreni kod iz emaila.');
    setBusy(true);
    try {
      await verifyRegistrationCode(email, code);
      setCode('');
      setStep('PROFILE');
      setMessage('Email je potvrden. Sada unesite ime i prezime.');
    } catch {
      setError(safeError());
    } finally {
      setBusy(false);
    }
  }

  async function completeProfile(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!isPlausibleFullName(fullName)) return setError('Unesite ime i prezime.');
    setBusy(true);
    try {
      await completeOwnProfile(fullName);
      setStep('READY');
      setMessage('Nalog je aktivan kao gradjanin. Visu ulogu moze dodijeliti samo vlasnik sistema.');
    } catch {
      setError(safeError());
    } finally {
      setBusy(false);
    }
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      setPassword('');
      setStep('READY');
      setMessage('Prijava je uspjela.');
    } catch {
      setError(safeError());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card account-connect" aria-labelledby="account-connect-h">
      <div className="card__head">
        <div><p className="card__kicker">Povezani nalog</p><h2 id="account-connect-h">Prijava i registracija</h2></div>
      </div>
      {message ? <Notice tone="info">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {step === 'SIGN_IN' || step === 'REGISTER' ? (
        <form className="account-auth-form" onSubmit={step === 'SIGN_IN' ? signIn : register}>
          <Field controlId="accountEmail" label="Email" required>
            {(props) => <input {...props} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />}
          </Field>
          <Field controlId="accountPassword" label="Lozinka" hint={step === 'REGISTER' ? 'Najmanje 12 znakova.' : undefined} required>
            {(props) => <input {...props} type="password" autoComplete={step === 'REGISTER' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
          <div className="account-auth-actions">
            <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Molimo sacekajte...' : step === 'SIGN_IN' ? 'Prijavi se' : 'Posalji kod'}</button>
            <button className="btn" type="button" onClick={() => start(step === 'SIGN_IN' ? 'REGISTER' : 'SIGN_IN')}>
              {step === 'SIGN_IN' ? 'Napravi nalog' : 'Vec imam nalog'}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'VERIFY' ? (
        <form className="account-auth-form" onSubmit={verify}>
          <Field controlId="accountCode" label="Kod iz emaila" hint="Sest cifara. Kod ne dijelite ni sa kim." required>
            {(props) => <input {...props} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />}
          </Field>
          <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Provjeravam...' : 'Potvrdi email'}</button>
        </form>
      ) : null}

      {step === 'PROFILE' ? (
        <form className="account-auth-form" onSubmit={completeProfile}>
          <Field controlId="accountFullName" label="Ime i prezime" hint="Koristi se za prikaz. Ne daje vatrogasna prava." required>
            {(props) => <input {...props} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} />}
          </Field>
          <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Cuvam...' : 'Zavrsi profil'}</button>
        </form>
      ) : null}

      {step === 'READY' ? (
        <button
          className="btn"
          type="button"
          onClick={async () => {
            setBusy(true);
            try { await signOut(); start('SIGN_IN'); } catch { setError(safeError()); }
            finally { setBusy(false); }
          }}
          disabled={busy}
        >
          Odjavi se
        </button>
      ) : null}
    </section>
  );
}
