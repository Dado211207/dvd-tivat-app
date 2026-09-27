/**
 * P6: the registry adapters ask the server for ONE service.
 *
 * The row-level-security policies already refuse a service the caller is not staff
 * in (202609240024), but a dual-service admin and the installation owner are staff
 * in both - so for them isolation is the client's job too: it must ask for the
 * acting service and only that one. These tests pin the exact request each adapter
 * issues, so "acting as DVD" can never carry an SZS filter, or none at all.
 *
 * The backend is a recording stub. It proves what the client SENDS; the real
 * isolation against real RLS is proven in db-tests/service_registry_scope.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  backend: null as unknown as ReturnType<typeof makeRecordingBackend>,
}));

vi.mock('./supabaseClient', () => ({
  accountBackend: () => hoisted.backend,
}));

interface ReadCall {
  readonly table: string;
  readonly filters: Record<string, unknown>;
}
interface RpcCall {
  readonly rpc: string;
  readonly args: Record<string, unknown> | undefined;
}

function makeRecordingBackend() {
  const reads: ReadCall[] = [];
  const rpcs: RpcCall[] = [];

  function query(table: string) {
    const filters: Record<string, unknown> = {};
    let recorded = false;
    const record = () => {
      if (!recorded) {
        recorded = true;
        reads.push({ table, filters });
      }
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      // Awaiting the builder resolves the read; record it exactly once.
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
        record();
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    };
    return builder;
  }

  return {
    reads,
    rpcs,
    from: (table: string) => query(table),
    rpc: (name: string, args?: Record<string, unknown>) => {
      rpcs.push({ rpc: name, args });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

// Imported AFTER the mock is registered.
import {
  createGroup,
  createMember,
  createVehicle,
  loadGroups,
  loadRoster,
  loadVehicles,
} from './roster';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  hoisted.backend = makeRecordingBackend();
});

describe('registry reads ask for exactly the acting service', () => {
  it('loads the roster of the acting service, and no other', async () => {
    await loadRoster(SZS);
    const members = hoisted.backend.reads.filter((call) => call.table === 'members');
    expect(members).toHaveLength(1);
    expect(members[0]!.filters.organization_id).toBe(SZS);
    // The DVD id appears nowhere in what was asked for.
    expect(JSON.stringify(hoisted.backend.reads)).not.toContain(DVD);
  });

  it('scopes groups AND their membership links to the acting service', async () => {
    await loadGroups(DVD);
    const groups = hoisted.backend.reads.find((call) => call.table === 'groups');
    const links = hoisted.backend.reads.find((call) => call.table === 'group_members');
    expect(groups?.filters.organization_id).toBe(DVD);
    // Without the link filter a DVD group would still list an SZS member id.
    expect(links?.filters.organization_id).toBe(DVD);
  });

  it('scopes vehicles to the acting service', async () => {
    await loadVehicles(SZS);
    const vehicles = hoisted.backend.reads.find((call) => call.table === 'vehicles');
    expect(vehicles?.filters.organization_id).toBe(SZS);
  });

  it('still issues an unscoped read when no service is given (the pre-P6 call-out path)', async () => {
    await loadRoster();
    const members = hoisted.backend.reads.find((call) => call.table === 'members');
    expect(members?.filters.organization_id).toBeUndefined();
  });
});

describe('registry creates target the acting service', () => {
  it('creates a member in the named service via the *_in command', async () => {
    await createMember(SZS, 'Ime Prezime', []);
    expect(hoisted.backend.rpcs).toContainEqual({
      rpc: 'admin_create_member_in',
      args: { target_organization: SZS, requested_full_name: 'Ime Prezime', requested_specialties: [] },
    });
  });

  it('creates a group in the named service', async () => {
    await createGroup(DVD, 'Prva ekipa');
    expect(hoisted.backend.rpcs).toContainEqual({
      rpc: 'admin_create_group_in',
      args: { target_organization: DVD, requested_name: 'Prva ekipa' },
    });
  });

  it('creates a vehicle in the named service', async () => {
    await createVehicle(SZS, 'V-1', 'Navalno', 'navalno');
    expect(hoisted.backend.rpcs).toContainEqual({
      rpc: 'admin_create_vehicle_in',
      args: {
        target_organization: SZS,
        requested_callsign: 'V-1',
        requested_name: 'Navalno',
        requested_kind: 'navalno',
      },
    });
  });
});
