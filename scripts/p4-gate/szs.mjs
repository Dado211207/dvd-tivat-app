/**
 * What production does not contain yet: SZS-only and dual-service accounts, an
 * SZS registry and a live SZS call-out, added to a clone of the MIGRATED copy
 * through the application's own commands. The real owner grants the
 * memberships and builds the SZS registry; synthetic SZS accounts run the
 * call-out; the real DVD firefighter and the real vehicles are pointed at it.
 *
 * Every step has an expected outcome, refusals included. Where a later phase
 * deliberately changes one, the change is listed against that phase's
 * migration, so the same extension grades each phase as it lands.
 */

import { DVD, SZS } from './database.mjs';
import { P4E } from './push.mjs';

/** The migration that deliberately changes an outcome, and what it becomes. */
export const P4C = 'supabase/migrations/202609250030_response_service.sql';
export const P4D = 'supabase/migrations/202609250031_attendance_service.sql';

/** Somebody in both services who is withdrawn from SZS once both call-outs are out. */
const SYNTHETIC = ['szsCommander', 'szsFirefighter', 'dual', 'dualWithdrawn', 'szsSuspended', 'szsIncomplete'];

const register = `select public.register_web_push_subscription($1, $2, 'gate-auth-secret-1', null, 'Gate agent')`;
const device = (who) => () => [`https://push.example.invalid/gate/${who}`, 'B'.repeat(65)];

/**
 * [label, who, sql, params(ctx), expected, { after: [[migration, expected]] }]
 * `who` names an actor in ctx.actors. A step's value, when it returns one, is
 * stored under its `save` name for later steps.
 */
function steps() {
  return [
    // accounts: sign-up exactly as the auth trigger sees it, then the person's
    // own profile completion, then the owner's grants
    ...['szsCommander', 'szsFirefighter', 'dual', 'dualWithdrawn', 'szsSuspended'].map((who) =>
      [`${who} completes their profile`, who, `select public.complete_own_profile($1, '+38267000999', date '1990-01-01')`, () => [`${who} Test`], 'OK']),
    // SZS-only accounts hold CITIZEN on the grant: an operational grant role
    // would mirror into an active DVD membership (sync_dvd_membership_from_grant).
    ...['szsCommander', 'szsFirefighter', 'szsSuspended', 'szsIncomplete'].map((who) =>
      [`owner grants ${who} CITIZEN`, 'owner', `select public.owner_set_role($1, 'CITIZEN')`, (c) => [c.users[who]], 'OK']),
    ...['dual', 'dualWithdrawn'].map((who) =>
      [`owner grants ${who} FIREFIGHTER (their DVD service)`, 'owner', `select public.owner_set_role($1, 'FIREFIGHTER')`, (c) => [c.users[who]], 'OK']),
    ...[['szsCommander', 'COMMANDER'], ['szsFirefighter', 'FIREFIGHTER'], ['dual', 'COMMANDER'], ['dualWithdrawn', 'FIREFIGHTER'], ['szsSuspended', 'FIREFIGHTER'], ['szsIncomplete', 'FIREFIGHTER']].map(([who, role]) =>
      [`owner makes ${who} SZS ${role}`, 'owner', `select public.owner_set_organization_membership($1, 'SZS', $2)`, (c) => [c.users[who], role], 'OK']),
    // the SZS registry, built by the owner through the service-aware creates
    ...['szsCommander', 'szsFirefighter', 'dual', 'dualWithdrawn', 'szsSuspended', 'szsIncomplete'].flatMap((who) => [
      [`owner creates the SZS member for ${who}`, 'owner', `select public.admin_create_member_in($1, $2, array['spasilac'])`, () => [SZS, `SZS ${who}`], 'OK', { save: `${who}Szs` }],
      [`owner links the SZS member to ${who}`, 'owner', `select public.admin_link_member_account($1, $2)`, (c) => [c.saved[`${who}Szs`], c.users[who]], 'OK'],
    ]),
    ...['dual', 'dualWithdrawn'].flatMap((who) => [
      [`owner creates the DVD member for ${who}`, 'owner', `select public.admin_create_member($1, array['vozac'])`, () => [`DVD ${who}`], 'OK', { save: `${who}Dvd` }],
      [`owner links the DVD member to ${who}`, 'owner', `select public.admin_link_member_account($1, $2)`, (c) => [c.saved[`${who}Dvd`], c.users[who]], 'OK'],
    ]),
    ['owner suspends szsSuspended', 'owner', `select public.owner_set_account_active($1, false, 'Gate')`, (c) => [c.users.szsSuspended], 'OK'],

    // devices: one per account, whichever service it serves in (P4e)
    ['szsFirefighter registers a device', 'szsFirefighter', register, device('szsFirefighter'), 'ERR OPERATIONAL_ACCESS_REQUIRED', { after: [[P4E, 'OK']] }],
    ['szsCommander registers a device', 'szsCommander', register, device('szsCommander'), 'ERR OPERATIONAL_ACCESS_REQUIRED', { after: [[P4E, 'OK']] }],
    ['dual registers one device for both services', 'dual', register, device('dual'), 'OK'],
    ['dualWithdrawn registers one device for both services', 'dualWithdrawn', register, device('dualWithdrawn'), 'OK'],
    ['szsSuspended registers a device', 'szsSuspended', register, device('szsSuspended'), 'ERR OPERATIONAL_ACCESS_REQUIRED'],
    ['szsIncomplete registers a device', 'szsIncomplete', register, device('szsIncomplete'), 'ERR OPERATIONAL_ACCESS_REQUIRED'],
    ['szsFirefighter claims the device dual registered', 'szsFirefighter', register, device('dual'), 'ERR OPERATIONAL_ACCESS_REQUIRED',
      { after: [[P4E, 'ERR PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT']] }],
    ['owner creates an SZS group', 'owner', `select public.admin_create_group_in($1, 'SZS smjena')`, () => [SZS], 'OK', { save: 'szsGroup' }],
    ['owner fills the SZS group', 'owner', `select public.admin_set_group_members($1, $2)`, (c) => [c.saved.szsGroup, [c.saved.szsCommanderSzs, c.saved.szsFirefighterSzs]], 'OK'],
    ['owner puts a DVD member in the SZS group', 'owner', `select public.admin_set_group_members($1, $2)`, (c) => [c.saved.szsGroup, [c.saved.szsCommanderSzs, c.dvdMember]], 'ERR ORGANIZATION_MISMATCH'],
    ['owner creates an SZS vehicle', 'owner', `select public.admin_create_vehicle_in($1, 'SZS-1', 'SZS vozilo', 'Tehnicko')`, () => [SZS], 'OK', { save: 'szsVehicle' }],
    ['szsFirefighter reports SZS availability', 'szsFirefighter', `select public.set_own_availability_in($1, true, 'SZS dostupan')`, () => [SZS], 'OK'],

    // a live SZS call-out, run by the SZS commander
    ['szsCommander drafts an SZS call-out', 'szsCommander', `select public.create_intervention_draft_in($1, 'POZAR', 'SZS poziv', 'SZS upute', 'SZS mjesto', 'szs-gate-1')`, () => [SZS], 'OK', { save: 'szsCallout' }],
    ['szsCommander drafts through the DVD wrapper', 'szsCommander', `select public.create_intervention_draft('POZAR', 'SZS u DVD', 'upute', 'mjesto', 'szs-gate-dvd')`, () => [], 'ERR COMMAND_REQUIRED'],
    // E3: the deliberate prohibition on mixing services in one call-out.
    ['szsCommander publishes to an SZS and a DVD member (MIXED)', 'szsCommander', `select public.publish_intervention($1, $2)`, (c) => [c.saved.szsCallout, [c.saved.szsFirefighterSzs, c.dvdMember]], 'ERR ORGANIZATION_MISMATCH'],
    ['szsCommander publishes to SZS members', 'szsCommander', `select public.publish_intervention($1, $2)`, (c) => [c.saved.szsCallout, [c.saved.szsFirefighterSzs, c.saved.dualSzs, c.saved.dualWithdrawnSzs]], 'OK'],
    ['szsFirefighter acknowledges', 'szsFirefighter', `select public.acknowledge_intervention($1)`, (c) => [c.saved.szsCallout], 'OK'],

    // answering it: the functional gap P4c closes
    ['szsFirefighter answers their SZS call-out', 'szsFirefighter', `select public.submit_response($1, 'DOLAZIM', null, true)`, (c) => [c.saved.szsCallout], 'ERR MEMBER_RECORD_REQUIRED', { after: [[P4C, 'OK']] }],
    ['szsFirefighter repeats the same answer', 'szsFirefighter', `select public.submit_response($1, 'DOLAZIM', null, true)`, (c) => [c.saved.szsCallout], 'ERR MEMBER_RECORD_REQUIRED', { after: [[P4C, 'OK']] }],
    ['szsFirefighter changes their answer', 'szsFirefighter', `select public.submit_response($1, 'DOLAZIM_KASNIJE', 30, false)`, (c) => [c.saved.szsCallout], 'ERR MEMBER_RECORD_REQUIRED', { after: [[P4C, 'OK']] }],
    ['dual answers the SZS call-out', 'dual', `select public.submit_response($1, 'NE_MOGU', null, false)`, (c) => [c.saved.szsCallout], 'ERR NOT_A_RECIPIENT', { after: [[P4C, 'OK']] }],
    ['the DVD firefighter answers the SZS call-out', 'dvdFirefighter', `select public.submit_response($1, 'DOLAZIM', null, true)`, (c) => [c.saved.szsCallout], 'ERR NOT_A_RECIPIENT', { after: [[P4C, 'ERR MEMBER_RECORD_REQUIRED']] }],
    ['szsCommander (not sent it) answers the SZS call-out', 'szsCommander', `select public.submit_response($1, 'DOLAZIM', null, true)`, (c) => [c.saved.szsCallout], 'ERR MEMBER_RECORD_REQUIRED', { after: [[P4C, 'ERR NOT_A_RECIPIENT']] }],
    ['szsSuspended answers the SZS call-out', 'szsSuspended', `select public.submit_response($1, 'DOLAZIM', null, true)`, (c) => [c.saved.szsCallout], 'ERR MEMBER_RECORD_REQUIRED'],
    ['szsIncomplete answers the SZS call-out', 'szsIncomplete', `select public.submit_response($1, 'DOLAZIM', null, true)`, (c) => [c.saved.szsCallout], 'ERR MEMBER_RECORD_REQUIRED'],

    ['szsFirefighter reports a journey', 'szsFirefighter', `select public.set_journey_progress($1, 'KRECEM')`, (c) => [c.saved.szsCallout], 'OK'],
    ['the DVD firefighter reports a journey on the SZS call-out', 'dvdFirefighter', `select public.set_journey_progress($1, 'KRECEM')`, (c) => [c.saved.szsCallout], 'ERR STAFF_REQUIRED'],
    ['szsFirefighter checks in', 'szsFirefighter', `select public.attendance_check_in($1)`, (c) => [c.saved.szsCallout], 'OK', { save: 'szsInterval' }],
    ['szsFirefighter asks for a correction to their own SZS attendance', 'szsFirefighter',
      `insert into public.attendance_correction_requests(interval_id, requested_by, message) values ($1, auth.uid(), 'SZS ispravka')`,
      (c) => [c.saved.szsInterval], 'ERR RLS', { after: [[P4D, 'OK']] }],
    ['the DVD firefighter asks for a correction to that SZS attendance', 'dvdFirefighter',
      `insert into public.attendance_correction_requests(interval_id, requested_by, message) values ($1, auth.uid(), 'Tudja ispravka')`,
      (c) => [c.saved.szsInterval], 'ERR RLS'],
    ['szsCommander files a correction for the SZS firefighter', 'szsCommander',
      `insert into public.attendance_correction_requests(interval_id, requested_by, message) values ($1, auth.uid(), 'Komandir ispravka')`,
      (c) => [c.saved.szsInterval], 'ERR RLS'],
    ['szsCommander checks dual in with a DVD vehicle', 'szsCommander', `select public.attendance_check_in($1, $2, null, null, $3)`, (c) => [c.saved.szsCallout, c.saved.dualSzs, c.dvdVehicle], 'ERR ORGANIZATION_MISMATCH'],
    ['szsCommander sends a DVD vehicle', 'szsCommander', `select public.record_vehicle_departure($1, $2, null)`, (c) => [c.dvdVehicle, c.saved.szsCallout], 'ERR STAFF_REQUIRED'],
    ['szsCommander sends the SZS vehicle', 'szsCommander', `select public.record_vehicle_departure($1, $2, null)`, (c) => [c.saved.szsVehicle, c.saved.szsCallout], 'OK'],
    ['owner moves the SZS call-out on', 'owner', `select public.set_intervention_status($1, 'ASSEMBLING', 2)`, (c) => [c.saved.szsCallout], 'OK'],

    // the owner's own DVD call-out, offered to both services and then to DVD
    ['owner drafts a DVD call-out', 'owner', `select public.create_intervention_draft('POZAR', 'DVD poziv', 'upute', 'mjesto', 'dvd-gate-1')`, () => [], 'OK', { save: 'dvdCallout' }],
    ['owner publishes it to a DVD and an SZS member (MIXED)', 'owner', `select public.publish_intervention($1, $2)`, (c) => [c.saved.dvdCallout, [c.dvdMember, c.saved.szsFirefighterSzs]], 'ERR ORGANIZATION_MISMATCH'],
    ['owner publishes it to DVD members, dual included', 'owner', `select public.publish_intervention($1, $2)`, (c) => [c.saved.dvdCallout, [c.dvdMember, c.saved.dualDvd, c.saved.dualWithdrawnDvd]], 'OK'],
    ['dual answers the DVD call-out', 'dual', `select public.submit_response($1, 'DOLAZIM', null, false)`, (c) => [c.saved.dvdCallout], 'OK'],
    ['the DVD firefighter answers the DVD call-out', 'dvdFirefighter', `select public.submit_response($1, 'DOLAZIM_KASNIJE', 15, false)`, (c) => [c.saved.dvdCallout], 'OK'],
    ['szsFirefighter answers the DVD call-out', 'szsFirefighter', `select public.submit_response($1, 'DOLAZIM', null, true)`, (c) => [c.saved.dvdCallout], 'ERR MEMBER_RECORD_REQUIRED'],

    // Both alerts are queued; only now does this person stop serving in SZS.
    // Their SZS alert must not be sent on the strength of their DVD role.
    ['owner withdraws dualWithdrawn from SZS', 'owner', `select public.owner_set_organization_membership($1, 'SZS', 'NONE')`, (c) => [c.users.dualWithdrawn], 'OK'],
  ];
}

/** Web Push alerts on the two gate call-outs, labelled by the synthetic member they are for. */
const QUEUED_ALERTS = `
  from public.notification_outbox o join public.organizations org on org.id = o.organization_id
 where o.channel = 'WEB_PUSH' and o.intervention_id in ($1, $2)`;
const ALERT_LABEL = `case o.member_id when $3 then 'szsFirefighterSzs' when $4 then 'dualSzs' when $5 then 'dualWithdrawnSzs'
                                      when $6 then 'dualDvd' when $7 then 'dualWithdrawnDvd' end || '@' || org.code`;
const alertMembers = (c) => [c.saved.szsFirefighterSzs, c.saved.dualSzs, c.saved.dualWithdrawnSzs, c.saved.dualDvd, c.saved.dualWithdrawnDvd];

/**
 * What must be true of the stored rows afterwards: who each answer was written
 * against. Counted as postgres, so nothing here depends on who may read it.
 */
function postconditions() {
  return [
    ['answers on the SZS call-out, by the member each came from', (c) => [c.saved.szsCallout],
      `select coalesce(string_agg(line, ',' order by line), '') from (
         select case r.member_id when $2 then 'szsFirefighterSzs' when $3 then 'dualSzs' else 'OTHER' end
                || ':' || r.answer || ':rev' || r.revision || ':' || o.code as line
           from public.intervention_responses r join public.organizations o on o.id = r.organization_id
          where r.intervention_id = $1) x`,
      (c) => [c.saved.szsFirefighterSzs, c.saved.dualSzs],
      '', { after: [[P4C, 'dualSzs:NE_MOGU:rev1:SZS,szsFirefighterSzs:DOLAZIM_KASNIJE:rev2:SZS']] }],
    ['revisions of the SZS answers, and whose they are', (c) => [c.saved.szsCallout],
      `select coalesce(string_agg(line, ',' order by line), '') from (
         select case r.member_id when $2 then 'szsFirefighterSzs' when $3 then 'dualSzs' else 'OTHER' end
                || ':rev' || v.revision || ':' || v.answer || ':' || o.code as line
           from public.intervention_response_revisions v
           join public.intervention_responses r on r.id = v.response_id
           join public.organizations o on o.id = v.organization_id
          where r.intervention_id = $1) x`,
      (c) => [c.saved.szsFirefighterSzs, c.saved.dualSzs],
      '', { after: [[P4C, 'dualSzs:rev1:NE_MOGU:SZS,szsFirefighterSzs:rev1:DOLAZIM:SZS,szsFirefighterSzs:rev2:DOLAZIM_KASNIJE:SZS']] }],
    ['answers on the DVD call-out, by the member each came from', (c) => [c.saved.dvdCallout],
      `select coalesce(string_agg(line, ',' order by line), '') from (
         select case r.member_id when $2 then 'dvdMember' when $3 then 'dualDvd' else 'OTHER' end
                || ':' || r.answer || ':' || o.code as line
           from public.intervention_responses r join public.organizations o on o.id = r.organization_id
          where r.intervention_id = $1) x`,
      (c) => [c.dvdMember, c.saved.dualDvd],
      'dualDvd:DOLAZIM:DVD,dvdMember:DOLAZIM_KASNIJE:DVD'],
    // Who was queued a Web Push alert: everybody sent a call-out who holds a
    // device - which an SZS-only member could not, before P4e.
    ['Web Push alerts queued for the synthetic members', (c) => [c.saved.szsCallout, c.saved.dvdCallout],
      `select coalesce(string_agg(line, ',' order by line), '') from (select ${ALERT_LABEL} as line ${QUEUED_ALERTS}) x where line is not null`,
      alertMembers,
      'dualDvd@DVD,dualSzs@SZS,dualWithdrawnDvd@DVD,dualWithdrawnSzs@SZS',
      { after: [[P4E, 'dualDvd@DVD,dualSzs@SZS,dualWithdrawnDvd@DVD,dualWithdrawnSzs@SZS,szsFirefighterSzs@SZS']] }],
    // What the push worker is told for each, asked in the service of its call-out:
    // the SZS firefighter has opened theirs; the member withdrawn from SZS is
    // refused their SZS alert and still sent their DVD one.
    ['the push worker\'s verdict on each', (c) => [c.saved.szsCallout, c.saved.dvdCallout],
      `select coalesce(string_agg(line, ',' order by line), '') from (
         select ${ALERT_LABEL} || ':' || v.verdict as line
         ${QUEUED_ALERTS.replace('from public.notification_outbox o', 'from public.notification_outbox o cross join lateral public.push_delivery_verdict(o.id) v')}) x
        where line is not null`,
      alertMembers,
      'dualDvd@DVD:DELIVER,dualSzs@SZS:DELIVER,dualWithdrawnDvd@DVD:DELIVER,dualWithdrawnSzs@SZS:INELIGIBLE,szsFirefighterSzs@SZS:OPENED',
      { requires: P4E }],
  ];
}

export const expectedFor = (spec, base, applied) => {
  let expected = base;
  for (const [migration, outcome] of spec?.after ?? []) if (applied.has(migration)) expected = outcome;
  return expected;
};

/**
 * Runs the extension on `client` (a clone of a migrated copy). `applied` is the
 * set of migration files applied to it. Returns every step with its expected
 * and actual outcome; the clone is left committed for the probes that follow.
 */
export async function runExtension(client, { applied, owner, dvdFirefighter, dvdMember, dvdVehicle }) {
  const users = { owner, dvdFirefighter };
  for (const who of SYNTHETIC) {
    const { rows } = await client.query(`insert into auth.users(email, email_confirmed_at) values ($1, now()) returning id::text`, [`${who.toLowerCase()}@example.invalid`]);
    users[who] = rows[0].id;
  }
  const ctx = { users, saved: {}, dvdMember, dvdVehicle };
  const report = [];
  for (const [label, who, statement, params, base, spec] of steps()) {
    const expected = expectedFor(spec, base, applied);
    await client.query('begin');
    let actual;
    try {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: users[who], role: 'authenticated' })]);
      await client.query('set local role authenticated');
      const { rows } = await client.query(statement, params(ctx));
      await client.query('commit');
      const value = rows.length ? Object.values(rows[0])[0] : null;
      if (spec?.save) ctx.saved[spec.save] = value;
      actual = 'OK';
    } catch (error) {
      await client.query('rollback');
      actual = /row-level security/.test(error.message)
        ? 'ERR RLS'
        : `ERR ${error.message.replace(/^.*?([A-Z][A-Z_]{4,})\b.*$/s, '$1')}`;
    }
    report.push({ label, expected, actual });
  }
  for (const [label, key, statement, params, base, spec] of postconditions()) {
    if (spec?.requires && !applied.has(spec.requires)) {
      report.push({ label, expected: 'n/a', actual: 'n/a' });
      continue;
    }
    const expected = expectedFor(spec, base, applied);
    const { rows } = await client.query(statement, [...key(ctx), ...params(ctx)]);
    report.push({ label, expected, actual: Object.values(rows[0])[0] });
  }
  return { report, users, saved: ctx.saved };
}

/**
 * Which services' rows every account can read, table by table, for every table
 * that carries `organization_id`. The whole point of P4a/P4b in one grid.
 *
 * Only rows about SOMEBODY ELSE count. Where a table names an account in
 * `user_id`, the reader's own row is left out: every account may read its own
 * membership in every service it holds one in - that is how a suspended or
 * half-registered account is told why it cannot act - and that is not a read
 * of the other service's data.
 */
export async function serviceVisibility(client, accounts) {
  const { rows: tables } = await client.query(`
    select c.table_name,
           exists (select 1 from information_schema.columns u
                    where u.table_schema = 'public' and u.table_name = c.table_name and u.column_name = 'user_id') as has_user
      from information_schema.columns c join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'organization_id' order by 1`);
  const out = {};
  for (const account of accounts) {
    await client.query('begin');
    try {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: account.id, role: 'authenticated' })]);
      await client.query('set local role authenticated');
      out[account.label] = {};
      for (const { table_name: table, has_user: hasUser } of tables) {
        const { rows } = await client.query(`select coalesce(string_agg(distinct o.code, ',' order by o.code), '') as seen
            from public.${table} x join public.organizations o on o.id = x.organization_id
           ${hasUser ? 'where x.user_id is distinct from auth.uid()' : ''}`);
        out[account.label][table] = rows[0].seen;
      }
    } finally {
      await client.query('rollback');
    }
  }
  return { tables: tables.map((t) => t.table_name), grid: out };
}

/** What each kind of account may see, by service - checked against the grid above. */
export function visibilityExpectation(label) {
  if (label === 'owner') return { may: [DVD, SZS].map(codeOf) };
  if (label === 'dual') return { may: ['DVD', 'SZS'] };
  if (label === 'szsCommander' || label === 'szsFirefighter') return { may: ['SZS'] };
  if (label === 'szsSuspended' || label === 'szsIncomplete') return { may: [] };
  return { may: ['DVD'] };
}
const codeOf = (id) => (id === DVD ? 'DVD' : 'SZS');
