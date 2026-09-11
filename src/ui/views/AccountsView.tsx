/**
 * The real account directory.
 *
 * Everything on this screen is a live account on the server. There is no
 * simulated owner: the previous version granted the owner panel to anybody who
 * picked "administrator" in the actor selector, which made the most sensitive
 * screen in the application the easiest one to reach.
 *
 * The screen is hidden from anybody the server does not call `OWNER`, but that
 * is only tidiness. The enforcement is that `owner_set_role` and
 * `owner_set_account_active` refuse a non-owner, that the read policies return
 * zero rows to one, and that a suspension without a reason is refused outright.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ASSIGNABLE_ROLES, type AccountRole, type AccountStatus } from '@/access/policy';
import { useAccess } from '@/auth/AccessProvider';
import { accessObstacle } from '@/auth/access';
import {
  loadDirectory,
  loadRoleAudit,
  loadStatusAudit,
  setAccountActive,
  setAccountRole,
  statusOf,
  type DirectoryAccount,
  type RoleAuditEntry,
  type StatusAuditEntry,
} from '@/auth/directory';
import { useApp } from '@/state/AppStateContext';
import { Chip, EmptyState, Notice } from '../components/primitives';
import { AccountAccessSetup } from '../components/AccountAccessSetup';
import { RequireRole } from '../components/RequireRole';

const ROLE_LABEL: Record<AccountRole, string> = {
  OWNER: 'Vlasnik sistema',
  ADMIN: 'Administrator',
  COMMANDER: 'Komandir',
  FIREFIGHTER: 'Vatrogasac',
  PENDING: 'Ceka odobrenje',
  CITIZEN: 'Gradjanin (stara oznaka)',
};

const STATUS_LABEL: Record<AccountStatus, string> = {
  UNKNOWN: 'Nepoznato',
  PROFILE_REQUIRED: 'Profil nije zavrsen',
  ACTIVE: 'Aktivan',
  SUSPENDED: 'Pristup ukinut',
};

function formatMoment(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('sr-Latn-ME', { timeZone: 'Europe/Podgorica' });
}

export function AccountsView() {
  const { access } = useAccess();

  return (
    <>
      <h1 className="sr-only">Nalozi i pristup</h1>
      <AccountAccessSetup />
      <RequireRole
        allow={['OWNER']}
        refused={
          <section className="card account-directory" aria-labelledby="account-directory-h">
            <div className="card__head">
              <div>
                <p className="card__kicker">Samo vlasnik sistema</p>
                <h2 id="account-directory-h">Spisak naloga</h2>
              </div>
            </div>
            <Notice tone="info">
              {accessObstacle(access) === 'SIGN_IN_REQUIRED'
                ? 'Spisak naloga se ne prikazuje dok se ne prijavite.'
                : 'Ovaj spisak vidi samo vlasnik sistema. Server ne salje ove redove nikome ' +
                  'drugom, pa ovdje nema sta da se sakrije - jednostavno ne stizu.'}
            </Notice>
          </section>
        }
      >
        {access.kind === 'SIGNED_IN' ? <OwnerDirectory ownUserId={access.userId} /> : null}
      </RequireRole>
      <RegistrationExplainer />
    </>
  );
}

function OwnerDirectory({ ownUserId }: { readonly ownUserId: string }) {
  const { announce } = useApp();
  const [accounts, setAccounts] = useState<DirectoryAccount[] | null>(null);
  const [roleAudit, setRoleAudit] = useState<RoleAuditEntry[]>([]);
  const [statusAudit, setStatusAudit] = useState<StatusAuditEntry[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [directory, roles, statuses] = await Promise.all([
        loadDirectory(),
        loadRoleAudit(),
        loadStatusAudit(),
      ]);
      setAccounts(directory);
      setRoleAudit(roles);
      setStatusAudit(statuses);
    } catch {
      setAccounts([]);
      setError('Spisak naloga nije mogao biti ucitan sa servera.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('sr');
    if (!needle || accounts === null) return accounts ?? [];
    return accounts.filter((account) =>
      `${account.fullName ?? ''} ${account.email} ${ROLE_LABEL[account.role]} ${
        STATUS_LABEL[statusOf(account)]
      }`
        .toLocaleLowerCase('sr')
        .includes(needle),
    );
  }, [accounts, query]);

  async function changeRole(account: DirectoryAccount, nextRole: AccountRole) {
    setBusyUserId(account.userId);
    setError('');
    try {
      const outcome = await setAccountRole(account.userId, nextRole);
      if (!outcome.ok) {
        setError(outcome.message ?? '');
        announce(outcome.message ?? 'Promjena nije sacuvana.', 'error');
        return;
      }
      announce(`Uloga je promijenjena u: ${ROLE_LABEL[nextRole]}.`);
      await refresh();
    } finally {
      setBusyUserId(null);
    }
  }

  async function changeActive(account: DirectoryAccount, active: boolean) {
    const reason = (reasonDraft[account.userId] ?? '').trim();
    // Checked here only so the person is told before a round trip. The server
    // refuses REASON_REQUIRED regardless, and that refusal is the real rule.
    if (reason.length < 2) {
      setError('Razlog je obavezan: upisite zasto se pristup mijenja.');
      announce('Razlog je obavezan.', 'error');
      return;
    }
    setBusyUserId(account.userId);
    setError('');
    try {
      const outcome = await setAccountActive(account.userId, active, reason);
      if (!outcome.ok) {
        setError(outcome.message ?? '');
        announce(outcome.message ?? 'Promjena nije sacuvana.', 'error');
        return;
      }
      setReasonDraft((current) => ({ ...current, [account.userId]: '' }));
      announce(active ? 'Pristup je vracen.' : 'Pristup je ukinut.');
      await refresh();
    } finally {
      setBusyUserId(null);
    }
  }

  const nameOf = (userId: string): string => {
    const account = accounts?.find((candidate) => candidate.userId === userId);
    return account?.fullName ?? account?.email ?? userId;
  };

  return (
    <>
      <section className="card account-directory" aria-labelledby="account-directory-h">
        <div className="card__head">
          <div>
            <p className="card__kicker">Samo vlasnik sistema</p>
            <h2 id="account-directory-h">Svi registrovani nalozi</h2>
          </div>
          <Chip tone="neutral" symbol="#">
            {accounts?.length ?? 0} naloga
          </Chip>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Notice tone="warn">
          Ovo su stvarni nalozi na serveru. Svaka izmjena odmah mijenja necije pravo pristupa i
          zapisuje se u trajnu evidenciju ispod.
        </Notice>

        <label className="account-search">
          <span>Pretrazi po imenu, emailu, ulozi ili statusu</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            disabled={accounts === null}
          />
        </label>

        {accounts === null ? (
          <p role="status">Ucitavam naloge sa servera...</p>
        ) : filtered.length === 0 ? (
          <EmptyState title="Nema rezultata">
            {accounts.length === 0
              ? 'Server nije vratio nijedan nalog.'
              : 'Promijenite pojam za pretragu.'}
          </EmptyState>
        ) : (
          <div className="account-table-wrap">
            <table className="account-table">
              <thead>
                <tr>
                  <th scope="col">Nalog</th>
                  <th scope="col">Status</th>
                  <th scope="col">Uloga</th>
                  <th scope="col">Pristup</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((account) => {
                  const status = statusOf(account);
                  const isSelf = account.userId === ownUserId;
                  const isOwnerRow = account.role === 'OWNER';
                  const locked = isSelf || isOwnerRow;
                  const busy = busyUserId === account.userId;
                  return (
                    <tr key={account.userId}>
                      <th scope="row">
                        <strong>{account.fullName ?? 'Ime nije uneseno'}</strong>
                        <small>{account.email}</small>
                      </th>
                      <td>
                        <Chip
                          tone={status === 'ACTIVE' ? 'yes' : status === 'SUSPENDED' ? 'no' : 'later'}
                          symbol={status === 'ACTIVE' ? '+' : status === 'SUSPENDED' ? '-' : '!'}
                        >
                          {STATUS_LABEL[status]}
                        </Chip>
                      </td>
                      <td>
                        {locked ? (
                          <>
                            <strong>{ROLE_LABEL[account.role]}</strong>
                            <small>
                              {isSelf
                                ? 'Sopstveni nalog se ne mijenja odavde.'
                                : 'Vlasnicki nalog je zasticen.'}
                            </small>
                          </>
                        ) : (
                          <select
                            aria-label={`Uloga za ${account.fullName ?? account.email}`}
                            value={ASSIGNABLE_ROLES.includes(
                              account.role as (typeof ASSIGNABLE_ROLES)[number],
                            )
                              ? account.role
                              : 'PENDING'}
                            disabled={busy}
                            onChange={(event) =>
                              void changeRole(account, event.target.value as AccountRole)
                            }
                          >
                            {account.role === 'CITIZEN' ? (
                              <option value="CITIZEN">{ROLE_LABEL.CITIZEN}</option>
                            ) : null}
                            {ASSIGNABLE_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {ROLE_LABEL[role]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {locked ? (
                          <small>-</small>
                        ) : (
                          <div className="account-access-cell">
                            <label>
                              <span className="sr-only">
                                Razlog za promjenu pristupa: {account.fullName ?? account.email}
                              </span>
                              <input
                                type="text"
                                placeholder="Razlog (obavezno)"
                                value={reasonDraft[account.userId] ?? ''}
                                disabled={busy}
                                onChange={(event) =>
                                  setReasonDraft((current) => ({
                                    ...current,
                                    [account.userId]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <button
                              className={account.active ? 'btn btn--danger' : 'btn'}
                              type="button"
                              disabled={busy}
                              onClick={() => void changeActive(account, !account.active)}
                            >
                              {account.active ? 'Ukini pristup' : 'Vrati pristup'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="account-audit-h">
        <div className="card__head">
          <div>
            <p className="card__kicker">Trajna evidencija</p>
            <h2 id="account-audit-h">Promjene uloga i pristupa</h2>
          </div>
        </div>
        {roleAudit.length === 0 && statusAudit.length === 0 ? (
          <EmptyState title="Jos nema zapisa">
            Evidencija se popunjava sama kad se uloga ili pristup promijene.
          </EmptyState>
        ) : (
          <ul className="audit-list">
            {roleAudit.map((entry) => (
              <li key={`role-${entry.id}`}>
                <strong>{nameOf(entry.targetUserId)}</strong>: uloga {entry.previousRole} -&gt;{' '}
                {entry.nextRole}
                <small>{formatMoment(entry.changedAt)}</small>
              </li>
            ))}
            {statusAudit.map((entry) => (
              <li key={`status-${entry.id}`}>
                <strong>{nameOf(entry.targetUserId)}</strong>:{' '}
                {entry.nextActive ? 'pristup vracen' : 'pristup ukinut'} - {entry.reason}
                <small>{formatMoment(entry.changedAt)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function RegistrationExplainer() {
  return (
    <section className="account-flow" aria-labelledby="account-flow-h">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Registracija</p>
          <h2 id="account-flow-h">Kako novi nalog dobija pristup</h2>
        </div>
      </div>
      <ol className="account-steps">
        <li>
          <span>1</span>
          <strong>Email i lozinka</strong>
          <small>Korisnik sam kreira nalog.</small>
        </li>
        <li>
          <span>2</span>
          <strong>Ime i prezime</strong>
          <small>Prikazni podatak, ne dokaz identiteta.</small>
        </li>
        <li>
          <span>3</span>
          <strong>Ceka odobrenje</strong>
          <small>Novi nalog nema nijedno pravo u sistemu.</small>
        </li>
        <li>
          <span>4</span>
          <strong>Odluka vlasnika</strong>
          <small>Samo vlasnik moze dodijeliti ulogu.</small>
        </li>
        <li>
          <span>5</span>
          <strong>Provjera pri svakom zahtjevu</strong>
          <small>Server provjerava ulogu, ne aplikacija.</small>
        </li>
      </ol>
    </section>
  );
}
