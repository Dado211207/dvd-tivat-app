/**
 * P4a/P4b equivalence gate, on a copy of production.
 *
 * docs/MULTI_ORG_PLAN.md section 13. P4a and P4b rewrote every policy and
 * command over the registry, call-outs, what a call-out produces and its
 * history. Before any of that reaches production - and before P4c builds on it
 * - this answers, for the accounts and rows that actually exist:
 *
 *   does anything a real account can READ or DO change, other than the
 *   changes the phases set out to make?
 *
 *   node scripts/p4-equivalence-gate.mjs <capture.json> [--keep] [--report <file>]
 *
 * The capture is the one row scripts/p4-equivalence-production.sql returns,
 * run over a read-only path and kept outside the repository. Nothing here
 * touches the hosted project: it drives a local PostgreSQL server
 * (DVD_TEST_DATABASE_URL, the one `npm run test:db` uses), in databases of its
 * own that it drops at the end.
 *
 * The order of the argument matters, so it is the order of the output:
 *
 *   1-4  build a copy and PROVE it is one - same schema fingerprint, same rows,
 *        same answers for every account - before measuring anything on it
 *   5-7  apply the migrations production does not have to a clone, and compare
 *        every read fact and every command outcome and effect, per account
 *   8    the same with every profile completed: production has two accounts
 *        that can act today, and authority that comes from a membership needs
 *        the others to be exercised
 *   8b   the push worker's decision on every queued alert, and on a new one for
 *        every member on a running and on an ended call-out: the rule it
 *        applied in TypeScript before P4e against the verdict the database
 *        gives since - identical but for E5, an alert about a call-out that
 *        has ended
 *   9    SZS-only and dual-service accounts, which production does not contain
 *        yet, added through the real commands to the migrated copy
 *   10   negative controls: break the data, a read and a command on purpose
 *        and require the comparisons to notice
 *
 * A difference is a DIVERGENCE unless a rule below names it, with the
 * migration that makes it and why. Every excused difference is still printed.
 *
 * Exit codes follow scripts/p3-equivalence-gate.mjs:
 *   0  the gate passed
 *   1  the gate failed - something diverged, or a check did not hold
 *   2  the gate could not be RUN (no capture, no local server, or a copy that
 *      does not reproduce production), which is not the same as passing
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Databases, Unrunnable, applyMigrations, captureWith, checkForeignKeys, completeProfiles,
  exportDigestOf, loadExport, localAdminUrl, migrationsFromHarness, productionBoundary,
} from './p4-gate/database.mjs';
import { accountsOf, commandMatrix, compareMatrices, findTargets, publicColumns } from './p4-gate/commands.mjs';
import { P4E, PUSH_EXPECTED, RUNNING, pushDecisions } from './p4-gate/push.mjs';
import { runExtension, serviceVisibility, visibilityExpectation } from './p4-gate/szs.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURE_SQL = readFileSync(resolve(REPO, 'scripts/p4-equivalence-production.sql'), 'utf8');
const LAST_P4B = 'supabase/migrations/202609250029_intervention_outputs.sql';

/**
 * Differences the phases set out to make. Anything else is a divergence.
 */
const EXPECTED_READS = [
  {
    id: 'E1',
    migration: LAST_P4B,
    what: 'is_eligible_recipient() now answers only a caller who is staff in the service. P0 answered anybody '
      + 'who served with the member, so an account with an active DVD membership but no operational access '
      + '(profile incomplete, or suspended) was told true. Nothing in the client calls it; publish and web-push '
      + 'registration refuse such an account before asking.',
    matches: ({ key, pre, post, preFacts, applied }) => applied.has(LAST_P4B)
      && key.startsWith('per|is_eligible_recipient|') && pre === true && post === false
      && JSON.stringify(preFacts['fn|is_dvd_staff']) === '["false"]',
  },
];
const EXPECTED_COMMANDS = [
  {
    id: 'E2',
    migration: 'supabase/migrations/202609240024_organisation_registry.sql',
    what: "set_own_availability() became a one-line SQL wrapper over set_own_availability_in(). A plpgsql void "
      + "returns an empty void datum, a SQL one returns null. Same effect, row for row; the client's command() "
      + 'reads only `error` (src/auth/operations.ts).',
    matches: ({ name, pre, post, applied }) => applied.has('supabase/migrations/202609240024_organisation_registry.sql')
      && name === 'set_own_availability' && pre.outcome === 'OK ""' && post.outcome === 'OK null'
      && JSON.stringify(pre.effect) === JSON.stringify(post.effect),
  },
];
EXPECTED_COMMANDS.push({
  id: 'E4',
  migration: 'supabase/migrations/202609250031_attendance_service.sql',
  what: 'A correction request that arrives with a decision already on it is refused. Before 031 the requester could fill '
    + 'resolved_by, resolved_at, resolution_note and requested_at themselves; no client sends them.',
  matches: ({ name, pre, post, applied }) => applied.has('supabase/migrations/202609250031_attendance_service.sql')
    && name === 'correction_request_prefilled' && pre.outcome.startsWith('OK')
    && post.outcome.startsWith('ERR 42501 new row violates row-level security policy'),
});
// E3, the deliberate prohibition on one call-out naming members of two
// services, is only reachable with SZS data; it is asserted as an expected
// outcome of step 9 (scripts/p4-gate/szs.mjs), in both directions.
// E5, no alert about a call-out that has ended, is a push-worker decision and
// is classified in step 8b (scripts/p4-gate/push.mjs, PUSH_EXPECTED).

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` - ${detail}` : ''}`);
  return ok;
}
const report = {};

/** Every fact of every account, pre vs post; differences classified by EXPECTED_READS. */
function compareFacts(pre, post, applied, rules = EXPECTED_READS) {
  const out = { compared: 0, unexpected: [], excused: [] };
  for (const account of Object.keys(pre)) {
    const a = pre[account];
    const b = post[account] ?? {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      out.compared += 1;
      const x = a[key];
      const y = b[key];
      if (JSON.stringify(x) === JSON.stringify(y)) continue;
      const entry = { account, key, pre: x, post: y };
      const rule = rules.find((r) => r.matches({ key, pre: x, post: y, preFacts: a, applied }));
      (rule ? out.excused : out.unexpected).push(rule ? { ...entry, rule: rule.id } : entry);
    }
  }
  return out;
}

function printDifferences(title, result) {
  for (const d of result.excused) console.log(`       expected (${d.rule}) ${title}: ${JSON.stringify(d)}`);
  for (const d of result.unexpected.slice(0, 40)) console.log(`       DIVERGENCE ${title}: ${JSON.stringify(d)}`);
  if (result.unexpected.length > 40) console.log(`       ... and ${result.unexpected.length - 40} more`);
}

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const reportAt = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
  const capturePath = args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--report');
  if (!capturePath) throw new Unrunnable('no capture given. Usage: node scripts/p4-equivalence-gate.mjs <capture.json>');
  let capture;
  try {
    capture = JSON.parse(readFileSync(resolve(process.cwd(), capturePath), 'utf8'));
  } catch (error) {
    throw new Unrunnable(`the capture could not be read - ${error.message}`);
  }
  for (const key of ['read_only', 'applied_migrations', 'schema_fingerprint', 'export', 'export_digest', 'behaviour_digest']) {
    if (capture[key] === undefined || capture[key] === null) throw new Unrunnable(`the capture has no "${key}" - see scripts/p4-equivalence-production.sql`);
  }
  if (capture.read_only !== 'on') throw new Unrunnable('the capture was not taken in a read-only transaction');

  console.log('=== 1. where production stands ===');
  const files = migrationsFromHarness(REPO);
  const boundary = productionBoundary(files, capture.applied_migrations);
  const before = files.slice(0, boundary);
  const toApply = files.slice(boundary);
  const applied = new Set(toApply);
  console.log(`  production has   ${before.filter((f) => f.startsWith('supabase/migrations/')).length} migrations, last ${before[before.length - 1]}`);
  toApply.forEach((file, k) => console.log(`  under test    ${String(k + 1).padStart(2)}. ${file}`));
  if (!toApply.length) throw new Unrunnable('production already has every migration in the harness; there is nothing to compare');
  report.production = { migrations: before.length, underTest: toApply };

  const databases = new Databases(localAdminUrl());
  const tables = Object.keys(capture.export_digest);
  try {
    const admin = await databases.connect('postgres').catch((error) => {
      throw new Unrunnable(`no local server - run \`npm run db:start\` (${error.message})`);
    });
    try {
      console.log('\n=== 2. the capture agrees with itself ===');
      const digest = await exportDigestOf(admin, capture.export);
      check(`export matches its own digest, all ${tables.length} tables`, tables.every((t) => digest[t] === capture.export_digest[t]));
      if (failures) throw new Unrunnable('the export in the capture file is not the one production digested - re-take the capture');
    } finally {
      await admin.end();
    }

    console.log('\n=== 3. build the copy ===');
    const pre = await databases.create('pre');
    let client = await databases.connect(pre);
    await applyMigrations(client, REPO, before);
    console.log(`  applied the local stand-in for Supabase's schemas and ${before.filter((f) => f.startsWith('supabase/migrations/')).length} migrations to an empty database`);
    await loadExport(client, capture.export);
    const [keys, orphans] = await checkForeignKeys(client);
    check(`loaded with every foreign key intact`, orphans === 0, `${keys} foreign keys checked, ${orphans} orphan rows`);

    console.log('\n=== 4. the copy reproduces production ===');
    const preCapture = await captureWith(client, CAPTURE_SQL);
    const categories = Object.keys(capture.schema_fingerprint);
    const sameSchema = categories.filter((c) => JSON.stringify(preCapture.schema_fingerprint[c]) === JSON.stringify(capture.schema_fingerprint[c]));
    check(`schema fingerprint, per category`, sameSchema.length === categories.length,
      `${sameSchema.length}/${categories.length} identical (${categories.map((c) => `${c} ${capture.schema_fingerprint[c].n}`).join(', ')})`);
    const sameRows = tables.filter((t) => preCapture.export_digest[t] === capture.export_digest[t]);
    check(`rows, per table`, sameRows.length === tables.length, `${sameRows.length}/${tables.length} identical`);
    const accountsInCapture = Object.keys(capture.behaviour_digest);
    const sameAccounts = accountsInCapture.filter((a) => preCapture.behaviour_digest[a] === capture.behaviour_digest[a]);
    check(`what every account can read and every reader answers`, sameAccounts.length === accountsInCapture.length
      && Object.keys(preCapture.behaviour_digest).length === accountsInCapture.length,
    `${sameAccounts.length}/${accountsInCapture.length} accounts identical, ${Object.values(preCapture.behaviour).reduce((n, f) => n + Object.keys(f).length, 0)} facts`);
    if (capture.behaviour) {
      const exact = compareFacts(capture.behaviour, preCapture.behaviour, new Set(), []);
      check('and fact by fact', exact.unexpected.length === 0, `${exact.compared} facts`);
    }
    check('no column-level grants on either side', String(capture.column_acls ?? 0) === String(preCapture.column_acls));
    if (failures) {
      throw new Unrunnable('BLOCKED: the copy does not reproduce production, so nothing measured on it would be evidence');
    }
    await client.end();

    console.log('\n=== 5. apply what production does not have ===');
    const post = await databases.create('post', pre);
    client = await databases.connect(post);
    await applyMigrations(client, REPO, toApply);
    const { rows: backfill } = await client.query(`select
      (select count(*) from public.members)::int as members,
      (select count(*) from public.members where organization_id is null)::int as members_unassigned,
      (select count(*) from public.interventions where organization_id is null)::int as interventions_unassigned,
      (select count(*) from public.operational_audit where organization_id is null)::int as audit_unassigned`);
    check('every existing row was given a service', Object.entries(backfill[0]).filter(([k]) => k.endsWith('unassigned')).every(([, n]) => n === 0),
      JSON.stringify(backfill[0]));
    const postCapture = await captureWith(client, CAPTURE_SQL);
    await client.end();

    console.log('\n=== 6. reads, before and after ===');
    const reads = compareFacts(preCapture.behaviour, postCapture.behaviour, applied);
    check('no read diverged', reads.unexpected.length === 0,
      `${reads.compared} facts, ${reads.excused.length} expected differences, ${reads.unexpected.length} divergences`);
    printDifferences('read', reads);
    report.reads = reads;

    console.log('\n=== 7. commands, before and after ===');
    client = await databases.connect(pre);
    const accounts = await accountsOf(client);
    const targets = await findTargets(client);
    const columns = await publicColumns(client);
    const preMatrix = await commandMatrix(client, { columns, accounts, targets });
    await client.end();
    client = await databases.connect(post);
    const postMatrix = await commandMatrix(client, { columns, accounts, targets });
    await client.end();
    if (preMatrix.skipped.length) console.log(`  not exercisable on this data: ${preMatrix.skipped.join(', ')}`);
    const commands = compareMatrices(preMatrix.results, postMatrix.results, EXPECTED_COMMANDS.map((r) => ({ ...r, matches: (x) => r.matches({ ...x, applied }) })));
    const succeeded = Object.values(preMatrix.results).filter((r) => !Array.isArray(r) && r.outcome.startsWith('OK')).length;
    check('no command diverged', commands.unexpected.length === 0,
      `${commands.compared} single probes (${succeeded} succeed), ${commands.steps} scenario steps, `
      + `${commands.excused.length} expected differences, ${commands.unexpected.length} divergences`);
    printDifferences('command', commands);
    report.commands = { ...commands, skipped: preMatrix.skipped };

    console.log('\n=== 8. the same, with every profile completed ===');
    const preFull = await databases.create('pre_full', pre);
    client = await databases.connect(preFull);
    const completed = await completeProfiles(client);
    console.log(`  completed ${completed} profiles through complete_own_profile(), as each account`);
    const preFullCapture = await captureWith(client, CAPTURE_SQL);
    const preFullMatrix = await commandMatrix(client, { columns, accounts, targets });
    await client.end();
    const postFull = await databases.create('post_full', preFull);
    client = await databases.connect(postFull);
    await applyMigrations(client, REPO, toApply);
    const postFullCapture = await captureWith(client, CAPTURE_SQL);
    const postFullMatrix = await commandMatrix(client, { columns, accounts, targets });
    await client.end();
    const readsFull = compareFacts(preFullCapture.behaviour, postFullCapture.behaviour, applied);
    check('no read diverged', readsFull.unexpected.length === 0,
      `${readsFull.compared} facts, ${readsFull.excused.length} expected differences, ${readsFull.unexpected.length} divergences`);
    printDifferences('read', readsFull);
    const commandsFull = compareMatrices(preFullMatrix.results, postFullMatrix.results, EXPECTED_COMMANDS.map((r) => ({ ...r, matches: (x) => r.matches({ ...x, applied }) })));
    const succeededFull = Object.values(preFullMatrix.results).filter((r) => !Array.isArray(r) && r.outcome.startsWith('OK')).length;
    check('no command diverged', commandsFull.unexpected.length === 0,
      `${commandsFull.compared} single probes (${succeededFull} succeed), ${commandsFull.steps} scenario steps, `
      + `${commandsFull.excused.length} expected differences, ${commandsFull.unexpected.length} divergences`);
    printDifferences('command', commandsFull);
    report.completed = { profiles: completed, reads: readsFull, commands: commandsFull };

    console.log('\n=== 8b. the push worker\'s decision, before and after P4e ===');
    if (!applied.has(P4E)) {
      console.log(`  skipped: ${P4E} is not under test`);
    } else {
      console.log(`  expected (${PUSH_EXPECTED.id}, ${PUSH_EXPECTED.migration}): ${PUSH_EXPECTED.what}`);
      report.push = {};
      for (const [label, base] of [['as production is', post], ['every profile completed', postFull]]) {
        client = await databases.connect(base);
        const push = await pushDecisions(client);
        await client.end();
        for (const [what, result] of [
          ['every queued alert', push.existing],
          ['a new DVD alert for every member, call-out running', push.everyMember],
          ['a new DVD alert for every member, call-out closed first', push.everyMemberEnded],
        ]) {
          check(`${label}, ${what}: the verdict decides as the old worker did, but for ${PUSH_EXPECTED.id}`,
            result.differing.length === 0 && result.answered === result.compared,
            `${result.compared} alerts (${Object.entries(result.tally).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}), `
            + `${result.expected.length} expected differences, ${result.differing.length} divergences`);
          // Every expected difference is shown, grouped: what it was, the call-out's
          // status, and whether the worker would have taken the alert up again.
          const groups = {};
          for (const d of result.expected) {
            const key = `${d.before} -> ${d.after} on ${d.callout}${d.due ? ', still due' : ''}`;
            groups[key] = (groups[key] ?? 0) + 1;
          }
          for (const [key, n] of Object.entries(groups)) console.log(`       expected (${PUSH_EXPECTED.id}) ${n} x ${key}`);
          for (const d of result.differing) console.log(`       DIVERGENCE ${JSON.stringify(d)}`);
        }
        // The closed call-out must actually exercise the rule for every member.
        check(`${label}: every member's alert on a call-out closed first is set aside unsent`,
          push.everyMemberEnded.expected.length === push.everyMemberEnded.compared && push.everyMemberEnded.compared > 0,
          `${push.everyMemberEnded.expected.length} of ${push.everyMemberEnded.compared}`);
        report.push[label] = push;
      }
    }

    console.log('\n=== 9. SZS-only and dual-service accounts ===');
    if (!applied.has(LAST_P4B)) {
      console.log(`  skipped: ${LAST_P4B} is not under test, so no SZS call-out can exist`);
    } else {
      for (const [label, base, baseCapture, baseMatrix] of [['as production is', post, postCapture, postMatrix], ['every profile completed', postFull, postFullCapture, postFullMatrix]]) {
        console.log(`  -- on the migrated copy, ${label}`);
        const clone = await databases.create(`szs_${base === post ? 'as_is' : 'full'}`, base);
        client = await databases.connect(clone);
        const { rows: ownerRows } = await client.query(`select user_id::text as id from public.access_grants where role = 'OWNER' and active order by user_id limit 1`);
        if (!ownerRows.length) throw new Unrunnable('the capture has no active owner to build the SZS side with');
        const extension = await runExtension(client, {
          applied,
          owner: ownerRows[0].id,
          dvdFirefighter: targets.recipientAccount,
          dvdMember: targets.recipientMember,
          dvdVehicle: targets.vehicleA,
        });
        const wrong = extension.report.filter((s) => s.expected !== s.actual);
        check('every step did what it should', wrong.length === 0, `${extension.report.length} steps and postconditions, ${wrong.length} wrong`);
        for (const s of wrong) console.log(`       DIVERGENCE "${s.label}": expected ${s.expected}, got ${s.actual}`);
        const mixed = extension.report.filter((s) => s.label.includes('(MIXED)'));
        check('E3: a call-out naming members of two services is refused, both ways', mixed.length === 2 && mixed.every((s) => s.actual === 'ERR ORGANIZATION_MISMATCH'));

        // Real accounts, with SZS data present: every fact about the rows that
        // existed before must be unchanged, and nothing SZS may appear except
        // to the installation owner.
        const extCapture = await captureWith(client, CAPTURE_SQL);
        const TOKEN = /^[a-z]+\d+$/;
        const known = new Set();
        for (const facts of Object.values(baseCapture.behaviour)) {
          for (const [key, value] of Object.entries(facts)) {
            for (const part of key.split('|')) if (TOKEN.test(part)) known.add(part);
            for (const item of Array.isArray(value) ? value : []) for (const part of String(item).split('|')) if (TOKEN.test(part)) known.add(part);
          }
        }
        const isKnown = (value) => String(value).split('|').every((part) => !TOKEN.test(part) || known.has(part));
        let same = 0;
        const changed = [];
        for (const account of Object.keys(baseCapture.behaviour)) {
          for (const [key, value] of Object.entries(baseCapture.behaviour[account])) {
            const now = extCapture.behaviour[account]?.[key];
            const kept = Array.isArray(value) ? JSON.stringify((now ?? []).filter(isKnown).sort()) : JSON.stringify(now);
            if (kept === JSON.stringify(Array.isArray(value) ? [...value].sort() : value)) same += 1;
            else changed.push({ account, key, before: value, after: now });
          }
        }
        check('real accounts: every fact about existing rows is unchanged by SZS data', changed.length === 0, `${same} facts`);
        for (const c of changed.slice(0, 20)) console.log(`       DIVERGENCE ${JSON.stringify(c)}`);

        const labelled = [
          ...accounts.map((a) => ({ ...a, label: a.id === ownerRows[0].id ? 'owner' : `real ${a.token}` })),
          ...Object.entries(extension.users).filter(([who]) => !['owner', 'dvdFirefighter'].includes(who)).map(([who, id]) => ({ id, label: who })),
        ];
        const visibility = await serviceVisibility(client, labelled);
        const leaks = [];
        for (const { label: who } of labelled) {
          const { may } = visibilityExpectation(who);
          for (const table of visibility.tables) {
            const seen = visibility.grid[who][table] ? visibility.grid[who][table].split(',') : [];
            for (const service of seen) if (!may.includes(service)) leaks.push(`${who} reads ${service} rows of ${table}`);
          }
        }
        check('no account reads rows of a service it does not serve in', leaks.length === 0,
          `${labelled.length} accounts x ${visibility.tables.length} tables`);
        for (const leak of leaks) console.log(`       DIVERGENCE ${leak}`);
        const dual = visibility.grid.dual;
        check('dual reads both of its services', Object.values(dual).some((s) => s.includes('DVD')) && Object.values(dual).some((s) => s.includes('SZS')));

        // And every DVD command, with SZS data present, still does exactly what
        // it did without it.
        const extMatrix = await commandMatrix(client, { columns, accounts, targets });
        const withSzs = compareMatrices(baseMatrix.results, extMatrix.results);
        check('no DVD command changed with SZS data present', withSzs.unexpected.length === 0,
          `${withSzs.compared} single probes, ${withSzs.steps} scenario steps`);
        printDifferences('command with SZS data', withSzs);
        await client.end();
        report[`szs ${label}`] = { steps: extension.report, visibility: visibility.grid, changed, withSzs };
      }
    }

    console.log('\n=== 10. negative controls: each comparison must notice a break ===');
    const breakData = await databases.create('neg_data', pre);
    client = await databases.connect(breakData);
    const { rowCount } = await client.query(`update public.attendance_intervals set ended_at = ended_at + interval '1 second'
      where id = (select id from public.attendance_intervals where ended_at is not null order by id limit 1)`);
    const brokenData = await captureWith(client, CAPTURE_SQL);
    await client.end();
    const differing = tables.filter((t) => brokenData.export_digest[t] !== capture.export_digest[t]);
    check('one attendance interval one second longer: exactly that table stops matching production',
      rowCount === 1 && differing.length === 1 && differing[0] === 'attendance_intervals', differing.join(', '));

    const breakRead = await databases.create('neg_read', post);
    client = await databases.connect(breakRead);
    await client.query(`create or replace function public.is_recipient_of(target_intervention uuid) returns boolean
      language sql stable security definer set search_path = public, pg_temp as $$ select true $$`);
    const brokenRead = await captureWith(client, CAPTURE_SQL);
    await client.end();
    const readControl = compareFacts(preCapture.behaviour, brokenRead.behaviour, applied);
    check('is_recipient_of() answering yes to everybody: the read comparison reports it', readControl.unexpected.length > 0,
      `${readControl.unexpected.length} facts diverge`);

    const breakCommand = await databases.create('neg_command', postFull);
    client = await databases.connect(breakCommand);
    const { rows: fn } = await client.query(`select pg_get_functiondef('public.submit_response(uuid,text,integer,boolean)'::regprocedure) as def`);
    const sabotaged = fn[0].def.replace(/raise exception 'NOT_A_RECIPIENT';/, 'null;');
    if (sabotaged === fn[0].def) throw new Unrunnable('submit_response no longer raises NOT_A_RECIPIENT where the control expects it');
    await client.query(sabotaged);
    const brokenMatrix = await commandMatrix(client, { columns, accounts, targets });
    await client.end();
    const commandControl = compareMatrices(preFullMatrix.results, brokenMatrix.results, EXPECTED_COMMANDS.map((r) => ({ ...r, matches: (x) => r.matches({ ...x, applied }) })));
    check('submit_response() accepting somebody it was not sent to: the command comparison reports it', commandControl.unexpected.length > 0,
      `${commandControl.unexpected.length} steps diverge`);

    if (applied.has(P4E)) {
      const breakPush = await databases.create('neg_push', postFull);
      client = await databases.connect(breakPush);
      const { rows: verdictFn } = await client.query(`select pg_get_functiondef('public.push_delivery_verdict(uuid)'::regprocedure) as def`);
      const refusing = verdictFn[0].def.replace(/then 'DELIVER'/, `then 'INELIGIBLE'`);
      if (refusing === verdictFn[0].def) throw new Unrunnable('push_delivery_verdict no longer answers DELIVER where the control expects it');
      await client.query(refusing);
      const brokenPush = await pushDecisions(client);
      await client.end();
      check('push_delivery_verdict() refusing everybody: the push comparison reports it', brokenPush.everyMember.differing.length > 0,
        `${brokenPush.everyMember.differing.length} alerts differ`);

      // E5 excuses an alert on a call-out that has ENDED. A verdict that set
      // aside alerts on a running one must still be a divergence.
      const endPush = await databases.create('neg_push_running', postFull);
      client = await databases.connect(endPush);
      const running = `'${RUNNING.join("', '")}'`;
      const ending = verdictFn[0].def.replace(running, `'NONE'`);
      if (ending === verdictFn[0].def) throw new Unrunnable('push_delivery_verdict no longer lists the running statuses where the control expects it');
      await client.query(ending);
      const endedPush = await pushDecisions(client);
      await client.end();
      check('push_delivery_verdict() treating a running call-out as ended: the push comparison reports it, not E5',
        endedPush.everyMember.differing.length > 0 && endedPush.everyMember.expected.length === 0,
        `${endedPush.everyMember.differing.length} alerts differ, ${endedPush.everyMember.expected.length} excused`);
    }
  } finally {
    if (keep) console.log(`\n  kept: ${databases.created.join(', ')}`);
    else await databases.dropAll();
  }

  if (reportAt) writeFileSync(resolve(process.cwd(), reportAt), JSON.stringify(report, null, 1));
  console.log(failures ? `\nFAILED - ${failures} check(s) did not hold` : '\nPASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n${error.exitCode === 2 ? 'COULD NOT RUN' : 'ERROR'}: ${error.message}`);
  process.exit(error.exitCode ?? 1);
});
