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
  READINESS_LABEL,
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

type Tab = 'clanovi' | 'grupe' | 'vozila';

const TAB_LABEL: Record<Tab, string> = {
  clanovi: 'Clanovi',
  grupe: 'Grupe',
  vozila: 'Vozila',
};

export function OrganisationView() {
  const { access } = useAccess();

  return (
    <>
      <h1 className="sr-only">Evidencija drustva</h1>
      <RequireRole
        allow={['OWNER', 'ADMIN']}
        refused={
          <section className="card" aria-labelledby="organisation-refused-h">
            <div className="card__head">
              <div>
                <p className="card__kicker">Samo administrator ili vlasnik</p>
                <h2 id="organisation-refused-h">Evidencija drustva</h2>
              </div>
            </div>
            <Notice tone="info">
              {accessObstacle(access) === 'SIGN_IN_REQUIRED'
                ? 'Evidencija se ne prikazuje dok se ne prijavite.'
                : 'Ovu evidenciju odrzava administrator ili vlasnik. Komandir vodi ' +
                  'intervencije, ali ne mijenja sastav drustva - server odbija te ' +
                  'komande i kada je dugme vidljivo.'}
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
  const { announce } = useApp();
  const [tab, setTab] = useState<Tab>('clanovi');
  const [members, setMembers] = useState<RosterMember[] | null>(null);
  const [groups, setGroups] = useState<RosterGroup[]>([]);
  const [vehicles, setVehicles] = useState<RosterVehicle[]>([]);
  const [accounts, setAccounts] = useState<DirectoryAccount[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [roster, groupRows, vehicleRows] = await Promise.all([
        loadRoster(),
        loadGroups(),
        loadVehicles(),
      ]);
      setMembers(roster);
      setGroups(groupRows);
      setVehicles(vehicleRows);
    } catch {
      setMembers([]);
      setError('Evidencija nije mogla biti ucitana sa servera.');
    }
    // The account list is owner-only, so an ADMIN gets zero rows rather than an
    // error. Failing to read it must not empty the roster that did load.
    try {
      setAccounts(await loadDirectory());
    } catch {
      setAccounts([]);
    }
  }, []);

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
          announce(outcome.message ?? 'Promjena nije sacuvana.', 'error');
        }
      } finally {
        setBusy(false);
      }
    },
    [announce, refresh],
  );

  if (members === null) {
    return (
      <section className="card">
        <p className="muted">Ucitavanje evidencije...</p>
      </section>
    );
  }

  return (
    <section className="card organisation" aria-labelledby="organisation-h">
      <div className="card__head">
        <div>
          <p className="card__kicker">Stvarni podaci sa servera</p>
          <h2 id="organisation-h">Evidencija drustva</h2>
        </div>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="tabs" role="tablist" aria-label="Dio evidencije">
        {(Object.keys(TAB_LABEL) as Tab[]).map((name) => (
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
            {TAB_LABEL[name]}
          </button>
        ))}
      </div>

      {tab === 'clanovi' ? (
        <MembersPanel members={members} accounts={accounts} busy={busy} run={run} />
      ) : null}
      {tab === 'grupe' ? (
        <GroupsPanel groups={groups} members={members} busy={busy} run={run} />
      ) : null}
      {tab === 'vozila' ? <VehiclesPanel vehicles={vehicles} busy={busy} run={run} /> : null}
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
            ? 'Jedan clan ne moze primiti poziv.'
            : `${unready} clanova ne moze primiti poziv.`}{' '}
          Clan bez povezanog naloga dobija poziv, ali server odbija njegov odgovor.
        </Notice>
      ) : null}

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length < 2) return;
          void run(() => createMember(name.trim(), []), 'Clan je dodat.').then(() => setName(''));
        }}
      >
        <Field label="Ime i prezime novog clana" required>
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
          Dodaj clana
        </button>
      </form>

      {members.length === 0 ? (
        <EmptyState title="Nema unesenih clanova">
          Dodajte prvog clana da bi intervencija imala kome da se uputi.
        </EmptyState>
      ) : (
        <ScrollRegion label="Spisak clanova">
          <table className="table">
            <caption className="sr-only">Clanovi drustva i stanje njihovih naloga</caption>
            <thead>
              <tr>
                <th scope="col">Ime i prezime</th>
                <th scope="col">Nalog</th>
                <th scope="col">Stanje</th>
                <th scope="col">Radnja</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const readiness = memberReadiness(member);
                const account = accounts.find((row) => row.userId === member.userId);
                return (
                  <tr key={member.id}>
                    <th scope="row">{member.fullName}</th>
                    <td>{account ? account.email : member.userId ? 'Povezan' : 'Nije povezan'}</td>
                    <td>
                      <span className={`chip chip--${readiness === 'READY' ? 'yes' : 'later'}`}>
                        {READINESS_LABEL[readiness]}
                      </span>
                    </td>
                    <td className="organisation__actions">
                      {member.userId === null && withoutMember.length > 0 ? (
                        <label className="sr-only" htmlFor={`link-${member.id}`}>
                          Povezi nalog sa clanom {member.fullName}
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
                              'Nalog je povezan sa clanom.',
                            );
                          }}
                        >
                          <option value="">Povezi nalog...</option>
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
                          label={`Razlog razvezivanja naloga clana ${member.fullName}`}
                          action="Razvezi nalog"
                          busy={busy}
                          value={reason[`u-${member.id}`] ?? ''}
                          onChange={(next) =>
                            setReason((prev) => ({ ...prev, [`u-${member.id}`]: next }))
                          }
                          onRun={(text) =>
                            run(
                              () => unlinkMemberAccount(member.id, text),
                              'Nalog je razvezan od clana.',
                            )
                          }
                        />
                      ) : null}

                      <ReasonAction
                        id={`active-${member.id}`}
                        label={`Razlog promjene sastava za ${member.fullName}`}
                        action={member.active ? 'Van sastava' : 'Vrati u sastav'}
                        busy={busy}
                        value={reason[`a-${member.id}`] ?? ''}
                        onChange={(next) =>
                          setReason((prev) => ({ ...prev, [`a-${member.id}`]: next }))
                        }
                        onRun={(text) =>
                          run(
                            () => setMemberActive(member.id, !member.active, text),
                            member.active ? 'Clan je van sastava.' : 'Clan je vracen u sastav.',
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
  return (
    <span className="organisation__reason">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        placeholder="Razlog"
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
  const [name, setName] = useState('');

  return (
    <div role="tabpanel" id="panel-grupe" aria-labelledby="tab-grupe">
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim().length < 2) return;
          void run(() => createGroup(name.trim()), 'Grupa je dodata.').then(() => setName(''));
        }}
      >
        <Field label="Naziv nove grupe" required>
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
          Dodaj grupu
        </button>
      </form>

      {groups.length === 0 ? (
        <EmptyState title="Nema unesenih grupa">
          Grupe sluze da se poziv uputi smjeni ili ekipi umjesto da se biraju pojedinacno.
        </EmptyState>
      ) : (
        groups.map((group) => (
          <fieldset key={group.id} className="organisation__group">
            <legend>
              {group.name} <span className="muted small">({group.memberIds.length})</span>
            </legend>
            {members.length === 0 ? (
              <p className="muted small">Dodajte clanove prije rasporedjivanja u grupe.</p>
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
                          checked ? 'Clan je uklonjen iz grupe.' : 'Clan je dodat u grupu.',
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
  const [callsign, setCallsign] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [reason, setReason] = useState<Record<string, string>>({});
  const ready = callsign.trim() && name.trim() && kind.trim();

  return (
    <div role="tabpanel" id="panel-vozila" aria-labelledby="tab-vozila">
      <Notice tone="info">
        Unesite oznaku, naziv i vrstu vozila. Registarske oznake i drugi osjetljivi
        podaci o vozilima nijesu dio ove evidencije.
      </Notice>

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          void run(
            () => createVehicle(callsign.trim(), name.trim(), kind.trim()),
            'Vozilo je dodato.',
          ).then(() => {
            setCallsign('');
            setName('');
            setKind('');
          });
        }}
      >
        <Field label="Oznaka" required>
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
        <Field label="Naziv vozila" required>
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
        <Field label="Vrsta" required hint="Na primjer: navalno, cisterna, tehnicko.">
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
          Dodaj vozilo
        </button>
      </form>

      {vehicles.length === 0 ? (
        <EmptyState title="Nema unesenih vozila" />
      ) : (
        <ScrollRegion label="Spisak vozila">
          <table className="table">
            <caption className="sr-only">Vozila drustva</caption>
            <thead>
              <tr>
                <th scope="col">Oznaka</th>
                <th scope="col">Naziv</th>
                <th scope="col">Vrsta</th>
                <th scope="col">Stanje</th>
                <th scope="col">Radnja</th>
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
                      {vehicle.active ? 'U upotrebi' : 'Van upotrebe'}
                    </span>
                  </td>
                  <td>
                    <ReasonAction
                      id={`vehicle-${vehicle.id}`}
                      label={`Razlog promjene stanja za vozilo ${vehicle.callsign}`}
                      action={vehicle.active ? 'Van upotrebe' : 'Vrati u upotrebu'}
                      busy={busy}
                      value={reason[vehicle.id] ?? ''}
                      onChange={(next) =>
                        setReason((prev) => ({ ...prev, [vehicle.id]: next }))
                      }
                      onRun={(text) =>
                        run(
                          () => setVehicleActive(vehicle.id, !vehicle.active, text),
                          vehicle.active ? 'Vozilo je van upotrebe.' : 'Vozilo je u upotrebi.',
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
