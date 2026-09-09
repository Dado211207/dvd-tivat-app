/**
 * Local editors for fictional demonstration data.
 *
 * The ADMIN check below changes only what the prototype displays. It is not an
 * authentication or permission boundary; real authorisation belongs on the
 * production server and is intentionally not imitated in this browser build.
 */

import { useState, type FormEvent } from 'react';
import type { DomainError } from '@/domain/errors';
import type { RoleId, SpecialtyId } from '@/domain/types';
import { ROLE_LABEL, SPECIALTY_LABEL } from '@/i18n/labels';
import { makeId, useApp } from '@/state/AppStateContext';
import { Field, Notice } from './primitives';

const ROLES: readonly RoleId[] = ['ADMIN', 'DEZURNI', 'CLAN', 'PRIKAZ'];
const SPECIALTIES: readonly SpecialtyId[] = [
  'KOMANDNI_KADAR',
  'VOZAC_C',
  'IDA',
  'PRVA_POMOC',
  'TEHNICKO_SPASAVANJE',
  'SUMSKI_POZAR',
];

function errorFor(error: DomainError | null, field: string): string | undefined {
  return error?.field === field ? error.message : undefined;
}

export function AdminDataPanel() {
  const { state, run, announce } = useApp();

  const [memberId, setMemberId] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState<RoleId>('CLAN');
  const [memberSpecialties, setMemberSpecialties] = useState<SpecialtyId[]>([]);
  const [memberGroups, setMemberGroups] = useState<string[]>([]);
  const [memberActive, setMemberActive] = useState(true);
  const [memberError, setMemberError] = useState<DomainError | null>(null);

  const [groupId, setGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupError, setGroupError] = useState<DomainError | null>(null);

  const [vehicleId, setVehicleId] = useState('');
  const [vehicleCallsign, setVehicleCallsign] = useState('');
  const [vehicleName, setVehicleName] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleError, setVehicleError] = useState<DomainError | null>(null);

  if (state.simulation.viewRole !== 'ADMIN') {
    return (
      <section className="card admin-panel" aria-labelledby="admin-panel-h">
        <div className="card__head">
          <div>
            <p className="card__kicker">Lokalna demonstracija</p>
            <h2 id="admin-panel-h">Upravljanje probnim podacima</h2>
          </div>
        </div>
        <Notice tone="info">
          Ovaj dio se prikazuje samo kada je izabran simulirani ucesnik sa predlozenom ulogom
          administratora. To nije prijava na nalog niti stvarna provjera ovlascenja.
        </Notice>
      </section>
    );
  }

  function chooseMember(nextId: string) {
    setMemberError(null);
    setMemberId(nextId);
    const member = state.members.find((item) => item.id === nextId);
    if (!member) {
      setMemberName('');
      setMemberRole('CLAN');
      setMemberSpecialties([]);
      setMemberGroups([]);
      setMemberActive(true);
      return;
    }
    setMemberName(member.name);
    setMemberRole(member.roleProposed);
    setMemberSpecialties([...member.specialties]);
    setMemberGroups([...member.groupIds]);
    setMemberActive(member.active);
  }

  function toggleSpecialty(specialty: SpecialtyId) {
    setMemberSpecialties((current) =>
      current.includes(specialty)
        ? current.filter((item) => item !== specialty)
        : [...current, specialty],
    );
  }

  function toggleGroup(nextGroupId: string) {
    setMemberGroups((current) =>
      current.includes(nextGroupId)
        ? current.filter((item) => item !== nextGroupId)
        : [...current, nextGroupId],
    );
  }

  function saveMember(event: FormEvent) {
    event.preventDefault();
    const result = run({
      type: 'SAVE_DEMO_MEMBER',
      commandId: makeId(),
      memberId: memberId || null,
      name: memberName,
      roleProposed: memberRole,
      specialties: memberSpecialties,
      groupIds: memberGroups,
      active: memberActive,
    });
    if (!result.ok) {
      setMemberError(result.error);
      announce(result.error.message, 'error');
      if (result.error.field) {
        window.setTimeout(() => document.getElementById(result.error.field!)?.focus(), 0);
      }
      return;
    }
    setMemberError(null);
    announce(memberId ? 'Probni clan je azuriran.' : 'Novi probni clan je dodat.');
    if (!memberId) chooseMember('');
  }

  function chooseGroup(nextId: string) {
    setGroupError(null);
    setGroupId(nextId);
    setGroupName(state.groups.find((item) => item.id === nextId)?.name ?? '');
  }

  function saveGroup(event: FormEvent) {
    event.preventDefault();
    const result = run({
      type: 'SAVE_DEMO_GROUP',
      commandId: makeId(),
      groupId: groupId || null,
      name: groupName,
    });
    if (!result.ok) {
      setGroupError(result.error);
      announce(result.error.message, 'error');
      return;
    }
    setGroupError(null);
    announce(groupId ? 'Probna grupa je preimenovana.' : 'Nova probna grupa je dodata.');
    if (!groupId) chooseGroup('');
  }

  function chooseVehicle(nextId: string) {
    setVehicleError(null);
    setVehicleId(nextId);
    const vehicle = state.vehicles.find((item) => item.id === nextId);
    setVehicleCallsign(vehicle?.callsign ?? '');
    setVehicleName(vehicle?.name ?? '');
    setVehicleType(vehicle?.type ?? '');
  }

  function saveVehicle(event: FormEvent) {
    event.preventDefault();
    const result = run({
      type: 'SAVE_DEMO_VEHICLE',
      commandId: makeId(),
      vehicleId: vehicleId || null,
      callsign: vehicleCallsign,
      name: vehicleName,
      vehicleType,
    });
    if (!result.ok) {
      setVehicleError(result.error);
      announce(result.error.message, 'error');
      return;
    }
    setVehicleError(null);
    announce(vehicleId ? 'Probno vozilo je azurirano.' : 'Novo probno vozilo je dodato.');
    if (!vehicleId) chooseVehicle('');
  }

  return (
    <section className="card admin-panel" aria-labelledby="admin-panel-h">
      <div className="card__head">
        <div>
          <p className="card__kicker">Samo ovaj pregledac</p>
          <h2 id="admin-panel-h">Upravljanje probnim podacima</h2>
        </div>
      </div>

      <Notice tone="warn">
        Unosite samo izmisljene podatke za demonstraciju. Ne unosite imena, telefone, adrese,
        registracije ni druge podatke stvarnih clanova DVD Tivat-a. Ove kontrole nijesu stvarna
        administratorska ovlascenja.
      </Notice>

      <div className="admin-grid">
        <form className="admin-editor" onSubmit={saveMember} noValidate>
          <div className="admin-editor__head">
            <span className="step-number" aria-hidden="true">01</span>
            <div><p className="card__kicker">Spisak</p><h3>Probni clan</h3></div>
          </div>

          {memberError && !memberError.field ? <Notice tone="error">{memberError.message}</Notice> : null}

          <Field label="Izaberite zapis za izmjenu" hint="Ostavite 'Novi probni clan' za dodavanje.">
            {(props) => (
              <select {...props} value={memberId} onChange={(event) => chooseMember(event.target.value)} data-testid="admin-member-select">
                <option value="">Novi probni clan</option>
                {state.members.map((member) => (
                  <option value={member.id} key={member.id}>{member.name}{member.active ? '' : ' - neaktivan'}</option>
                ))}
              </select>
            )}
          </Field>

          <Field controlId="demoMemberName" label="Izmisljeno ime" required error={errorFor(memberError, 'demoMemberName')}>
            {(props) => <input {...props} type="text" value={memberName} onChange={(event) => setMemberName(event.target.value)} />}
          </Field>

          <Field label="Predlozena uloga" required>
            {(props) => (
              <select {...props} value={memberRole} onChange={(event) => setMemberRole(event.target.value as RoleId)}>
                {ROLES.map((role) => <option value={role} key={role}>{ROLE_LABEL[role]}</option>)}
              </select>
            )}
          </Field>

          <fieldset>
            <legend>Specijalnosti (opciono)</legend>
            <div className="check-list check-list--2">
              {SPECIALTIES.map((specialty) => (
                <label className="check" key={specialty}>
                  <input aria-label={SPECIALTY_LABEL[specialty]} type="checkbox" checked={memberSpecialties.includes(specialty)} onChange={() => toggleSpecialty(specialty)} />
                  <span className="check__body"><span className="check__name">{SPECIALTY_LABEL[specialty]}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset aria-describedby={memberError?.field === 'demoMemberGroups' ? 'demoMemberGroups-error' : undefined}>
            <legend>Probne grupe (opciono)</legend>
            <div className="check-list check-list--2">
              {state.groups.map((group) => (
                <label className="check" key={group.id}>
                  <input aria-label={group.name} type="checkbox" checked={memberGroups.includes(group.id)} onChange={() => toggleGroup(group.id)} />
                  <span className="check__body"><span className="check__name">{group.name}</span></span>
                </label>
              ))}
            </div>
            {memberError?.field === 'demoMemberGroups' ? <p className="field__error" id="demoMemberGroups-error">! {memberError.message}</p> : null}
          </fieldset>

          <label className="check admin-editor__active">
            <input aria-label="Aktivan u probnom spisku" type="checkbox" checked={memberActive} onChange={(event) => setMemberActive(event.target.checked)} />
            <span className="check__body"><span className="check__name">Aktivan u probnom spisku</span><span className="muted small">Neaktivan clan se ne nudi kao primalac novog poziva.</span></span>
          </label>

          <button className="btn btn--primary" type="submit" data-testid="save-demo-member">{memberId ? 'Sacuvaj izmjene clana' : 'Dodaj probnog clana'}</button>
        </form>

        <div className="admin-side-stack">
          <form className="admin-editor" onSubmit={saveGroup} noValidate>
            <div className="admin-editor__head">
              <span className="step-number" aria-hidden="true">02</span>
              <div><p className="card__kicker">Organizacija</p><h3>Probna grupa</h3></div>
            </div>
            {groupError && !groupError.field ? <Notice tone="error">{groupError.message}</Notice> : null}
            <Field label="Izaberite grupu za preimenovanje">
              {(props) => (
                <select {...props} value={groupId} onChange={(event) => chooseGroup(event.target.value)} data-testid="admin-group-select">
                  <option value="">Nova probna grupa</option>
                  {state.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
                </select>
              )}
            </Field>
            <Field controlId="demoGroupName" label="Naziv grupe" required error={errorFor(groupError, 'demoGroupName')}>
              {(props) => <input {...props} type="text" value={groupName} onChange={(event) => setGroupName(event.target.value)} />}
            </Field>
            <p className="field__hint">Clanovi se dodaju i uklanjaju kroz obrazac probnog clana, da se evidencija ne razidje.</p>
            <button className="btn" type="submit" data-testid="save-demo-group">{groupId ? 'Sacuvaj naziv grupe' : 'Dodaj probnu grupu'}</button>
          </form>

          <form className="admin-editor" onSubmit={saveVehicle} noValidate>
            <div className="admin-editor__head">
              <span className="step-number" aria-hidden="true">03</span>
              <div><p className="card__kicker">Vozni park</p><h3>Probno vozilo</h3></div>
            </div>
            {vehicleError && !vehicleError.field ? <Notice tone="error">{vehicleError.message}</Notice> : null}
            <Field label="Izaberite vozilo za izmjenu">
              {(props) => (
                <select {...props} value={vehicleId} onChange={(event) => chooseVehicle(event.target.value)} data-testid="admin-vehicle-select">
                  <option value="">Novo probno vozilo</option>
                  {state.vehicles.map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicle.callsign} - {vehicle.name}</option>)}
                </select>
              )}
            </Field>
            <div className="admin-vehicle-fields">
              <Field controlId="demoVehicleCallsign" label="Oznaka" required error={errorFor(vehicleError, 'demoVehicleCallsign')}>
                {(props) => <input {...props} type="text" value={vehicleCallsign} onChange={(event) => setVehicleCallsign(event.target.value)} />}
              </Field>
              <Field controlId="demoVehicleType" label="Vrsta" required error={errorFor(vehicleError, 'demoVehicleType')}>
                {(props) => <input {...props} type="text" value={vehicleType} onChange={(event) => setVehicleType(event.target.value)} />}
              </Field>
            </div>
            <Field controlId="demoVehicleName" label="Naziv vozila" required error={errorFor(vehicleError, 'demoVehicleName')}>
              {(props) => <input {...props} type="text" value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} />}
            </Field>
            <button className="btn" type="submit" data-testid="save-demo-vehicle">{vehicleId ? 'Sacuvaj izmjene vozila' : 'Dodaj probno vozilo'}</button>
          </form>
        </div>
      </div>
    </section>
  );
}
