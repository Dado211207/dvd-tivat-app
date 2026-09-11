import { execFileSync } from 'node:child_process';
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

  it('asks only for the two public values, and says why the third is absent', () => {
    const environment = read('.env.example');
    expect(environment).toContain('VITE_SUPABASE_URL');
    expect(environment).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
    // Vite inlines every VITE_ variable into the bundle, so a secret given one
    // of those names is published to every visitor.
    expect(environment).not.toMatch(/VITE_[A-Z_]*(SERVICE_ROLE|SECRET)/);
  });

  it('keeps the example file to placeholders rather than real values', () => {
    const environment = read('.env.example');
    expect(environment).toContain('https://YOUR_PROJECT_REF.supabase.co');
    expect(environment).toContain('sb_publishable_YOUR_PUBLISHABLE_KEY');
  });

  it('has no secret key anywhere in a tracked file', () => {
    // The whole-repository check, not just the one file somebody remembered.
    // A secret key is `sb_secret_...`; the older form is a JWT whose payload
    // names the service_role. Neither may ever be committed.
    const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter((path) => path.length > 0);
    expect(tracked.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const path of tracked) {
      let contents: string;
      try {
        contents = read(path);
      } catch {
        continue; // Binary or unreadable; nothing to match in it either way.
      }
      if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(contents)) offenders.push(`${path}: sb_secret_`);
      if (/"role"\s*:\s*"service_role"/.test(contents)) offenders.push(`${path}: service_role JWT`);
      if (/\bSUPABASE_SERVICE_ROLE_KEY\s*=\s*\S/.test(contents)) {
        offenders.push(`${path}: assigned service role key`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never reads a secret key in application code', () => {
    const client = read('src/auth/supabaseClient.ts');
    expect(client).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(client).not.toMatch(/import\.meta\.env\.[A-Z_]*(SECRET|SERVICE_ROLE)/);
  });
});
