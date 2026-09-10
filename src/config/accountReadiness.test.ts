import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('account and report production foundation', () => {
  it('documents the account, report and map boundaries', () => {
    const plan = read('docs/ACCOUNTS_REPORTS_MAP_PLAN.md');
    expect(plan.toLowerCase()).toContain('every protected request is authorised on the server');
    expect(plan).toContain('A citizen submission starts as `UNVERIFIED`');
    expect(plan).toContain('A citizen report is never itself proof');
    expect(plan).toContain('custom SMTP');
  });

  it('does not allow signup metadata or the first registrant to become owner', () => {
    const migration = read('supabase/migrations/202609090001_accounts_reports.sql');
    expect(migration).toContain("values (new.id, 'CITIZEN', true)");
    expect(migration).toContain("requested_role not in ('ADMIN', 'COMMANDER', 'FIREFIGHTER', 'CITIZEN')");
    expect(migration).toContain('Never promote "the first account" automatically');
    expect(migration).not.toMatch(/raw_user_meta_data.*role/i);
  });

  it('enables row-level security on every application table', () => {
    const migration = read('supabase/migrations/202609090001_accounts_reports.sql');
    for (const table of ['profiles', 'access_grants', 'role_audit', 'citizen_reports', 'report_media', 'report_status_audit']) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('keeps report media private and role changes owner-only', () => {
    const migration = read('supabase/migrations/202609090001_accounts_reports.sql');
    expect(migration).toContain("values ('report-media', 'report-media', false");
    expect(migration).toContain('report_objects_create_own');
    expect(migration).toContain('report_objects_read_authorized');
    expect(migration).toContain("coalesce(public.current_dvd_role(), '') <> 'OWNER'");
    expect(migration).toContain('create or replace function public.review_report');
    expect(migration).not.toContain('policy reports_leader_update');
  });

  it('never places a service credential in a browser variable', () => {
    const environment = read('.env.example');
    expect(environment).toContain('VITE_SUPABASE_ANON_KEY');
    expect(environment).not.toMatch(/VITE_.*SERVICE_ROLE/);
  });
});
