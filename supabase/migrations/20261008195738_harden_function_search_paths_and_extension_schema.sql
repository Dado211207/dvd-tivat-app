-- These trigger-only guard functions never resolve application objects by
-- name, so an empty search_path is both sufficient and the safest setting.
-- Their EXECUTE privilege remains revoked from PUBLIC, anon and authenticated;
-- triggers continue to invoke them by OID.
alter function public.refuse_registry_audit_change() set search_path = '';
alter function public.refuse_attendance_rebinding() set search_path = '';
alter function public.refuse_attendance_correction_change() set search_path = '';
alter function public.refuse_correction_request_rebinding() set search_path = '';
alter function public.refuse_delivery_attempt_change() set search_path = '';
alter function public.refuse_outbox_rebinding() set search_path = '';
alter function public.refuse_audit_change() set search_path = '';
alter function public.refuse_audit_truncate() set search_path = '';
alter function public.refuse_response_rebinding() set search_path = '';
alter function public.refuse_journey_rebinding() set search_path = '';
alter function public.refuse_availability_rebinding() set search_path = '';

-- The hosted btree_gist extension belongs to supabase_admin. The application
-- migration role postgres cannot relocate it; leave this platform-owned
-- extension in place and track its advisory separately.
