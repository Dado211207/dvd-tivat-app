/** D21: the targeted command retains the incident, with only its own people. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  asUser, asUserCommitted, completeProfile, connect, createAccount, createMember,
  grantRole, resetSchema, type TestAccount,
} from './harness';

const DVD = '00000000-0000-4000-8000-000000000001';
const SZS = '00000000-0000-4000-8000-000000000002';
let db: Client;
let dvdCommand: TestAccount;
let szsCommand: TestAccount;
let szsMember: TestAccount;
let dvdMember: TestAccount;
let citizen: TestAccount;
let joint = '';
let unrelated = '';
let szsMemberId = '';
let dvdMemberId = '';

const read = <T extends object>(account: TestAccount, sql: string, params: unknown[] = []) =>
  asUser(db, account.userId, async (client) =>
    (await client.query<T & Record<string, unknown>>(sql, params)).rows);

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);
  szsCommand = await createAccount(db, 'archive-szs-cmd@example.invalid');
  await completeProfile(db, szsCommand.userId, 'SZS Komandir');
  await db.query(`insert into public.organization_memberships
    (organization_id, user_id, role, active, granted_by, granted_at)
    values ($1, $2, 'COMMANDER', true, $2, now())`, [SZS, szsCommand.userId]);
  dvdCommand = await createAccount(db, 'archive-dvd-cmd@example.invalid');
  await completeProfile(db, dvdCommand.userId, 'DVD Komandir');
  await grantRole(db, dvdCommand.userId, 'COMMANDER');

  szsMember = await createAccount(db, 'archive-szs-member@example.invalid');
  await completeProfile(db, szsMember.userId, 'SZS Ucesnik');
  await db.query(`insert into public.organization_memberships
    (organization_id, user_id, role, active, granted_by, granted_at)
    values ($1, $2, 'FIREFIGHTER', true, $2, now())`, [SZS, szsMember.userId]);
  szsMemberId = (await db.query<{ id: string }>(`insert into public.members
    (organization_id, full_name, user_id) values ($1, 'SZS Ucesnik', $2) returning id`,
  [SZS, szsMember.userId])).rows[0]!.id;
  dvdMember = await createAccount(db, 'archive-dvd-member@example.invalid');
  await completeProfile(db, dvdMember.userId, 'DVD Ucesnik');
  await grantRole(db, dvdMember.userId, 'FIREFIGHTER');
  dvdMemberId = await createMember(db, 'DVD Ucesnik', dvdMember.userId);
  citizen = await createAccount(db, 'archive-citizen@example.invalid');
  await completeProfile(db, citizen.userId, 'Gradjanin');

  joint = await asUserCommitted(db, szsCommand.userId, async (client) => {
    const id = (await client.query<{ id: string }>(`select public.create_intervention_draft_in
      ($1, 'POZAR', 'Zajednicka arhiva', 'Uputstvo', 'Lokacija', 'archive-joint') as id`, [SZS])).rows[0]!.id;
    await client.query('select public.publish_intervention($1, $2, $3)', [id, [szsMemberId], [DVD]]);
    await client.query(`select public.set_intervention_status($1, 'ASSEMBLING', null)`, [id]);
    return id;
  });
  // The updates table predates P7 but no current command writes to it. Seed a
  // shared fact directly so its RLS policy is exercised by a nonempty read.
  await db.query(`insert into public.intervention_updates
    (intervention_id, version, body, created_by)
    values ($1, 50, 'Zajednicka informacija o lokaciji', $2)`, [joint, szsCommand.userId]);
  unrelated = await asUserCommitted(db, szsCommand.userId, async (client) => {
    const id = (await client.query<{ id: string }>(`select public.create_intervention_draft_in
      ($1, 'POZAR', 'SZS samo', 'Uputstvo', 'Lokacija', 'archive-solo') as id`, [SZS])).rows[0]!.id;
    await client.query('select public.publish_intervention($1, $2)', [id, [szsMemberId]]);
    return id;
  });
  await asUserCommitted(db, szsMember.userId, (client) =>
    client.query(`select public.submit_response($1, 'DOLAZIM', null, true)`, [joint]));
  await asUserCommitted(db, dvdMember.userId, (client) =>
    client.query(`select public.submit_response($1, 'DOLAZIM', null, true)`, [joint]));
});

afterAll(async () => { await db?.end(); });

describe('permanent recipient-service archive', () => {
  it('DVD command, though not paged as a member, reads joint shared facts and updates', async () => {
    expect((await read<{ id: string }>(dvdCommand,
      'select id from public.interventions where id = $1', [joint])).map((row) => row.id)).toEqual([joint]);
    expect(await read(dvdCommand,
      'select id from public.intervention_updates where intervention_id = $1', [joint])).not.toHaveLength(0);
  });
  it('never grants DVD command access to an unrelated SZS call-out or a citizen access to the joint one', async () => {
    expect(await read(dvdCommand, 'select id from public.interventions where id = $1', [unrelated])).toHaveLength(0);
    expect(await read(citizen, 'select id from public.interventions where id = $1', [joint])).toHaveLength(0);
  });
  it('the targeted commander reads their participant, not the publisher participant', async () => {
    const rows = await read<{ member_id: string }>(dvdCommand,
      'select member_id from public.intervention_responses where intervention_id = $1', [joint]);
    expect(rows.map((row) => row.member_id)).toEqual([dvdMemberId]);
    expect(await read<{ member_id: string }>(dvdCommand,
      'select member_id from public.intervention_recipients where intervention_id = $1 and member_id = $2',
      [joint, szsMemberId])).toHaveLength(0);
  });
  it('the publisher likewise reads only their own participant', async () => {
    const rows = await read<{ member_id: string }>(szsCommand,
      'select member_id from public.intervention_responses where intervention_id = $1', [joint]);
    expect(rows.map((row) => row.member_id)).toEqual([szsMemberId]);
  });
  it('the other service sees shared lifecycle events without the publisher actor name or participant audit', async () => {
    const rows = await read<{ event_type: string; actor_name: string | null }>(dvdCommand,
      'select event_type, actor_name from public.intervention_audit($1)', [joint]);
    expect(rows.map((row) => row.event_type)).toContain('INTERVENTION_STATUS_CHANGED');
    expect(rows.some((row) => row.actor_name !== null)).toBe(false);
    expect(rows.some((row) => row.event_type === 'INTERVENTION_PUBLISHED')).toBe(false);
  });
  it('the publisher alone may change the intervention status', async () => {
    await expect(asUserCommitted(db, dvdCommand.userId, (client) =>
      client.query(`select public.set_intervention_status($1, 'DEPLOYED', null)`, [joint])))
      .rejects.toThrow('ORGANIZATION_MISMATCH');
  });
});
