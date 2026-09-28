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
import { organizationIdOf } from '@/auth/serviceContext';
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

export function RegistryView() {
  const t = useText();
  const { access } = useAccess();
  // Both the signed-in account and acting service identify this registry view.
  // A switch of either remounts the panel so rows and half-typed forms cannot
  // carry into another account or service. A same-identity refresh keeps state.
  const actingService = access.kind === 'SIGNED_IN' ? access.service : null;
  const actingUserId = access.kind === 'SIGNED_IN' ? access.userId : null;

  return (
    <>
      <h1 className="sr-only">{t.registry.pageTitle}</h1>
      <RequireRole
        allow={['OWNER', 'ADMIN']}
        refused={
          <section className="card" aria-labelledby="registry-refused-h">
            <div className="card__head">
              <div>
                <p className="card__kicker">{t.registry.adminOnly}</p>
                <h2 id="registry-refused-h">{t.registry.pageTitle}</h2>
              </div>
            </div>
            <Notice tone="info">
              {accessObstacle(access) === 'SIGN_IN_REQUIRED'
                ? t.registry.signInFirst
                : t.registry.denied}
            </Notice>
          </section>
        }
      >
        <RegistryPanel key={`${actingUserId ?? 'none'}:${actingService ?? 'none'}`} />
      </RequireRole>
    </>
  );
}

function RegistryPanel() {
  const t = useText();
  const { announce } = useApp();
  // The registry is read and written FOR THE ACTING SERVICE. A dual-service admin
  // or the owner sees exactly one service's roster here - the one they are acting
  // as - and creating a member adds it to that service, never the other.
  const { actingService } = useAccess();
  const organizationId = actingService === null ? null : organizationIdOf(actingService);
  const [tab, setTab] = useState<Tab>('clanovi');
  const [members, setMembers] = useState<RosterMember[] | null>(null);
  const [groups, setGroups] = useState<RosterGroup[]>([]);
  const [vehicles, setVehicles] = useState<RosterVehicle[]>([]);
  const [accounts, setAccounts] = useState<DirectoryAccount[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (organizationId === null) return;
    setLoading(true);
    try {
      const [roster, groupRows, vehicleRows] = await Promise.all([
        loadRoster(organizationId),
        loadGroups(organizationId),
        loadVehicles(organizationId),
      ]);
      setMembers(roster);
      setGroups(groupRows);
      setVehicles(vehicleRows);
      setError('');
      // The account list is owner-only; an ADMIN receives no rows. A failure
      // here must not turn successfully loaded registry records into an error.
      try {
        setAccounts(await loadDirectory());
      } catch {
        setAccounts([]);
      }
    } catch {
      setError(t.registry.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [organizationId, t.registry.loadFailed]);

  // Re-reads whenever the acting service changes, so switching service replaces
  // the roster on screen rather than leaving the previous service's on it.
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
          announce(outcome.message ?? t.registry.changeFailed, 'error');
        }
      } finally {
        setBusy(false);
      }
    },
    [announce, refresh, t.registry.changeFailed],
  );

  if (error) {
    return (
      <section className="card" aria-labelledby="registry-error-h">
        <h2 id="registry-error-h">{t.registry.pageTitle}</h2>
        <Notice tone="error">{error}</Notice>
        {loading ? <p role="status">{t.registry.loading}</p> : null}
        <button className="btn" type="button" disabled={loading} onClick={() => void refresh()}>
          {t.gate.retry}
        </button>
      </section>
    );
  }

  if (members === null || organizationId === null) {
    return (
      <section className="card">
        <p className="muted" role="status">{t.registry.loading}</p>
      </section>
    );
  }

  return (
    <section className="card registry" aria-labelledby="registry-h">
      <div className="card__head">
        <div>
          <p className="card__kicker">{t.registry.serverData}</p>
          <h2 id="registry-h">{t.registry.pageTitle}</h2>
          {/* Which service's registry this is - said plainly, because a
              dual-service admin needs to know which roster they are editing. */}
          {actingService !== null ? (
            <p className="muted small" data-testid="registry-acting-service">
              {t.registry.actingService}: <strong>{t.accounts.organizationLabel[actingService]}</strong>
            </p>
          ) : null}
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label={t.registry.tabs}>
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
              ? t.registry.members
              : name === 'grupe' ? t.registry.groups : t.registry.vehicles}
          </button>
        ))}
      </div>

      {tab === 'clanovi' ? (
        <MembersPanel
          organizationId={organizationId}
          members={members}
          accounts={accounts}
          busy={busy || loading}
          run={run}
        />
      ) : null}
      {tab === 'grupe' ? (
        <GroupsPanel
          organizationId={organizationId}
          groups={groups}
          members={members}
          busy={busy || loading}
          run={run}
        />
      ) : null}
      {tab === 'vozila' ? (
        <VehiclesPanel organizationId={organizationId} vehicles={vehicles} busy={busy || loading} run={run} />
      ) : null}
    </section>
  );
}

type Run = (
  work: () => Promise<{ ok: boolean; message?: string }>,
  success: string,
) => Promise<void>;

function MembersPanel({
  organizationId,
  members,
  accounts,
  busy,
  run,
}: {
  readonly organizationId: string;
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
            ? t.registry.unreadyOne
            : t.registry.unreadyMany.replace('{count}', String(unready))}{' '}
          {t.registry.unreadyExplain}
        </Notice>
      ) : null}

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length < 2) return;
          void run(() => createMember(organizationId, name.trim(), []), t.registry.memberAdded).then(() =>
            setName(''),
          );
        }}
      >
        <Field label={t.registry.newMember} required>
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
          {t.registry.addMember}
        </button>
      </form>

      {members.length === 0 ? (
        <EmptyState title={t.registry.noMembers}>
          {t.registry.addFirstMember}
        </EmptyState>
      ) : (
        <ScrollRegion label={t.registry.memberList}>
          <table className="table">
            <caption className="sr-only">{t.registry.tableMembers}</caption>
            <thead>
              <tr>
                <th scope="col">{t.registry.newMember}</th>
                <th scope="col">{t.registry.account}</th>
                <th scope="col">{t.registry.state}</th>
                <th scope="col">{t.registry.action}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const readiness = memberReadiness(member);
                const account = accounts.find((row) => row.userId === member.userId);
                return (
                  <tr key={member.id}>
                    <th scope="row">{member.fullName}</th>
                    <td>{account ? account.email : member.userId ? t.registry.linked : t.registry.notLinked}</td>
                    <td>
                      <span className={`chip chip--${readiness === 'READY' ? 'yes' : 'later'}`}>
                        {t.registry.readiness[readiness]}
                      </span>
                    </td>
                    <td className="registry__actions">
                      {member.userId === null && withoutMember.length > 0 ? (
                        <label className="sr-only" htmlFor={`link-${member.id}`}>
                          {t.registry.linkAccount} {member.fullName}
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
                              t.registry.accountLinked,
                            );
                          }}
                        >
                          <option value="">{t.registry.linkAccountOption}</option>
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
                          label={`${t.registry.unlinkReason} ${member.fullName}`}
                          action={t.registry.unlinkAccount}
                          busy={busy}
                          value={reason[`u-${member.id}`] ?? ''}
                          onChange={(next) =>
                            setReason((prev) => ({ ...prev, [`u-${member.id}`]: next }))
                          }
                          onRun={(text) =>
                            run(
                              () => unlinkMemberAccount(member.id, text),
                              t.registry.accountUnlinked,
                            )
                          }
                        />
                      ) : null}

                      <ReasonAction
                        id={`active-${member.id}`}
                        label={`${t.registry.compositionReason} ${member.fullName}`}
                        action={member.active ? t.registry.removeFromRoster : t.registry.restoreToRoster}
                        busy={busy}
                        value={reason[`a-${member.id}`] ?? ''}
                        onChange={(next) =>
                          setReason((prev) => ({ ...prev, [`a-${member.id}`]: next }))
                        }
                        onRun={(text) =>
                          run(
                            () => setMemberActive(member.id, !member.active, text),
                            member.active ? t.registry.removedFromRoster : t.registry.restoredToRoster,
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
    <span className="registry__reason">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        placeholder={t.registry.reason}
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
  organizationId,
  groups,
  members,
  busy,
  run,
}: {
  readonly organizationId: string;
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
          void run(() => createGroup(organizationId, name.trim()), t.registry.groupAdded).then(() =>
            setName(''),
          );
        }}
      >
        <Field label={t.registry.newGroup} required>
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
          {t.registry.addGroup}
        </button>
      </form>

      {groups.length === 0 ? (
        <EmptyState title={t.registry.noGroups}>
          {t.registry.groupsHint}
        </EmptyState>
      ) : (
        groups.map((group) => (
          <fieldset key={group.id} className="registry__group">
            <legend>
              {group.name} <span className="muted small">({group.memberIds.length})</span>
            </legend>
            {members.length === 0 ? (
              <p className="muted small">{t.registry.addMembersFirst}</p>
            ) : (
              members.map((member) => {
                const checked = group.memberIds.includes(member.id);
                return (
                  <label key={member.id} className="registry__check">
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
                          checked ? t.registry.removedFromGroup : t.registry.addedToGroup,
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
  organizationId,
  vehicles,
  busy,
  run,
}: {
  readonly organizationId: string;
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
        {t.registry.vehiclePrivacy}
      </Notice>

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          void run(
            () => createVehicle(organizationId, callsign.trim(), name.trim(), kind.trim()),
            t.registry.vehicleAdded,
          ).then(() => {
            setCallsign('');
            setName('');
            setKind('');
          });
        }}
      >
        <Field label={t.registry.callsign} required>
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
        <Field label={t.registry.vehicleName} required>
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
        <Field label={t.registry.kind} required hint={t.registry.vehicleKindHint}>
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
          {t.registry.addVehicle}
        </button>
      </form>

      {vehicles.length === 0 ? (
        <EmptyState title={t.registry.noVehicles} />
      ) : (
        <ScrollRegion label={t.registry.vehicleList}>
          <table className="table">
            <caption className="sr-only">{t.registry.tableVehicles}</caption>
            <thead>
              <tr>
                <th scope="col">{t.registry.callsign}</th>
                <th scope="col">{t.registry.vehicleName}</th>
                <th scope="col">{t.registry.kind}</th>
                <th scope="col">{t.registry.state}</th>
                <th scope="col">{t.registry.action}</th>
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
                      {vehicle.active ? t.registry.inService : t.registry.outOfService}
                    </span>
                  </td>
                  <td>
                    <ReasonAction
                      id={`vehicle-${vehicle.id}`}
                      label={`${t.registry.vehicleReason} ${vehicle.callsign}`}
                      action={vehicle.active ? t.registry.outOfService : t.registry.inService}
                      busy={busy}
                      value={reason[vehicle.id] ?? ''}
                      onChange={(next) =>
                        setReason((prev) => ({ ...prev, [vehicle.id]: next }))
                      }
                      onRun={(text) =>
                        run(
                          () => setVehicleActive(vehicle.id, !vehicle.active, text),
                          vehicle.active ? t.registry.vehicleTakenOut : t.registry.vehicleRestored,
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
