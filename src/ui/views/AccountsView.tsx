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
import { ASSIGNABLE_ROLES, type AccountRole } from '@/access/policy';
import { useAccess } from '@/auth/AccessProvider';
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
import { formatTime } from '@/i18n/time';
import { useText } from '@/i18n/useText';

export function AccountsView() {
  const t = useText();
  const { access } = useAccess();

  return (
    <>
      <h1 className="sr-only">{t.accounts.pageTitle}</h1>
      <AccountAccessSetup />
      {/*
        Nothing at all for anybody but the owner.
        A firefighter opening this screen used to find a section headed "Spisak
        naloga" with an explanation that they could not see it. It was honest,
        and it was still the empty shell of somebody else's management screen
        sitting on their own account page, and it invited the reading that
        something had failed to load.
        Their own account information, which is what they came here for, is
        above in `AccountAccessSetup` and is untouched. The server is what
        actually withholds the rows - the directory policies return nothing to a
        non-owner - so this is tidiness, not a control.
      */}
      <RequireRole allow={['OWNER']} refused={null}>
        {access.kind === 'SIGNED_IN' ? <OwnerDirectory ownUserId={access.userId} /> : null}
      </RequireRole>
      <RegistrationExplainer />
    </>
  );
}

function OwnerDirectory({ ownUserId }: { readonly ownUserId: string }) {
  const t = useText();
  const { announce } = useApp();
  const [accounts, setAccounts] = useState<DirectoryAccount[] | null>(null);
  const [roleAudit, setRoleAudit] = useState<RoleAuditEntry[]>([]);
  const [statusAudit, setStatusAudit] = useState<StatusAuditEntry[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [directory, roles, statuses] = await Promise.all([
        loadDirectory(),
        loadRoleAudit(),
        loadStatusAudit(),
      ]);
      setAccounts(directory);
      setRoleAudit(roles);
      setStatusAudit(statuses);
      setLoadFailed(false);
    } catch {
      setAccounts([]);
      setLoadFailed(true);
      setError(t.accounts.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.accounts.loadFailed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || accounts === null) return accounts ?? [];
    return accounts.filter((account) =>
      `${account.fullName ?? ''} ${account.email} ${t.accounts.roleLabel[account.role]} ${
        t.accounts.statusLabel[statusOf(account)]
      }`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [accounts, query, t.accounts.roleLabel, t.accounts.statusLabel]);

  async function changeRole(account: DirectoryAccount, nextRole: AccountRole) {
    setBusyUserId(account.userId);
    setError('');
    try {
      const outcome = await setAccountRole(account.userId, nextRole);
      if (!outcome.ok) {
        const message = outcome.message ?? t.accounts.changeFailed;
        setError(message);
        announce(message, 'error');
        return;
      }
      announce(t.accounts.changedRole.replace('{role}', t.accounts.roleLabel[nextRole]));
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
      setError(t.accounts.reasonMissing);
      announce(t.accounts.reasonNeeded, 'error');
      return;
    }
    setBusyUserId(account.userId);
    setError('');
    try {
      const outcome = await setAccountActive(account.userId, active, reason);
      if (!outcome.ok) {
        const message = outcome.message ?? t.accounts.changeFailed;
        setError(message);
        announce(message, 'error');
        return;
      }
      setReasonDraft((current) => ({ ...current, [account.userId]: '' }));
      announce(active ? t.accounts.accessRestored : t.accounts.accessRevoked);
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
            <p className="card__kicker">{t.accounts.ownerOnly}</p>
            <h2 id="account-directory-h">{t.accounts.allAccounts}</h2>
          </div>
          <Chip tone="neutral" symbol="#">
            {t.accounts.accountCount.replace(
              '{count}',
              loading || accounts === null || loadFailed ? '—' : String(accounts.length),
            )}
          </Chip>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {loadFailed ? (
          <button className="btn" type="button" disabled={loading} onClick={() => void refresh()}>
            {t.gate.retry}
          </button>
        ) : null}

        <Notice tone="warn">
          {t.accounts.risk}
        </Notice>

        <label className="account-search">
          <span>{t.accounts.search}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            disabled={loading || accounts === null || loadFailed}
          />
        </label>

        {loading ? (
          <p role="status">{t.accounts.loading}</p>
        ) : loadFailed || accounts === null ? null : filtered.length === 0 ? (
          <EmptyState title={t.accounts.noResults}>
            {accounts.length === 0
              ? t.accounts.noAccounts
              : t.accounts.changeSearch}
          </EmptyState>
        ) : (
          <div className="account-table-wrap">
            <table className="account-table">
              <thead>
                <tr>
                  <th scope="col">{t.accounts.account}</th>
                  <th scope="col">{t.accounts.status}</th>
                  <th scope="col">{t.accounts.role}</th>
                  <th scope="col">{t.accounts.access}</th>
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
                        <strong>{account.fullName ?? t.accounts.noName}</strong>
                        <small>{account.email}</small>
                      </th>
                      <td>
                        <Chip
                          tone={status === 'ACTIVE' ? 'yes' : status === 'SUSPENDED' ? 'no' : 'later'}
                          symbol={status === 'ACTIVE' ? '+' : status === 'SUSPENDED' ? '-' : '!'}
                        >
                          {t.accounts.statusLabel[status]}
                        </Chip>
                      </td>
                      <td>
                        {locked ? (
                          <>
                            <strong>{t.accounts.roleLabel[account.role]}</strong>
                            <small>
                              {isSelf
                                ? t.accounts.ownAccountLocked
                                : t.accounts.ownerLocked}
                            </small>
                          </>
                        ) : (
                          <select
                            aria-label={`${t.accounts.role} - ${account.fullName ?? account.email}`}
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
                              <option value="CITIZEN">{t.accounts.roleLabel.CITIZEN}</option>
                            ) : null}
                            {ASSIGNABLE_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {t.accounts.roleLabel[role]}
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
                                {t.accounts.reasonForAccess}: {account.fullName ?? account.email}
                              </span>
                              <input
                                type="text"
                                placeholder={t.accounts.reasonRequired}
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
                              {account.active ? t.accounts.revokeAccess : t.accounts.restoreAccess}
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

      <section className="card">
        <details className="disclosure">
          <summary className="disclosure__summary">{t.accounts.auditTitle}</summary>
          <div className="disclosure__body">
            {loading ? (
              <p role="status">{t.accounts.loading}</p>
            ) : loadFailed ? (
              <Notice tone="error">{t.accounts.loadFailed}</Notice>
            ) : roleAudit.length === 0 && statusAudit.length === 0 ? (
              <EmptyState title={t.accounts.noAudit}>{t.accounts.auditHint}</EmptyState>
            ) : (
              <ul className="audit-list">
                {roleAudit.map((entry) => (
                  <li key={`role-${entry.id}`}>
                    <strong>{nameOf(entry.targetUserId)}</strong>:{' '}
                    {t.accounts.roleChanged
                      .replace(
                        '{from}',
                        t.accounts.roleLabel[entry.previousRole as keyof typeof t.accounts.roleLabel] ??
                          entry.previousRole,
                      )
                      .replace(
                        '{to}',
                        t.accounts.roleLabel[entry.nextRole as keyof typeof t.accounts.roleLabel] ??
                          entry.nextRole,
                      )}
                    <small>{formatTime(entry.changedAt)}</small>
                  </li>
                ))}
                {statusAudit.map((entry) => (
                  <li key={`status-${entry.id}`}>
                    <strong>{nameOf(entry.targetUserId)}</strong>:{' '}
                    {entry.nextActive ? t.accounts.accessChange : t.accounts.accessRemoval} - {entry.reason}
                    <small>{formatTime(entry.changedAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </section>
    </>
  );
}

function RegistrationExplainer() {
  const t = useText();
  return (
    <section className="panel account-flow">
      <details className="disclosure">
        <summary className="disclosure__summary">{t.accounts.registrationTitle}</summary>
        <div className="disclosure__body">
          <ol className="account-steps">
        <li>
          <span>1</span>
          <strong>{t.accounts.emailPassword}</strong>
          <small>{t.accounts.accountCreatedByUser}</small>
        </li>
        <li>
          <span>2</span>
          <strong>{t.accounts.nameAndSurname}</strong>
          <small>{t.accounts.displayNotProof}</small>
        </li>
        <li>
          <span>3</span>
          <strong>{t.accounts.awaitingApproval}</strong>
          <small>{t.accounts.noRights}</small>
        </li>
        <li>
          <span>4</span>
          <strong>{t.accounts.ownerDecision}</strong>
          <small>{t.accounts.ownerAssigns}</small>
        </li>
        <li>
          <span>5</span>
          <strong>{t.accounts.serverCheck}</strong>
          <small>{t.accounts.serverChecksRole}</small>
        </li>
          </ol>
        </div>
      </details>
    </section>
  );
}
