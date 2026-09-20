import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { asUser, asUserCommitted, connect, expectRefused, resetSchema } from './harness';

let db: Client;

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);
}, 60_000);

afterAll(async () => {
  await db?.end();
});

async function register(email: string, metadata: Record<string, string> = {}) {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users(email, email_confirmed_at, raw_user_meta_data)
     values ($1, now(), $2::jsonb) returning id`,
    [email, JSON.stringify(metadata)],
  );
  return rows[0]!.id;
}

describe('required registration profile', () => {
  it('creates a complete pending profile from valid sign-up metadata', async () => {
    const userId = await register('complete@example.invalid', {
      full_name: 'Probni Vatrogasac',
      phone: '067 123-456',
      date_of_birth: '1995-04-23',
    });
    const { rows } = await db.query(
      `select full_name, phone_e164, date_of_birth::text, profile_complete
         from public.profiles where user_id = $1`,
      [userId],
    );
    expect(rows[0]).toEqual({
      full_name: 'Probni Vatrogasac',
      phone_e164: '+38267123456',
      date_of_birth: '1995-04-23',
      profile_complete: true,
    });
    const role = await asUser(db, userId, async (client) =>
      (await client.query<{ role: string | null }>('select public.current_dvd_role() as role')).rows[0]!.role,
    );
    expect(role).toBeNull();
  });

  it.each([
    ['missing phone', { full_name: 'Probni Vatrogasac', date_of_birth: '1995-04-23' }],
    ['invalid name', { full_name: 'Jednoime', phone: '067123456', date_of_birth: '1995-04-23' }],
    ['future birth date', { full_name: 'Probni Vatrogasac', phone: '067123456', date_of_birth: '2995-04-23' }],
  ])('keeps direct sign-up incomplete for %s', async (_label, metadata) => {
    const userId = await register(`incomplete-${Math.random()}@example.invalid`, metadata);
    const { rows } = await db.query<{ profile_complete: boolean }>(
      'select profile_complete from public.profiles where user_id = $1',
      [userId],
    );
    expect(rows[0]!.profile_complete).toBe(false);
  });

  it('validates and normalizes all fields in the authenticated completion command', async () => {
    const userId = await register('finish@example.invalid');
    await asUserCommitted(db, userId, (client) =>
      client.query(
        `select public.complete_own_profile($1, $2, $3::date)`,
        ['Naknadno Popunjen', '00382 69 222 333', '1988-11-05'],
      ),
    );
    const { rows } = await db.query(
      `select full_name, phone_e164, date_of_birth::text, profile_complete
         from public.profiles where user_id = $1`,
      [userId],
    );
    expect(rows[0]).toEqual({
      full_name: 'Naknadno Popunjen',
      phone_e164: '+38269222333',
      date_of_birth: '1988-11-05',
      profile_complete: true,
    });
  });

  it('refuses invalid profile completion and exposes no one-argument bypass', async () => {
    const userId = await register('refused@example.invalid');
    expect(
      await expectRefused(db, userId, (client) =>
        client.query(
          `select public.complete_own_profile($1, $2, $3::date)`,
          ['Probni Clan', 'ne-validan-broj', '1990-01-01'],
        ),
      ),
    ).toContain('PHONE_REQUIRED');
    await expect(db.query(`select public.complete_own_profile('Samo Ime')`)).rejects.toThrow(
      /function public\.complete_own_profile\(unknown\) does not exist/i,
    );
  });
});
