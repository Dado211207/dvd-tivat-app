/**
 * The fictional roster.
 *
 * Every name and contact label here is invented. The "role" column is the
 * PROPOSED role from the plan, not an enforced permission - nothing in this
 * prototype checks who anyone is.
 */

import { ROLE_LABEL, SPECIALTY_LABEL, T } from '@/i18n/labels';
import { useApp } from '@/state/AppStateContext';
import { Notice, ScrollRegion } from '../components/primitives';

export function RosterView() {
  const { state } = useApp();

  return (
    <>
      <h1 className="sr-only">{T.rosterTitle}</h1>

      <section className="card" aria-labelledby="roster-h">
        <div className="card__head">
          <h2 id="roster-h">
            {T.rosterTitle} ({state.members.length})
          </h2>
        </div>

        <Notice tone="warn">
          {T.rosterNote} Uloge su prijedlog iz plana, a ne provjerene dozvole - u prototipu nista ne
          provjerava identitet.
        </Notice>

        <ScrollRegion label="Spisak izmisljenih clanova">
          <table>
            <caption className="sr-only">Spisak izmisljenih clanova</caption>
            <thead>
              <tr>
                <th scope="col">{T.member}</th>
                <th scope="col">Predlozena uloga</th>
                <th scope="col">{T.specialties}</th>
                <th scope="col">{T.groups}</th>
                <th scope="col">{T.contactLabel}</th>
              </tr>
            </thead>
            <tbody data-testid="roster-rows">
              {state.members.map((member) => (
                <tr key={member.id}>
                  <th scope="row">{member.name}</th>
                  <td className="small">{ROLE_LABEL[member.roleProposed]}</td>
                  <td>
                    {member.specialties.map((s) => (
                      <span className="tag" key={s}>
                        {SPECIALTY_LABEL[s]}
                      </span>
                    ))}
                  </td>
                  <td>
                    {member.groupIds.map((id) => (
                      <span className="tag" key={id}>
                        {state.groups.find((g) => g.id === id)?.name ?? id}
                      </span>
                    ))}
                  </td>
                  <td className="small muted mono">{member.contactLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      <section className="card" aria-labelledby="groups-h">
        <div className="card__head">
          <h2 id="groups-h">{T.groups}</h2>
        </div>
        <ScrollRegion label="Grupe i broj clanova">
          <table>
            <caption className="sr-only">Grupe i broj clanova</caption>
            <thead>
              <tr>
                <th scope="col">Grupa</th>
                <th scope="col">Broj clanova</th>
                <th scope="col">Clanovi</th>
              </tr>
            </thead>
            <tbody>
              {state.groups.map((group) => (
                <tr key={group.id}>
                  <th scope="row">{group.name}</th>
                  <td>{group.memberIds.length}</td>
                  <td className="small muted">
                    {group.memberIds
                      .map((id) => state.members.find((m) => m.id === id)?.name ?? id)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>

      <section className="card" aria-labelledby="fleet-h">
        <div className="card__head">
          <h2 id="fleet-h">{T.vehiclesTitle}</h2>
        </div>
        <ScrollRegion label="Izmisljeni vozni park">
          <table>
            <caption className="sr-only">Izmisljeni vozni park</caption>
            <thead>
              <tr>
                <th scope="col">Oznaka</th>
                <th scope="col">Naziv</th>
                <th scope="col">Vrsta</th>
              </tr>
            </thead>
            <tbody>
              {state.vehicles.map((vehicle) => (
                <tr key={vehicle.id}>
                  <th scope="row" className="mono">
                    {vehicle.callsign}
                  </th>
                  <td>{vehicle.name}</td>
                  <td className="small muted">{vehicle.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </section>
    </>
  );
}
