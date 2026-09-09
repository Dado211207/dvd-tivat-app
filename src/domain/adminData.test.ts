/**
 * Local administration rules for the demonstration roster.
 *
 * These tests deliberately exercise the pure domain rather than the form. The
 * prototype has no real administrator account or server-side permission check;
 * it only lets a presenter maintain fictional data in this browser.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand, resolveRecipients } from './reducer';
import { cid, emptyState, makeCtx, must } from './testing';

describe('fictional member administration', () => {
  it('adds a member and keeps both sides of group membership in sync', () => {
    const { ctx } = makeCtx();
    const before = emptyState();
    const after = must(
      before,
      {
        type: 'SAVE_DEMO_MEMBER',
        commandId: cid(),
        actorId: 'm-01',
        memberId: null,
        name: 'Probni Clan 15',
        roleProposed: 'CLAN',
        specialties: ['PRVA_POMOC', 'PRVA_POMOC'],
        groupIds: ['g-prva-pomoc', 'g-svi', 'g-svi'],
        active: true,
      },
      ctx,
    );

    const member = after.members.at(-1)!;
    expect(member).toMatchObject({
      name: 'Probni Clan 15',
      specialties: ['PRVA_POMOC'],
      groupIds: ['g-prva-pomoc', 'g-svi'],
      active: true,
    });
    expect(member.contactLabel).toMatch(/^demo-kontakt-\d+$/);
    expect(after.groups.find((group) => group.id === 'g-prva-pomoc')!.memberIds).toContain(member.id);
    expect(after.groups.find((group) => group.id === 'g-svi')!.memberIds).toContain(member.id);
    expect(after.groups.find((group) => group.id === 'g-ida')!.memberIds).not.toContain(member.id);
    expect(after.activity[0]).toMatchObject({ kind: 'PROBNI_CLAN_SACUVAN', actorId: 'm-01' });
    expect(after.calls).toEqual(before.calls);
    expect(after.deliveryAttempts).toEqual(before.deliveryAttempts);
  });

  it('moves an existing member between groups without leaving stale membership', () => {
    const { ctx } = makeCtx();
    const before = emptyState();
    const after = must(
      before,
      {
        type: 'SAVE_DEMO_MEMBER',
        commandId: cid(),
        actorId: 'm-01',
        memberId: 'm-04',
        name: 'Ivan Radulovic - proba',
        roleProposed: 'CLAN',
        specialties: ['TEHNICKO_SPASAVANJE'],
        groupIds: ['g-tehnicka'],
        active: true,
      },
      ctx,
    );

    expect(after.members.find((member) => member.id === 'm-04')!.groupIds).toEqual(['g-tehnicka']);
    expect(after.groups.find((group) => group.id === 'g-tehnicka')!.memberIds).toContain('m-04');
    expect(after.groups.find((group) => group.id === 'g-ida')!.memberIds).not.toContain('m-04');
    expect(after.groups.find((group) => group.id === 'g-svi')!.memberIds).not.toContain('m-04');
  });

  it('excludes a deactivated member from recipient resolution', () => {
    const { ctx } = makeCtx();
    const after = must(
      emptyState(),
      {
        type: 'SAVE_DEMO_MEMBER',
        commandId: cid(),
        actorId: 'm-01',
        memberId: 'm-04',
        name: 'Ivan Radulovic',
        roleProposed: 'CLAN',
        specialties: ['IDA', 'TEHNICKO_SPASAVANJE'],
        groupIds: ['g-ida', 'g-tehnicka', 'g-svi'],
        active: false,
      },
      ctx,
    );

    expect(resolveRecipients(after, ['m-04'], ['g-ida'])).not.toContain('m-04');
  });

  it('keeps the simulated role aligned when the selected member is edited', () => {
    const { ctx } = makeCtx();
    const after = must(
      emptyState(),
      {
        type: 'SAVE_DEMO_MEMBER',
        commandId: cid(),
        actorId: 'm-01',
        memberId: 'm-02',
        name: 'Ana Vukovic',
        roleProposed: 'ADMIN',
        specialties: ['KOMANDNI_KADAR'],
        groupIds: ['g-komanda', 'g-svi'],
        active: true,
      },
      ctx,
    );

    expect(after.simulation).toEqual({ actorId: 'm-02', viewRole: 'ADMIN' });
  });

  it('rejects blank names, unknown groups and unknown edit targets', () => {
    const { ctx } = makeCtx();
    const base = {
      type: 'SAVE_DEMO_MEMBER' as const,
      commandId: cid(),
      actorId: 'm-01',
      memberId: null,
      name: 'Probni Clan',
      roleProposed: 'CLAN' as const,
      specialties: [],
      groupIds: [],
      active: true,
    };

    const blank = applyCommand(emptyState(), { ...base, commandId: cid(), name: '  ' }, ctx);
    const unknownGroup = applyCommand(
      emptyState(),
      { ...base, commandId: cid(), groupIds: ['g-ne-postoji'] },
      ctx,
    );
    const unknownMember = applyCommand(
      emptyState(),
      { ...base, commandId: cid(), memberId: 'm-ne-postoji' },
      ctx,
    );

    expect(blank.ok ? null : blank.error.code).toBe('NEDOSTAJE_IME_CLANA');
    expect(unknownGroup.ok ? null : unknownGroup.error.code).toBe('NEPOZNATA_GRUPA');
    expect(unknownMember.ok ? null : unknownMember.error.code).toBe('CLAN_ZA_IZMJENU_NE_POSTOJI');
  });
});

describe('fictional group and vehicle administration', () => {
  it('adds and renames a group while preserving its member ids', () => {
    const { ctx } = makeCtx();
    let state = must(
      emptyState(),
      { type: 'SAVE_DEMO_GROUP', commandId: cid(), actorId: 'm-01', groupId: null, name: 'Nova probna grupa' },
      ctx,
    );
    const group = state.groups.at(-1)!;
    state = {
      ...state,
      groups: state.groups.map((item) => (item.id === group.id ? { ...item, memberIds: ['m-14'] } : item)),
    };
    state = must(
      state,
      { type: 'SAVE_DEMO_GROUP', commandId: cid(), actorId: 'm-01', groupId: group.id, name: 'Preimenovana probna grupa' },
      ctx,
    );

    expect(state.groups.find((item) => item.id === group.id)).toEqual({
      id: group.id,
      name: 'Preimenovana probna grupa',
      memberIds: ['m-14'],
    });
    expect(state.activity[0]!.kind).toBe('PROBNA_GRUPA_SACUVANA');
  });

  it('rejects duplicate group names without changing the state', () => {
    const { ctx } = makeCtx();
    const state = emptyState();
    const result = applyCommand(
      state,
      { type: 'SAVE_DEMO_GROUP', commandId: cid(), actorId: 'm-01', groupId: null, name: ' komandni KADAR ' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUPLIKAT_NAZIVA_GRUPE');
    expect(state.groups).toHaveLength(6);
  });

  it('adds and updates a vehicle without changing movement history', () => {
    const { ctx } = makeCtx();
    const before = emptyState();
    let state = must(
      before,
      {
        type: 'SAVE_DEMO_VEHICLE',
        commandId: cid(),
        actorId: 'm-01',
        vehicleId: null,
        callsign: 'PV-2',
        name: 'Probno vozilo',
        vehicleType: 'Logistika',
      },
      ctx,
    );
    const vehicle = state.vehicles.at(-1)!;
    state = must(
      state,
      {
        type: 'SAVE_DEMO_VEHICLE',
        commandId: cid(),
        actorId: 'm-01',
        vehicleId: vehicle.id,
        callsign: 'PV-3',
        name: 'Azurirano probno vozilo',
        vehicleType: 'Podrska',
      },
      ctx,
    );

    expect(state.vehicles.find((item) => item.id === vehicle.id)).toMatchObject({
      callsign: 'PV-3',
      name: 'Azurirano probno vozilo',
      type: 'Podrska',
    });
    expect(state.vehicleMovements).toEqual(before.vehicleMovements);
    expect(state.activity[0]!.kind).toBe('PROBNO_VOZILO_SACUVANO');
  });

  it('rejects duplicate callsigns case-insensitively', () => {
    const { ctx } = makeCtx();
    const result = applyCommand(
      emptyState(),
      {
        type: 'SAVE_DEMO_VEHICLE',
        commandId: cid(),
        actorId: 'm-01',
        vehicleId: null,
        callsign: ' nv-1 ',
        name: 'Duplikat',
        vehicleType: 'Probno',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUPLIKAT_OZNAKE_VOZILA');
  });

  it('treats a repeated admin command as a no-op', () => {
    const { ctx } = makeCtx();
    const command = {
      type: 'SAVE_DEMO_GROUP' as const,
      commandId: cid(),
      actorId: 'm-01',
      groupId: null,
      name: 'Idempotentna grupa',
    };
    const once = must(emptyState(), command, ctx);
    const twice = must(once, command, ctx);
    expect(twice).toBe(once);
  });
});
