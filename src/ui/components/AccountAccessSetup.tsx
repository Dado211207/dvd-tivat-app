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

import { useState, type FormEvent } from 'react';
import { useAccess } from '@/auth/AccessProvider';
import { accessObstacle } from '@/auth/access';
import {
  PASSWORD_RESET_AVAILABLE,
  completeOwnProfile,
  registerWithEmail,
  signInWithEmail,
} from '@/auth/supabaseClient';
import { isPlausibleFullName } from '@/access/policy';
import { Field, Notice } from './primitives';

type Mode = 'SIGN_IN' | 'REGISTER';

export function AccountAccessSetup() {
  const { access, reload, signOut } = useAccess();
  const [mode, setMode] = useState<Mode>('SIGN_IN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const obstacle = accessObstacle(access);

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setMessage('');
    setPassword('');
  }

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Unesite ispravnu email adresu.');
      return;
    }
    if (mode === 'REGISTER' && password.length < 12) {
      setError('Lozinka mora imati najmanje 12 znakova.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'SIGN_IN') {
        const outcome = await signInWithEmail(email, password);
        setPassword('');
        if (!outcome.ok) {
          setError(outcome.message ?? '');
          return;
        }
        // The provider reloads from the server; nothing here decides access.
        await reload();
        return;
      }

      const outcome = await registerWithEmail(email, password);
      setPassword('');
      if (!outcome.ok) {
        setError(outcome.message ?? '');
        return;
      }
      if (outcome.sessionStarted) {
        await reload();
        return;
      }
      // Deliberately one message for "already registered" and "confirmation
      // required": telling them apart would turn this form into a way to test
      // whether an address belongs to a member of the society.
      setMode('SIGN_IN');
      setMessage(
        'Zahtjev je primljen. Ako je ovo nova adresa, provjerite email za potvrdu. ' +
          'Ako nalog vec postoji, prijavite se postojecom lozinkom.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitProfile(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!isPlausibleFullName(fullName)) {
      setError('Unesite ime i prezime.');
      return;
    }
    setBusy(true);
    try {
      const outcome = await completeOwnProfile(fullName);
      if (!outcome.ok) {
        setError(outcome.message ?? '');
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

  return (
    <section className="card account-connect" aria-labelledby="account-connect-h">
      <div className="card__head">
        <div>
          <p className="card__kicker">Nalog na serveru</p>
          <h2 id="account-connect-h">Prijava i pristup</h2>
        </div>
      </div>

      {message ? <Notice tone="info">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {obstacle === 'NOT_CONFIGURED' ? (
        <Notice tone="info">
          Server nije podesen u ovoj verziji. Potrebno je popuniti adresu projekta i javni kljuc
          prema uputstvu u datoteci <code>.env.example</code>. Ovaj prototip ne trazi stvarne podatke
          dok server nije povezan.
        </Notice>
      ) : null}

      {obstacle === 'LOADING' ? <p role="status">Provjeravam pristup na serveru...</p> : null}

      {obstacle === 'SERVER_UNREACHABLE' ? (
        <>
          <Notice tone="error">
            Server trenutno nije dostupan, pa se prava pristupa ne mogu provjeriti. Dok provjera ne
            uspije, aplikacija ne dodjeljuje nikakav pristup.
          </Notice>
          <button className="btn" type="button" onClick={() => void reload()} disabled={busy}>
            Pokusaj ponovo
          </button>
        </>
      ) : null}

      {obstacle === 'ACCOUNT_BROKEN' ? (
        <>
          <Notice tone="error">
            Nalog postoji, ali njegov profil nije pronaden na serveru. Javite se vlasniku sistema;
            ovo se ne moze popraviti iz aplikacije.
          </Notice>
          <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
            Odjavi se
          </button>
        </>
      ) : null}

      {obstacle === 'SIGN_IN_REQUIRED' ? (
        <>
          <form className="account-auth-form" onSubmit={submitCredentials}>
            <Field controlId="accountEmail" label="Email" required>
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
            <Field
              controlId="accountPassword"
              label="Lozinka"
              hint={mode === 'REGISTER' ? 'Najmanje 12 znakova.' : undefined}
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
            <div className="account-auth-actions">
              <button className="btn btn--primary" type="submit" disabled={busy}>
                {busy
                  ? 'Molimo sacekajte...'
                  : mode === 'SIGN_IN'
                    ? 'Prijavi se'
                    : 'Napravi nalog'}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => switchMode(mode === 'SIGN_IN' ? 'REGISTER' : 'SIGN_IN')}
                disabled={busy}
              >
                {mode === 'SIGN_IN' ? 'Nemam nalog' : 'Vec imam nalog'}
              </button>
            </div>
          </form>

          {!PASSWORD_RESET_AVAILABLE ? (
            <Notice tone="info">
              Promjena zaboravljene lozinke jos nije dostupna: slanje emaila nije podeseno, pa bi
              takva forma samo izgledala kao da je nesto poslala. Do tada lozinku mijenja vlasnik
              sistema.
            </Notice>
          ) : null}
        </>
      ) : null}

      {obstacle === 'PROFILE_REQUIRED' ? (
        <form className="account-auth-form" onSubmit={submitProfile}>
          <Notice tone="info">
            Nalog je napravljen. Unesite ime i prezime da bi vlasnik znao ko trazi pristup.
          </Notice>
          <Field
            controlId="accountFullName"
            label="Ime i prezime"
            hint="Prikazni podatak. Ne daje nikakva vatrogasna prava."
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
          <div className="account-auth-actions">
            <button className="btn btn--primary" type="submit" disabled={busy}>
              {busy ? 'Cuvam...' : 'Sacuvaj profil'}
            </button>
            <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
              Odjavi se
            </button>
          </div>
        </form>
      ) : null}

      {obstacle === 'SUSPENDED' ? (
        <>
          <Notice tone="error">
            Pristup ovom nalogu je privremeno ukinut. Razlog je zapisan na serveru; obratite se
            vlasniku sistema.
          </Notice>
          <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
            Odjavi se
          </button>
        </>
      ) : null}

      {obstacle === 'AWAITING_APPROVAL' ? (
        <>
          <Notice tone="warn">
            Nalog je aktivan, ali jos nema nijedno pravo u sistemu. Samo vlasnik sistema moze
            dodijeliti ulogu. Do tada ne vidite nijedan operativni ekran.
          </Notice>
          <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
            Odjavi se
          </button>
        </>
      ) : null}

      {obstacle === null && access.kind === 'SIGNED_IN' ? (
        <>
          <dl className="account-identity">
            <div>
              <dt>Prijavljeni nalog</dt>
              <dd>{access.email}</dd>
            </div>
            <div>
              <dt>Ime i prezime</dt>
              <dd>{access.fullName ?? '-'}</dd>
            </div>
            <div>
              <dt>Uloga sa servera</dt>
              <dd>
                <strong>{access.role}</strong>
              </dd>
            </div>
          </dl>
          <p className="account-identity__note">
            Ulogu je dao server pri posljednjoj provjeri. Aplikacija je ne pamti i ne pretpostavlja.
          </p>
          <div className="account-auth-actions">
            <button className="btn" type="button" onClick={() => void reload()} disabled={busy}>
              Provjeri pristup ponovo
            </button>
            <button className="btn" type="button" onClick={() => void leave()} disabled={busy}>
              Odjavi se
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
