import { beforeEach, describe, expect, it, vi } from 'vitest';

const recorded = vi.hoisted(() => ({
  reads: [] as { table: string; filters: Record<string, unknown> }[],
  rpcs: [] as { name: string; args: Record<string, unknown> | undefined }[],
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
      return Promise.resolve({ data: name.startsWith('eligible_') ? [] : 'id', error: null });
    },
  }),
}));

import {
  createDraft, fetchAvailability, fetchEligibleRecipients, fetchInterventions,
  fetchVehicleMovements, setOwnAvailability,
} from './operations';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

beforeEach(() => { recorded.reads.length = 0; recorded.rpcs.length = 0; });

describe('operational data asks for the selected service', () => {
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
