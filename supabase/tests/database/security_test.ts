import { PGlite } from "npm:@electric-sql/pglite@0.3.14";

const initialMigrationName =
  "20261012000000_initial_schema_rls_and_auth_support.sql";
const initialMigrationUrl = new URL(
  "../../migrations/20261012000000_initial_schema_rls_and_auth_support.sql",
  import.meta.url,
);
const migrationsDirectoryUrl = new URL("../../migrations/", import.meta.url);
const mobileSupportMigrationName = "20261013000000_mobile_client_support.sql";
const ownerProfileMigrationName =
  "20261014000000_repair_owner_auth_profiles.sql";

const ownerId = "00000000-0000-4000-8000-000000000001";
const ownerEmail = `admin-${"a".repeat(64)}@dotaznicek.invalid`;
const userId = "00000000-0000-4000-8000-000000000002";
const otherUserId = "00000000-0000-4000-8000-000000000003";
const templateId = "10000000-0000-4000-8000-000000000001";
const deliveryId = "20000000-0000-4000-8000-000000000001";
const otherDeliveryId = "20000000-0000-4000-8000-000000000002";
const responseId = "30000000-0000-4000-8000-000000000001";
const otherResponseId = "30000000-0000-4000-8000-000000000002";

async function createBaseDatabase(): Promise<PGlite> {
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
    CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
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

  await db.exec(await Deno.readTextFile(initialMigrationUrl));

  return db;
}

async function applyAppMigrations(db: PGlite): Promise<void> {
  const migrationNames: string[] = [];
  for await (const entry of Deno.readDir(migrationsDirectoryUrl)) {
    if (
      entry.isFile &&
      entry.name.endsWith(".sql") &&
      entry.name !== initialMigrationName &&
      !entry.name.includes("_schedule_")
    ) {
      migrationNames.push(entry.name);
    }
  }

  migrationNames.sort();
  for (const migrationName of migrationNames) {
    await db.exec(
      await Deno.readTextFile(new URL(migrationName, migrationsDirectoryUrl)),
    );
  }
}

async function applyMobileSupportMigration(db: PGlite): Promise<void> {
  await db.exec(
    await Deno.readTextFile(
      new URL(mobileSupportMigrationName, migrationsDirectoryUrl),
    ),
  );
}

async function createDatabase(): Promise<PGlite> {
  const db = await createBaseDatabase();
  await applyAppMigrations(db);
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

Deno.test("auth trigger creates profiles without assigning generated columns", async () => {
  const db = await createDatabase();
  const newUserId = "00000000-0000-4000-8000-000000000005";
  try {
    await addAuthUser(
      db,
      newUserId,
      `admin-${"c".repeat(64)}@dotaznicek.invalid`,
      { display_name: "Bootstrap Owner" },
      { dotaznicek_admin_owner: true },
    );

    const createdProfile = await db.query<{
      username: string | null;
      username_normalized: string | null;
      role: string;
      is_owner: boolean;
      display_name: string | null;
      username_normalized_generated: string;
    }>(
      `SELECT profile.username,
              profile.username_normalized,
              profile.role,
              profile.is_owner,
              profile.display_name,
              attribute.attgenerated AS username_normalized_generated
       FROM public.profiles profile
       JOIN pg_attribute attribute
         ON attribute.attrelid = 'public.profiles'::regclass
        AND attribute.attname = 'username_normalized'
       WHERE profile.id = $1::uuid`,
      [newUserId],
    );
    assertEqual(createdProfile.rows.length, 1, "trigger-created profile");
    assertEqual(
      createdProfile.rows[0].username,
      "user_00000000",
      "missing username gets a generated fallback",
    );
    assertEqual(
      createdProfile.rows[0].username_normalized,
      "user_00000000",
      "normalized username is computed by the database",
    );
    assertEqual(createdProfile.rows[0].role, "user", "new users are not admins");
    assertEqual(
      createdProfile.rows[0].is_owner,
      false,
      "new users are not marked as owner",
    );
    assertEqual(
      createdProfile.rows[0].display_name,
      "Bootstrap Owner",
      "display name is copied from Auth metadata",
    );
    assertEqual(
      createdProfile.rows[0].username_normalized_generated,
      "s",
      "username_normalized remains a stored generated column",
    );

    await db.query("SELECT public.bootstrap_admin_owner($1::uuid)", [
      newUserId,
    ]);
    const promotedProfile = await db.query<{
      username: string;
      role: string;
      is_owner: boolean;
    }>(
      `SELECT username, role, is_owner
       FROM public.profiles
       WHERE id = $1::uuid`,
      [newUserId],
    );
    assertEqual(promotedProfile.rows[0].username, "admin_owner", "owner username");
    assertEqual(promotedProfile.rows[0].role, "admin", "owner profile role");
    assertEqual(promotedProfile.rows[0].is_owner, true, "owner profile flag");
  } finally {
    await db.close();
  }
});

Deno.test("owner profile migration is safe to apply more than once", async () => {
  const db = await createDatabase();
  try {
    const migration = await Deno.readTextFile(
      new URL(ownerProfileMigrationName, migrationsDirectoryUrl),
    );
    await db.exec(migration);
  } finally {
    await db.close();
  }
});

Deno.test("migration leaves managed Storage tables unchanged", async () => {
  const sql = await Deno.readTextFile(initialMigrationUrl);
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

Deno.test("user metadata cannot mark a profile as owner", async () => {
  const db = await createDatabase();
  try {
    const untrustedUserId = "00000000-0000-4000-8000-000000000004";
    await db.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
       VALUES ($1::uuid, $2, $3::jsonb)`,
      [
        untrustedUserId,
        `admin-${"b".repeat(64)}@dotaznicek.invalid`,
        JSON.stringify({ dotaznicek_admin_owner: true }),
      ],
    );
    const profile = await db.query<{ role: string; is_owner: boolean }>(
      `SELECT role, is_owner FROM public.profiles WHERE id = $1::uuid`,
      [untrustedUserId],
    );
    assertEqual(
      profile.rows[0].role,
      "user",
      "untrusted metadata cannot assign the profile role",
    );
    assertEqual(
      profile.rows[0].is_owner,
      false,
      "untrusted metadata cannot mark the profile as owner",
    );
  } finally {
    await db.close();
  }
});

Deno.test("admins get protected access while owner stays a unique role", async () => {
  const db = await createDatabase();
  const adminId = "00000000-0000-4000-8000-000000000004";
  try {
    await addAuthUser(db, ownerId, ownerEmail, {}, {
      dotaznicek_admin_owner: true,
    });
    await addAuthUser(db, adminId, "admin@dotaznicek.local", {
      username: "admin",
    }, { role: "admin" });
    await addAuthUser(
      db,
      userId,
      "ordinary@example.test",
      { username: "ordinary", role: "admin" },
    );
    await db.query("SELECT public.bootstrap_admin_owner($1::uuid)", [ownerId]);

    await db.query(
      "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
    );
    await db.query("SET ROLE service_role");
    await db.query("SELECT public.grant_admin_role($1::uuid)", [adminId]);
    await db.query("RESET ROLE");

    const adminRole = await db.query<{ role: string }>(
      "SELECT role FROM private.user_roles WHERE user_id = $1::uuid",
      [adminId],
    );
    assertEqual(adminRole.rows[0]?.role, "admin", "seeded admin role");

    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      adminId,
    ]);
    await db.query("SET ROLE authenticated");
    const visibleToAdmin = await db.query<{ id: string }>(
      "SELECT id FROM public.profiles WHERE id = $1::uuid",
      [userId],
    );
    assertEqual(
      visibleToAdmin.rows.length,
      1,
      "admin can read another user's protected profile",
    );
    await db.query("RESET ROLE");

    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      userId,
    ]);
    await db.query("SET ROLE authenticated");
    const visibleToOrdinaryUser = await db.query<{ id: string }>(
      "SELECT id FROM public.profiles WHERE id = $1::uuid",
      [adminId],
    );
    assertEqual(
      visibleToOrdinaryUser.rows.length,
      0,
      "user-editable metadata does not grant admin access",
    );
    await db.query(
      "SELECT set_config('request.jwt.claim.role', 'service_role', false)",
    );
    await db.query("SET ROLE service_role");
    let userMetadataAdminDenied = false;
    try {
      await db.query("SELECT public.grant_admin_role($1::uuid)", [userId]);
    } catch {
      userMetadataAdminDenied = true;
    }
    assertEqual(
      userMetadataAdminDenied,
      true,
      "user-editable metadata cannot be promoted by the role RPC",
    );
    await db.query("RESET ROLE");

    await db.query(
      "SELECT set_config('request.jwt.claim.role', 'authenticated', false)",
    );
    let roleAssignmentDenied = false;
    try {
      await db.query("SELECT public.grant_admin_role($1::uuid)", [userId]);
    } catch {
      roleAssignmentDenied = true;
    }
    assertEqual(
      roleAssignmentDenied,
      true,
      "authenticated users cannot assign admin roles",
    );
    await db.query("RESET ROLE");

    const ownerRole = await db.query<{ role: string }>(
      "SELECT role FROM private.user_roles WHERE user_id = $1::uuid",
      [ownerId],
    );
    assertEqual(ownerRole.rows[0]?.role, "owner", "owner role is preserved");
    const ownerLookup = await db.query<{ id: string | null }>(
      "SELECT public.admin_owner_user_id() AS id",
    );
    assertEqual(
      ownerLookup.rows[0].id,
      ownerId,
      "singleton owner is unchanged",
    );
    const usernameLogin = await db.query<{ email: string | null }>(
      "SELECT public.login_email_for_username('admin') AS email",
    );
    assertEqual(
      usernameLogin.rows[0].email,
      null,
      "owner username does not collide with a pre-existing admin nickname",
    );
    const renamedAdminLogin = await db.query<{ email: string | null }>(
      "SELECT public.login_email_for_username('admin_old') AS email",
    );
    assertEqual(
      renamedAdminLogin.rows[0].email,
      "admin@dotaznicek.local",
      "the displaced admin nickname remains usable as admin_old",
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

Deno.test("migration adds typed templates and persistent favorites", async () => {
  const db = await createDatabase();
  try {
    await addAuthUser(db, ownerId, ownerEmail, {}, {
      dotaznicek_admin_owner: true,
    });
    await addAuthUser(db, userId, "user@example.test", { username: "Maslo" });
    await db.query("SELECT public.bootstrap_admin_owner($1::uuid)", [ownerId]);
    await db.query(
      `INSERT INTO public.groups (id, name, created_by)
       VALUES ($1::uuid, 'První', $2::uuid)`,
      ["40000000-0000-4000-8000-000000000001", ownerId],
    );
    await db.query(
      `INSERT INTO public.templates (id, title, created_by)
       VALUES ($1::uuid, 'První šablona', $2::uuid)`,
      [templateId, userId],
    );

    const defaults = await db.query<{
      category: string;
      profile_favorite: boolean;
      group_favorite: boolean;
    }>(
      `SELECT
         template.category,
         profile.is_favorite AS profile_favorite,
         group_record.is_favorite AS group_favorite
       FROM public.templates template
       JOIN public.profiles profile ON profile.id = $1::uuid
       JOIN public.groups group_record
         ON group_record.id = $2::uuid
       WHERE template.id = $3::uuid`,
      [
        userId,
        "40000000-0000-4000-8000-000000000001",
        templateId,
      ],
    );
    assertEqual(
      defaults.rows[0].category,
      "questionnaire",
      "template category default",
    );
    assertEqual(
      defaults.rows[0].profile_favorite,
      false,
      "profile favorite default",
    );
    assertEqual(
      defaults.rows[0].group_favorite,
      false,
      "group favorite default",
    );

    await db.query(
      "UPDATE public.templates SET category = 'advertisement' WHERE id = $1::uuid",
      [templateId],
    );
    let invalidCategoryRejected = false;
    try {
      await db.query(
        "UPDATE public.templates SET category = 'unknown' WHERE id = $1::uuid",
        [templateId],
      );
    } catch {
      invalidCategoryRejected = true;
    }
    assertEqual(
      invalidCategoryRejected,
      true,
      "invalid template category is rejected",
    );

    const updateGrants = await db.query<{
      template_category: boolean;
      profile_favorite: boolean;
      group_favorite: boolean;
    }>(
      `SELECT
         has_column_privilege('authenticated', 'public.templates', 'category', 'UPDATE') AS template_category,
         has_column_privilege('authenticated', 'public.profiles', 'is_favorite', 'UPDATE') AS profile_favorite,
         has_column_privilege('authenticated', 'public.groups', 'is_favorite', 'UPDATE') AS group_favorite`,
    );
    assertEqual(
      updateGrants.rows[0].template_category,
      true,
      "category update grant",
    );
    assertEqual(
      updateGrants.rows[0].profile_favorite,
      true,
      "profile favorite update grant",
    );
    assertEqual(
      updateGrants.rows[0].group_favorite,
      true,
      "group favorite update grant",
    );

    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      userId,
    ]);
    await db.query("SET ROLE authenticated");
    let selfFavoriteDenied = false;
    try {
      await db.query(
        "UPDATE public.profiles SET is_favorite = true WHERE id = $1::uuid",
        [userId],
      );
    } catch {
      selfFavoriteDenied = true;
    }
    await db.query("RESET ROLE");
    assertEqual(
      selfFavoriteDenied,
      true,
      "users cannot protect themselves from cleanup",
    );

    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      ownerId,
    ]);
    await db.query("SET ROLE authenticated");
    await db.query(
      "UPDATE public.profiles SET is_favorite = true WHERE id = $1::uuid",
      [userId],
    );
    await db.query("RESET ROLE");
    const favorite = await db.query<{ is_favorite: boolean }>(
      "SELECT is_favorite FROM public.profiles WHERE id = $1::uuid",
      [userId],
    );
    assertEqual(favorite.rows[0].is_favorite, true, "owner favorite persists");
  } finally {
    await db.close();
  }
});

Deno.test("migration rejects existing multiple-folder membership", async () => {
  const db = await createBaseDatabase();
  try {
    await addAuthUser(db, ownerId, ownerEmail, {}, {
      dotaznicek_admin_owner: true,
    });
    await addAuthUser(db, userId, "user@example.test", { username: "Maslo" });
    await db.query("SELECT public.bootstrap_admin_owner($1::uuid)", [ownerId]);
    await db.query(
      `INSERT INTO public.groups (id, name, created_by)
       VALUES ($1::uuid, 'První', $3::uuid),
              ($2::uuid, 'Druhá', $3::uuid)`,
      [
        "40000000-0000-4000-8000-000000000001",
        "40000000-0000-4000-8000-000000000002",
        ownerId,
      ],
    );
    await db.query(
      `INSERT INTO public.group_members (group_id, user_id)
       VALUES ($1::uuid, $3::uuid), ($2::uuid, $3::uuid)`,
      [
        "40000000-0000-4000-8000-000000000001",
        "40000000-0000-4000-8000-000000000002",
        userId,
      ],
    );

    let migrationError = "";
    try {
      await applyMobileSupportMigration(db);
    } catch (error) {
      migrationError = error instanceof Error ? error.message : String(error);
      await db.exec("ROLLBACK");
    }
    if (!migrationError.toLowerCase().includes("multiple")) {
      throw new Error(
        `migration must explain the multiple-membership conflict, got: ${migrationError}`,
      );
    }

    const memberships = await db.query<{ group_id: string }>(
      `SELECT group_id::text
       FROM public.group_members
       WHERE user_id = $1::uuid
       ORDER BY group_id`,
      [userId],
    );
    assertEqual(
      memberships.rows.length,
      2,
      "conflicting memberships are preserved",
    );
    assertEqual(
      memberships.rows[0].group_id,
      "40000000-0000-4000-8000-000000000001",
      "first membership remains unchanged",
    );
    assertEqual(
      memberships.rows[1].group_id,
      "40000000-0000-4000-8000-000000000002",
      "second membership remains unchanged",
    );
  } finally {
    await db.close();
  }
});

Deno.test("only owner can atomically move selected users to one group", async () => {
  const db = await createDatabase();
  try {
    await addAuthUser(db, ownerId, ownerEmail, {}, {
      dotaznicek_admin_owner: true,
    });
    await addAuthUser(db, userId, "user@example.test", { username: "Maslo" });
    await addAuthUser(db, otherUserId, "other@example.test", {
      username: "Other",
    });
    await db.query("SELECT public.bootstrap_admin_owner($1::uuid)", [ownerId]);
    await db.query(
      `INSERT INTO public.groups (id, name, created_by)
       VALUES ($1::uuid, 'Výchozí', $3::uuid),
              ($2::uuid, 'Cíl', $3::uuid)`,
      [
        "40000000-0000-4000-8000-000000000001",
        "40000000-0000-4000-8000-000000000002",
        ownerId,
      ],
    );
    await db.query(
      `INSERT INTO public.group_members (group_id, user_id)
       VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid)`,
      [
        "40000000-0000-4000-8000-000000000001",
        userId,
        otherUserId,
      ],
    );

    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      userId,
    ]);
    await db.query("SET ROLE authenticated");
    let nonOwnerDenied = false;
    try {
      await db.query(
        "SELECT public.move_users_to_group($1::uuid[], $2::uuid)",
        [[userId], "40000000-0000-4000-8000-000000000002"],
      );
    } catch {
      nonOwnerDenied = true;
    }
    assertEqual(nonOwnerDenied, true, "ordinary user cannot move members");
    await db.query("RESET ROLE");

    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [
      ownerId,
    ]);
    await db.query("SET ROLE authenticated");
    let ownerMoveDenied = false;
    try {
      await db.query(
        "SELECT public.move_users_to_group($1::uuid[], $2::uuid)",
        [[ownerId], "40000000-0000-4000-8000-000000000002"],
      );
    } catch {
      ownerMoveDenied = true;
    }
    assertEqual(ownerMoveDenied, true, "owner account cannot be moved");

    let invalidDestinationDenied = false;
    try {
      await db.query(
        "SELECT public.move_users_to_group($1::uuid[], $2::uuid)",
        [[userId], "40000000-0000-4000-8000-000000000099"],
      );
    } catch {
      invalidDestinationDenied = true;
    }
    assertEqual(
      invalidDestinationDenied,
      true,
      "invalid destination is rejected",
    );
    const unchanged = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM public.group_members
       WHERE group_id = $1::uuid
         AND user_id = ANY($2::uuid[])`,
      [
        "40000000-0000-4000-8000-000000000001",
        [userId, otherUserId],
      ],
    );
    assertEqual(
      unchanged.rows[0].count,
      2,
      "failed moves leave all memberships intact",
    );

    const moved = await db.query<{ count: number }>(
      "SELECT public.move_users_to_group($1::uuid[], $2::uuid) AS count",
      [[userId, otherUserId], "40000000-0000-4000-8000-000000000002"],
    );
    assertEqual(
      moved.rows[0].count,
      2,
      "owner moves the selected users together",
    );
    const destinationMembers = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM public.group_members
       WHERE group_id = $1::uuid
         AND user_id = ANY($2::uuid[])`,
      [
        "40000000-0000-4000-8000-000000000002",
        [userId, otherUserId],
      ],
    );
    assertEqual(
      destinationMembers.rows[0].count,
      2,
      "both users join the destination",
    );

    const movedToGeneral = await db.query<{ count: number }>(
      "SELECT public.move_users_to_group($1::uuid[], NULL) AS count",
      [[userId]],
    );
    assertEqual(
      movedToGeneral.rows[0].count,
      1,
      "null destination moves to virtual general folder",
    );
    const remaining = await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.group_members WHERE user_id = $1::uuid",
      [userId],
    );
    assertEqual(
      remaining.rows[0].count,
      0,
      "general folder has no explicit membership",
    );
    await db.query("RESET ROLE");
  } finally {
    await db.close();
  }
});

Deno.test("deleting a user cascades only that user's app data", async () => {
  const db = await createDatabase();
  try {
    await addAuthUser(db, ownerId, ownerEmail, {}, {
      dotaznicek_admin_owner: true,
    });
    await addAuthUser(db, userId, "user@example.test", { username: "Maslo" });
    await addAuthUser(db, otherUserId, "other@example.test", {
      username: "Other",
    });
    await db.query("SELECT public.bootstrap_admin_owner($1::uuid)", [ownerId]);
    await db.query(
      `INSERT INTO public.groups (id, name, created_by)
       VALUES ($1::uuid, 'Skupina', $2::uuid)`,
      ["40000000-0000-4000-8000-000000000001", ownerId],
    );
    await db.query(
      `INSERT INTO public.group_members (group_id, user_id)
       VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid)`,
      ["40000000-0000-4000-8000-000000000001", userId, otherUserId],
    );
    await db.query(
      `INSERT INTO public.templates (id, title, points, created_by)
       VALUES ($1::uuid, 'Template', 5, $2::uuid)`,
      [templateId, ownerId],
    );
    await db.query(
      `INSERT INTO public.form_deliveries (id, template_id, user_id, sent_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid),
              ($5::uuid, $2::uuid, $6::uuid, $4::uuid)`,
      [deliveryId, templateId, userId, ownerId, otherDeliveryId, otherUserId],
    );
    await db.query(
      `INSERT INTO public.response_drafts (delivery_id, user_id, answers)
       VALUES ($1::uuid, $2::uuid, '{"draft":true}'::jsonb),
              ($3::uuid, $4::uuid, '{"draft":true}'::jsonb)`,
      [deliveryId, userId, otherDeliveryId, otherUserId],
    );
    await db.query(
      `INSERT INTO public.responses (id, delivery_id, user_id, original_answers)
       VALUES ($1::uuid, $2::uuid, $3::uuid, '{"answer":"own"}'::jsonb),
              ($4::uuid, $5::uuid, $6::uuid, '{"answer":"other"}'::jsonb)`,
      [
        responseId,
        deliveryId,
        userId,
        otherResponseId,
        otherDeliveryId,
        otherUserId,
      ],
    );
    await db.query(
      `INSERT INTO public.response_edits (response_id, version, answers, edited_by)
       VALUES ($1::uuid, 1, '{"answer":"corrected"}'::jsonb, $3::uuid),
              ($2::uuid, 1, '{"answer":"corrected"}'::jsonb, $3::uuid)`,
      [responseId, otherResponseId, ownerId],
    );
    await db.query(
      `INSERT INTO public.score_ledger (user_id, response_id, event_type, points)
       VALUES ($1::uuid, $3::uuid, 'initial_submission', 5),
              ($2::uuid, $4::uuid, 'initial_submission', 5)`,
      [userId, otherUserId, responseId, otherResponseId],
    );
    await db.query(
      `INSERT INTO public.push_tokens (user_id, token, platform)
       VALUES ($1::uuid, 'ExponentPushToken[own]', 'ios'),
              ($2::uuid, 'ExponentPushToken[other]', 'android')`,
      [userId, otherUserId],
    );

    await db.query("DELETE FROM auth.users WHERE id = $1::uuid", [userId]);

    const deletedUserData = await db.query<{
      profiles: number;
      memberships: number;
      deliveries: number;
      drafts: number;
      responses: number;
      edits: number;
      scores: number;
      tokens: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM public.profiles WHERE id = $1::uuid) AS profiles,
         (SELECT count(*)::int FROM public.group_members WHERE user_id = $1::uuid) AS memberships,
         (SELECT count(*)::int FROM public.form_deliveries WHERE user_id = $1::uuid) AS deliveries,
         (SELECT count(*)::int FROM public.response_drafts WHERE user_id = $1::uuid) AS drafts,
         (SELECT count(*)::int FROM public.responses WHERE user_id = $1::uuid) AS responses,
         (SELECT count(*)::int FROM public.response_edits WHERE response_id = $2::uuid) AS edits,
         (SELECT count(*)::int FROM public.score_ledger WHERE user_id = $1::uuid) AS scores,
         (SELECT count(*)::int FROM public.push_tokens WHERE user_id = $1::uuid) AS tokens`,
      [userId, responseId],
    );
    assertEqual(
      Object.values(deletedUserData.rows[0]).every((count) => count === 0),
      true,
      "all deleted user's app data is removed",
    );

    const preservedData = await db.query<{
      profile_count: number;
      membership_count: number;
      delivery_count: number;
      draft_count: number;
      response_count: number;
      edit_count: number;
      score_count: number;
      token_count: number;
      template_count: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM public.profiles WHERE id = $1::uuid) AS profile_count,
         (SELECT count(*)::int FROM public.group_members WHERE user_id = $1::uuid) AS membership_count,
         (SELECT count(*)::int FROM public.form_deliveries WHERE user_id = $1::uuid) AS delivery_count,
         (SELECT count(*)::int FROM public.response_drafts WHERE user_id = $1::uuid) AS draft_count,
         (SELECT count(*)::int FROM public.responses WHERE user_id = $1::uuid) AS response_count,
         (SELECT count(*)::int FROM public.response_edits WHERE response_id = $2::uuid) AS edit_count,
         (SELECT count(*)::int FROM public.score_ledger WHERE user_id = $1::uuid) AS score_count,
         (SELECT count(*)::int FROM public.push_tokens WHERE user_id = $1::uuid) AS token_count,
         (SELECT count(*)::int FROM public.templates WHERE id = $3::uuid) AS template_count`,
      [otherUserId, otherResponseId, templateId],
    );
    const preserved = preservedData.rows[0];
    assertEqual(preserved.profile_count, 1, "other user's profile remains");
    assertEqual(
      preserved.membership_count,
      1,
      "other user's membership remains",
    );
    assertEqual(preserved.delivery_count, 1, "other user's delivery remains");
    assertEqual(preserved.draft_count, 1, "other user's draft remains");
    assertEqual(preserved.response_count, 1, "other user's response remains");
    assertEqual(preserved.edit_count, 1, "other user's response edit remains");
    assertEqual(preserved.score_count, 1, "other user's score remains");
    assertEqual(preserved.token_count, 1, "other user's token remains");
    assertEqual(preserved.template_count, 1, "owner template remains");
  } finally {
    await db.close();
  }
});
