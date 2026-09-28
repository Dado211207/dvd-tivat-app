/**
 * P6: the own-member read asks for the member record in ONE service.
 *
 * A person may hold a member record in each service (202609240022). The gate reads
 * the record for the service being acted as, through `current_member_id_in`; the
 * old shim `current_member_id` (which is `current_member_id_in(DVD)`) stays for the
 * call-out screens that have not been made service-aware yet. These tests pin which
 * RPC is called so a switch cannot leave the previous service's member on screen.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  rpcs: [] as { name: string; args: Record<string, unknown> | undefined }[],
  result: { data: null as unknown, error: null as unknown },
}));

vi.mock('./supabaseClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./supabaseClient')>()),
  accountBackend: () => ({
    rpc: (name: string, args?: Record<string, unknown>) => {
      hoisted.rpcs.push({ name, args });
      return Promise.resolve(hoisted.result);
    },
  }),
}));

import { fetchOwnMemberId } from './operations';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  hoisted.rpcs = [];
  hoisted.result = { data: 'member-1', error: null };
});

describe('fetchOwnMemberId is service-aware', () => {
  it('reads the member in the acting service via current_member_id_in', async () => {
    const result = await fetchOwnMemberId(SZS);
    expect(hoisted.rpcs).toEqual([
      { name: 'current_member_id_in', args: { target_organization: SZS } },
    ]);
    expect(result).toEqual({ ok: true, value: 'member-1' });
  });

  it('asks the DVD service for its own member, never the other, when acting as DVD', async () => {
    await fetchOwnMemberId(DVD);
    expect(hoisted.rpcs[0]!.args).toEqual({ target_organization: DVD });
    expect(JSON.stringify(hoisted.rpcs)).not.toContain(SZS);
  });

  it('keeps the DVD-only shim when no service is given', async () => {
    await fetchOwnMemberId();
    expect(hoisted.rpcs).toEqual([{ name: 'current_member_id', args: undefined }]);
  });

  it('reports a refused read as a failure, not as "no member"', async () => {
    hoisted.result = { data: null, error: { code: '42501', message: 'permission denied' } };
    const result = await fetchOwnMemberId(SZS);
    expect(result.ok).toBe(false);
  });
});
