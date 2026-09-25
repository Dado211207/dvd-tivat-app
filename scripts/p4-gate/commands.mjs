/**
 * What every account can DO, before and after: every command a signed-in
 * client can call on a schema at production's state, run as every account
 * against real rows of the copy, each in a transaction that is rolled back.
 *
 * Each probe records the outcome (the refusal code, or OK and the value) and
 * the exact effect on every table - restricted to the columns production has
 * today, with freshly generated ids shown as NEW and the transaction's now()
 * as NOW - so the matrix taken on the copy before 202609240022 and after the
 * last migration under test can be compared entry by entry.
 *
 * Targets are chosen by what a row IS (a closed call-out, a verified interval,
 * an unlinked member), not by position, so the same matrix means the same thing
 * on a later capture with more rows in it.
 */

const UUID_WHOLE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const MISSING = '00000000-0000-4000-8fff-000000000001';

/** The account tokens (u1, u2, ...) of a copy, in id order - the capture's numbering. */
export async function accountsOf(client) {
  const { rows } = await client.query(`select id::text as id from auth.users order by id`);
  return rows.map((row, k) => ({ token: `u${k + 1}`, id: row.id }));
}

/** What each case is pointed at, found by property on the pre-migration copy. */
export async function findTargets(client) {
  const { rows } = await client.query(`
    select
      (select array_agg(id::text order by id) from public.groups) as groups,
      (select array_agg(id::text order by id) from (select id from public.members order by id limit 3) x) as three_members,
      (select array_agg(id::text order by id) from public.members where user_id is null) as unlinked_members,
      (select id::text from public.members where user_id is not null order by id limit 1) as linked_member,
      (select user_id::text from public.access_grants where role = 'CITIZEN' order by user_id limit 1) as citizen,
      (select user_id::text from public.access_grants where role <> 'OWNER' order by user_id limit 1) as non_owner,
      (select array_agg(id::text order by id) from public.vehicles) as vehicles,
      (select array_agg(id::text order by id) from public.interventions where status in ('CLOSED', 'CANCELLED')) as finished,
      (select id::text from public.attendance_intervals where not verified and rejected_at is null order by id limit 1) as unverified_interval,
      (select id::text from public.attendance_intervals where verified order by id limit 1) as verified_interval,
      (select id::text from public.vehicle_movements where returned_at is not null order by id limit 1) as returned_movement,
      (select endpoint from public.web_push_subscriptions where revoked_at is null order by id limit 1) as live_endpoint,
      (select a.id::text from public.attendance_intervals a join public.members m on m.id = a.member_id
         join public.profiles p on p.user_id = m.user_id and p.profile_complete
         join public.access_grants g on g.user_id = m.user_id and g.active
                                     and g.role in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER')
        where m.active order by m.id, a.id limit 1) as recipient_interval,
      -- The member a call-out can be sent to: what P0's eligibility asks, as
      -- postgres, so it does not depend on who is asking.
      (select row(m.id::text, m.user_id::text)::text from public.members m
         join public.profiles p on p.user_id = m.user_id and p.profile_complete
         join public.access_grants g on g.user_id = m.user_id and g.active
                                     and g.role in ('OWNER', 'ADMIN', 'COMMANDER', 'FIREFIGHTER')
        where m.active order by m.id limit 1) as recipient`);
  const t = rows[0];
  const [recipientMember, recipientAccount] = t.recipient ? t.recipient.slice(1, -1).split(',') : [null, null];
  return {
    groupA: t.groups?.[0] ?? null,
    groupB: t.groups?.[1] ?? null,
    threeMembers: t.three_members ?? [],
    unlinkedA: t.unlinked_members?.[0] ?? null,
    unlinkedB: t.unlinked_members?.[1] ?? null,
    linkedMember: t.linked_member,
    citizen: t.citizen,
    nonOwner: t.non_owner,
    vehicleA: t.vehicles?.[0] ?? null,
    vehicleB: t.vehicles?.[1] ?? null,
    finishedA: t.finished?.[0] ?? null,
    finishedB: t.finished?.[1] ?? null,
    unverifiedInterval: t.unverified_interval,
    verifiedInterval: t.verified_interval,
    returnedMovement: t.returned_movement,
    liveEndpoint: t.live_endpoint,
    recipientInterval: t.recipient_interval,
    recipientMember,
    recipientAccount,
  };
}

/** [name, sql, params] - null params mean the data has no row of that kind, and the case is skipped. */
function cases(t) {
  const need = (...values) => (values.every((v) => v !== null && v !== undefined) ? values : null);
  const T0 = '2026-09-14T20:32:00+00';
  return [
    // registry (P4a)
    ['admin_create_group', `select public.admin_create_group('Gate grupa')`, []],
    ['admin_rename_group', `select public.admin_rename_group($1, 'Gate ime grupe')`, need(t.groupA)],
    ['admin_set_group_active', `select public.admin_set_group_active($1, false, 'Gate razlog')`, need(t.groupB ?? t.groupA)],
    ['admin_set_group_members', `select public.admin_set_group_members($1, $2)`, t.threeMembers.length ? need(t.groupA, t.threeMembers) : null],
    ['admin_create_member', `select public.admin_create_member('Gate Clan', array['spec-1'])`, []],
    ['admin_update_member', `select public.admin_update_member($1, 'Gate Ime', array['spec-2'])`, need(t.unlinkedA)],
    ['admin_set_member_active', `select public.admin_set_member_active($1, false, 'Gate razlog')`, need(t.unlinkedB ?? t.unlinkedA)],
    ['admin_link_member_account', `select public.admin_link_member_account($1, $2)`, need(t.unlinkedA, t.citizen)],
    ['admin_unlink_member_account', `select public.admin_unlink_member_account($1, 'Gate razlog')`, need(t.linkedMember)],
    ['admin_create_vehicle', `select public.admin_create_vehicle('GATE-1', 'Gate vozilo', 'Navalno')`, []],
    ['admin_update_vehicle', `select public.admin_update_vehicle($1, 'GATE-2', 'Gate vozilo 2', 'Tehnicko')`, need(t.vehicleB ?? t.vehicleA)],
    ['admin_set_vehicle_active', `select public.admin_set_vehicle_active($1, false, 'Gate razlog')`, need(t.vehicleB ?? t.vehicleA)],
    ['set_own_availability', `select public.set_own_availability(false, 'Gate napomena')`, []],
    // call-outs (P4b), against real finished ones
    ['create_intervention_draft', `select public.create_intervention_draft('POZAR', 'Gate naslov', 'Gate upute', 'Gate lokacija', 'gate-key-1')`, []],
    ['update_intervention_draft_finished', `select public.update_intervention_draft($1, 'Gate naslov', 'Gate upute', 'Gate lokacija', 3)`, need(t.finishedA)],
    ['discard_intervention_draft_finished', `select public.discard_intervention_draft($1, 'Gate razlog')`, need(t.finishedA)],
    ['publish_intervention_finished', `select public.publish_intervention($1, $2)`, need(t.finishedA, t.recipientMember && [t.recipientMember])],
    ['set_intervention_status_finished', `select public.set_intervention_status($1, 'ASSEMBLING', 3)`, need(t.finishedA)],
    ['close_intervention_finished', `select public.close_intervention($1, 'CLOSED', 'Gate razlog', true)`, need(t.finishedA)],
    ['acknowledge_intervention_finished', `select public.acknowledge_intervention($1)`, need(t.finishedA)],
    // what a call-out produces, against real rows
    ['attendance_check_in_finished', `select public.attendance_check_in($1)`, need(t.finishedA)],
    ['attendance_check_out_finished', `select public.attendance_check_out($1)`, need(t.finishedB ?? t.finishedA)],
    ['attendance_confirm', `select public.attendance_confirm($1, null)`, need(t.unverifiedInterval)],
    ['attendance_reject', `select public.attendance_reject($1, 'Gate razlog')`, need(t.unverifiedInterval)],
    ['attendance_unconfirm', `select public.attendance_unconfirm($1, 'Gate razlog')`, need(t.verifiedInterval)],
    ['attendance_correct', `select public.attendance_correct($1, $2::timestamptz, $2::timestamptz + interval '1 minute', 'Gate razlog')`, need(t.unverifiedInterval, T0)],
    ['attendance_confirm_many', `select interval_id, outcome from public.attendance_confirm_many($1, null)`,
      t.unverifiedInterval && t.verifiedInterval ? [[t.unverifiedInterval, t.verifiedInterval]] : null],
    ['record_vehicle_departure_free', `select public.record_vehicle_departure($1, null, 'Gate svrha')`, need(t.vehicleB ?? t.vehicleA)],
    ['record_vehicle_departure_finished', `select public.record_vehicle_departure($1, $2, null)`, need(t.vehicleA, t.finishedA)],
    ['record_vehicle_return_returned', `select public.record_vehicle_return($1)`, need(t.returnedMovement)],
    ['set_journey_progress_finished', `select public.set_journey_progress($1, 'KRECEM')`, need(t.finishedA)],
    ['submit_response_finished', `select public.submit_response($1, 'DOLAZIM', null, true)`, need(t.finishedA)],
    ['submit_response_missing', `select public.submit_response($1, 'DOLAZIM', null, true)`, [MISSING]],
    ['submit_response_invalid_answer_missing', `select public.submit_response($1, 'MOZDA', null, true)`, [MISSING]],
    // the account's own device and profile
    ['register_web_push_subscription', `select public.register_web_push_subscription('https://push.example.invalid/gate', $1, 'gate-auth-secret-1', null, 'Gate agent')`, ['B'.repeat(65)]],
    ['register_web_push_subscription_existing', `select public.register_web_push_subscription($1, $2, 'gate-auth-secret-2', null, 'Gate agent')`, need(t.liveEndpoint, 'B'.repeat(65))],
    ['revoke_web_push_subscription', `select public.revoke_web_push_subscription($1)`, need(t.liveEndpoint)],
    ['complete_own_profile', `select public.complete_own_profile('Gate Ime Prezime', '+38267555111', date '1980-02-03')`, []],
    ['review_report_missing', `select public.review_report($1, 'REVIEWED', 'Gate')`, [MISSING]],
    // the one direct write a member may make: asking for their own attendance
    // to be corrected - as a client sends it, and arriving already decided
    ['correction_request', `insert into public.attendance_correction_requests(interval_id, requested_by, message)
       values ($1, auth.uid(), 'Gate ispravka') returning id`, need(t.recipientInterval)],
    ['correction_request_prefilled', `insert into public.attendance_correction_requests(
       interval_id, requested_by, message, resolved_by, resolved_at, resolution_note)
       values ($1, auth.uid(), 'Gate ispravka', auth.uid(), now(), 'Gate odluka') returning id`, need(t.recipientInterval)],
    // account administration (P4f's, but decided by the same authority shim)
    ['owner_set_role', `select public.owner_set_role($1, 'FIREFIGHTER')`, need(t.citizen)],
    ['owner_set_account_active', `select public.owner_set_account_active($1, false, 'Gate razlog')`, need(t.nonOwner)],
    ['owner_set_organization_membership', `select public.owner_set_organization_membership($1, 'DVD', 'FIREFIGHTER')`, need(t.citizen)],
  ];
}

export async function commandMatrix(client, { columns, accounts, targets }) {
  const snapshotSql = `select jsonb_build_object(${Object.entries(columns).map(([table, cols]) =>
    `'${table}', (select coalesce(jsonb_agg(jsonb_build_object(${cols.map((c) => `'${c}', x.${c}`).join(', ')})), '[]'::jsonb) from public.${table} x)`).join(',\n')}) as s,
    to_jsonb(now()) #>> '{}' as now`;
  const pristine = (await client.query(snapshotSql)).rows[0].s;
  const known = new Set();
  const collect = (v) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    else if (typeof v === 'string' && UUID_WHOLE.test(v)) known.add(v);
  };
  collect(pristine);
  // Ids generated inside the transaction are random, so they are shown as NEW,
  // including where a command embeds one in a longer string (an outbox
  // dedupe_key carries the call-out's id). Known ids become their account token
  // where they are one, so the report reads in the capture's numbering.
  const tokenOf = new Map(accounts.map((a) => [a.id, a.token]));
  const normalise = (v, now) => {
    if (Array.isArray(v)) return v.map((x) => normalise(x, now));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalise(x, now)]));
    if (typeof v === 'string' && v === now) return 'NOW';
    if (typeof v === 'string') return v.replace(UUID_ANYWHERE, (id) => (known.has(id) ? tokenOf.get(id) ?? id : 'NEW'));
    return v;
  };
  const multiset = (rows, now) => rows.map((row) => JSON.stringify(normalise(row, now), Object.keys(row).sort()));
  const diff = (before, after, now) => {
    const out = {};
    for (const table of Object.keys(columns)) {
      const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
      const b = count(multiset(before[table], now));
      const a = count(multiset(after[table], now));
      const added = [];
      const removed = [];
      for (const [x, n] of a) for (let k = 0; k < n - (b.get(x) ?? 0); k += 1) added.push(x);
      for (const [x, n] of b) for (let k = 0; k < n - (a.get(x) ?? 0); k += 1) removed.push(x);
      if (added.length || removed.length) out[table] = { added: added.sort(), removed: removed.sort() };
    }
    return out;
  };

  async function as(account, statement, params) {
    await client.query('savepoint step');
    try {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: account.id, role: 'authenticated' })]);
      await client.query('set local role authenticated');
      const { rows } = await client.query(statement, params);
      await client.query('reset role');
      await client.query('release savepoint step');
      const value = rows.length ? Object.values(rows[0])[0] : null;
      return { ok: true, value: rows.length > 1 ? rows.map((row) => Object.values(row)) : value };
    } catch (error) {
      await client.query('rollback to savepoint step');
      await client.query('reset role');
      return { ok: false, code: error.code, message: error.message };
    }
  }
  async function step(account, statement, params, state) {
    const result = await as(account, statement, params);
    const { rows } = await client.query(snapshotSql);
    const outcome = result.ok
      ? `OK ${JSON.stringify(normalise(result.value, rows[0].now))}`
      : `ERR ${result.code} ${normalise(result.message, rows[0].now)}`;
    const effect = diff(state.snapshot, rows[0].s, rows[0].now);
    state.snapshot = rows[0].s;
    return { outcome, effect, value: result.ok ? result.value : null };
  }

  const results = {};
  const skipped = [];
  for (const [name, statement, params] of cases(targets)) {
    if (params === null) {
      skipped.push(name);
      continue;
    }
    for (const account of accounts) {
      await client.query('begin');
      try {
        const r = await step(account, statement, params, { snapshot: pristine });
        results[`${name}|${account.token}`] = { outcome: r.outcome, effect: r.effect };
      } finally {
        await client.query('rollback');
      }
    }
  }

  // A whole live call-out, in one transaction per account: each account tries
  // to run it, and the real recipient answers. Every other account then tries
  // to answer and to report a journey, which is where a boundary would show.
  const recipient = accounts.find((a) => a.id === targets.recipientAccount);
  if (!recipient) {
    skipped.push('scenario (the capture has no member a call-out can be sent to)');
  } else {
    for (const commander of accounts) {
      await client.query('begin');
      try {
        const state = { snapshot: pristine };
        const log = [];
        const run = async (label, account, statement, params = []) => {
          const r = await step(account, statement, params, state);
          log.push([label, account.token, r.outcome, r.effect]);
          return r;
        };
        const draft = await run('create', commander, `select public.create_intervention_draft('POZAR', 'Gate poziv', 'Gate upute', 'Gate mjesto', 'gate-scenario')`);
        if (draft.value) {
          const id = draft.value;
          await run('update', commander, `select public.update_intervention_draft($1, 'Gate poziv 2', 'Gate upute 2', 'Gate mjesto 2', 1)`, [id]);
          await run('publish', commander, `select public.publish_intervention($1, $2)`, [id, [targets.recipientMember]]);
          await run('publish-repeat', commander, `select public.publish_intervention($1, $2)`, [id, [targets.recipientMember]]);
          const second = await run('create-2', commander, `select public.create_intervention_draft('VJEZBA', 'Gate vjezba', 'Gate upute', 'Gate mjesto', 'gate-scenario-2')`);
          if (second.value && targets.unlinkedA) {
            await run('publish-ineligible', commander, `select public.publish_intervention($1, $2)`, [second.value, [targets.recipientMember, targets.unlinkedA]]);
          }
          await run('acknowledge', recipient, `select public.acknowledge_intervention($1)`, [id]);
          await run('respond', recipient, `select public.submit_response($1, 'DOLAZIM', null, true)`, [id]);
          await run('respond-repeat', recipient, `select public.submit_response($1, 'DOLAZIM', null, true)`, [id]);
          await run('respond-change', recipient, `select public.submit_response($1, 'DOLAZIM_KASNIJE', 15, false)`, [id]);
          await run('respond-change-back', recipient, `select public.submit_response($1, 'NE_MOGU', null, true)`, [id]);
          await run('respond-invalid-eta', recipient, `select public.submit_response($1, 'DOLAZIM_KASNIJE', 10, false)`, [id]);
          await run('respond-invalid-answer', recipient, `select public.submit_response($1, 'MOZDA', null, false)`, [id]);
          if (second.value) await run('respond-to-draft', recipient, `select public.submit_response($1, 'DOLAZIM', null, true)`, [second.value]);
          for (const other of accounts.filter((a) => a !== recipient)) {
            await run(`respond-as-${other.token}`, other, `select public.submit_response($1, 'DOLAZIM', null, true)`, [id]);
            await run(`journey-as-${other.token}`, other, `select public.set_journey_progress($1, 'KRECEM')`, [id]);
          }
          await run('journey', recipient, `select public.set_journey_progress($1, 'KRECEM')`, [id]);
          const checkIn = await run('check-in-self', recipient, `select public.attendance_check_in($1)`, [id]);
          const vehicle = targets.vehicleB ?? targets.vehicleA;
          const out = vehicle ? await run('vehicle-out', commander, `select public.record_vehicle_departure($1, $2, 'Gate')`, [vehicle, id]) : { value: null };
          await run('status', commander, `select public.set_intervention_status($1, 'ASSEMBLING', 3)`, [id]);
          // Backdated so check-out and correction have a real interval to work with.
          const T0 = '2026-09-24T12:00:00+00';
          if (checkIn.value) await client.query('update public.attendance_intervals set started_at = $2 where id = $1', [checkIn.value, T0]);
          if (out.value) await client.query('update public.vehicle_movements set departed_at = $2 where id = $1', [out.value, T0]);
          state.snapshot = (await client.query(snapshotSql)).rows[0].s;
          await run('check-out-self', recipient, `select public.attendance_check_out($1)`, [id]);
          if (checkIn.value) {
            await run('request-correction', recipient, `insert into public.attendance_correction_requests(interval_id, requested_by, message)
              values ($1, auth.uid(), 'Gate ispravka') returning id`, [checkIn.value]);
          }
          if (checkIn.value) {
            await run('confirm', commander, `select public.attendance_confirm($1, null)`, [checkIn.value]);
            await run('unconfirm', commander, `select public.attendance_unconfirm($1, 'Gate')`, [checkIn.value]);
            await run('correct', commander, `select public.attendance_correct($1, '2026-09-24T12:30:00+00', '2026-09-24T13:30:00+00', 'Gate')`, [checkIn.value]);
            await run('reject', commander, `select public.attendance_reject($1, 'Gate')`, [checkIn.value]);
          }
          if (out.value) await run('vehicle-return', commander, `select public.record_vehicle_return($1)`, [out.value]);
          await run('close', commander, `select public.close_intervention($1, 'CLOSED', 'Gate', true)`, [id]);
          await run('respond-after-close', recipient, `select public.submit_response($1, 'DOLAZIM', null, true)`, [id]);
        }
        results[`scenario|${commander.token}`] = log;
      } finally {
        await client.query('rollback');
      }
    }
  }
  return { results, skipped };
}

/** The columns production has, so the copy after migration is compared on the same ones only. */
export async function publicColumns(client) {
  const { rows } = await client.query(`select table_name, array_agg(column_name::text order by ordinal_position) as cols
    from information_schema.columns where table_schema = 'public' group by table_name order by 1`);
  return Object.fromEntries(rows.map((row) => [row.table_name, row.cols]));
}

/**
 * Entry-by-entry comparison. `expected` rules may excuse a difference; every
 * excused one is returned with the rule that excused it, so the report shows
 * them rather than hiding them.
 */
export function compareMatrices(pre, post, expected = []) {
  const out = { compared: 0, steps: 0, unexpected: [], excused: [] };
  const keys = new Set([...Object.keys(pre), ...Object.keys(post)]);
  for (const key of [...keys].sort()) {
    const a = pre[key];
    const b = post[key];
    if (!a || !b) {
      out.unexpected.push({ key, why: `present ${a ? 'before' : 'after'} only` });
      continue;
    }
    if (key.startsWith('scenario|')) {
      const n = Math.max(a.length, b.length);
      for (let k = 0; k < n; k += 1) {
        out.steps += 1;
        const x = a[k];
        const y = b[k];
        if (JSON.stringify(x) === JSON.stringify(y)) continue;
        const entry = { key: `${key}#${k}:${x?.[0] ?? y?.[0]}`, pre: x?.[2], post: y?.[2], sameEffect: JSON.stringify(x?.[3]) === JSON.stringify(y?.[3]) };
        const rule = expected.find((r) => x && y && r.matches({ name: x[0], account: x[1], pre: { outcome: x[2], effect: x[3] }, post: { outcome: y[2], effect: y[3] } }));
        (rule ? out.excused : out.unexpected).push(rule ? { ...entry, rule: rule.id } : entry);
      }
      continue;
    }
    out.compared += 1;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const name = key.split('|')[0];
    const entry = { key, pre: a.outcome, post: b.outcome, sameEffect: JSON.stringify(a.effect) === JSON.stringify(b.effect) };
    const rule = expected.find((r) => r.matches({ name, account: key.split('|')[1], pre: a, post: b }));
    (rule ? out.excused : out.unexpected).push(rule ? { ...entry, rule: rule.id } : entry);
  }
  return out;
}
