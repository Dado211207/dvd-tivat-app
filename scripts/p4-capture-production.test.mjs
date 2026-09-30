import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { captureResult, outputPath, sourceUrl } from './p4-capture-production.mjs';

test('only the expected production project can be captured', () => {
  assert.equal(sourceUrl('postgresql://postgres:example@db.yskhdzrdbywrpfowckpn.supabase.co:5432/postgres').hostname,
    'db.yskhdzrdbywrpfowckpn.supabase.co');
  assert.equal(sourceUrl('postgresql://postgres.yskhdzrdbywrpfowckpn:example@aws-0-eu-west-1.pooler.supabase.com:5432/postgres').username,
    'postgres.yskhdzrdbywrpfowckpn');
  assert.throws(() => sourceUrl('postgresql://postgres:example@db.another.supabase.co:5432/postgres'), /expected DVD Tivat/);
  assert.throws(() => sourceUrl('postgresql://postgres:example@db.yskhdzrdbywrpfowckpn.supabase.co:5432/other'), /expected DVD Tivat/);
});

test('the capture can only be saved outside the source tree', async () => {
  await assert.rejects(outputPath('capture.production-export.json'), /absolute path/);
  await assert.rejects(outputPath(resolve('capture.production-export.json')), /outside the repository/);
  const outside = await mkdtemp(join(tmpdir(), 'boka-capture-'));
  try {
    const target = join(outside, 'capture.production-export.json');
    assert.equal(await outputPath(target), target);
    await symlink(resolve('.'), join(outside, 'source-link'));
    await assert.rejects(outputPath(join(outside, 'source-link', 'capture.production-export.json')), /outside the repository/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('a capture must include a read-only transaction and the real migration ledger', () => {
  const valid = {
    read_only: 'on', applied_migrations: ['example'], schema_fingerprint: {},
    export: {}, export_digest: {}, behaviour_digest: {},
  };
  assert.deepEqual(captureResult([{ rows: [] }, { rows: [valid] }]), valid);
  assert.throws(() => captureResult({ rows: [{ ...valid, read_only: 'off' }] }), /not read-only/);
  assert.throws(() => captureResult({ rows: [{ ...valid, applied_migrations: null }] }), /missing applied_migrations/);
  assert.throws(() => captureResult({ rows: [] }), /exactly one row/);
});
