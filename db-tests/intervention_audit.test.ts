/**
 * The chronology the archive reads, and who may read it.
 *
 * Two claims are tested here, and the first is the one that decided the whole
 * shape of this slice: the movements and state transitions the archive appeared
 * to be losing were NEVER LOST. `operational_audit` has recorded every one of
 * them since the schema was written. The archive had no reader, and the table
 * had one policy - `is_dvd_command()` - so a firefighter could not have read
 * their own participation history even if a screen had asked.
 *
 * So: a member reports Krecem, then U putu, then Na licu mjesta. The
 * current-state table `intervention_journey` holds exactly one row and knows
 * only the last of the three. The audit holds all three, with the times the
 * DATABASE stamped on them and the account that caused each. That is the
 * difference between a record and a snapshot, and the first test measures it.
 *
 * The second claim is the boundary: command reads any intervention, a member
 * reads the ones they were called to, and somebody who was not called reads
 * nothing at all - not a filtered list, nothing.
 */

import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  asUserCommitted,
  completeProfile,
  connect,
  createAccount,
  createDraftAsSuperuser,
  createMember,
  grantRole,
  resetSchema,
} from './harness';

let db: Client;

interface Cast {
  commander: string;
  recipient: string;
  recipientMember: string;
  outsider: string;
  outsiderMember: string;
}

let cast: Cast;
let intervention: string;

async function person(
  email: string,
  name: string,
  role: string,
): Promise<{ userId: string; memberId: string }> {
  const account = await createAccount(db, email);
  await completeProfile(db, account.userId, name);
  await grantRole(db, account.userId, role);
  const memberId = await createMember(db, name, account.userId);
  return { userId: account.userId, memberId };
}

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);

  const commander = await person('komandir@example.invalid', 'Komandir Smjene', 'COMMANDER');
  const recipient = await person('pozvan@example.invalid', 'Ivo Vatrogasac', 'FIREFIGHTER');
  const outsider = await person('nepozvan@example.invalid', 'Pero Vatrogasac', 'FIREFIGHTER');

  cast = {
    commander: commander.userId,
    recipient: recipient.userId,
    recipientMember: recipient.memberId,
    outsider: outsider.userId,
    outsiderMember: outsider.memberId,
  };

  intervention = await createDraftAsSuperuser(db, cast.commander, 'audit-1');

  // Publish to the recipient only. The outsider is a perfectly good firefighter
  // who simply was not called to this one.
  await asUserCommitted(db, cast.commander, (client) =>
    client.query('select public.publish_intervention($1, $2)', [
      intervention,
      [cast.recipientMember],
    ]),
  );

  // Three movements, each its own transaction so each gets its own `now()`.
  for (const step of ['KRECEM', 'U_PUTU', 'NA_LICU_MJESTA']) {
    await asUserCommitted(db, cast.recipient, (client) =>
      client.query('select public.set_journey_progress($1, $2)', [intervention, step]),
    );
  }

  // And a state transition, which no current-state row records at all.
  await asUserCommitted(db, cast.commander, (client) =>
    client.query('select public.set_intervention_status($1, $2, null)', [intervention, 'DEPLOYED']),
  );
}, 180_000);

afterAll(async () => {
  await db?.end();
});

describe('nothing was ever being overwritten', () => {
  it('keeps one current-state row per member, which is why it looked lost', async () => {
    // The snapshot. This is what the archive used to build its chronology from,
    // and it is doing exactly what it was designed to do.
    const { rows } = await db.query<{ n: number; progress: string }>(
      `select count(*)::int as n, max(progress) as progress
       from public.intervention_journey
       where intervention_id = $1 and member_id = $2`,
      [intervention, cast.recipientMember],
    );
    expect(rows[0]!.n, 'one row per member per intervention').toBe(1);
    expect(rows[0]!.progress, 'and it holds only the latest step').toBe('NA_LICU_MJESTA');
  });

  it('has held all three movements in the audit the whole time', async () => {
    const steps = await asUser(db, cast.commander, async (client) => {
      const { rows } = await client.query<{ detail: { to?: string } }>(
        `select detail from public.intervention_audit($1)
         where event_type = 'JOURNEY_PROGRESS_SET'`,
        [intervention],
      );
      return rows.map((r) => r.detail.to);
    });
    expect(steps, 'every step, in the order it happened').toEqual([
      'KRECEM',
      'U_PUTU',
      'NA_LICU_MJESTA',
    ]);
  });

  it('records the state transition, which no current-state row can express', async () => {
    const change = await asUser(db, cast.commander, async (client) => {
      const { rows } = await client.query<{ detail: { from?: string; to?: string } }>(
        `select detail from public.intervention_audit($1)
         where event_type = 'INTERVENTION_STATUS_CHANGED'`,
        [intervention],
      );
      return rows[0]?.detail;
    });
    expect(change?.from).toBe('PUBLISHED');
    expect(change?.to).toBe('DEPLOYED');
  });

  it('stamps every event with the server’s own time and the acting account', async () => {
    const rows = await asUser(db, cast.commander, async (client) => {
      const result = await client.query<{
        occurred_at: Date;
        actor_name: string | null;
      }>('select occurred_at, actor_name from public.intervention_audit($1)', [intervention]);
      return result.rows;
    });

    expect(rows.length).toBeGreaterThan(4);
    for (const row of rows) {
      // No client supplies either of these. `occurred_at` defaults to the
      // transaction's own clock and the actor is `auth.uid()`, recorded by the
      // command that did the work.
      expect(row.occurred_at, 'a server-generated time').toBeInstanceOf(Date);
      expect(row.actor_name, 'resolved to a name a person can read').not.toBeNull();
    }

    const names = rows.map((r) => r.actor_name);
    expect(names, 'the member who moved is named, not the commander').toContain('Ivo Vatrogasac');
    expect(names).toContain('Komandir Smjene');
  });

  it('returns the same order every time it is read', async () => {
    // Several of these events share a transaction time to the microsecond. An
    // archive whose lines shuffle between two readings of one record is not a
    // record, so the function breaks ties on the id.
    const read = async () =>
      asUser(db, cast.commander, async (client) => {
        const { rows } = await client.query<{ event_id: string }>(
          'select event_id from public.intervention_audit($1)',
          [intervention],
        );
        return rows.map((r) => r.event_id);
      });
    expect(await read()).toEqual(await read());
  });
});

describe('who may read an intervention’s chronology', () => {
  it('the commander reads it', async () => {
    const count = await asUser(db, cast.commander, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        'select count(*)::int as n from public.intervention_audit($1)',
        [intervention],
      );
      return rows[0]!.n;
    });
    expect(count).toBeGreaterThan(4);
  });

  it('a member who was called reads their own intervention’s record', async () => {
    // Their participation record. Before this they could open the archive entry
    // and see a chronology with none of their own movements in it.
    const count = await asUser(db, cast.recipient, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        'select count(*)::int as n from public.intervention_audit($1)',
        [intervention],
      );
      return rows[0]!.n;
    });
    expect(count).toBeGreaterThan(4);
  });

  it('a member who was NOT called reads nothing at all', async () => {
    // Not a filtered list - nothing. An operational firefighter in good
    // standing still has no business in an intervention they were not part of.
    const count = await asUser(db, cast.outsider, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        'select count(*)::int as n from public.intervention_audit($1)',
        [intervention],
      );
      return rows[0]!.n;
    });
    expect(count).toBe(0);
  });

  it('an unauthenticated caller reads nothing', async () => {
    const count = await asUser(db, null, async (client) => {
      const result = await client
        .query<{ n: number }>('select count(*)::int as n from public.intervention_audit($1)', [
          intervention,
        ])
        .catch(() => ({ rows: [{ n: -1 }] }));
      return result.rows[0]!.n;
    });
    expect(count === 0 || count === -1, 'either refused or empty, never rows').toBe(true);
  });
});

describe('the chronology cannot be written by a client', () => {
  it('refuses an insert into the audit from an authenticated role', async () => {
    // The actor on every row is `auth.uid()` recorded by the command that did
    // the work. If a browser could write a row, it could name anybody as the
    // person who closed an intervention.
    const message = await asUser(db, cast.commander, async (client) => {
      try {
        await client.query(
          `insert into public.operational_audit(intervention_id, event_type, detail, actor_user_id)
           values ($1, 'INTERVENTION_CLOSED', '{}'::jsonb, $2)`,
          [intervention, cast.outsider],
        );
        return 'WROTE';
      } catch (error) {
        return String(error);
      }
    });
    expect(message, 'no client may fabricate an audit row').not.toBe('WROTE');
    expect(message).toMatch(/permission denied|policy/i);
  });
});
