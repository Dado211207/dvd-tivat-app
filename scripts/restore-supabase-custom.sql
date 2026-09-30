-- Only for an isolated Supabase restore target. These app-owned changes to
-- Supabase's auth/storage schemas are deliberately separate from the CLI's
-- default schema dump. Source: 202609090001_accounts_reports.sql. The release
-- rehearsal compares their canonical definitions against production afterward.
drop trigger if exists create_dvd_account on auth.users;
create trigger create_dvd_account
after insert on auth.users
for each row execute function public.handle_new_account();

drop policy if exists report_objects_create_own on storage.objects;
create policy report_objects_create_own on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.citizen_reports report
      where report.id::text = (storage.foldername(name))[2]
        and report.reporter_user_id = auth.uid()
        and report.status = 'UNVERIFIED'
    )
  );

drop policy if exists report_objects_read_authorized on storage.objects;
create policy report_objects_read_authorized on storage.objects for select to authenticated
  using (
    bucket_id = 'report-media'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_dvd_staff())
  );
