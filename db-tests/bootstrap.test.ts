/**
 * The owner bootstrap, executed from the document that describes it.
 *
 * The SQL below is not copied from `docs/OWNER_BOOTSTRAP.md` - it is READ OUT OF
 * IT and run. A runbook that has quietly stopped working is worse than no
 * runbook, because the person following it assumes the system is broken rather
 * than the instructions. This way the instructions cannot drift from the schema
 * without the suite failing.
 *
 * Everything here runs on a schema built from zero, so it is the real "from an
 * empty project" path: no owner exists when the file starts.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, asUserCommitted, connect, createDraft, expectRefused, resetSchema } from './harness';

let db: Client;

const RUNBOOK = readFileSync(resolve(process.cwd(), 'docs/OWNER_BOOTSTRAP.md'), 'utf8');

/** Every ```sql fenced block in the runbook, in the order it appears. */
function runbookSql(): string[] {
  return [...RUNBOOK.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1]!.trim());
}

/**
 * The one block that does `thing`, selected by content so a reordered document
 * does not break this - and refused outright if the selection is ambiguous,
 * because running the wrong block would be worse than failing.
 */
function blockContaining(needles: string[], excluding: string[] = []): string {
  const matches = runbookSql().filter(
    (block) =>
      needles.every((needle) => block.includes(needle)) &&
      excluding.every((needle) => !block.includes(needle)),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one SQL block in docs/OWNER_BOOTSTRAP.md containing ` +
        `${needles.map((n) => JSON.stringify(n)).join(' and ')}, found ${matches.length}. ` +
        `If the runbook changed, this test must be read again rather than adjusted away.`,
    );
  }
  return matches[0]!;
}

/** Puts a real address where the runbook tells the reader to put theirs. */
function forEmail(block: string, email: string): string {
  const placeholder = 'your.email@example.com';
  if (!block.includes(placeholder)) {
    throw new Error(`The runbook block no longer contains the ${placeholder} placeholder.`);
  }
  return block.split(placeholder).join(email);
}

/**
 * Step 4's single promotion statement, told apart from the transfer block (which
 * also sets OWNER) by the transaction keywords the transfer needs and it does not.
 */
const PROMOTION_BLOCK = blockContaining(
  ["set role = 'OWNER'", 'YOUR EMAIL HERE', 'update public.access_grants'],
  ['begin;'],
);

/** Registers an account the way GoTrue does: the trigger does the rest. */
async function register(email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users(email, email_confirmed_at) values ($1, now()) returning id`,
    [email],
  );
  return rows[0]!.id;
}

const roleOf = (userId: string | null): Promise<string | null> =>
  asUser(db, userId, async (client) => {
    const { rows } = await client.query<{ role: string | null }>(
      'select public.current_dvd_role() as role',
    );
    return rows[0]!.role;
  });

const countMembers = (userId: string): Promise<number> =>
  asUser(db, userId, async (client) => {
    const { rows } = await client.query<{ n: string }>(
      'select count(*)::text as n from public.members',
    );
    return Number(rows[0]!.n);
  });

beforeAll(async () => {
  db = await connect();
  await resetSchema(db);
}, 60_000);

afterAll(async () => {
  await db?.end();
});

describe('the owner bootstrap, run from the runbook', () => {
  const ownerEmail = 'prvi.vlasnik@example.invalid';
  const secondEmail = 'drugi.kandidat@example.invalid';
  let ownerId: string;
  let secondId: string;

  it('starts from a project with no owner at all', async () => {
    const { rows } = await db.query(`select 1 from public.access_grants where role = 'OWNER'`);
    expect(rows).toHaveLength(0);
  });

  it('gives a freshly registered account nothing (runbook steps 1 and 2)', async () => {
    ownerId = await register(ownerEmail);

    const { rows } = await db.query(
      `select role, active from public.access_grants where user_id = $1`,
      [ownerId],
    );
    expect(rows[0]).toMatchObject({ role: 'PENDING', active: true });

    // Zero access, asserted rather than assumed.
    expect(await roleOf(ownerId)).toBeNull();
    expect(await countMembers(ownerId)).toBe(0);
    expect(
      await expectRefused(db, ownerId, (client) =>
        client.query('select public.owner_set_role($1, $2)', [ownerId, 'ADMIN']),
      ),
    ).toContain('OWNER_REQUIRED');
  });

  it('completes the profile through the real command, not a shortcut', async () => {
    await asUserCommitted(db, ownerId, (client) =>
      client.query('select public.complete_own_profile($1)', ['Prvi Vlasnik']),
    );
    const { rows } = await db.query(
      `select full_name, profile_complete from public.profiles where user_id = $1`,
      [ownerId],
    );
    expect(rows[0]).toMatchObject({ full_name: 'Prvi Vlasnik', profile_complete: true });

    // Still nothing: a finished profile is not an approval.
    expect(await roleOf(ownerId)).toBeNull();
  });

  it('promotes exactly that account with the runbook statement (step 4)', async () => {
    const promote = forEmail(PROMOTION_BLOCK, ownerEmail);
    // Guard against a runbook edit that would make this a no-op check.
    expect(promote).not.toContain('your.email@example.com');

    const result = await db.query(promote);
    expect(result.rowCount).toBe(1);

    expect(await roleOf(ownerId)).toBe('OWNER');
  });

  it('confirms it with the runbook verification query (step 5)', async () => {
    const verify = blockContaining(["where g.role = 'OWNER'", 'profile_complete']);
    const { rows } = await db.query(verify);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: ownerEmail,
      role: 'OWNER',
      active: true,
      profile_complete: true,
    });
  });

  it('refuses a second bootstrap, which is the whole point of the index', async () => {
    secondId = await register(secondEmail);
    await asUserCommitted(db, secondId, (client) =>
      client.query('select public.complete_own_profile($1)', ['Drugi Kandidat']),
    );

    const promoteSecond = forEmail(PROMOTION_BLOCK, secondEmail);
    await expect(db.query(promoteSecond)).rejects.toThrow(
      /access_grants_single_owner|duplicate key/i,
    );

    // The first owner is untouched by the failed attempt.
    expect(await roleOf(ownerId)).toBe('OWNER');
    expect(await roleOf(secondId)).toBeNull();
  });

  it('transfers ownership with the runbook block, never leaving two or none', async () => {
    const transfer = forEmail(blockContaining(['begin;', 'commit;', 'YOUR EMAIL HERE']), secondEmail);
    await db.query(transfer);

    const { rows } = await db.query(
      `select u.email from public.access_grants g
       join auth.users u on u.id = g.user_id where g.role = 'OWNER'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: secondEmail });

    // The previous owner keeps administrative access, as the block's comment says.
    expect(await roleOf(ownerId)).toBe('ADMIN');
    expect(await roleOf(secondId)).toBe('OWNER');

    // Put the first account back in charge for the rest of the file. Split
    // into separate statements because a parameterised query cannot carry more
    // than one; the runbook block above has no parameters and so can.
    await db.query('begin');
    await db.query(`update public.access_grants set role = 'ADMIN' where role = 'OWNER'`);
    await db.query(`update public.access_grants set role = 'OWNER' where user_id = $1`, [ownerId]);
    await db.query('commit');
    expect(await roleOf(ownerId)).toBe('OWNER');
  });
});

describe('a role change changes what the server actually allows', () => {
  let ownerId: string;
  let memberId: string;
  let draftId: string;

  beforeAll(async () => {
    const { rows } = await db.query<{ user_id: string }>(
      `select user_id from public.access_grants where role = 'OWNER'`,
    );
    ownerId = rows[0]!.user_id;

    await db.query(`insert into public.members(full_name) values ('Izmisljeni Clan Jedan')
                    on conflict do nothing`);
    memberId = await register(`napredovanje-${Date.now()}@example.invalid`);
    await asUserCommitted(db, memberId, (client) =>
      client.query('select public.complete_own_profile($1)', ['Ime Za Napredovanje']),
    );
    await asUserCommitted(db, ownerId, (client) =>
      client.query('select public.owner_set_role($1, $2)', [memberId, 'FIREFIGHTER']),
    );
    draftId = await createDraft(db, ownerId, { title: 'Nacrt za provjeru prava' });
  });

  it('hides a draft intervention from a firefighter', async () => {
    expect(await roleOf(memberId)).toBe('FIREFIGHTER');
    const seen = await asUser(db, memberId, async (client) => {
      const { rows } = await client.query('select id from public.interventions where id = $1', [
        draftId,
      ]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });

  it('shows the same draft after the owner makes them a commander', async () => {
    // No new session, no new token, no client co-operation: the next request
    // simply gets a different answer because the server decides.
    await asUserCommitted(db, ownerId, (client) =>
      client.query('select public.owner_set_role($1, $2)', [memberId, 'COMMANDER']),
    );
    expect(await roleOf(memberId)).toBe('COMMANDER');

    const seen = await asUser(db, memberId, async (client) => {
      const { rows } = await client.query('select id from public.interventions where id = $1', [
        draftId,
      ]);
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('hides it again the moment the role is taken back', async () => {
    await asUserCommitted(db, ownerId, (client) =>
      client.query('select public.owner_set_role($1, $2)', [memberId, 'PENDING']),
    );
    expect(await roleOf(memberId)).toBeNull();

    const seen = await asUser(db, memberId, async (client) => {
      const { rows } = await client.query('select id from public.interventions where id = $1', [
        draftId,
      ]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });
});

describe('a suspension takes effect on the very next request', () => {
  let ownerId: string;
  let memberId: string;

  beforeAll(async () => {
    const { rows } = await db.query<{ user_id: string }>(
      `select user_id from public.access_grants where role = 'OWNER'`,
    );
    ownerId = rows[0]!.user_id;

    await db.query(`insert into public.members(full_name) values ('Izmisljeni Clan Dva')
                    on conflict do nothing`);
    memberId = await register(`suspenzija-${Date.now()}@example.invalid`);
    await asUserCommitted(db, memberId, (client) =>
      client.query('select public.complete_own_profile($1)', ['Ime Za Suspenziju']),
    );
    await asUserCommitted(db, ownerId, (client) =>
      client.query('select public.owner_set_role($1, $2)', [memberId, 'COMMANDER']),
    );
  });

  it('lets an approved commander read the roster and publish', async () => {
    expect(await roleOf(memberId)).toBe('COMMANDER');
    expect(await countMembers(memberId)).toBeGreaterThan(0);
  });

  it('refuses the same account on its next request once suspended', async () => {
    await asUserCommitted(db, ownerId, (client) =>
      client.query('select public.owner_set_account_active($1, false, $2)', [
        memberId,
        'Privremeno van drustva.',
      ]),
    );

    // Same identity, same claims, same connection - only the server's answer
    // changed. An already-issued token stays syntactically valid until it
    // expires, which is exactly why authority is re-read on every request
    // instead of being trusted from the token.
    expect(await roleOf(memberId)).toBeNull();
    expect(await countMembers(memberId)).toBe(0);

    const draftId = await createDraft(db, ownerId, { title: 'Nacrt poslije suspenzije' });
    expect(
      await expectRefused(db, memberId, (client) =>
        client.query('select public.publish_intervention($1, $2)', [draftId, [memberId]]),
      ),
    ).toContain('COMMAND_REQUIRED');
  });

  it('restores access, with a reason, when the owner lifts it', async () => {
    await asUserCommitted(db, ownerId, (client) =>
      client.query('select public.owner_set_account_active($1, true, $2)', [
        memberId,
        'Vratio se u drustvo.',
      ]),
    );
    expect(await roleOf(memberId)).toBe('COMMANDER');
    expect(await countMembers(memberId)).toBeGreaterThan(0);

    const { rows } = await db.query(
      `select next_active, reason from public.account_status_audit
       where target_user_id = $1 order by changed_at`,
      [memberId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ next_active: false, reason: 'Privremeno van drustva.' });
    expect(rows[1]).toMatchObject({ next_active: true, reason: 'Vratio se u drustvo.' });
  });
});
