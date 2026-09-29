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
  select: '' as string,
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
        select: (selection: string) => {
          recorded.select = selection;
          return builder;
        },
        eq: (key: string, value: unknown) => {
          recorded.filters[key] = value;
          return builder;
        },
        in: (key: string, values: readonly string[]) => {
          recorded.filters[key] = values;
          return builder;
        },
        limit: (_count: number) => builder,
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
          Promise.resolve({
            // Hosted REST APIs commonly cap a response. A joined parent filter
            // must run before that cap, or years of closed history hide a new page.
            data: recorded.error ? null : (
              recorded.select.includes('interventions!inner(') &&
              Array.isArray(recorded.filters['interventions.status'])
                ? recorded.rows.filter((row) => {
                    const related = (row as {
                      interventions: { status: string } | { status: string }[] | null;
                    }).interventions;
                    const status = (Array.isArray(related) ? related[0] : related)?.status ?? '';
                    return (recorded.filters['interventions.status'] as readonly string[]).includes(status);
                  })
                : recorded.rows
            ).slice(0, 1000),
            error: recorded.error,
          }).then(
            resolve,
          ),
      };
      return builder;
    },
  }),
}));

import {
  fetchAddressedInterventions, fetchAddressedOpenInterventionIds, fetchTargetedInterventions,
} from './operations';

const DVD = '00000000-0000-4000-8000-000000000001';
const MEMBER = '00000000-0000-4000-8000-000000000101';

/** A minimally-complete embedded intervention row, as PostgREST returns it. */
const embeddedIntervention = (id: string, overrides: Record<string, unknown> = {}) => ({
  interventions: {
    id,
    kind: 'POZAR',
    other_kind_note: null,
    title: 'Zajednicka intervencija',
    instructions: 'Upute.',
    incident_location: 'Lokacija',
    assembly_point: null,
    latitude: null,
    longitude: null,
    status: 'PUBLISHED',
    version: 2,
    published_at: '2026-09-29T10:00:00Z',
    closed_at: null,
    close_reason: null,
    created_at: '2026-09-29T09:59:00Z',
    ...overrides,
  },
});

beforeEach(() => {
  recorded.table = '';
  recorded.select = '';
  recorded.filters = {};
  recorded.rows = [];
  recorded.error = null;
});

describe('fetchAddressedOpenInterventionIds', () => {
  it('reads the member’s own recipient rows, scoped by service and member', async () => {
    await fetchAddressedOpenInterventionIds(DVD, MEMBER);
    expect(recorded.table).toBe('intervention_recipients');
    expect(recorded.filters).toMatchObject({ organization_id: DVD, member_id: MEMBER });
  });

  it('filters open parent call-outs before the API row cap, keeping a new page after long history', async () => {
    recorded.rows = [
      ...Array.from({ length: 1000 }, (_, index) => ({
        intervention_id: `closed-${index}`,
        interventions: { status: 'CLOSED' },
      })),
      { intervention_id: 'new-open', interventions: { status: 'PUBLISHED' } },
    ];
    const result = await fetchAddressedOpenInterventionIds(DVD, MEMBER);
    expect(recorded.select).toContain('interventions!inner(status)');
    expect(recorded.filters['interventions.status']).toEqual([
      'PUBLISHED', 'ASSEMBLING', 'DEPLOYED', 'CONTAINED',
    ]);
    expect(result).toEqual({ ok: true, value: ['new-open'] });
  });

  it('keeps only the OPEN call-outs, dropping drafts and closed ones', async () => {
    recorded.rows = [
      { intervention_id: 'open-1', interventions: { status: 'PUBLISHED' } },
      { intervention_id: 'assembling-1', interventions: { status: 'ASSEMBLING' } },
      { intervention_id: 'closed-1', interventions: { status: 'CLOSED' } },
      { intervention_id: 'cancelled-1', interventions: { status: 'CANCELLED' } },
      { intervention_id: 'draft-1', interventions: { status: 'DRAFT' } },
    ];
    const result = await fetchAddressedOpenInterventionIds(DVD, MEMBER);
    expect(result.ok).toBe(true);
    expect(result.ok && [...result.value].sort()).toEqual(['assembling-1', 'open-1']);
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

describe('fetchAddressedInterventions', () => {
  it('reads the member’s own recipient rows in one service, embedding the call-out', async () => {
    recorded.rows = [embeddedIntervention('joint-1')];
    await fetchAddressedInterventions(DVD, MEMBER);
    expect(recorded.table).toBe('intervention_recipients');
    expect(recorded.select).toContain('interventions!inner(');
    expect(recorded.filters).toMatchObject({ organization_id: DVD, member_id: MEMBER });
  });

  it('returns the full call-out embedded through the recipient row (a joint call-out owned elsewhere)', async () => {
    recorded.rows = [embeddedIntervention('joint-1', { title: 'SZS zove DVD' })];
    const result = await fetchAddressedInterventions(DVD, MEMBER);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toHaveLength(1);
    expect(result.ok && result.value[0]).toMatchObject({ id: 'joint-1', title: 'SZS zove DVD', status: 'PUBLISHED' });
  });

  it('de-duplicates by call-out id, even if two recipient rows point at one call-out', async () => {
    recorded.rows = [embeddedIntervention('joint-1'), embeddedIntervention('joint-1')];
    const result = await fetchAddressedInterventions(DVD, MEMBER);
    expect(result.ok && result.value.map((i) => i.id)).toEqual(['joint-1']);
  });

  it('tolerates the embedded call-out arriving as an array', async () => {
    recorded.rows = [{ interventions: [embeddedIntervention('arr-1').interventions] }];
    const result = await fetchAddressedInterventions(DVD, MEMBER);
    expect(result.ok && result.value.map((i) => i.id)).toEqual(['arr-1']);
  });

  it('fails closed on an error - never an empty success', async () => {
    recorded.error = { code: '42501', message: 'permission denied' };
    const result = await fetchAddressedInterventions(DVD, MEMBER);
    expect(result.ok).toBe(false);
  });
});

describe('fetchTargetedInterventions', () => {
  it('reads shared incidents through rows targeting the selected service, without a member id', async () => {
    recorded.rows = [embeddedIntervention('joint-archive', { status: 'CLOSED' })];
    const result = await fetchTargetedInterventions(DVD);
    expect(recorded.table).toBe('intervention_recipient_organizations');
    expect(recorded.filters).toMatchObject({ organization_id: DVD });
    expect(recorded.select).toContain('interventions!inner(');
    expect(result.ok && result.value[0]).toMatchObject({ id: 'joint-archive', status: 'CLOSED' });
  });

  it('keeps a refused archive read distinct from an empty archive', async () => {
    recorded.error = { code: '42501', message: 'permission denied' };
    expect((await fetchTargetedInterventions(DVD)).ok).toBe(false);
  });
});
