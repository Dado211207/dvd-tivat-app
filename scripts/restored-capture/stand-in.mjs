/**
 * A loopback stand-in for a hosted Supabase project, for testing the
 * restored-copy capture without touching one.
 *
 * It is the repository's Supabase stub plus what the stub leaves out and the
 * hosted project has (measured on the isolated project, 2026-10-04):
 *
 *   - auth.users with the secret columns the dump must never read
 *     (encrypted_password, confirmation_token, email, phone) and Supabase's
 *     own auth.uid()/auth.role()/auth.jwt() definitions;
 *   - pg_net's `net` schema with the grants PUBLIC holds there (USAGE, write
 *     on the request queue and response table, EXECUTE on http_post);
 *   - pg_cron's `cron` schema, which PUBLIC cannot use, with a job whose
 *     command holds a secret, and DELETE granted to PUBLIC on its run log;
 *   - a `vault` schema holding a secret; `extensions.pg_stat_statements`
 *     readable by PUBLIC;
 *   - a supabase_migrations ledger in the hosted shape;
 *   - production's 22 migrations, then rows made through the app's commands.
 *
 * Fictional data only.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrationName, migrationsFromHarness } from '../p4-gate/database.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PRODUCTION_MIGRATIONS = 22;

const PLATFORM = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin superuser; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

alter table auth.users add column encrypted_password text, add column confirmation_token text,
  add column phone text, add column raw_app_meta_data jsonb;

-- Supabase's definitions, as pg_get_functiondef prints them on the hosted project.
create or replace function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
create or replace function auth.role() returns text language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $f$;
create or replace function auth.jwt() returns jsonb language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''))::jsonb $f$;

create schema net authorization supabase_admin;
grant usage on schema net to public;
create table net.http_request_queue (id bigserial primary key, method text, url text, headers jsonb, body bytea, timeout_milliseconds int);
create table net._http_response (id bigint, status_code int, content text, created timestamptz default now());
alter table net.http_request_queue owner to supabase_admin;
alter table net._http_response owner to supabase_admin;
-- Exactly what PUBLIC holds on the hosted project.
grant all on net.http_request_queue, net._http_response to public;
grant select, usage, update on sequence net.http_request_queue_id_seq to public;
-- Supabase's \`postgres\` is not a superuser; the cron runs as it. Locally
-- \`postgres\` IS one, so this role stands in for it when checking that the
-- cron can still enqueue once pg_net is hardened.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'cron_stand_in') then create role cron_stand_in nologin; end if;
end $$;
create function net.http_post(url text, body jsonb default '{}', headers jsonb default '{}') returns bigint
  language sql as $f$ insert into net.http_request_queue(method, url, headers, body) values ('POST', url, headers, convert_to(body::text, 'utf8')) returning id $f$;
alter function net.http_post(text, jsonb, jsonb) owner to supabase_admin;

create schema cron authorization supabase_admin;
create table cron.job (jobid bigserial primary key, schedule text, command text, username text, active boolean default true, jobname text);
create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text);
alter table cron.job enable row level security;
alter table cron.job_run_details enable row level security;
grant select on cron.job to public;
grant select, delete on cron.job_run_details to public;
insert into cron.job(schedule, command, username, jobname) values
  ('* * * * *', 'select net.http_post(''https://example.invalid/functions/v1/send-web-push'', ''{}'', jsonb_build_object(''x-push-worker-secret'', ''stand-in-secret-not-real''))', 'postgres', 'send-web-push');
insert into cron.job_run_details(jobid, status) values (1, 'succeeded');

create schema vault authorization supabase_admin;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, secret text);
insert into vault.secrets(name, secret) values ('push_worker_secret', 'stand-in-secret-not-real');

create schema if not exists extensions;
grant usage on schema extensions to public;
create table extensions.pg_stat_statements (query text, calls bigint);
grant select on extensions.pg_stat_statements to public;

create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
`;

async function connect(url, database) {
  const target = new URL(url);
  target.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: target.toString() });
  await client.connect();
  return client;
}

async function as(client, user, sql, params = []) {
  await client.query('begin');
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })]);
    await client.query('set local role authenticated');
    const { rows } = await client.query(sql, params);
    await client.query('commit');
    return rows[0];
  } catch (error) {
    await client.query('rollback');
    throw new Error(`seed step failed: ${sql.slice(0, 80)} - ${error.message}`);
  }
}

/** Production-shaped rows, made the way the app makes them. */
async function seed(client) {
  const account = async (email, fullName, phone) => {
    const { rows } = await client.query(`insert into auth.users(email, email_confirmed_at, encrypted_password, confirmation_token)
      values ($1, now() - interval '30 days', 'bcrypt-stand-in', 'token-stand-in') returning id`, [email]);
    const id = rows[0].id;
    await as(client, id, `select public.complete_own_profile($1, $2, date '1990-05-01')`, [fullName, phone]);
    return id;
  };
  const owner = await account('owner@stand-in.test', 'Vlasnik Test', '+38267000001');
  // The hosted project's owner was bootstrapped by an operator, not a command.
  await client.query(`update public.access_grants set role = 'OWNER' where user_id = $1`, [owner]);
  const admin = await account('admin@stand-in.test', 'Admin Test', '+38267000002');
  const commander = await account('cmd@stand-in.test', 'Komandir Test', '+38267000003');
  const ff = [];
  for (const [k, name] of ['Ana', 'Boris', 'Cedo'].entries()) ff.push(await account(`ff${k}@stand-in.test`, `${name} Test`, `+3826700001${k}`));
  const pending = (await client.query(`insert into auth.users(email) values ('pending@stand-in.test') returning id`)).rows[0].id;
  void pending;

  await as(client, owner, `select public.owner_set_role($1, 'ADMIN')`, [admin]);
  await as(client, owner, `select public.owner_set_role($1, 'COMMANDER')`, [commander]);
  for (const id of ff) await as(client, owner, `select public.owner_set_role($1, 'FIREFIGHTER')`, [id]);

  const members = {};
  for (const [label, user] of [['commander', commander], ...ff.map((id, k) => [`ff${k}`, id])]) {
    const m = await as(client, admin, `select public.admin_create_member($1, array['vozac']) as id`, [`Clan ${label}`]);
    await as(client, admin, `select public.admin_link_member_account($1, $2)`, [m.id, user]);
    members[label] = m.id;
  }
  const unlinked = await as(client, admin, `select public.admin_create_member('Clan bez naloga') as id`);
  void unlinked;
  const vehicle = await as(client, admin, `select public.admin_create_vehicle('TV-1', 'Navalno vozilo', 'NAVALNO') as id`);
  const group = await as(client, admin, `select public.admin_create_group('Smjena A') as id`);
  await as(client, admin, `select public.admin_set_group_members($1, $2)`, [group.id, [members.ff0, members.ff1]]);
  await as(client, ff[0], `select public.set_own_availability(true, 'Dostupan')`);
  await as(client, ff[1], `select public.set_own_availability(false)`);

  const draft = await as(client, commander, `select public.create_intervention_draft('POZAR', 'Pozar niskog rastinja', 'Ponijeti opremu',
    'Tivat', 'stand-in-key-1') as id`);
  await as(client, commander, `select public.publish_intervention($1, $2)`, [draft.id, [members.ff0, members.ff1, members.ff2]]);
  await as(client, ff[0], `select public.acknowledge_intervention($1)`, [draft.id]);
  await as(client, ff[0], `select public.submit_response($1, 'DOLAZIM', 10, false)`, [draft.id]);
  await as(client, ff[0], `select public.submit_response($1, 'DOLAZIM_KASNIJE', 30, true)`, [draft.id]);
  await as(client, ff[1], `select public.submit_response($1, 'NE_MOGU', null, false)`, [draft.id]);
  await as(client, ff[0], `select public.set_journey_progress($1, 'KRECEM')`, [draft.id]);
  await as(client, commander, `select public.attendance_check_in($1, $2)`, [draft.id, members.ff0]);
  const movement = await as(client, commander, `select public.record_vehicle_departure($1, $2, 'Intervencija') as id`, [vehicle.id, draft.id]);
  await as(client, commander, `select public.record_vehicle_return($1)`, [movement.id]);
  await as(client, commander, `select public.attendance_check_out($1, $2)`, [draft.id, members.ff0]);
  await as(client, ff[0], `select public.register_web_push_subscription('https://push.example.invalid/ff0', 'BStandInP256dhKeyStandInP256dhKeyStandInP256dhKey00000000000000000000000000000000', 'StandInAuthSecret0000')`);

  const second = await as(client, commander, `select public.create_intervention_draft('TEHNICKA_POMOC', 'Tehnicka pomoc',
    'Na lokaciji', 'Kalimanj', 'stand-in-key-2') as id`);
  await as(client, commander, `select public.publish_intervention($1, $2)`, [second.id, [members.ff0, members.ff2]]);
  await as(client, ff[2], `select public.submit_response($1, 'DOLAZIM', 5, false)`, [second.id]);
  await as(client, owner, `select public.owner_set_account_active($1, false, 'Privremeno suspendovan')`, [ff[2]]);
  return { owner, admin, commander, ff, members };
}

/**
 * Builds `database` on the loopback server at `adminUrl` from scratch, and
 * creates the dump role in it exactly as dump-role.sql specifies, with the
 * SCRAM verifier given. With `hardenPgNet`, harden-pg-net.sql is applied as
 * the release instructions require before the role is created.
 */
export async function buildIsolatedSource(adminUrl, database, { verifier, migrations = PRODUCTION_MIGRATIONS, hardenPgNet = false } = {}) {
  const admin = await connect(adminUrl, 'postgres');
  try {
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.query(`do $$ begin if exists (select 1 from pg_roles where rolname = 'dvd_release_dump') then
      execute 'drop role dvd_release_dump'; end if; end $$`).catch(() => {});
    await admin.query(`create database ${database}`);
  } finally {
    await admin.end();
  }
  const files = migrationsFromHarness(REPO);
  const stub = files[0];
  const chosen = files.slice(1, 1 + migrations);
  const client = await connect(adminUrl, database);
  try {
    await client.query(readFileSync(resolve(REPO, stub), 'utf8'));
    await client.query(PLATFORM);
    for (const file of chosen) await client.query(readFileSync(resolve(REPO, file), 'utf8'));
    for (const [k, file] of chosen.entries()) {
      await client.query(`insert into supabase_migrations.schema_migrations(version, name) values ($1, $2)`,
        [String(20260909000000 + k * 100), migrationName(file)]);
    }
    const people = await seed(client);
    await client.query('grant usage on schema net to cron_stand_in');
    if (hardenPgNet) {
      await client.query(readFileSync(resolve(REPO, 'scripts/restored-capture/harden-pg-net.sql'), 'utf8'));
      // The same grants for the non-superuser stand-in for Supabase's postgres.
      await client.query(`grant select, insert on table net.http_request_queue to cron_stand_in;
        grant select on table net._http_response to cron_stand_in;
        grant usage, select on sequence net.http_request_queue_id_seq to cron_stand_in`);
    } else {
      await client.query(`grant select, insert on table net.http_request_queue to cron_stand_in`);
    }
    if (verifier) {
      const spec = readFileSync(resolve(REPO, 'scripts/restored-capture/dump-role.sql'), 'utf8').replaceAll('__SCRAM_VERIFIER__', verifier);
      await client.query(spec);
    }
    return { people, migrations: chosen.length };
  } finally {
    await client.end();
  }
}
