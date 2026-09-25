/**
 * Local databases for the P4 equivalence gate: building the production schema
 * state, loading the pseudonymised capture into it, and capturing a copy the
 * same way production was captured.
 *
 * Everything here runs against a LOOPBACK PostgreSQL server only. The hosted
 * project is never contacted; its only input is the capture file.
 */

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';

export const DVD = '00000000-0000-4000-8000-000000000001';
export const SZS = '00000000-0000-4000-8000-000000000002';

export class Unrunnable extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

/**
 * The migration order is read out of the harness rather than restated here,
 * so the gate cannot pass against an order the suite does not use.
 */
export function migrationsFromHarness(repo) {
  const source = readFileSync(resolve(repo, 'db-tests/harness.ts'), 'utf8');
  const start = source.indexOf('export const MIGRATIONS = [');
  if (start === -1) throw new Unrunnable('db-tests/harness.ts no longer exports MIGRATIONS');
  const block = source.slice(start, source.indexOf('];', start));
  return [...block.matchAll(/'([^']+\.sql)'/g)].map((match) => match[1]);
}

/** `supabase/migrations/202609150012_web_push_subscriptions.sql` -> `web_push_subscriptions`. */
export const migrationName = (file) => file.split('/').pop().replace(/^\d+[a-z]?_/, '').replace(/\.sql$/, '');

/**
 * Where production stands in the harness list. Hosted migrations are recorded
 * by name under a timestamp of their own, so they are matched by name - and
 * the applied set must be EXACTLY a prefix of the list, or the copy would be
 * built from a state production is not in.
 */
export function productionBoundary(files, applied) {
  const appliedSet = new Set(applied);
  if (appliedSet.size !== applied.length) throw new Unrunnable('the capture lists a migration twice');
  // The harness also lists the local stand-in for Supabase's own schemas
  // (supabase/tests/...). It is not a migration and production never records
  // it; it belongs to whichever side of the boundary it sits on.
  let boundary = files.length;
  const inPrefix = new Set();
  for (const [k, file] of files.entries()) {
    if (!file.startsWith('supabase/migrations/')) continue;
    if (!appliedSet.has(migrationName(file))) {
      boundary = k;
      break;
    }
    inPrefix.add(migrationName(file));
  }
  const unknown = applied.filter((name) => !inPrefix.has(name));
  if (unknown.length) {
    throw new Unrunnable(`production has migrations that are not a prefix of the harness list: ${unknown.join(', ')}`);
  }
  return boundary;
}

export function localAdminUrl() {
  const raw = process.env.DVD_TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:55432/postgres';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Unrunnable('DVD_TEST_DATABASE_URL must be a local PostgreSQL URL');
  }
  // This creates and drops databases. Never a remote endpoint, even when the
  // variable was set to one by accident in this shell.
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Unrunnable('the gate only accepts a loopback PostgreSQL server');
  }
  return url;
}

/** Creates and remembers databases, so every one of them is dropped at the end. */
export class Databases {
  constructor(adminUrl) {
    this.adminUrl = adminUrl;
    this.prefix = `p4_gate_${process.pid}_${randomBytes(4).toString('hex')}`;
    this.created = [];
    this.clients = new Set();
  }

  name(label) {
    return `${this.prefix}_${label}`;
  }

  async admin(statement) {
    const client = new pg.Client({ connectionString: this.adminUrl.toString() });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
  }

  /** A new database, empty or cloned from another one this run created. */
  async create(label, template = null) {
    const name = this.name(label);
    try {
      await this.admin(`create database ${name}${template ? ` template ${template}` : ''}`);
    } catch (error) {
      throw new Unrunnable(`could not create ${name} - is the local server running? (${error.message})`);
    }
    this.created.push(name);
    return name;
  }

  async connect(name) {
    const url = new URL(this.adminUrl);
    url.pathname = `/${name}`;
    const client = new pg.Client({ connectionString: url.toString() });
    // A database dropped under an open connection terminates it; that must not
    // take the process down before the verdict is printed.
    client.on('error', () => {});
    await client.connect();
    this.clients.add(client);
    const end = client.end.bind(client);
    client.end = () => {
      this.clients.delete(client);
      return end();
    };
    return client;
  }

  async dropAll() {
    for (const client of this.clients) await client.end().catch(() => {});
    for (const name of this.created.reverse()) {
      await this.admin(`drop database if exists ${name} with (force)`).catch(() => {});
    }
    this.created = [];
  }
}

export async function applyMigrations(client, repo, files) {
  for (const file of files) {
    try {
      await client.query(readFileSync(resolve(repo, file), 'utf8'));
    } catch (error) {
      throw new Unrunnable(`migration failed: ${file}\n${error.message}`);
    }
  }
}

/** Runs a whole file as ONE simple query - one implicit transaction, as the hosted connector does. */
export async function captureWith(client, sqlText) {
  const results = await client.query(sqlText);
  const last = Array.isArray(results) ? results[results.length - 1] : results;
  return last.rows[0];
}

/** The digest the capture computes for `export`, recomputed here for a document on disk. */
export async function exportDigestOf(client, exported) {
  const { rows } = await client.query(
    `select jsonb_object_agg(k, case when jsonb_typeof(v) = 'array'
        then md5(coalesce((select string_agg(x::text, E'\\n' order by x::text collate "C") from jsonb_array_elements(v) x), ''))
        else md5(v::text) end) as digest
       from jsonb_each($1::jsonb) as t(k, v)`,
    [JSON.stringify(exported)],
  );
  return rows[0].digest;
}

const CODES = {
  u: '8001', m: '8002', g: '8003', v: '8004', i: '8005', a: '8006', mv: '8007', o: '8008', da: '8009',
  r: '800a', rr: '800b', jh: '800c', ah: '800d', oa: '800e', ra: '800f', rl: '8010', sa: '8011', w: '8012',
  up: '8013', ac: '8014', cr: '8015', ma: '8016',
};
const TOKEN = new RegExp(`^(${Object.keys(CODES).join('|')})(\\d+)$`);

/**
 * The synthetic uuid a token stands for. Order-preserving - token n sorts
 * before token n+1, exactly as the real ids did - because several reads order
 * by id, and the copy has to answer them in the same order production does.
 */
export function tokenUuid(token) {
  const match = TOKEN.exec(token);
  if (!match) throw new Error(`not a token: ${token}`);
  return `00000000-0000-4000-${CODES[match[1]]}-${match[2].padStart(12, '0')}`;
}

/**
 * Loads the capture's `export` into a database already built at production's
 * schema state.
 *
 * Triggers are suppressed (session_replication_role = replica): this is a copy
 * of the stored state, not a re-enactment, so no signup trigger, membership
 * mirror or audit trigger may add rows of its own. Foreign keys are therefore
 * re-checked explicitly afterwards, every one of them.
 *
 * Wherever production held text, the copy holds an obviously synthetic value;
 * where production held nothing, so does the copy.
 */
export async function loadExport(client, ex) {
  for (const [table, count] of Object.entries(ex.counts)) {
    if (Number(count) !== 0) throw new Unrunnable(`${table} has ${count} rows; the capture does not export it, so no faithful copy can be built`);
  }
  const orgByCode = Object.fromEntries(ex.organizations.map((row) => [row[1], row[0]]));
  const id = (t) => {
    if (t === null || t === undefined) return null;
    if (typeof t === 'string' && t.startsWith('org:')) return orgByCode[t.slice(4)];
    return tokenUuid(t);
  };
  const num = (t) => Number(TOKEN.exec(t)[2]);
  const expand = (value) => {
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]));
    if (typeof value === 'string' && (TOKEN.test(value) || value.startsWith('org:'))) return id(value);
    return value;
  };
  const insert = async (table, columns, rows) => {
    const params = columns.map((_, k) => `$${k + 1}`).join(', ');
    for (const row of rows) await client.query(`insert into public.${table}(${columns.join(', ')}) values (${params})`, row);
  };

  await client.query('begin');
  try {
    await client.query('set local session_replication_role = replica');
    for (const [orgId, code, display, active, created] of ex.organizations) {
      const { rowCount } = await client.query(
        'update public.organizations set code = $2, display_name = $3, active = $4, created_at = $5 where id = $1',
        [orgId, code, display, active, created],
      );
      if (rowCount !== 1) {
        await client.query('insert into public.organizations(id, code, display_name, active, created_at) values ($1, $2, $3, $4, $5)',
          [orgId, code, display, active, created]);
      }
    }
    for (const [t, confirmed, confirmedAt, created] of ex.users) {
      await client.query(`insert into auth.users(id, email, email_confirmed_at, created_at, raw_user_meta_data) values ($1, $2, $3, $4, '{}')`,
        [id(t), `account-${num(t)}@example.invalid`, confirmed ? confirmedAt : null, created]);
    }
    await insert('profiles', ['user_id', 'email', 'full_name', 'phone_e164', 'date_of_birth', 'profile_complete', 'created_at', 'updated_at'],
      ex.profiles.map(([t, hasName, hasPhone, hasDob, complete, c, u]) => [id(t), `account-${num(t)}@example.invalid`,
        hasName ? `Korisnik ${num(t)}` : null, hasPhone ? `+38267${String(num(t)).padStart(6, '0')}` : null,
        hasDob ? '1985-05-05' : null, complete, c, u]));
    await insert('access_grants', ['user_id', 'role', 'active', 'granted_by', 'granted_at'],
      ex.access_grants.map(([t, role, active, by, at]) => [id(t), role, active, id(by), at]));
    await insert('organization_memberships', ['organization_id', 'user_id', 'role', 'active', 'granted_by', 'granted_at'],
      ex.organization_memberships.map(([org, t, role, active, by, at]) => [org, id(t), role, active, id(by), at]));
    await insert('organization_membership_audit', ['id', 'organization_id', 'target_user_id', 'previous_role', 'next_role', 'previous_active', 'next_active', 'changed_by', 'changed_at'],
      ex.organization_membership_audit.map(([r, org, t, pr, nr, pa, na, by, at]) => [id(r), org, id(t), pr, nr, pa, na, id(by), at]));
    await insert('role_audit', ['id', 'target_user_id', 'previous_role', 'next_role', 'changed_by', 'changed_at'],
      ex.role_audit.map(([r, t, pr, nr, by, at]) => [id(r), id(t), pr, nr, id(by), at]));
    await insert('account_status_audit', ['id', 'target_user_id', 'previous_active', 'next_active', 'reason', 'changed_by', 'changed_at'],
      ex.account_status_audit.map(([r, t, pa, na, by, at]) => [id(r), id(t), pa, na, 'Razlog promjene', id(by), at]));
    const memberName = {};
    await insert('members', ['id', 'user_id', 'full_name', 'specialties', 'active', 'created_at', 'updated_at'],
      ex.members.map(([r, t, name, specs, active, c, u]) => {
        memberName[r] = name;
        return [id(r), id(t), name, specs, active, c, u];
      }));
    await insert('groups', ['id', 'name', 'active', 'created_at'], ex.groups.map(([r, active, c]) => [id(r), `Grupa ${num(r)}`, active, c]));
    await insert('group_members', ['group_id', 'member_id'], ex.group_members.map(([g, m]) => [id(g), id(m)]));
    await insert('vehicles', ['id', 'callsign', 'name', 'kind', 'active', 'created_at'],
      ex.vehicles.map(([r, kind, active, c]) => [id(r), `V-${num(r)}`, `Vozilo ${num(r)}`, kind, active, c]));
    await insert('member_availability', ['member_id', 'available', 'note', 'changed_at', 'changed_by'],
      ex.member_availability.map(([m, available, note, at, by]) => [id(m), available, note ? 'Napomena' : null, at, id(by)]));
    await insert('member_availability_history', ['id', 'member_id', 'previous_available', 'next_available', 'note', 'changed_at', 'changed_by'],
      ex.member_availability_history.map(([r, m, pa, na, note, at, by]) => [id(r), id(m), pa, na, note ? 'Napomena' : null, at, id(by)]));
    await insert('interventions', ['id', 'kind', 'other_kind_note', 'title', 'instructions', 'incident_location', 'latitude', 'longitude',
      'coordinate_source', 'coordinate_captured_at', 'assembly_point', 'status', 'created_by', 'created_at', 'updated_at', 'published_at',
      'published_by', 'closed_at', 'closed_by', 'close_reason', 'version', 'idempotency_key'],
    ex.interventions.map(([r, kind, other, hasCoordinates, source, captured, assembly, status, by, c, u, publishedAt, publishedBy,
      closedAt, closedBy, reason, version, keyN]) => [
      id(r), kind, other ? 'Druga vrsta' : null, `Intervencija ${num(r)}`, `Upute za intervenciju ${num(r)}`, `Lokacija ${num(r)}`,
      hasCoordinates ? 42.43 : null, hasCoordinates ? 18.7 : null, source, captured, assembly ? `Zborno mjesto ${num(r)}` : null,
      status, id(by), c, u, publishedAt, id(publishedBy), closedAt, id(closedBy), reason ? 'Razlog zatvaranja' : null, version,
      // Keys are unique per author, so equal keys stay equal and distinct ones distinct.
      `ui-key-${keyN}`]));
    await insert('intervention_recipients', ['intervention_id', 'member_id', 'recipient_version', 'member_name_at_publication', 'added_at'],
      ex.intervention_recipients.map(([i, m, version, at]) => [id(i), id(m), version, memberName[m], at]));
    await insert('intervention_updates', ['id', 'intervention_id', 'version', 'body', 'created_by', 'created_at'],
      ex.intervention_updates.map(([r, i, version, by, at]) => [id(r), id(i), version, `Dopuna ${num(r)}`, id(by), at]));
    await insert('intervention_acknowledgements', ['intervention_id', 'member_id', 'opened_at'],
      ex.intervention_acknowledgements.map(([i, m, at]) => [id(i), id(m), at]));
    await insert('operational_audit', ['id', 'intervention_id', 'event_type', 'detail', 'actor_user_id', 'occurred_at'],
      ex.operational_audit.map(([r, i, type, detail, actor, at]) => [id(r), id(i), type, JSON.stringify(expand(detail)), id(actor), at]));
    await insert('registry_audit', ['id', 'entity_kind', 'entity_id', 'event_type', 'detail', 'reason', 'changed_by', 'changed_at'],
      ex.registry_audit.map(([r, kind, entity, type, detail, reason, by, at]) => [id(r), kind, id(entity), type,
        JSON.stringify(expand(detail)), reason ? 'Razlog' : null, id(by), at]));
    await insert('notification_outbox', ['id', 'intervention_id', 'member_id', 'channel', 'state', 'attempt_count', 'dedupe_key', 'created_at',
      'updated_at', 'delivery_closed_at', 'delivery_close_reason'],
    ex.notification_outbox.map(([r, i, m, channel, state, attempts, key, c, u, closedAt, closeReason]) => [id(r), id(i), id(m), channel, state,
      attempts, key.split(':').map((part) => (TOKEN.test(part) ? id(part) : part)).join(':'), c, u, closedAt, closeReason]));
    await insert('notification_delivery_attempts', ['id', 'outbox_id', 'attempted_at', 'provider', 'provider_status', 'provider_message'],
      ex.notification_delivery_attempts.map(([r, o, at, provider, status, message]) => [id(r), id(o), at, provider, status, message ? 'Poruka' : null]));
    await insert('intervention_journey', ['intervention_id', 'member_id', 'progress', 'updated_at', 'updated_by'],
      ex.intervention_journey.map(([i, m, progress, at, by]) => [id(i), id(m), progress, at, id(by)]));
    await insert('intervention_journey_history', ['id', 'intervention_id', 'member_id', 'previous_progress', 'next_progress', 'changed_at', 'changed_by'],
      ex.intervention_journey_history.map(([r, i, m, previous, next, at, by]) => [id(r), id(i), id(m), previous, next, at, id(by)]));
    await insert('attendance_intervals', ['id', 'intervention_id', 'member_id', 'started_at', 'ended_at', 'reported_started_at', 'reported_ended_at',
      'crew', 'task_role', 'vehicle_id', 'recorded_by', 'recorded_at', 'verified', 'verified_by', 'verified_at', 'source', 'rejected_at',
      'rejected_by', 'rejection_reason'],
    ex.attendance_intervals.map(([r, i, m, s, e, rs, re, crew, role, v, recordedBy, recordedAt, verified, verifiedBy, verifiedAt, source,
      rejectedAt, rejectedBy, rejectionReason]) => [id(r), id(i), id(m), s, e, rs, re, crew ? 'Posada' : null, role ? 'Uloga' : null, id(v),
      id(recordedBy), recordedAt, verified, id(verifiedBy), verifiedAt, source, rejectedAt, id(rejectedBy), rejectionReason ? 'Razlog odbijanja' : null]));
    await insert('attendance_corrections', ['id', 'interval_id', 'before_value', 'after_value', 'reason', 'corrected_by', 'corrected_at'],
      ex.attendance_corrections.map(([r, a, before, after, by, at]) => [id(r), id(a), JSON.stringify(before), JSON.stringify(after), 'Razlog ispravke', id(by), at]));
    await insert('attendance_correction_requests', ['id', 'interval_id', 'requested_by', 'requested_at', 'message', 'state', 'resolved_by', 'resolved_at', 'resolution_note'],
      ex.attendance_correction_requests.map(([r, a, by, at, state, resolvedBy, resolvedAt, note]) => [id(r), id(a), id(by), at, 'Molim ispravku', state,
        id(resolvedBy), resolvedAt, note ? 'Napomena' : null]));
    await insert('vehicle_movements', ['id', 'vehicle_id', 'intervention_id', 'purpose', 'departed_at', 'departed_by', 'returned_at', 'returned_by'],
      ex.vehicle_movements.map(([r, v, i, purpose, departedAt, departedBy, returnedAt, returnedBy]) => [id(r), id(v), id(i), purpose ? 'Svrha' : null,
        departedAt, id(departedBy), returnedAt, id(returnedBy)]));
    await insert('intervention_responses', ['id', 'intervention_id', 'member_id', 'answer', 'eta_minutes', 'direct_to_location', 'responded_at', 'updated_at', 'revision'],
      ex.intervention_responses.map(([r, i, m, answer, eta, direct, respondedAt, updatedAt, revision]) => [id(r), id(i), id(m), answer, eta, direct,
        respondedAt, updatedAt, revision]));
    await insert('intervention_response_revisions', ['id', 'response_id', 'revision', 'answer', 'eta_minutes', 'direct_to_location', 'recorded_at'],
      ex.intervention_response_revisions.map(([r, response, revision, answer, eta, direct, at]) => [id(r), id(response), revision, answer, eta, direct, at]));
    await insert('web_push_subscriptions', ['id', 'user_id', 'endpoint', 'p256dh', 'auth_secret', 'expiration_time', 'user_agent', 'created_at',
      'updated_at', 'last_used_at', 'revoked_at'],
    ex.web_push_subscriptions.map(([r, t, expires, agent, c, u, lastUsed, revoked]) => [id(r), id(t), `https://push.example.invalid/w${num(r)}`,
      'B'.repeat(65), `authsecret${num(r)}`, expires, agent ? 'Synthetic agent' : null, c, u, lastUsed, revoked]));
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw new Unrunnable(`the capture could not be loaded: ${error.message}`);
  }
}

/** Every foreign key in public, checked by hand because replica mode did not. Returns [checked, orphans]. */
export async function checkForeignKeys(client) {
  const { rows: keys } = await client.query(`
    select c.conname, c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
           (select string_agg(quote_ident(a.attname), ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as child_columns,
           (select string_agg(quote_ident(a.attname), ',' order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as parent_columns
      from pg_constraint c join pg_class t on t.oid = c.conrelid
     where c.contype = 'f' and t.relnamespace = 'public'::regnamespace`);
  let orphans = 0;
  for (const key of keys) {
    const child = key.child_columns.split(',');
    const parent = key.parent_columns.split(',');
    const { rows } = await client.query(
      `select count(*)::int as n from ${key.child} ch
        where ${child.map((c) => `ch.${c} is not null`).join(' and ')}
          and not exists (select 1 from ${key.parent} p where ${child.map((c, k) => `p.${parent[k]} = ch.${c}`).join(' and ')})`,
    );
    orphans += rows[0].n;
  }
  return [keys.length, orphans];
}

/**
 * Completes every incomplete profile through the application's own command, as
 * the account itself. Production today has only two accounts that can act;
 * this is the near-future production in which the others finish registering,
 * so authority that comes from a membership is exercised on the real roster.
 */
export async function completeProfiles(client) {
  const { rows } = await client.query(`select user_id from public.profiles where not profile_complete order by user_id`);
  for (const [k, { user_id: userId }] of rows.entries()) {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await client.query('set local role authenticated');
    await client.query(`select public.complete_own_profile($1, $2, date '1985-05-05')`,
      [`Korisnik Popunjen ${k + 1}`, `+38267${String(900000 + k)}`]);
    await client.query('commit');
  }
  return rows.length;
}
