const MAX_BODY_BYTES = 8 * 1024;
const MAX_LOGIN_ATTEMPTS = 30;
const LOGIN_WINDOW_SECONDS = 10 * 60;
const OWNER_EMAIL_DOMAIN = "dotaznicek.invalid";
const encoder = new TextEncoder();

export interface LoginResult {
  session: unknown;
  user: unknown;
}

export interface AdminAuthUser {
  id: string;
  isMarkedOwner: boolean;
}

export interface LoginDependencies {
  adminLoginSecret: string | undefined;
  consumeRateLimit(
    bucketHashes: readonly string[],
    maxAttempts: number,
    windowSeconds: number,
  ): Promise<boolean>;
  findUsernameEmail(username: string): Promise<string | null>;
  getOwnerId(): Promise<string | null>;
  findAdminAuthUser(email: string): Promise<AdminAuthUser | null>;
  createAdminAuthUser(email: string, password: string): Promise<{ id: string }>;
  updateAdminAuthUser(
    userId: string,
    email: string,
    password: string,
  ): Promise<void>;
  bootstrapAdminOwner(userId: string): Promise<void>;
  signIn(email: string, password: string): Promise<LoginResult | null>;
  logger: Pick<Console, "info" | "error">;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "authorization, apikey, content-type, x-client-info",
      "access-control-allow-methods": "POST, OPTIONS",
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return null;
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isInternalOwnerEmail(value: string): boolean {
  return /^admin-[0-9a-f]{64}@dotaznicek\.invalid$/i.test(value);
}

function clientIp(request: Request): string | null {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) {
    return cloudflareIp;
  }

  const forwardedFor = request.headers.get("x-forwarded-for")
    ?.split(",", 1)[0]
    .trim();
  if (forwardedFor) {
    return forwardedFor;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function secretsMatch(
  supplied: string,
  configured: string,
): Promise<boolean> {
  const [suppliedHash, configuredHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(configured)),
  ]);
  const suppliedBytes = new Uint8Array(suppliedHash);
  const configuredBytes = new Uint8Array(configuredHash);
  let difference = 0;
  for (let index = 0; index < suppliedBytes.length; index += 1) {
    difference |= suppliedBytes[index] ^ configuredBytes[index];
  }
  return difference === 0;
}

async function provisionOwner(
  password: string,
  dependencies: LoginDependencies,
): Promise<LoginResult | null> {
  const secret = dependencies.adminLoginSecret;
  if (!secret || encoder.encode(secret).byteLength < 32) {
    dependencies.logger.error("admin login unavailable");
    throw new Error("admin login unavailable");
  }
  if (!await secretsMatch(password, secret)) {
    return null;
  }

  const email = `admin-${await sha256Hex(secret)}@${OWNER_EMAIL_DOMAIN}`;
  let ownerId = await dependencies.getOwnerId();

  if (ownerId) {
    await dependencies.updateAdminAuthUser(ownerId, email, secret);
  } else {
    const existingUser = await dependencies.findAdminAuthUser(email);
    if (existingUser) {
      if (!existingUser.isMarkedOwner) {
        throw new Error("admin auth email collision");
      }
      ownerId = existingUser.id;
      await dependencies.updateAdminAuthUser(ownerId, email, secret);
    } else {
      try {
        const createdUser = await dependencies.createAdminAuthUser(
          email,
          secret,
        );
        ownerId = createdUser.id;
      } catch {
        const racedUser = await dependencies.findAdminAuthUser(email);
        if (!racedUser?.isMarkedOwner) {
          throw new Error("admin auth provisioning failed");
        }
        ownerId = racedUser.id;
        await dependencies.updateAdminAuthUser(ownerId, email, secret);
      }
    }
  }

  await dependencies.bootstrapAdminOwner(ownerId);
  return await dependencies.signIn(email, secret);
}

export function createLoginHandler(
  dependencies: LoginDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers":
            "authorization, apikey, content-type, x-client-info",
          "access-control-allow-methods": "POST, OPTIONS",
        },
      });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const contentType = request.headers.get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      return jsonResponse(400, { error: "Invalid request" });
    }

    let bodyText: string | null;
    try {
      bodyText = await readBoundedBody(request);
    } catch {
      return jsonResponse(400, { error: "Invalid request" });
    }
    if (bodyText === null) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return jsonResponse(400, { error: "Invalid request" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    const input = body as Record<string, unknown>;
    const identifier = typeof input.identifier === "string"
      ? input.identifier.trim()
      : null;
    const password = typeof input.password === "string" ? input.password : null;
    if (
      identifier === null ||
      password === null ||
      identifier.length > 320 ||
      password.length === 0 ||
      password.length > 4096
    ) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    try {
      const normalizedIdentifier = normalizeUsername(identifier);
      const ip = clientIp(request);
      if (!ip) {
        dependencies.logger.error("login rate limit unavailable");
        return jsonResponse(503, { error: "Unable to sign in right now" });
      }
      const bucketHashes = [await sha256Hex(`ip:${ip}`)];
      const allowed = await dependencies.consumeRateLimit(
        bucketHashes,
        MAX_LOGIN_ATTEMPTS,
        LOGIN_WINDOW_SECONDS,
      );
      if (!allowed) {
        return jsonResponse(429, {
          error: "Too many login attempts. Try again later",
        });
      }

      if (identifier.length === 0) {
        dependencies.logger.info("admin login attempt");
        const result = await provisionOwner(password, dependencies);
        return result
          ? jsonResponse(200, { session: result.session, user: result.user })
          : jsonResponse(401, { error: "Invalid identifier or password" });
      }

      if (isInternalOwnerEmail(identifier)) {
        return jsonResponse(401, { error: "Invalid identifier or password" });
      }

      const email = looksLikeEmail(identifier)
        ? identifier.toLowerCase()
        : await dependencies.findUsernameEmail(normalizedIdentifier) ??
          `no-account-${await sha256Hex(
            normalizedIdentifier,
          )}@${OWNER_EMAIL_DOMAIN}`;
      const result = await dependencies.signIn(email, password);
      return result
        ? jsonResponse(200, { session: result.session, user: result.user })
        : jsonResponse(401, { error: "Invalid identifier or password" });
    } catch {
      dependencies.logger.error("login service unavailable");
      return jsonResponse(503, { error: "Unable to sign in right now" });
    }
  };
}
