/**
 * The society's real records: members, groups and vehicles.
 *
 * This is where the owner enters DVD Tivat's actual roster and fleet, rather
 * than through a seed script or the Supabase dashboard. Everything on this
 * screen is live server data.
 *
 * The screen is hidden from anybody the server does not call `ADMIN` or `OWNER`,
 * and that is only tidiness - every command here begins with its own
 * `ADMIN_REQUIRED` check against `auth.uid()`, and a COMMANDER is refused just
 * as firmly as a firefighter. Command authority runs call-outs; it does not edit
 * who is in the society.
 *
 * The one thing worth noticing on the members table is the readiness column. A
 * member with no linked account resolves to no `current_member_id()` on the
 * server, so they would receive a call-out and be unable to answer it. That is
 * invisible unless it is said, so it is said on every row.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAccess } from '@/auth/AccessProvider';
import { accessObstacle } from '@/auth/access';
import { loadDirectory, type DirectoryAccount } from '@/auth/directory';
import {
  createGroup,
  createMember,
  createVehicle,
  linkMemberAccount,
  loadGroups,
  loadRoster,
  loadVehicles,
  memberReadiness,
  setGroupMembers,
  setMemberActive,
  setVehicleActive,
  unlinkMemberAccount,
  type RosterGroup,
  type RosterMember,
  type RosterVehicle,
} from '@/auth/roster';
import { useApp } from '@/state/AppStateContext';
import { EmptyState, Field, Notice, ScrollRegion } from '../components/primitives';
import { RequireRole } from '../components/RequireRole';
import { useText } from '@/i18n/useText';

type Tab = 'clanovi' | 'grupe' | 'vozila';

export function OrganisationView() {
  const t = useText();
  const { access } = useAccess();

  return (
    <>
      <h1 className="sr-only">{t.organisation.pageTitle}</h1>
      <RequireRole
        allow={['OWNER', 'ADMIN']}
        refused={
          <section className="card" aria-labelledby="organisation-refused-h">
            <div className="card__head">
              <div>
                <p className="card__kicker">{t.organisation.adminOnly}</p>
                <h2 id="organisation-refused-h">{t.organisation.pageTitle}</h2>
              </div>
            </div>
            <Notice tone="info">
              {accessObstacle(access) === 'SIGN_IN_REQUIRED'
                ? t.organisation.signInFirst
                : t.organisation.denied}
            </Notice>
          </section>
        }
      >
        <OrganisationPanel />
      </RequireRole>
    </>
  );
}

function OrganisationPanel() {
  const t = useText();
  const { announce } = useApp();
  const [tab, setTab] = useState<Tab>('clanovi');
  const [members, setMembers] = useState<RosterMember[] | null>(null);
  const [groups, setGroups] = useState<RosterGroup[]>([]);
  const [vehicles, setVehicles] = useState<RosterVehicle[]>([]);
  const [accounts, setAccounts] = useState<DirectoryAccount[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [roster, groupRows, vehicleRows] = await Promise.all([
        loadRoster(),
        loadGroups(),
        loadVehicles(),
      ]);
      setMembers(roster);
      setGroups(groupRows);
      setVehicles(vehicleRows);
      setError('');
      // The account list is owner-only; an ADMIN receives no rows. A failure
      // here must not turn successfully loaded organisation records into an error.
      try {
        setAccounts(await loadDirectory());
      } catch {
        setAccounts([]);
      }
    } catch {
      setError(t.organisation.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [t.organisation.loadFailed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs a command, reports what the server said, and reloads on success. */
  const run = useCallback(
    async (work: () => Promise<{ ok: boolean; message?: string }>, success: string) => {
      setBusy(true);
      try {
        const outcome = await work();
        if (outcome.ok) {
          await refresh();
          announce(success);
        } else {
          announce(outcome.message ?? t.organisation.changeFailed, 'error');
        }
      } finally {
        setBusy(false);
      }
    },
    [announce, refresh, t.organisation.changeFailed],
  );

  if (error) {
    return (
      <section className="card" aria-labelledby="organisation-error-h">
        <h2 id="organisation-error-h">{t.organisation.pageTitle}</h2>
        <Notice tone="error">{error}</Notice>
        {loading ? <p role="status">{t.organisation.loading}</p> : null}
        <button className="btn" type="button" disabled={loading} onClick={() => void refresh()}>
          {t.gate.retry}
        </button>
      </section>
    );
  }

  if (members === null) {
    return (
      <section className="card">
        <p className="muted" role="status">{t.organisation.loading}</p>
      </section>
    );
  }

  return (
    <section className="card organisation" aria-labelledby="organisation-h">
      <div className="card__head">
        <div>
          <p className="card__kicker">{t.organisation.serverData}</p>
          <h2 id="organisation-h">{t.organisation.pageTitle}</h2>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label={t.organisation.tabs}>
        {(['clanovi', 'grupe', 'vozila'] as Tab[]).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`panel-${name}`}
            className={`tabs__tab ${tab === name ? 'tabs__tab--on' : ''}`}
            onClick={() => setTab(name)}
          >
            {name === 'clanovi'
              ? t.organisation.members
              : name === 'grupe' ? t.organisation.groups : t.organisation.vehicles}
          </button>
        ))}
      </div>

      {tab === 'clanovi' ? (
        <MembersPanel members={members} accounts={accounts} busy={busy || loading} run={run} />
      ) : null}
      {tab === 'grupe' ? (
        <GroupsPanel groups={groups} members={members} busy={busy || loading} run={run} />
      ) : null}
      {tab === 'vozila' ? <VehiclesPanel vehicles={vehicles} busy={busy || loading} run={run} /> : null}
    </section>
  );
}

type Run = (
  work: () => Promise<{ ok: boolean; message?: string }>,
  success: string,
) => Promise<void>;

function MembersPanel({
  members,
  accounts,
  busy,
  run,
}: {
  readonly members: readonly RosterMember[];
  readonly accounts: readonly DirectoryAccount[];
  readonly busy: boolean;
  readonly run: Run;
}) {
  const t = useText();
  const [name, setName] = useState('');
  const [reason, setReason] = useState<Record<string, string>>({});
  const linked = new Set(members.map((member) => member.userId).filter(Boolean));
  const withoutMember = accounts.filter((account) => !linked.has(account.userId));
  const unready = members.filter((member) => memberReadiness(member) !== 'READY').length;

  return (
    <div role="tabpanel" id="panel-clanovi" aria-labelledby="tab-clanovi">
      {unready > 0 ? (
        <Notice tone="warn">
          {unready === 1
            ? t.organisation.unreadyOne
            : t.organisation.unreadyMany.replace('{count}', String(unready))}{' '}
          {t.organisation.unreadyExplain}
        </Notice>
      ) : null}

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length < 2) return;
          void run(() => createMember(name.trim(), []), t.organisation.memberAdded).then(() => setName(''));
        }}
      >
        <Field label={t.organisation.newMember} required>
          {(props) => (
            <input
              {...props}
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <button type="submit" className="btn btn--primary" disabled={busy || name.trim().length < 2}>
          {t.organisation.addMember}
        </button>
      </form>

      {members.length === 0 ? (
        <EmptyState title={t.organisation.noMembers}>
          {t.organisation.addFirstMember}
        </EmptyState>
      ) : (
        <ScrollRegion label={t.organisation.memberList}>
          <table className="table">
            <caption className="sr-only">{t.organisation.tableMembers}</caption>
            <thead>
              <tr>
                <th scope="col">{t.organisation.newMember}</th>
                <th scope="col">{t.organisation.account}</th>
                <th scope="col">{t.organisation.state}</th>
                <th scope="col">{t.organisation.action}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const readiness = memberReadiness(member);
                const account = accounts.find((row) => row.userId === member.userId);
                return (
                  <tr key={member.id}>
                    <th scope="row">{member.fullName}</th>
                    <td>{account ? account.email : member.userId ? t.organisation.linked : t.organisation.notLinked}</td>
                    <td>
                      <span className={`chip chip--${readiness === 'READY' ? 'yes' : 'later'}`}>
                        {t.organisation.readiness[readiness]}
                      </span>
                    </td>
                    <td className="organisation__actions">
                      {member.userId === null && withoutMember.length > 0 ? (
                        <label className="sr-only" htmlFor={`link-${member.id}`}>
                          {t.organisation.linkAccount} {member.fullName}
                        </label>
                      ) : null}
                      {member.userId === null && withoutMember.length > 0 ? (
                        <select
                          id={`link-${member.id}`}
                          className="input"
                          defaultValue=""
                          disabled={busy}
                          onChange={(event) => {
                            const userId = event.target.value;
                            if (!userId) return;
                            void run(
                              () => linkMemberAccount(member.id, userId),
                              t.organisation.accountLinked,
                            );
                          }}
                        >
                          <option value="">{t.organisation.linkAccountOption}</option>
                          {withoutMember.map((candidate) => (
                            <option key={candidate.userId} value={candidate.userId}>
                              {candidate.fullName ?? candidate.email}
                            </option>
                          ))}
                        </select>
                      ) : null}

                      {member.userId !== null ? (
                        <ReasonAction
                          id={`unlink-${member.id}`}
                          label={`${t.organisation.unlinkReason} ${member.fullName}`}
                          action={t.organisation.unlinkAccount}
                          busy={busy}
                          value={reason[`u-${member.id}`] ?? ''}
                          onChange={(next) =>
                            setReason((prev) => ({ ...prev, [`u-${member.id}`]: next }))
                          }
                          onRun={(text) =>
                            run(
                              () => unlinkMemberAccount(member.id, text),
                              t.organisation.accountUnlinked,
                            )
                          }
                        />
                      ) : null}

                      <ReasonAction
                        id={`active-${member.id}`}
                        label={`${t.organisation.compositionReason} ${member.fullName}`}
                        action={member.active ? t.organisation.removeFromRoster : t.organisation.restoreToRoster}
                        busy={busy}
                        value={reason[`a-${member.id}`] ?? ''}
                        onChange={(next) =>
                          setReason((prev) => ({ ...prev, [`a-${member.id}`]: next }))
                        }
                        onRun={(text) =>
                          run(
                            () => setMemberActive(member.id, !member.active, text),
                            member.active ? t.organisation.removedFromRoster : t.organisation.restoredToRoster,
                          )
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  );
}

/**
 * A reason box and the button it belongs to.
 *
 * The server refuses every one of these commands without a reason of at least
 * two characters, so the button stays disabled until there is one. That is the
 * interface agreeing with the server rather than letting somebody discover the
 * rule by being refused.
 */
function ReasonAction({
  id,
  label,
  action,
  busy,
  value,
  onChange,
  onRun,
}: {
  readonly id: string;
  readonly label: string;
  readonly action: string;
  readonly busy: boolean;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onRun: (reason: string) => Promise<void>;
}) {
  const t = useText();
  return (
    <span className="organisation__reason">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        placeholder={t.organisation.reason}
        value={value}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="btn"
        disabled={busy || value.trim().length < 2}
        onClick={() => void onRun(value.trim()).then(() => onChange(''))}
      >
        {action}
      </button>
    </span>
  );
}

function GroupsPanel({
  groups,
  members,
  busy,
  run,
}: {
  readonly groups: readonly RosterGroup[];
  readonly members: readonly RosterMember[];
  readonly busy: boolean;
  readonly run: Run;
}) {
  const t = useText();
  const [name, setName] = useState('');

  return (
    <div role="tabpanel" id="panel-grupe" aria-labelledby="tab-grupe">
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length < 2) return;
          void run(() => createGroup(name.trim()), t.organisation.groupAdded).then(() => setName(''));
        }}
      >
        <Field label={t.organisation.newGroup} required>
          {(props) => (
            <input
              {...props}
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <button type="submit" className="btn btn--primary" disabled={busy || name.trim().length < 2}>
          {t.organisation.addGroup}
        </button>
      </form>

      {groups.length === 0 ? (
        <EmptyState title={t.organisation.noGroups}>
          {t.organisation.groupsHint}
        </EmptyState>
      ) : (
        groups.map((group) => (
          <fieldset key={group.id} className="organisation__group">
            <legend>
              {group.name} <span className="muted small">({group.memberIds.length})</span>
            </legend>
            {members.length === 0 ? (
              <p className="muted small">{t.organisation.addMembersFirst}</p>
            ) : (
              members.map((member) => {
                const checked = group.memberIds.includes(member.id);
                return (
                  <label key={member.id} className="organisation__check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => {
                        const next = checked
                          ? group.memberIds.filter((id) => id !== member.id)
                          : [...group.memberIds, member.id];
                        void run(
                          () => setGroupMembers(group.id, next),
                          checked ? t.organisation.removedFromGroup : t.organisation.addedToGroup,
                        );
                      }}
                    />
                    <span>{member.fullName}</span>
                  </label>
                );
              })
            )}
          </fieldset>
        ))
      )}
    </div>
  );
}

function VehiclesPanel({
  vehicles,
  busy,
  run,
}: {
  readonly vehicles: readonly RosterVehicle[];
  readonly busy: boolean;
  readonly run: Run;
}) {
  const t = useText();
  const [callsign, setCallsign] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [reason, setReason] = useState<Record<string, string>>({});
  const ready = callsign.trim() && name.trim() && kind.trim();

  return (
    <div role="tabpanel" id="panel-vozila" aria-labelledby="tab-vozila">
      <Notice tone="info">
        {t.organisation.vehiclePrivacy}
      </Notice>

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          void run(
            () => createVehicle(callsign.trim(), name.trim(), kind.trim()),
            t.organisation.vehicleAdded,
          ).then(() => {
            setCallsign('');
            setName('');
            setKind('');
          });
        }}
      >
        <Field label={t.organisation.callsign} required>
          {(props) => (
            <input
              {...props}
              className="input"
              value={callsign}
              onChange={(event) => setCallsign(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={t.organisation.vehicleName} required>
          {(props) => (
            <input
              {...props}
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={t.organisation.kind} required hint={t.organisation.vehicleKindHint}>
          {(props) => (
            <input
              {...props}
              className="input"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
        <button type="submit" className="btn btn--primary" disabled={busy || !ready}>
          {t.organisation.addVehicle}
        </button>
      </form>

      {vehicles.length === 0 ? (
        <EmptyState title={t.organisation.noVehicles} />
      ) : (
        <ScrollRegion label={t.organisation.vehicleList}>
          <table className="table">
            <caption className="sr-only">{t.organisation.tableVehicles}</caption>
            <thead>
              <tr>
                <th scope="col">{t.organisation.callsign}</th>
                <th scope="col">{t.organisation.vehicleName}</th>
                <th scope="col">{t.organisation.kind}</th>
                <th scope="col">{t.organisation.state}</th>
                <th scope="col">{t.organisation.action}</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <th scope="row">{vehicle.callsign}</th>
                  <td>{vehicle.name}</td>
                  <td>{vehicle.kind}</td>
                  <td>
                    <span className={`chip chip--${vehicle.active ? 'yes' : 'later'}`}>
                      {vehicle.active ? t.organisation.inService : t.organisation.outOfService}
                    </span>
                  </td>
                  <td>
                    <ReasonAction
                      id={`vehicle-${vehicle.id}`}
                      label={`${t.organisation.vehicleReason} ${vehicle.callsign}`}
                      action={vehicle.active ? t.organisation.outOfService : t.organisation.inService}
                      busy={busy}
                      value={reason[vehicle.id] ?? ''}
                      onChange={(next) =>
                        setReason((prev) => ({ ...prev, [vehicle.id]: next }))
                      }
                      onRun={(text) =>
                        run(
                          () => setVehicleActive(vehicle.id, !vehicle.active, text),
                          vehicle.active ? t.organisation.vehicleTakenOut : t.organisation.vehicleRestored,
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  );
}
