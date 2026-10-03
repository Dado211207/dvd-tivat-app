import { beforeEach, describe, expect, it, vi } from 'vitest';

const recorded = vi.hoisted(() => ({
  reads: [] as { table: string; filters: Record<string, unknown> }[],
  rpcs: [] as { name: string; args: Record<string, unknown> | undefined }[],
  totalsFilter: [] as { column: string; values: readonly string[] }[],
}));

vi.mock('./supabaseClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./supabaseClient')>()),
  accountBackend: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
          recorded.reads.push({ table, filters });
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return builder;
    },
    rpc: (name: string, args?: Record<string, unknown>) => {
      recorded.rpcs.push({ name, args });
      if (name === 'attendance_totals') return {
        in: (column: string, values: readonly string[]) => {
          recorded.totalsFilter.push({ column, values });
          return Promise.resolve({ data: [], error: null });
        },
      };
      if (name === 'callout_readiness') return Promise.resolve({
        data: [{ eligible_count: 5, push_ready_count: 3, checked_at: '2026-10-02T13:00:00Z' }],
        error: null,
      });
      return Promise.resolve({ data: name.startsWith('eligible_') ? [] : 'id', error: null });
    },
  }),
}));

import {
  createDraft, fetchAvailability, fetchCalloutReadiness, fetchEligibleRecipients, fetchInterventions,
  fetchParticipationTotals, fetchVehicleMovements, setOwnAvailability,
} from './operations';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

beforeEach(() => { recorded.reads.length = 0; recorded.rpcs.length = 0; recorded.totalsFilter.length = 0; });

describe('operational data asks for the selected service', () => {
  it('restricts participation totals at the RPC to the selected roster, including for dual-service command', async () => {
    const memberIds = ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102'];
    await fetchParticipationTotals(memberIds);
    expect(recorded.totalsFilter).toEqual([{ column: 'member_id', values: memberIds }]);
    expect(recorded.rpcs).toEqual([{ name: 'attendance_totals', args: {} }]);
  });

  it('does not request totals from other services when the selected roster is empty', async () => {
    expect(await fetchParticipationTotals([])).toEqual({ ok: true, value: [] });
    expect(recorded.rpcs).toEqual([]);
  });
  it('filters every call-out, availability and vehicle read before data returns', async () => {
    await Promise.all([fetchInterventions(SZS), fetchAvailability(SZS), fetchVehicleMovements(SZS)]);
    expect(recorded.reads.map(({ table }) => table).sort()).toEqual([
      'interventions', 'member_availability', 'vehicle_movements', 'vehicles',
    ]);
    for (const read of recorded.reads) expect(read.filters.organization_id).toBe(SZS);
    expect(JSON.stringify(recorded.reads)).not.toContain(DVD);
  });

  it('asks the service-aware recipient command, and creates a draft in that service', async () => {
    await fetchEligibleRecipients(SZS);
    await createDraft({
      organizationId: SZS, kind: 'POZAR', title: 'Poziv', instructions: 'Upute',
      location: 'Tivat', idempotencyKey: 'same-key',
    });
    expect(recorded.rpcs[0]).toEqual({
      name: 'eligible_recipients_in', args: { target_organization: SZS },
    });
    expect(recorded.rpcs[1]?.name).toBe('create_intervention_draft_in');
    expect(recorded.rpcs[1]?.args?.target_organization).toBe(SZS);
  });

  it('asks the server for aggregate readiness without reading another service roster', async () => {
    expect(await fetchCalloutReadiness(DVD, true, [SZS])).toEqual({
      eligibleCount: 5, pushReadyCount: 3, checkedAt: '2026-10-02T13:00:00Z',
    });
    expect(recorded.rpcs).toEqual([{ name: 'callout_readiness', args: {
      publisher_organization: DVD, include_own: true, recipient_organization_ids: [SZS],
    } }]);
    expect(recorded.reads).toEqual([]);
  });

  it('writes availability to the chosen member record, including for a dual-service user', async () => {
    await setOwnAvailability(true, null, DVD);
    await setOwnAvailability(false, 'Na poslu', SZS);
    expect(recorded.rpcs.map(({ name, args }) => [name, args?.target_organization])).toEqual([
      ['set_own_availability_in', DVD], ['set_own_availability_in', SZS],
    ]);
  });

  it('keeps the DVD compatibility API for existing callers', async () => {
    await fetchInterventions();
    await fetchAvailability();
    await fetchVehicleMovements();
    await fetchEligibleRecipients();
    await setOwnAvailability(true, null);
    expect(recorded.reads.every(({ filters }) => filters.organization_id === undefined)).toBe(true);
    expect(recorded.rpcs.map(({ name }) => name)).toEqual(['eligible_recipients', 'set_own_availability']);
  });
});
