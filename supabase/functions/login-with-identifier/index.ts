import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { createLoginHandler } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Supabase server configuration is incomplete");
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const authClient = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

Deno.serve(createLoginHandler({
  adminLoginSecret: Deno.env.get("ADMIN_LOGIN_SECRET"),
  consumeRateLimit: async (bucketHashes, maxAttempts, windowSeconds) => {
    const { data, error } = await serviceClient.rpc(
      "consume_login_rate_limits",
      {
        p_bucket_keys: [...bucketHashes],
        p_max_attempts: maxAttempts,
        p_window_seconds: windowSeconds,
      },
    );
    if (error || typeof data !== "boolean") {
      throw new Error("rate limit request failed");
    }
    return data;
  },
  findUsernameEmail: async (username) => {
    const { data, error } = await serviceClient.rpc(
      "login_email_for_username",
      { p_username: username },
    );
    if (error || (data !== null && typeof data !== "string")) {
      throw new Error("username lookup failed");
    }
    return data;
  },
  getOwnerId: async () => {
    const { data, error } = await serviceClient.rpc("admin_owner_user_id");
    if (error || (data !== null && typeof data !== "string")) {
      throw new Error("owner lookup failed");
    }
    return data;
  },
  findAdminAuthUser: async (email) => {
    const { data, error } = await serviceClient.rpc(
      "find_admin_auth_user",
      { p_email: email },
    );
    if (error || !Array.isArray(data)) {
      throw new Error("admin account lookup failed");
    }
    const row = data[0] as
      | { user_id?: unknown; is_marked_owner?: unknown }
      | undefined;
    if (
      !row ||
      typeof row.user_id !== "string" ||
      typeof row.is_marked_owner !== "boolean"
    ) {
      return null;
    }
    return {
      id: row.user_id,
      isMarkedOwner: row.is_marked_owner,
    };
  },
  createAdminAuthUser: async (email, password) => {
    const { data, error } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { dotaznicek_admin_owner: true },
    });
    if (error || !data.user) {
      throw new Error("admin account creation failed");
    }
    return { id: data.user.id };
  },
  updateAdminAuthUser: async (userId, email, password) => {
    const { error } = await serviceClient.auth.admin.updateUserById(userId, {
      email,
      password,
      email_confirm: true,
      app_metadata: { dotaznicek_admin_owner: true },
    });
    if (error) {
      throw new Error("admin account update failed");
    }
  },
  bootstrapAdminOwner: async (userId) => {
    const { error } = await serviceClient.rpc("bootstrap_admin_owner", {
      p_user_id: userId,
    });
    if (error) {
      throw new Error("owner bootstrap failed");
    }
  },
  signIn: async (email, password) => {
    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      if (error.status === 400 || error.status === 422) {
        return null;
      }
      throw new Error("password sign-in failed");
    }
    if (!data.session || !data.user) {
      throw new Error("password sign-in returned no session");
    }
    return { session: data.session, user: data.user };
  },
  logger: console,
}));
