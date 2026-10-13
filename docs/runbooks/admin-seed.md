# Local administrator seed

The seed creates or updates the application admin
`admin@dotaznicek.local` / `admin`. It is an explicit operator command and does
not run when the app starts.

## Configure locally

1. Copy `.env.example` to `.env` if needed.
2. Set `SUPABASE_URL` to the intended Supabase project URL. If it is empty, the
   script uses `EXPO_PUBLIC_SUPABASE_URL`.
3. Set `SUPABASE_SERVICE_ROLE_KEY` to that project's server-only service-role
   key. Never prefix it with `EXPO_PUBLIC_`.
4. Set `ADMIN_SEED_PASSWORD` in the ignored local `.env`. Do not copy the
   password into source files, SQL, logs, or `.env.example`.
5. Check `SUPABASE_URL` carefully before running the command. It creates or
   updates the account in that project; implementation and tests do not call
   this command or contact Supabase.

## Run

From the repository root, with Node.js 20.6 or newer:

```sh
npm run seed:admin
```

The script calls the Supabase Auth Admin API over HTTPS with the configured
password; Supabase Auth performs password hashing. Only the Auth user and its
username profile row receive account data. The script assigns
`app_metadata.role = admin` and asks a service-role-only RPC to grant the
matching protected database role. It never prints the password, service-role
key, or API response bodies.

Running the command again intentionally resets the configured account's
password and reconciles its username and admin role. It refuses to take the
singleton owner account or a username already used by another account.

After seeding, sign in through the existing login screen with either
`admin@dotaznicek.local` or `admin`, using the locally configured password.
The owner remains a separate singleton and keeps its existing blank-identifier
secret login and owner-specific notification routing.

The database role migration
`supabase/migrations/20261013000200_admin_role_seed.sql` must be applied to the
intended project by the operator before the seed RPC can succeed. Compare the
live schema read-only with repository migrations before applying it. This
runbook does not apply migrations or deploy Supabase changes.
