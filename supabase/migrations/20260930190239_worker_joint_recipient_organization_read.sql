-- The delivery verdict runs with the service role and checks the joint
-- recipient organization for every push. Its security-invoker body needs
-- explicit table access even though the service role bypasses RLS.
grant select on public.intervention_recipient_organizations to service_role;
