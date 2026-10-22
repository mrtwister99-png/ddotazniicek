import { getAuthSession } from "@/lib/auth-session";

export function credentials() {
  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const auth = getAuthSession();
  const token = (auth?.session as { access_token?: unknown } | undefined)
    ?.access_token;
  const userId = (auth?.user as { id?: unknown } | undefined)?.id;
  if (
    !baseUrl ||
    !anonKey ||
    typeof token !== "string" ||
    typeof userId !== "string"
  ) {
    throw new Error("not-configured");
  }
  return { baseUrl, anonKey, token, userId };
}

export async function rest(
  path: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<unknown> {
  const { baseUrl, anonKey, token } = credentials();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    body: init.body,
    headers: {
      Accept: "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: init.method === "POST" ? "return=representation" : "",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`http-${response.status}:${txt.slice(0, 200)}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function restWithPreferReturn(
  path: string,
  body: string,
): Promise<unknown> {
  return rest(path, {
    method: "POST",
    body,
    headers: { Prefer: "return=representation" },
  });
}

export function asArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error("bad-response");
  return value as T[];
}
