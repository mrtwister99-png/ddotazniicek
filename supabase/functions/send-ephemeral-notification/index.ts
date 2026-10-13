import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  createEphemeralNotificationHandler,
  type ExpoPushMessage,
  isDeliveryCategory,
} from "./handler.ts";

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

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_BATCH_SIZE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sendPushNotifications(
  messages: readonly ExpoPushMessage[],
): Promise<{ ok: boolean }[]> {
  const results: { ok: boolean }[] = [];
  for (let offset = 0; offset < messages.length; offset += EXPO_BATCH_SIZE) {
    const batch = messages.slice(offset, offset + EXPO_BATCH_SIZE);
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "accept-encoding": "gzip, deflate",
        "content-type": "application/json",
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      results.push(...batch.map(() => ({ ok: false })));
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      results.push(...batch.map(() => ({ ok: false })));
      continue;
    }
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      results.push(...batch.map(() => ({ ok: false })));
      continue;
    }
    if (payload.data.length !== batch.length) {
      results.push(...batch.map(() => ({ ok: false })));
      continue;
    }

    for (const ticket of payload.data) {
      results.push({
        ok: isRecord(ticket) && ticket.status === "ok",
      });
    }
  }
  return results;
}

Deno.serve(createEphemeralNotificationHandler({
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
  getOwnerId: async () => {
    const { data, error } = await serviceClient.rpc("admin_owner_user_id");
    if (error || (data !== null && typeof data !== "string")) {
      throw new Error("Owner lookup failed");
    }
    return data;
  },
  getDelivery: async (deliveryId) => {
    const { data, error } = await serviceClient
      .from("form_deliveries")
      .select("user_id, template_id")
      .eq("id", deliveryId)
      .maybeSingle();
    if (error) {
      throw new Error("Delivery lookup failed");
    }
    if (!data) {
      return null;
    }
    const delivery: unknown = data;
    if (
      !isRecord(delivery) ||
      typeof delivery.user_id !== "string" ||
      typeof delivery.template_id !== "string"
    ) {
      throw new Error("Delivery lookup returned invalid data");
    }

    const { data: templateData, error: templateError } = await serviceClient
      .from("templates")
      .select("category")
      .eq("id", delivery.template_id)
      .maybeSingle();
    if (templateError) {
      throw new Error("Template lookup failed");
    }
    const template: unknown = templateData;
    if (!isRecord(template) || !isDeliveryCategory(template.category)) {
      throw new Error("Template category is unavailable");
    }
    return {
      userId: delivery.user_id,
      category: template.category,
    };
  },
  getResponseUserId: async (responseId) => {
    const { data, error } = await serviceClient
      .from("responses")
      .select("user_id")
      .eq("id", responseId)
      .maybeSingle();
    if (error) {
      throw new Error("Response lookup failed");
    }
    if (!data) {
      return null;
    }
    const response: unknown = data;
    if (!isRecord(response) || typeof response.user_id !== "string") {
      throw new Error("Response lookup returned invalid data");
    }
    return response.user_id;
  },
  getPushTokens: async (userId) => {
    const { data, error } = await serviceClient
      .from("push_tokens")
      .select("token")
      .eq("user_id", userId);
    if (error) {
      throw new Error("Push token lookup failed");
    }
    if (!Array.isArray(data)) {
      throw new Error("Push token lookup returned invalid data");
    }
    return data.map((value: unknown) => {
      if (!isRecord(value) || typeof value.token !== "string") {
        throw new Error("Push token lookup returned invalid data");
      }
      return value.token;
    });
  },
  sendPushNotifications,
  logger: console,
}));
