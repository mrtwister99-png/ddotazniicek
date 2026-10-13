# Inactive account cleanup runbook

The cleanup Edge Function deletes Auth users whose most recent sign-in is at
least 30 days old. The owner, favorite profiles, users without profiles, and
users who sign in again before deletion are never deleted. Auth deletion
cascades through the user's related application data, so the mobile-support
cascade migration must be verified first.

## Before enabling the schedule

1. Compare the live Supabase schema read-only with the repository migrations.
   Stop and investigate any drift; do not use this runbook to apply migrations
   automatically.
2. Deploy `cleanup-inactive-users` with `supabase/config.toml` setting
   `verify_jwt = true`. The function also checks that the bearer token is the
   configured service-role JWT and that its signed payload has
   `role = service_role`.
3. Add these values to Supabase Vault; never put credential values in source
   control:
   - `supabase_url`: the HTTPS project URL, such as
     `https://<project-ref>.supabase.co`.
   - `service_role_jwt`: the project's service-role JWT. Its payload must claim
     `role = service_role`.
   - `cleanup_function_verify_jwt`: the literal text `true`. Set this deployment
     attestation only after verifying that the deployed function has gateway JWT
     verification enabled.
4. Confirm that `pg_cron`, `pg_net`, and Supabase Vault are enabled and that the
   mobile-support cascade migration is applied. The scheduling migration checks
   these prerequisites, validates the Vault values and JWT role claim, and
   aborts with an actionable error if a prerequisite is missing.
5. Only after completing those checks, apply
   `20261013000100_schedule_inactive_user_cleanup.sql` through the normal
   operator-controlled migration process. The schedule runs every Sunday at
   03:00 UTC.

The schedule sends one POST to `/functions/v1/cleanup-inactive-users`, with the
service-role JWT in both the `apikey` and `Authorization: Bearer` headers. The
request body is empty JSON; clients cannot select accounts for deletion. The
function logs counts and account IDs, but not profile contents or credentials.
Review the Edge Function logs after the first scheduled run and investigate any
non-zero failure count.

## Disable the schedule

Run this SQL as an operator with permission to manage `pg_cron`:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup-inactive-users';
```

This removes the recurring job; it does not restore accounts already deleted.
