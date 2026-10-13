import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  type CleanupAuthUser,
  createInactiveCleanupHandler,
} from "./handler.ts";

const { supabaseUrl, serviceRoleKey } = (() => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase server configuration is incomplete");
  }
  return { supabaseUrl, serviceRoleKey };
})();

let serviceClient: ReturnType<typeof createClient> | undefined;

function getServiceClient(): ReturnType<typeof createClient> {
  if (!serviceClient) {
    serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return serviceClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasServiceRoleClaim(accessToken: string): boolean {
  if (accessToken !== serviceRoleKey) {
    return false;
  }
  const payloadSegment = accessToken.split(".")[1];
  if (!payloadSegment) {
    return false;
  }

  try {
    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const paddedBase64 = base64 + "=".repeat((4 - base64.length % 4) % 4);
    const binaryPayload = atob(paddedBase64);
    const payloadBytes = Uint8Array.from(
      binaryPayload,
      (character) => character.charCodeAt(0),
    );
    const payload: unknown = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    );
    return isRecord(payload) && payload.role === "service_role";
  } catch {
    return false;
  }
}

function mapAuthUser(user: {
  id: string;
  last_sign_in_at?: string | null;
}): CleanupAuthUser {
  return {
    id: user.id,
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

Deno.serve(createInactiveCleanupHandler({
  verifyServiceRoleToken: async (accessToken) =>
    hasServiceRoleClaim(accessToken),
  getOwnerId: async () => {
    const { data, error } = await getServiceClient().rpc("admin_owner_user_id");
    if (error || (data !== null && typeof data !== "string")) {
      throw new Error("Owner lookup failed");
    }
    return data;
  },
  listAuthUsers: async (page, perPage) => {
    const { data, error } = await getServiceClient().auth.admin.listUsers({
      page,
      perPage,
    });
    if (error || !Array.isArray(data.users)) {
      throw new Error("Auth user enumeration failed");
    }
    return data.users.map(mapAuthUser);
  },
  getAuthUserById: async (userId) => {
    const { data, error } = await getServiceClient().auth.admin.getUserById(
      userId,
    );
    if (error) {
      if (error.status === 404) {
        return null;
      }
      throw new Error("Auth user recheck failed");
    }
    return data.user ? mapAuthUser(data.user) : null;
  },
  getProfileFavorite: async (userId) => {
    const { data, error } = await getServiceClient()
      .from("profiles")
      .select("is_favorite")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      throw new Error("Profile lookup failed");
    }
    const profile: unknown = data;
    if (profile === null) {
      return null;
    }
    if (!isRecord(profile) || typeof profile.is_favorite !== "boolean") {
      throw new Error("Profile favorite flag is invalid");
    }
    return profile.is_favorite;
  },
  deleteAuthUser: async (userId) => {
    const { error } = await getServiceClient().auth.admin.deleteUser(userId);
    if (error) {
      throw new Error("Auth user deletion failed");
    }
  },
  now: () => new Date(),
  logger: console,
}));
