import { describe, expect, it } from 'vitest';
import { applyCommand } from './reducer';
import { cid, emptyState, makeCtx, must } from './testing';

const report = (overrides: Record<string, unknown> = {}) => ({
  type: 'SUBMIT_CITIZEN_REPORT' as const,
  commandId: cid(),
  actorId: 'm-02',
  kind: 'POZAR_ILI_DIM' as const,
  description: 'Gust dim se vidi iza izmisljene zgrade.',
  incidentLocation: 'Izmisljeni orijentir',
  coordinates: null,
  photoIncluded: false,
  ...overrides,
});

describe('citizen report intake', () => {
  it('stores an honest local-only report without fabricating any operational record', () => {
    const { ctx } = makeCtx();
    const before = emptyState();
    const after = must(before, report(), ctx);

    expect(after.citizenReports).toHaveLength(1);
    expect(after.citizenReports[0]).toMatchObject({
      status: 'SACUVANA_LOKALNO',
      reviewedAt: null,
      reviewedBy: null,
      photoIncluded: false,
    });
    expect(after.exercises).toEqual(before.exercises);
    expect(after.calls).toEqual(before.calls);
    expect(after.deliveryAttempts).toEqual(before.deliveryAttempts);
    expect(after.responses).toEqual(before.responses);
    expect(after.vehicleMovements).toEqual(before.vehicleMovements);
  });

  it('requires a description', () => {
    const { ctx } = makeCtx();
    const result = applyCommand(emptyState(), report({ description: '  ' }), ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NEDOSTAJE_OPIS_PRIJAVE');
      expect(result.error.field).toBe('reportDescription');
    }
  });

  it('requires either a typed place or explicit coordinates', () => {
    const { ctx } = makeCtx();
    const result = applyCommand(
      emptyState(),
      report({ incidentLocation: '', coordinates: null }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NEDOSTAJE_LOKACIJA_PRIJAVE');
  });

  it('accepts explicit coordinates when no place was typed', () => {
    const { ctx } = makeCtx();
    const coordinates = { latitude: 1.234567, longitude: 2.345678, accuracyMeters: 12 };
    const after = must(
      emptyState(),
      report({ incidentLocation: '', coordinates }),
      ctx,
    );
    expect(after.citizenReports[0]!.incidentLocation).toBe('');
    expect(after.citizenReports[0]!.coordinates).toEqual(coordinates);
  });

  it('retains map provenance and rejects incomplete provenance', () => {
    const { ctx } = makeCtx();
    const coordinates = {
      latitude: 42.4319,
      longitude: 18.7112,
      accuracyMeters: null,
      source: 'MAP_PIN' as const,
      capturedAt: '2026-09-09T07:00:00.000Z',
    };
    const after = must(emptyState(), report({ incidentLocation: '', coordinates }), ctx);
    expect(after.citizenReports[0]!.coordinates).toEqual(coordinates);

    const invalid = applyCommand(
      emptyState(),
      report({ incidentLocation: '', coordinates: { ...coordinates, capturedAt: undefined } }),
      ctx,
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('NEISPRAVNE_KOORDINATE');
  });

  it('rejects impossible or non-finite coordinates', () => {
    const { ctx } = makeCtx();
    for (const coordinates of [
      { latitude: 91, longitude: 18, accuracyMeters: 1 },
      { latitude: 42, longitude: -181, accuracyMeters: 1 },
      { latitude: Number.NaN, longitude: 18, accuracyMeters: 1 },
      { latitude: 42, longitude: 18, accuracyMeters: -1 },
    ]) {
      const result = applyCommand(
        emptyState(),
        report({ incidentLocation: '', coordinates }),
        ctx,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NEISPRAVNE_KOORDINATE');
    }
  });

  it('retains only the fact that a photo was included, never bytes or a filename', () => {
    const { ctx } = makeCtx();
    const after = must(emptyState(), report({ photoIncluded: true }), ctx);
    const saved = JSON.stringify(after.citizenReports[0]);
    expect(after.citizenReports[0]!.photoIncluded).toBe(true);
    expect(saved).not.toContain('data:image');
    expect(saved).not.toContain('.jpg');
    expect(Object.keys(after.citizenReports[0]!)).not.toContain('photo');
  });

  it('is idempotent when the same submission is repeated', () => {
    const { ctx } = makeCtx();
    const command = report();
    const once = must(emptyState(), command, ctx);
    const twice = must(once, command, ctx);
    expect(twice).toBe(once);
    expect(twice.citizenReports).toHaveLength(1);
  });

  it('records a local review without accepting or dispatching the report', () => {
    const { ctx, advance } = makeCtx();
    const submitted = must(emptyState(), report(), ctx);
    advance(60_000);
    const reviewed = must(
      submitted,
      {
        type: 'REVIEW_CITIZEN_REPORT',
        commandId: cid(),
        actorId: 'm-02',
        reportId: submitted.citizenReports[0]!.id,
      },
      ctx,
    );

    expect(reviewed.citizenReports[0]).toMatchObject({
      status: 'PREGLEDANA_U_SIMULACIJI',
      reviewedBy: 'm-02',
      reviewedAt: '2026-09-07T10:01:00.000Z',
    });
    expect(reviewed.exercises).toHaveLength(0);
    expect(reviewed.calls).toHaveLength(0);
    expect(reviewed.deliveryAttempts).toHaveLength(0);
  });

  it('refuses to review a report that does not exist', () => {
    const { ctx } = makeCtx();
    const result = applyCommand(
      emptyState(),
      {
        type: 'REVIEW_CITIZEN_REPORT',
        commandId: cid(),
        actorId: 'm-02',
        reportId: 'missing',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PRIJAVA_NE_POSTOJI');
  });
});
