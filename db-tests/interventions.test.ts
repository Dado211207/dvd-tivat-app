/**
 * Intervention lifecycle, frozen recipients, honest notification state and
 * member responses.
 *
 * The rule this file exists to prove: publishing a call-out creates a QUEUED
 * outbox row and nothing else. It does not claim delivery, it does not invent a
 * response, and it does not mark anybody as attending.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  asUser,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  createDraft,
  createMember,
  expectRefused,
  grantRole,
  resetSchema,
} from './harness';

let db: Client;
let commander: string;
let firefighterA: string;
let memberA: string;
let firefighterB: string;
let memberB: string;
let outsider: string;
let memberOutsider: string;

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  const make = async (email: string, role: string, name: string) => {
    const account = await createAccount(db, email);
    await completeProfile(db, account.userId, name);
    await grantRole(db, account.userId, role);
    const memberId = await createMember(db, name, account.userId);
    return { userId: account.userId, memberId };
  };

  ({ userId: commander } = await make('cmd@example.invalid', 'COMMANDER', 'Ime Komandir'));
  ({ userId: firefighterA, memberId: memberA } = await make('a@example.invalid', 'FIREFIGHTER', 'Ime A'));
  ({ userId: firefighterB, memberId: memberB } = await make('b@example.invalid', 'FIREFIGHTER', 'Ime B'));
  ({ userId: outsider, memberId: memberOutsider } = await make(
    'out@example.invalid',
    'FIREFIGHTER',
    'Ime Van Poziva',
  ));
}, 60_000);

afterAll(async () => {
  await db?.end();
});

/** Publishes a fresh intervention to the given members and returns its id. */
async function published(recipients: string[] = [memberA, memberB]): Promise<string> {
  const id = await createDraft(db, commander);
  await asUserCommitted(db, commander, (client) =>
    client.query('select public.publish_intervention($1, $2)', [id, recipients]),
  );
  return id;
}

describe('the location contract', () => {
  it('requires a typed place, so a bare coordinate pair cannot be published', async () => {
    // The earlier branch let the interface submit coordinates with an empty
    // place while the database demanded 2-300 characters. The contract is now
    // one thing: the text is always required.
    await expect(
      db.query(
        `insert into public.interventions(kind, title, instructions, incident_location, created_by, idempotency_key)
         values ('POZAR', 'Bez mjesta', 'Uputstvo', '', $1, 'k1')`,
        [commander],
      ),
    ).rejects.toThrow(/incident_location/);
  });

  it('refuses coordinates without their provenance and capture time', async () => {
    await expect(
      db.query(
        `insert into public.interventions(kind, title, instructions, incident_location, latitude, longitude, created_by, idempotency_key)
         values ('POZAR', 'Bez izvora', 'Uputstvo', 'Poligon', 42.43, 18.70, $1, 'k2')`,
        [commander],
      ),
    ).rejects.toThrow(/coordinate_provenance/);
  });

  it('refuses half a coordinate pair', async () => {
    await expect(
      db.query(
        `insert into public.interventions(kind, title, instructions, incident_location, latitude, created_by, idempotency_key)
         values ('POZAR', 'Pola', 'Uputstvo', 'Poligon', 42.43, $1, 'k3')`,
        [commander],
      ),
    ).rejects.toThrow(/coordinate_pair/);
  });

  it('requires the extensible category to say what it is', async () => {
    await expect(
      db.query(
        `insert into public.interventions(kind, title, instructions, incident_location, created_by, idempotency_key)
         values ('DRUGO', 'Nesto', 'Uputstvo', 'Poligon', $1, 'k4')`,
        [commander],
      ),
    ).rejects.toThrow(/other_kind_note/);
  });
});

describe('publishing', () => {
  it('freezes the recipient list and queues one notification per recipient', async () => {
    const id = await published();

    const recipients = await db.query(
      `select member_id, member_name_at_publication from public.intervention_recipients
       where intervention_id = $1 order by member_name_at_publication`,
      [id],
    );
    expect(recipients.rows.map((r) => r.member_id).sort()).toEqual([memberA, memberB].sort());

    const outbox = await db.query(
      `select state, channel, attempt_count from public.notification_outbox where intervention_id = $1`,
      [id],
    );
    expect(outbox.rows).toHaveLength(2);
    for (const row of outbox.rows) {
      // The only state the server is entitled to claim: we queued it.
      expect(row.state).toBe('QUEUED');
      expect(row.attempt_count).toBe(0);
    }
  });

  it('creates no responses, no acknowledgements and no attendance', async () => {
    const id = await published();
    for (const table of [
      'intervention_responses',
      'intervention_acknowledgements',
      'attendance_intervals',
    ]) {
      const { rows } = await db.query(
        `select count(*)::int as n from public.${table} where intervention_id = $1`,
        [id],
      );
      expect(rows[0]!.n, `${table} must be empty after publishing`).toBe(0);
    }
  });

  it('records no delivery attempt, because nothing was sent', async () => {
    const id = await published();
    const { rows } = await db.query(
      `select count(*)::int as n from public.notification_delivery_attempts a
       join public.notification_outbox o on o.id = a.outbox_id
       where o.intervention_id = $1`,
      [id],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('is idempotent: a retried publish does not call the society twice', async () => {
    const id = await createDraft(db, commander);
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.publish_intervention($1, $2)', [id, [memberA, memberB]]),
    );
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.publish_intervention($1, $2)', [id, [memberA, memberB]]),
    );

    const recipients = await db.query(
      `select count(*)::int as n from public.intervention_recipients where intervention_id = $1`,
      [id],
    );
    const outbox = await db.query(
      `select count(*)::int as n from public.notification_outbox where intervention_id = $1`,
      [id],
    );
    expect(recipients.rows[0]!.n).toBe(2);
    expect(outbox.rows[0]!.n).toBe(2);
  });

  it('refuses a duplicate idempotency key from the same creator', async () => {
    await createDraft(db, commander, { key: 'shared-key' });
    await expect(createDraft(db, commander, { key: 'shared-key' })).rejects.toThrow(
      /interventions_idempotency|duplicate key/i,
    );
  });

  it('refuses publishing with no recipients', async () => {
    const id = await createDraft(db, commander);
    const message = await expectRefused(db, commander, (client) =>
      client.query('select public.publish_intervention($1, $2)', [id, []]),
    );
    expect(message).toContain('NO_RECIPIENTS');
  });

  it('refuses a firefighter publishing', async () => {
    const id = await createDraft(db, commander);
    const message = await expectRefused(db, firefighterA, (client) =>
      client.query('select public.publish_intervention($1, $2)', [id, [memberA]]),
    );
    expect(message).toContain('COMMAND_REQUIRED');
  });
});

describe('who can see an intervention', () => {
  it('keeps a draft invisible to firefighters', async () => {
    const id = await createDraft(db, commander);
    const seen = await asUser(db, firefighterA, async (client) => {
      const { rows } = await client.query('select id from public.interventions where id = $1', [id]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });

  it('shows a published intervention to the members it was addressed to', async () => {
    const id = await published([memberA]);
    const seen = await asUser(db, firefighterA, async (client) => {
      const { rows } = await client.query('select id from public.interventions where id = $1', [id]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('hides a published intervention from a member who was not called', async () => {
    const id = await published([memberA]);
    const seen = await asUser(db, outsider, async (client) => {
      const { rows } = await client.query('select id from public.interventions where id = $1', [id]);
      return rows.length;
    });
    // This is what keeps incident locations from leaking to uninvolved accounts.
    expect(seen).toBe(0);
  });

  it('lets a called member see the crew roster but not an unrelated one', async () => {
    const mine = await published([memberA, memberB]);
    const other = await published([memberOutsider]);
    const visible = await asUser(db, firefighterA, async (client) => {
      const { rows } = await client.query<{ intervention_id: string }>(
        'select distinct intervention_id from public.intervention_recipients',
      );
      return rows.map((r) => r.intervention_id);
    });
    expect(visible).toContain(mine);
    expect(visible).not.toContain(other);
  });
});

describe('status transitions', () => {
  it('moves through the operational statuses on explicit command', async () => {
    const id = await published();
    for (const next of ['ASSEMBLING', 'DEPLOYED', 'CONTAINED']) {
      await asUserCommitted(db, commander, (client) =>
        client.query('select public.set_intervention_status($1, $2, null)', [id, next]),
      );
      const { rows } = await db.query('select status from public.interventions where id = $1', [id]);
      expect(rows[0]!.status).toBe(next);
    }
  });

  it('refuses reaching CLOSED or CANCELLED through the status command', async () => {
    const id = await published();
    for (const bad of ['CLOSED', 'CANCELLED']) {
      const message = await expectRefused(db, commander, (client) =>
        client.query('select public.set_intervention_status($1, $2, null)', [id, bad]),
      );
      expect(message).toContain('STATUS_NOT_SETTABLE');
    }
  });

  it('refuses a status change on a draft', async () => {
    const id = await createDraft(db, commander);
    const message = await expectRefused(db, commander, (client) =>
      client.query('select public.set_intervention_status($1, $2, null)', [id, 'DEPLOYED']),
    );
    expect(message).toContain('INTERVENTION_NOT_PUBLISHED');
  });

  it('detects a concurrent edit through the version check', async () => {
    const id = await published();
    const { rows } = await db.query('select version from public.interventions where id = $1', [id]);
    const stale = rows[0]!.version - 1;
    const message = await expectRefused(db, commander, (client) =>
      client.query('select public.set_intervention_status($1, $2, $3)', [id, 'DEPLOYED', stale]),
    );
    expect(message).toContain('VERSION_CONFLICT');
  });

  it('refuses a firefighter changing the status', async () => {
    const id = await published();
    const message = await expectRefused(db, firefighterA, (client) =>
      client.query('select public.set_intervention_status($1, $2, null)', [id, 'DEPLOYED']),
    );
    expect(message).toContain('COMMAND_REQUIRED');
  });
});

describe('closing', () => {
  it('requires a reason and keeps the record', async () => {
    const id = await published();
    expect(
      await expectRefused(db, commander, (client) =>
        client.query('select public.close_intervention($1, $2, $3)', [id, 'CLOSED', ' ']),
      ),
    ).toContain('REASON_REQUIRED');

    await asUserCommitted(db, commander, (client) =>
      client.query('select public.close_intervention($1, $2, $3)', [id, 'CLOSED', 'Zavrseno.']),
    );
    const { rows } = await db.query(
      'select status, close_reason, closed_by from public.interventions where id = $1',
      [id],
    );
    expect(rows[0]).toMatchObject({
      status: 'CLOSED',
      close_reason: 'Zavrseno.',
      closed_by: commander,
    });
  });

  it('refuses closing twice', async () => {
    const id = await published();
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.close_intervention($1, $2, $3)', [id, 'CLOSED', 'Zavrseno.']),
    );
    const message = await expectRefused(db, commander, (client) =>
      client.query('select public.close_intervention($1, $2, $3)', [id, 'CLOSED', 'Ponovo.']),
    );
    expect(message).toContain('INTERVENTION_NOT_OPEN');
  });

  it('cancels with a reason and keeps earlier responses in history', async () => {
    const id = await published([memberA]);
    await asUserCommitted(db, firefighterA, (client) =>
      client.query('select public.submit_response($1, $2, null, false)', [id, 'DOLAZIM']),
    );
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.close_intervention($1, $2, $3)', [id, 'CANCELLED', 'Lazna uzbuna.']),
    );

    const { rows } = await db.query(
      'select count(*)::int as n from public.intervention_responses where intervention_id = $1',
      [id],
    );
    expect(rows[0]!.n).toBe(1);
  });
});

describe('member responses', () => {
  it('records an answer against the authenticated member with revision 1', async () => {
    const id = await published([memberA]);
    await asUserCommitted(db, firefighterA, (client) =>
      client.query('select public.submit_response($1, $2, null, false)', [id, 'DOLAZIM']),
    );
    const { rows } = await db.query(
      'select member_id, answer, revision from public.intervention_responses where intervention_id = $1',
      [id],
    );
    expect(rows[0]).toMatchObject({ member_id: memberA, answer: 'DOLAZIM', revision: 1 });
  });

  it('retains every revision when an answer changes', async () => {
    const id = await published([memberA]);
    await asUserCommitted(db, firefighterA, (client) =>
      client.query('select public.submit_response($1, $2, null, false)', [id, 'DOLAZIM']),
    );
    await asUserCommitted(db, firefighterA, (client) =>
      client.query('select public.submit_response($1, $2, 30, false)', [id, 'DOLAZIM_KASNIJE']),
    );
    await asUserCommitted(db, firefighterA, (client) =>
      client.query('select public.submit_response($1, $2, null, false)', [id, 'NE_MOGU']),
    );

    const current = await db.query(
      'select answer, revision from public.intervention_responses where intervention_id = $1',
      [id],
    );
    expect(current.rows[0]).toMatchObject({ answer: 'NE_MOGU', revision: 3 });

    const history = await db.query(
      `select r.revision, r.answer from public.intervention_response_revisions r
       join public.intervention_responses p on p.id = r.response_id
       where p.intervention_id = $1 order by r.revision`,
      [id],
    );
    expect(history.rows.map((r) => r.answer)).toEqual(['DOLAZIM', 'DOLAZIM_KASNIJE', 'NE_MOGU']);
  });

  it('treats re-sending the same answer as no change', async () => {
    const id = await published([memberA]);
    for (let i = 0; i < 3; i += 1) {
      await asUserCommitted(db, firefighterA, (client) =>
        client.query('select public.submit_response($1, $2, null, false)', [id, 'DOLAZIM']),
      );
    }
    const { rows } = await db.query(
      `select p.revision, (select count(*)::int from public.intervention_response_revisions v
        where v.response_id = p.id) as revisions
       from public.intervention_responses p where p.intervention_id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({ revision: 1, revisions: 1 });
  });

  it('requires a defined arrival band for a later arrival', async () => {
    const id = await published([memberA]);
    expect(
      await expectRefused(db, firefighterA, (client) =>
        client.query('select public.submit_response($1, $2, null, false)', [id, 'DOLAZIM_KASNIJE']),
      ),
    ).toContain('ETA_REQUIRED');
    expect(
      await expectRefused(db, firefighterA, (client) =>
        client.query('select public.submit_response($1, $2, 7, false)', [id, 'DOLAZIM_KASNIJE']),
      ),
    ).toContain('ETA_REQUIRED');
  });

  it('drops an arrival band that does not belong to the answer', async () => {
    const id = await published([memberA]);
    await asUserCommitted(db, firefighterA, (client) =>
      client.query('select public.submit_response($1, $2, 60, false)', [id, 'DOLAZIM']),
    );
    const { rows } = await db.query(
      'select eta_minutes from public.intervention_responses where intervention_id = $1',
      [id],
    );
    expect(rows[0]!.eta_minutes).toBeNull();
  });

  it('never lets a declined answer claim direct travel to the incident', async () => {
    const id = await published([memberA]);
    await asUserCommitted(db, firefighterA, (client) =>
      client.query('select public.submit_response($1, $2, null, true)', [id, 'NE_MOGU']),
    );
    const { rows } = await db.query(
      'select direct_to_location from public.intervention_responses where intervention_id = $1',
      [id],
    );
    expect(rows[0]!.direct_to_location).toBe(false);
  });

  it('refuses an answer from a member who was not called', async () => {
    const id = await published([memberA]);
    const message = await expectRefused(db, outsider, (client) =>
      client.query('select public.submit_response($1, $2, null, false)', [id, 'DOLAZIM']),
    );
    expect(message).toContain('NOT_A_RECIPIENT');
  });

  it('refuses an answer to a draft or a closed intervention', async () => {
    const draft = await createDraft(db, commander);
    expect(
      await expectRefused(db, firefighterA, (client) =>
        client.query('select public.submit_response($1, $2, null, false)', [draft, 'DOLAZIM']),
      ),
    ).toContain('INTERVENTION_NOT_OPEN');

    const closed = await published([memberA]);
    await asUserCommitted(db, commander, (client) =>
      client.query('select public.close_intervention($1, $2, $3)', [closed, 'CLOSED', 'Kraj.']),
    );
    expect(
      await expectRefused(db, firefighterA, (client) =>
        client.query('select public.submit_response($1, $2, null, false)', [closed, 'DOLAZIM']),
      ),
    ).toContain('INTERVENTION_NOT_OPEN');
  });

  it('one member changing their answer leaves everybody else untouched', async () => {
    const id = await published([memberA, memberB]);
    await asUserCommitted(db, firefighterA, (client) =>
      client.query('select public.submit_response($1, $2, null, false)', [id, 'DOLAZIM']),
    );
    await asUserCommitted(db, firefighterB, (client) =>
      client.query('select public.submit_response($1, $2, null, false)', [id, 'DOLAZIM']),
    );
    await asUserCommitted(db, firefighterA, (client) =>
      client.query('select public.submit_response($1, $2, null, false)', [id, 'NE_MOGU']),
    );

    const { rows } = await db.query(
      `select member_id, answer, revision from public.intervention_responses
       where intervention_id = $1`,
      [id],
    );
    const byMember = new Map(rows.map((r) => [r.member_id, r]));
    expect(byMember.get(memberA)).toMatchObject({ answer: 'NE_MOGU', revision: 2 });
    expect(byMember.get(memberB)).toMatchObject({ answer: 'DOLAZIM', revision: 1 });
  });

  it('answering creates no attendance record', async () => {
    // The single most important separation in the product.
    const id = await published([memberA]);
    await asUserCommitted(db, firefighterA, (client) =>
      client.query('select public.submit_response($1, $2, null, false)', [id, 'DOLAZIM']),
    );
    const { rows } = await db.query(
      'select count(*)::int as n from public.attendance_intervals where intervention_id = $1',
      [id],
    );
    expect(rows[0]!.n).toBe(0);
  });
});
