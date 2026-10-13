import { PGlite } from "npm:@electric-sql/pglite@0.3.14";

const migrationUrl = new URL(
  "../../migrations/20261012000000_initial_schema_rls_and_auth_support.sql",
  import.meta.url,
);

const ownerId = "00000000-0000-4000-8000-000000000001";
const ownerEmail = `admin-${"a".repeat(64)}@dotaznicek.invalid`;
const userId = "00000000-0000-4000-8000-000000000002";
const otherUserId = "00000000-0000-4000-8000-000000000003";
const templateId = "10000000-0000-4000-8000-000000000001";
const deliveryId = "20000000-0000-4000-8000-000000000001";
const otherDeliveryId = "20000000-0000-4000-8000-000000000002";

async function createDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text UNIQUE,
      raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL REFERENCES storage.buckets(id),
      name text NOT NULL,
      owner_id uuid
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(object_name text) RETURNS text[]
      LANGUAGE sql IMMUTABLE
      AS $$ SELECT string_to_array(object_name, '/') $$;
  `);

  try {
    await db.exec(await Deno.readTextFile(migrationUrl));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  return db;
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function addAuthUser(
  db: PGlite,
  id: string,
  email: string,
  metadata: Record<string, unknown>,
  appMetadata: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
     VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb)`,
    [id, email, JSON.stringify(metadata), JSON.stringify(appMetadata)],
  );
}

Deno.test("migration creates owner, response-version, and rate-limit primitives", async () => {
  const db = await createDatabase();
  try {
    const result = await db.query<{
      owner_function: string | null;
      edit_function: string | null;
      edits_table: string | null;
      limiter_function: string | null;
      username_function: string | null;
      admin_lookup_function: string | null;
    }>(`
      SELECT
        to_regprocedure('public.bootstrap_admin_owner(uuid)')::text AS owner_function,
        to_regprocedure('public.edit_response(uuid,jsonb)')::text AS edit_function,
        to_regclass('public.response_edits')::text AS edits_table,
        to_regprocedure('public.consume_login_rate_limits(text[],integer,integer)')::text AS limiter_function,
        to_regprocedure('public.login_email_for_username(text)')::text AS username_function,
        to_regprocedure('public.find_admin_auth_user(text)')::text AS admin_lookup_function
    `);
    const row = result.rows[0];
    assertEqual(
      row.owner_function,
      "bootstrap_admin_owner(uuid)",
      "owner bootstrap RPC",
    );
    assertEqual(
      row.edit_function,
      "edit_response(uuid,jsonb)",
      "response edit RPC",
    );
    assertEqual(
      row.edits_table,
      "response_edits",
      "response edit history table",
    );
    assertEqual(
      row.limiter_function,
      "consume_login_rate_limits(text[],integer,integer)",
      "rate-limit RPC",
    );
    assertEqual(
      row.username_function,
      "login_email_for_username(text)",
      "private username lookup RPC",
    );
    assertEqual(
      row.admin_lookup_function,
      "find_admin_auth_user(text)",
      "owner collision lookup RPC",
    );
  } finally {
    await db.close();
  }
});

Deno.test("migration leaves managed Storage tables unchanged", async () => {
  const sql = await Deno.readTextFile(migrationUrl);
  if (/\bstorage\s*\.\s*(objects|buckets)\b/i.test(sql)) {
    throw new Error(
      "migration must not reference Supabase-managed Storage tables",
    );
  }

  const db = await createDatabase();
  try {
    const result = await db.query<{ rls_enabled: boolean }>(
      "SELECT relrowsecurity AS rls_enabled FROM pg_class WHERE oid = 'storage.objects'::regclass",
    );
    assertEqual(result.rows[0].rls_enabled, true, "Storage RLS stays enabled");
  } finally {
    await db.close();
  }
});

Deno.test("user metadata cannot bypass the username requirement or mark an owner", async () => {
  const db = await createDatabase();
  try {
    let rejected = false;
    try {
      await db.query(
        `INSERT INTO auth.users (id, email, raw_user_meta_data)
         VALUES ($1::uuid, $2, $3::jsonb)`,
        [
          "00000000-0000-4000-8000-000000000004",
          `admin-${"b".repeat(64)}@dotaznicek.invalid`,
          JSON.stringify({ dotaznicek_admin_owner: true }),
        ],
      );
    } catch {
      rejected = true;
    }
    assertEqual(
      rejected,
      true,
      "untrusted user metadata cannot bypass signup checks",
    );
  } finally {
    await db.close();
  }
});

Deno.test("service login lookup normalizes usernames and identifies marked Auth accounts", async () => {
  const db = await createDatabase();
  try {
    await addAuthUser(db, ownerId, ownerEmail, {}, {
      dotaznicek_admin_owner: true,
    });
    await addAuthUser(db, userId, "user@example.test", {
      username: "Mixed Name",
    });

    const usernameLookup = await db.query<{ email: string | null }>(
      "SELECT public.login_email_for_username('  mixed   name ') AS email",
    );
    assertEqual(
      usernameLookup.rows[0].email,
      "user@example.test",
      "normalized nickname resolves to e-mail",
    );

    const ownerLookup = await db.query<{
      user_id: string;
      is_marked_owner: boolean;
    }>(
      "SELECT * FROM public.find_admin_auth_user($1)",
      [ownerEmail],
    );
    assertEqual(ownerLookup.rows[0].user_id, ownerId, "owner Auth UUID lookup");
    assertEqual(
      ownerLookup.rows[0].is_marked_owner,
      true,
      "only server app metadata marks owner candidates",
    );
  } finally {
    await db.close();
  }
});

Deno.test("only the owner can append audited score adjustments", async () => {
  const db = await createDatabase();
  try {
    await addAuthUser(db, ownerId, ownerEmail, {}, {
      dotaznicek_admin_owner: true,
    });
    await addAuthUser(db, userId, "user@example.test", { username: "Maslo" });
    await db.query("SELECT public.bootstrap_admin_owner($1::uuid)", [ownerId]);

    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      userId,
    ]);
    await db.query("SET ROLE authenticated");
    let userAdjustmentDenied = false;
    try {
      await db.query(
        "SELECT public.adjust_user_score($1::uuid, 3, 'untrusted')",
        [userId],
      );
    } catch {
      userAdjustmentDenied = true;
    }
    assertEqual(userAdjustmentDenied, true, "users cannot adjust scores");

    let directWriteDenied = false;
    try {
      await db.query(
        `INSERT INTO public.score_ledger (user_id, event_type, points)
         VALUES ($1::uuid, 'adjustment', 3)`,
        [userId],
      );
    } catch {
      directWriteDenied = true;
    }
    assertEqual(
      directWriteDenied,
      true,
      "users cannot write the score ledger directly",
    );
    await db.query("RESET ROLE");

    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      ownerId,
    ]);
    await db.query("SET ROLE authenticated");
    await db.query(
      "SELECT public.adjust_user_score($1::uuid, -2, 'Manual correction')",
      [userId],
    );
    await db.query("RESET ROLE");

    const entry = await db.query<{
      points: number;
      event_type: string;
      reason: string;
    }>(
      "SELECT points, event_type, reason FROM public.score_ledger WHERE user_id = $1::uuid",
      [userId],
    );
    assertEqual(entry.rows.length, 1, "one audit ledger entry");
    assertEqual(entry.rows[0].points, -2, "negative adjustment is recorded");
    assertEqual(entry.rows[0].event_type, "adjustment", "entry type");
    assertEqual(entry.rows[0].reason, "Manual correction", "audit reason");
  } finally {
    await db.close();
  }
});

Deno.test("response edits append history without changing the original or awarding more points", async () => {
  const db = await createDatabase();
  try {
    await addAuthUser(db, ownerId, ownerEmail, {
      dotaznicek_admin_owner: true,
    }, {
      dotaznicek_admin_owner: true,
    });
    await addAuthUser(db, userId, "user@example.test", { username: "Maslo" });
    await addAuthUser(db, otherUserId, "other@example.test", {
      username: "Other",
    });
    await db.query("SELECT public.bootstrap_admin_owner($1::uuid)", [ownerId]);
    await db.query(
      `INSERT INTO public.templates (id, title, points, created_by)
       VALUES ($1::uuid, 'Daily feedback', 5, $2::uuid)`,
      [templateId, ownerId],
    );
    await db.query(
      `INSERT INTO public.form_deliveries (id, template_id, user_id, sent_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid),
              ($5::uuid, $2::uuid, $6::uuid, $4::uuid)`,
      [deliveryId, templateId, userId, ownerId, otherDeliveryId, otherUserId],
    );

    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      userId,
    ]);
    await db.query("SET ROLE authenticated");
    const submission = await db.query<{ id: string }>(
      "SELECT public.submit_response($1::uuid, $2::jsonb) AS id",
      [deliveryId, JSON.stringify({ score: 7, comment: "first" })],
    );
    const responseId = submission.rows[0].id;
    const retry = await db.query<{ id: string }>(
      "SELECT public.submit_response($1::uuid, $2::jsonb) AS id",
      [deliveryId, JSON.stringify({ score: 2, comment: "late retry" })],
    );
    assertEqual(retry.rows[0].id, responseId, "duplicate submit is idempotent");
    await db.query(
      "SELECT public.edit_response($1::uuid, $2::jsonb)",
      [responseId, JSON.stringify({ score: 9, comment: "corrected" })],
    );
    await db.query("RESET ROLE");

    const response = await db.query<{
      original_answers: { score: number; comment: string };
    }>(
      "SELECT original_answers FROM public.responses WHERE id = $1::uuid",
      [responseId],
    );
    assertEqual(response.rows[0].original_answers.score, 7, "original answer");
    assertEqual(
      response.rows[0].original_answers.comment,
      "first",
      "original comment",
    );

    const history = await db.query<{
      latest_answers: { score: number; comment: string };
      latest_edit_at: string | null;
    }>(
      "SELECT latest_answers, latest_edit_at FROM public.response_history WHERE response_id = $1::uuid",
      [responseId],
    );
    assertEqual(
      history.rows[0].latest_answers.score,
      9,
      "latest corrected score",
    );
    assertEqual(
      history.rows[0].latest_answers.comment,
      "corrected",
      "latest corrected comment",
    );
    if (history.rows[0].latest_edit_at === null) {
      throw new Error("latest correction timestamp must be populated");
    }

    const counts = await db.query<{
      edit_count: number;
      awarded_points: number;
      edit_events: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM public.response_edits WHERE response_id = $1::uuid) AS edit_count,
         (SELECT coalesce(sum(points), 0)::int FROM public.score_ledger WHERE response_id = $1::uuid) AS awarded_points,
         (SELECT count(*)::int FROM private.notification_outbox
          WHERE event_type = 'response_edited' AND entity_id = $1::uuid) AS edit_events`,
      [responseId],
    );
    assertEqual(counts.rows[0].edit_count, 1, "append-only edit count");
    assertEqual(
      counts.rows[0].awarded_points,
      5,
      "points remain first-submit only",
    );
    assertEqual(counts.rows[0].edit_events, 1, "admin edit notification event");
  } finally {
    await db.close();
  }
});

Deno.test("RLS prevents users from reading another user's response or editing another user's delivery", async () => {
  const db = await createDatabase();
  try {
    await addAuthUser(db, ownerId, ownerEmail, {
      dotaznicek_admin_owner: true,
    }, {
      dotaznicek_admin_owner: true,
    });
    await addAuthUser(db, userId, "user@example.test", { username: "Maslo" });
    await addAuthUser(db, otherUserId, "other@example.test", {
      username: "Other",
    });
    await db.query("SELECT public.bootstrap_admin_owner($1::uuid)", [ownerId]);
    await db.query(
      `INSERT INTO public.templates (id, title, points, created_by)
       VALUES ($1::uuid, 'Daily feedback', 5, $2::uuid)`,
      [templateId, ownerId],
    );
    await db.query(
      `INSERT INTO public.form_deliveries (id, template_id, user_id, sent_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid),
              ($5::uuid, $2::uuid, $6::uuid, $4::uuid)`,
      [deliveryId, templateId, userId, ownerId, otherDeliveryId, otherUserId],
    );
    await db.query(
      `INSERT INTO public.responses (delivery_id, user_id, original_answers)
       VALUES ($1::uuid, $2::uuid, '{"score":4}'::jsonb)`,
      [otherDeliveryId, otherUserId],
    );
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      userId,
    ]);
    await db.query("SET ROLE authenticated");

    const visible = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.responses WHERE user_id = $1::uuid",
      [otherUserId],
    );
    assertEqual(visible.rows[0].count, 0, "other user's response visibility");
    await db.query(
      "UPDATE public.form_deliveries SET status = 'opened' WHERE id = $1::uuid",
      [otherDeliveryId],
    );
    const updateCount = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.form_deliveries WHERE id = $1::uuid AND status = 'opened'",
      [otherDeliveryId],
    );
    assertEqual(
      updateCount.rows[0].count,
      0,
      "other user's delivery stays unchanged",
    );
    let insertDenied = false;
    try {
      await db.query(
        `INSERT INTO public.form_deliveries (template_id, user_id, sent_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid)`,
        [templateId, userId, userId],
      );
    } catch {
      insertDenied = true;
    }
    assertEqual(insertDenied, true, "users cannot create their own deliveries");
    await db.query("RESET ROLE");
  } finally {
    await db.close();
  }
});
