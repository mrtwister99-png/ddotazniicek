# Supabase Auth and RLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first Supabase schema and RLS policies for the app, immutable response revisions, and a rate-limited `login-with-identifier` Edge Function that returns a valid Auth session for either a normal account or the owner secret.

**Architecture:** PostgreSQL owns the schema, append-only response history, owner mapping, and atomic rate-limit counters. A public Edge Function validates requests, routes a blank identifier plus the server-only `ADMIN_LOGIN_SECRET` to the owner flow, and otherwise resolves a username privately before using Supabase Auth password verification. The owner is created lazily with a deterministic, secret-derived `.invalid` Auth email and its Auth UUID is stored in a private singleton; changing the server secret updates the existing owner's Auth password without changing its UUID.

**Tech Stack:** Supabase PostgreSQL migrations/RLS, Supabase Edge Functions (Deno + `@supabase/supabase-js`), Deno tests.

**Spec:** `docs/brainstorming.md` and `docs/project.md`; this plan incorporates the user's updated admin-secret login and editable-response-history requirements.

## Global Constraints

- Client: Expo SDK 54 + React Native + TypeScript.
- Exactly one owner; only an Auth UUID stored in a private table confers owner permissions.
- `ADMIN_LOGIN_SECRET` exists only in the Edge Function environment, never in client code or repository `.env`.
- Admin login requires an empty identifier and a password exactly matching the configured secret; no `OR` shortcut.
- Owner Auth account uses an internal `.invalid` email, never displayed or requested in the UI.
- E-mail lookup and username-to-e-mail lookup never disclose another user's e-mail.
- Login failures are generic; credentials and secrets are never logged or returned.
- RLS covers client-exposed tables and Storage objects; privileged keys stay server-side.
- Initial response and points are recorded once; corrections append immutable snapshots and never award points.

## Review Focus

- Empty identifier with wrong secret, or non-empty identifier with correct secret, must never return owner session; test both in the login handler task.
- Concurrent owner bootstrap must result in one owner UUID and no adoption of an unmarked Auth account; test bootstrap idempotency and collision rejection in the database/function tasks.
- A user must not read or edit another user's delivery/response, self-assign a delivery, or write points; test owner and non-owner access in the SQL security tests. Owner score adjustments must append audited ledger entries through a privileged operation.
- Repeated response edits must preserve the original and all prior snapshots, while points remain unchanged; test append-only history and score uniqueness in the SQL tests.
- Repeated login attempts must be limited in shared database state, including secret attempts; test rejection after the configured threshold in the Edge Function task.

---

### Task 1: Supabase schema, RLS, response history, and auth support

**Files:**
- Create: `supabase/migrations/20261012000000_initial_schema_rls_and_auth_support.sql`
- Create: `supabase/tests/database/security.test.sql`
- Create: `supabase/tests/database/security_test.ts`
- Modify: `docs/brainstorming.md`
- Modify: `docs/project.md`

**Interfaces:**
- Produces private `private.user_roles`, `private.admin_owner`, and rate-limit storage.
- Produces `private.is_owner()`, service-role-only owner bootstrap/lookup functions, and an atomic service-role-only login-rate-limit RPC.
- Produces profile, group, template, delivery, response, response-edit, score-ledger, push-token, and notification-outbox tables with RLS.
- Produces authenticated `public.submit_response(...)` and `public.edit_response(...)` operations; edits append immutable versions and emit an admin notification-outbox event, while only first submission awards points.
- Produces owner-only `public.adjust_user_score(...)` for audited, append-only manual score adjustments; direct client writes to the score ledger remain denied.
- Produces a read-only response-history surface exposing the original response, latest correction, and correction time subject to RLS.

- [x] Write pgTAP and PGlite tests first for role escalation denial, row ownership, append-only response edits, immutable points on edit, owner-only score adjustments, and owner-only access.
- [x] Run the PGlite tests and confirm they fail because the schema/policies are missing; retain pgTAP tests for verification on a Supabase local stack.
- [x] Add the migration with constraints, triggers, private security-definer helpers, minimum grants, RLS policies, versioned responses, transactional response RPCs, and notification outbox. Managed Storage tables are excluded; create the bucket and Storage policies separately through the Dashboard or Storage API.
- [x] Update both design documents to reflect the approved secret-based owner login and correction-history rules.
- [x] Run the PGlite tests against the migration and confirm all modeled authorization/history cases pass; record that pgTAP still requires a running Supabase local stack.

### Task 2: `login-with-identifier` Edge Function

**Files:**
- Create: `supabase/functions/login-with-identifier/index.ts`
- Create: `supabase/functions/login-with-identifier/handler.ts`
- Create: `supabase/functions/login-with-identifier/handler_test.ts`
- Create: `supabase/config.toml`

**Interfaces:**
- Request: `POST { "identifier": string, "password": string }`.
- Normal success: `{ "session": AuthSession, "user": AuthUser }`.
- Owner success: same Supabase Auth session shape as normal login.
- Admin branch: `identifier.trim() === ""` and constant-time password comparison with `ADMIN_LOGIN_SECRET`.
- Normal branch: a non-empty e-mail or normalized nickname plus password; an empty identifier never falls through to normal login.
- The handler receives Auth/admin/database adapters so tests can exercise routing and failure behavior without network credentials.
- Rate limit: 30 attempts per source IP per 10 minutes, stored as a SHA-256 bucket in the database; fail closed if the Edge runtime has no source IP.

- [x] Write Deno tests first for owner-secret routing, wrong-secret rejection, no owner elevation when the secret appears only in a non-empty identifier, normal email/nickname routing, rate-limit enforcement, and generic auth errors.
- [x] Run the tests and confirm they fail because the handler is missing.
- [x] Implement the handler with input bounds, a shared atomic database rate limit before credential verification, secret-free attempt logging, deterministic secret-derived internal owner email, marked owner-account provisioning, password synchronization for secret rotation, private owner bootstrap, and separate non-persistent Supabase clients for Admin API and password sign-in.
- [x] Add the Edge Function entry point and disable platform JWT verification only for this function; the function performs its own credential checks.
- [x] Run Deno tests, formatter, and type check; review the migration and function diff for secret leakage.

### Verification note

The PGlite suite passes all 6 database/security tests; the handler suite passes all 14 tests; `deno check` and `deno fmt --check` pass. The pgTAP suite is retained but was not run because the local Supabase CLI/Postgres stack is unavailable in this environment. Final review fixes prevent the reserved owner Auth email from reaching normal password login and add an owner-only audited score-adjustment RPC.

## Out of scope for this implementation slice

- Expo SecureStore/session restoration and login UI.
- The response correction UI and client calls to `edit_response`.
- A push sender/worker; this slice records admin notification-outbox events for initial submissions and corrections but does not deliver APNs/FCM/Expo pushes.
- A full admin dashboard or CRUD screens.
