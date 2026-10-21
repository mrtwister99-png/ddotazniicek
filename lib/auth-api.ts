import type { AuthSession } from "@/lib/auth-session";

// Supabase posílá e-mailový kód dlouhý 6-10 číslic (čtyřmístný neumí).
export const PIN_LENGTH = 8;
export const RESERVED_NICKNAMES = ["admin", "admin_owner", "admin_old"];

export type AuthErrorCode =
  | "network"
  | "rate-limited"
  | "invalid-code"
  | "weak-password"
  | "nickname"
  | "confirm-disabled"
  | "failed";

export class AuthError extends Error {
  code: AuthErrorCode;
  constructor(code: AuthErrorCode) {
    super(code);
    this.code = code;
  }
}

function field(json: unknown, key: string): unknown {
  return typeof json === "object" && json !== null
    ? (json as Record<string, unknown>)[key]
    : undefined;
}

// POST na Supabase s veřejným (anon) klíčem. Hesla ani kódy nikam nelogujeme.
async function post(
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new AuthError("failed");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("network");
  }

  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

// Jen pro hezčí chybu. Když volání selže (např. ještě není migrace), registrace pokračuje
// a rozhodne databáze.
export async function isNicknameAvailable(nickname: string): Promise<boolean> {
  try {
    const { status, json } = await post("rest/v1/rpc/username_available", {
      p_username: nickname,
    });
    if (status === 200 && typeof json === "boolean") return json;
  } catch {
    // ignorujeme
  }
  return true;
}

// Založí neověřený účet; Supabase pošle e-mail s kódem.
export async function signUp(
  email: string,
  password: string,
  nickname: string,
): Promise<void> {
  const { status, json } = await post("auth/v1/signup", {
    email,
    password,
    data: { username: nickname },
  });
  if (status === 429) throw new AuthError("rate-limited");
  if (status >= 400) {
    if (field(json, "error_code") === "weak_password")
      throw new AuthError("weak-password");
    // Trigger v databázi odmítl přezdívku (obsazená / rezervovaná).
    if (status === 500) throw new AuthError("nickname");
    throw new AuthError("failed");
  }
  // Když server vrátí rovnou session, ověření e-mailem není zapnuté - takový účet nepřijmeme.
  if (typeof field(json, "access_token") === "string")
    throw new AuthError("confirm-disabled");
}

// Ověří kód z e-mailu. Teprve úspěšné ověření vrátí přihlášenou session.
export async function verifyCode(
  email: string,
  token: string,
): Promise<AuthSession> {
  const { status, json } = await post("auth/v1/verify", {
    type: "signup",
    email,
    token,
  });
  if (status === 429) throw new AuthError("rate-limited");
  const user = field(json, "user");
  if (
    status !== 200 ||
    typeof field(json, "access_token") !== "string" ||
    typeof user !== "object" ||
    user === null
  ) {
    throw new AuthError("invalid-code");
  }
  return { session: json as object, user };
}

export async function resendCode(email: string): Promise<void> {
  const { status } = await post("auth/v1/resend", { type: "signup", email });
  if (status === 429) throw new AuthError("rate-limited");
}
