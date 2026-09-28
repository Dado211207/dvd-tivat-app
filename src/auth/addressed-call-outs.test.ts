/**
 * `fetchAddressedOpenInterventionIds` - the recipient read the app-level alarm
 * relies on. This tests the adapter's own logic against a stubbed backend: it
 * asks `intervention_recipients` (the member's own rows, `recipients_self_read`)
 * filtered by service and member, keeps only OPEN call-outs, tolerates either
 * embed shape PostgREST may return, and fails closed on an error. The RLS that
 * makes those rows the member's own and no one else's is proven separately in the
 * database tests (`recipient_organisation_scope`, `organisation_interventions`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const recorded = vi.hoisted(() => ({
  table: '' as string,
  filters: {} as Record<string, unknown>,
  // The rows the stubbed query resolves with, and an optional error.
  rows: [] as unknown[],
  error: null as unknown,
}));

vi.mock('./supabaseClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./supabaseClient')>()),
  accountBackend: () => ({
    from: (table: string) => {
      recorded.table = table;
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          recorded.filters[key] = value;
          return builder;
        },
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
          Promise.resolve({ data: recorded.error ? null : recorded.rows, error: recorded.error }).then(
            resolve,
          ),
      };
      return builder;
    },
  }),
}));

import { fetchAddressedOpenInterventionIds } from './operations';

const DVD = '00000000-0000-4000-8000-000000000001';
const MEMBER = '00000000-0000-4000-8000-000000000101';

beforeEach(() => {
  recorded.table = '';
  recorded.filters = {};
  recorded.rows = [];
  recorded.error = null;
});

describe('fetchAddressedOpenInterventionIds', () => {
  it('reads the member’s own recipient rows, scoped by service and member', async () => {
    await fetchAddressedOpenInterventionIds(DVD, MEMBER);
    expect(recorded.table).toBe('intervention_recipients');
    expect(recorded.filters).toEqual({ organization_id: DVD, member_id: MEMBER });
  });

  it('keeps only the OPEN call-outs, dropping drafts and closed ones', async () => {
    recorded.rows = [
      { intervention_id: 'open-1', interventions: { status: 'PUBLISHED' } },
      { intervention_id: 'ack-1', interventions: { status: 'ACKNOWLEDGED' } },
      { intervention_id: 'closed-1', interventions: { status: 'CLOSED' } },
      { intervention_id: 'cancelled-1', interventions: { status: 'CANCELLED' } },
      { intervention_id: 'draft-1', interventions: { status: 'DRAFT' } },
    ];
    const result = await fetchAddressedOpenInterventionIds(DVD, MEMBER);
    expect(result.ok).toBe(true);
    expect(result.ok && [...result.value].sort()).toEqual(['ack-1', 'open-1']);
  });

  it('tolerates the embedded intervention arriving as an array', async () => {
    recorded.rows = [
      { intervention_id: 'open-arr', interventions: [{ status: 'PUBLISHED' }] },
      { intervention_id: 'closed-arr', interventions: [{ status: 'CLOSED' }] },
    ];
    const result = await fetchAddressedOpenInterventionIds(DVD, MEMBER);
    expect(result.ok && result.value).toEqual(['open-arr']);
  });

  it('drops a row whose intervention could not be embedded rather than guessing', async () => {
    recorded.rows = [
      { intervention_id: 'no-embed', interventions: null },
      { intervention_id: 'open-1', interventions: { status: 'PUBLISHED' } },
    ];
    const result = await fetchAddressedOpenInterventionIds(DVD, MEMBER);
    expect(result.ok && result.value).toEqual(['open-1']);
  });

  it('fails closed on an error - never an empty success', async () => {
    recorded.error = { code: '42501', message: 'permission denied' };
    const result = await fetchAddressedOpenInterventionIds(DVD, MEMBER);
    expect(result.ok).toBe(false);
  });
});
