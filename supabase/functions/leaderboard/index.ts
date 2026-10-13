import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { createLeaderboardHandler, type LeaderboardRow } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Supabase server configuration is incomplete");
}

const authClient = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const PAGE_SIZE = 500;

function readProfile(value: unknown): {
  id: string;
  username: string | null;
  displayName: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("leaderboard profile query returned invalid data");
  }
  const profile = value as Record<string, unknown>;
  if (
    typeof profile.id !== "string" ||
    (profile.username !== null && typeof profile.username !== "string") ||
    (profile.display_name !== null &&
      typeof profile.display_name !== "string")
  ) {
    throw new Error("leaderboard profile query returned invalid data");
  }
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
  };
}

function readScore(value: unknown): { userId: string; points: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("leaderboard score query returned invalid data");
  }
  const score = value as Record<string, unknown>;
  if (
    typeof score.user_id !== "string" ||
    typeof score.points !== "number" ||
    !Number.isFinite(score.points)
  ) {
    throw new Error("leaderboard score query returned invalid data");
  }
  return { userId: score.user_id, points: score.points };
}

async function listAllProfiles() {
  const profiles: ReturnType<typeof readProfile>[] = [];
  for (let offset = 0;; offset += PAGE_SIZE) {
    const { data, error } = await serviceClient
      .from("profiles")
      .select("id, username, display_name")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error("leaderboard profile lookup failed");
    }
    if (!Array.isArray(data)) {
      throw new Error("leaderboard profile lookup returned no data");
    }
    profiles.push(...data.map(readProfile));
    if (data.length < PAGE_SIZE) {
      return profiles;
    }
  }
}

async function listScoreTotals(): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  for (let offset = 0;; offset += PAGE_SIZE) {
    const { data, error } = await serviceClient
      .from("score_ledger")
      .select("user_id, points")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error("leaderboard score lookup failed");
    }
    if (!Array.isArray(data)) {
      throw new Error("leaderboard score lookup returned no data");
    }
    for (const value of data) {
      const row = readScore(value);
      const points = (totals.get(row.userId) ?? 0) + row.points;
      if (!Number.isFinite(points)) {
        throw new Error("leaderboard aggregate is outside the supported range");
      }
      totals.set(row.userId, points);
    }
    if (data.length < PAGE_SIZE) {
      return totals;
    }
  }
}

async function listLeaderboardRows(): Promise<LeaderboardRow[]> {
  const [profiles, totals] = await Promise.all([
    listAllProfiles(),
    listScoreTotals(),
  ]);
  return profiles.map((profile) => ({
    userId: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    points: totals.get(profile.id) ?? 0,
  }));
}

Deno.serve(createLeaderboardHandler({
  getAuthenticatedUser: async (accessToken) => {
    const { data, error } = await authClient.auth.getUser(accessToken);
    if (error) {
      if (error.status === undefined || error.status >= 500) {
        throw new Error("Auth verification failed");
      }
      return null;
    }
    return data.user ? { id: data.user.id } : null;
  },
  listLeaderboardRows,
  logger: console,
}));
