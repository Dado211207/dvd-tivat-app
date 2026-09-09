/**
 * Interaction prototype for the future account directory.
 *
 * The rows are fictional and local to this mounted view. Real identity, email
 * verification and role enforcement are specified in the production schema;
 * this screen exists so the owner can review the workflow before that backend
 * is connected.
 */

import { useMemo, useState } from 'react';
import {
  ASSIGNABLE_ROLES,
  canAssignRole,
  type AccountRole,
  type AccountSummary,
} from '@/access/policy';
import { useApp } from '@/state/AppStateContext';
import { Chip, EmptyState, Notice } from '../components/primitives';
import { AccountAccessSetup } from '../components/AccountAccessSetup';

const ROLE_LABEL: Record<AccountRole, string> = {
  OWNER: 'Vlasnik sistema',
  ADMIN: 'Administrator',
  COMMANDER: 'Komandir',
  FIREFIGHTER: 'Vatrogasac',
  CITIZEN: 'Gradjanin',
};

const STATUS_LABEL: Record<AccountSummary['status'], string> = {
  EMAIL_UNVERIFIED: 'Email nije potvrden',
  PROFILE_REQUIRED: 'Profil nije zavrsen',
  ACTIVE: 'Aktivan',
  SUSPENDED: 'Suspendovan',
};

const DEMO_ACCOUNTS: AccountSummary[] = [
  { id: 'owner-demo', fullName: 'Vlasnik sistema (demo)', role: 'OWNER', status: 'ACTIVE' },
  { id: 'account-demo-01', fullName: 'Probni Korisnik 01', role: 'CITIZEN', status: 'ACTIVE' },
  { id: 'account-demo-02', fullName: 'Probni Korisnik 02', role: 'FIREFIGHTER', status: 'ACTIVE' },
  { id: 'account-demo-03', fullName: 'Probni Korisnik 03', role: 'COMMANDER', status: 'ACTIVE' },
  { id: 'account-demo-04', fullName: 'Probni Korisnik 04', role: 'CITIZEN', status: 'EMAIL_UNVERIFIED' },
];

export function AccountsView() {
  const { state, announce } = useApp();
  const [accounts, setAccounts] = useState(DEMO_ACCOUNTS);
  const [query, setQuery] = useState('');
  const isOwnerSimulation = state.simulation.viewRole === 'ADMIN';
  const simulatedOwner: AccountSummary = {
    id: state.simulation.actorId,
    fullName: 'Simulirani vlasnik',
    role: isOwnerSimulation ? 'OWNER' : 'CITIZEN',
    status: 'ACTIVE',
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('me');
    if (!needle) return accounts;
    return accounts.filter((account) =>
      `${account.fullName} ${ROLE_LABEL[account.role]} ${STATUS_LABEL[account.status]}`
        .toLocaleLowerCase('me')
        .includes(needle),
    );
  }, [accounts, query]);

  function changeRole(accountId: string, nextRole: AccountRole) {
    if (!canAssignRole(simulatedOwner, nextRole)) {
      announce('Samo vlasnik sistema moze dodjeljivati uloge.', 'error');
      return;
    }
    setAccounts((current) => current.map((account) =>
      account.id === accountId ? { ...account, role: nextRole } : account,
    ));
    announce(`Probna uloga je promijenjena u: ${ROLE_LABEL[nextRole]}.`);
  }

  return (
    <>
      <h1 className="sr-only">Nalozi i pristup</h1>
      <Notice tone="warn">
        Ovo je pregled nacina rada sa izmisljenim nalozima. Nije prava registracija i ne salje
        email. Produkcioni nalog ce se cuvati na serveru i provjeravati pri svakom zahtjevu.
      </Notice>

      <AccountAccessSetup />

      <section className="account-flow" aria-labelledby="account-flow-h">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Registracija</p>
            <h2 id="account-flow-h">Kako novi nalog postaje aktivan</h2>
          </div>
        </div>
        <ol className="account-steps">
          <li><span>1</span><strong>Email i lozinka</strong><small>Korisnik sam kreira nalog.</small></li>
          <li><span>2</span><strong>Kod na email</strong><small>Bez potvrde nema pristupa aplikaciji.</small></li>
          <li><span>3</span><strong>Ime i prezime</strong><small>Prikazni podatak, ne dokaz identiteta.</small></li>
          <li><span>4</span><strong>Gradjanin</strong><small>Svaki novi nalog dobija najmanja prava.</small></li>
          <li><span>5</span><strong>Odobrenje vlasnika</strong><small>Samo vlasnik moze dodijeliti visu ulogu.</small></li>
        </ol>
      </section>

      <section className="card account-directory" aria-labelledby="account-directory-h">
        <div className="card__head">
          <div>
            <p className="card__kicker">Samo vlasnik sistema</p>
            <h2 id="account-directory-h">Svi registrovani nalozi</h2>
          </div>
          <Chip tone="neutral" symbol="#">{accounts.length} probnih naloga</Chip>
        </div>

        {!isOwnerSimulation ? (
          <Notice tone="info">
            Ovaj spisak je sakriven. U simulaciji izaberite administratora drustva da pregledate
            vlasnicki panel. U produkciji se provjera radi na serveru.
          </Notice>
        ) : (
          <>
            <label className="account-search">
              <span>Pretrazi po imenu, ulozi ili statusu</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" />
            </label>

            {filtered.length === 0 ? (
              <EmptyState title="Nema rezultata">Promijenite pojam za pretragu.</EmptyState>
            ) : (
              <div className="account-table-wrap">
                <table className="account-table">
                  <thead><tr><th>Ime i prezime</th><th>Status</th><th>Uloga</th></tr></thead>
                  <tbody>
                    {filtered.map((account) => (
                      <tr key={account.id}>
                        <td><strong>{account.fullName}</strong><small>ID naloga: {account.id}</small></td>
                        <td>
                          <Chip
                            tone={account.status === 'ACTIVE' ? 'yes' : 'later'}
                            symbol={account.status === 'ACTIVE' ? '+' : '!'}
                          >
                            {STATUS_LABEL[account.status]}
                          </Chip>
                        </td>
                        <td>
                          {account.role === 'OWNER' ? (
                            <strong>{ROLE_LABEL.OWNER}</strong>
                          ) : (
                            <select
                              aria-label={`Uloga za ${account.fullName}`}
                              value={account.role}
                              disabled={account.status !== 'ACTIVE'}
                              onChange={(event) => changeRole(account.id, event.target.value as AccountRole)}
                            >
                              {ASSIGNABLE_ROLES.map((role) => (
                                <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                              ))}
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
