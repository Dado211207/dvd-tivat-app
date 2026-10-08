import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { connect, resetSchema } from './harness';

let client: Client;

const triggerGuards = [
  'refuse_registry_audit_change',
  'refuse_attendance_rebinding',
  'refuse_attendance_correction_change',
  'refuse_correction_request_rebinding',
  'refuse_delivery_attempt_change',
  'refuse_outbox_rebinding',
  'refuse_audit_change',
  'refuse_audit_truncate',
  'refuse_response_rebinding',
  'refuse_journey_rebinding',
  'refuse_availability_rebinding',
];

beforeAll(async () => {
  client = await connect();
  await resetSchema(client);
});

afterAll(async () => {
  await client.end();
});

describe('Supabase security-advisor hardening', () => {
  it('pins every trigger-only guard to an empty search path', async () => {
    const result = await client.query<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any($1::text[])
        order by p.proname`,
      [triggerGuards],
    );

    expect(result.rows).toHaveLength(triggerGuards.length);
    for (const row of result.rows) {
      expect(row.proconfig, row.proname).toContain('search_path=');
    }
  });

  it('keeps trigger guards private while their triggers still enforce identity', async () => {
    const privileges = await client.query<{ exposed: number }>(
      `select count(*)::int as exposed
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any($1::text[])
          and (
            has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('authenticated', p.oid, 'execute')
            or p.proacl is null
            or exists (select 1 from aclexplode(p.proacl) acl where acl.grantee = 0)
          )`,
      [triggerGuards],
    );
    expect(privileges.rows[0]?.exposed).toBe(0);

    const account = await client.query<{ id: string }>(
      `insert into auth.users(email, email_confirmed_at)
       values ('hardening@example.invalid', now()) returning id`,
    );
    const member = await client.query<{ id: string }>(
      `insert into public.members(full_name, user_id, organization_id)
       values ('Hardening Fixture', $1, '00000000-0000-4000-8000-000000000001') returning id`,
      [account.rows[0]!.id],
    );
    await client.query(
      `insert into public.member_availability(member_id, available, changed_by, organization_id)
       values ($1, true, $2, '00000000-0000-4000-8000-000000000001')`,
      [member.rows[0]!.id, account.rows[0]!.id],
    );

    await expect(client.query(
      `update public.member_availability
          set member_id = '00000000-0000-4000-8000-000000000099'
        where member_id = $1`,
      [member.rows[0]!.id],
    )).rejects.toThrow(/AVAILABILITY_IDENTITY_FIXED/);
  });

  it('moves btree_gist out of the exposed public schema', async () => {
    const result = await client.query<{ schema_name: string; extrelocatable: boolean }>(
      `select n.nspname as schema_name, e.extrelocatable
         from pg_extension e
         join pg_namespace n on n.oid = e.extnamespace
        where e.extname = 'btree_gist'`,
    );
    expect(result.rows).toEqual([{ schema_name: 'extensions', extrelocatable: true }]);
  });
});
