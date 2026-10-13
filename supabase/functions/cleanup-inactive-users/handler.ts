const PAGE_SIZE = 500;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 2048;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CleanupAuthUser {
  id: string;
  lastSignInAt: string | null;
}

export interface CleanupDependencies {
  verifyServiceRoleToken(accessToken: string): Promise<boolean>;
  getOwnerId(): Promise<string | null>;
  listAuthUsers(
    page: number,
    perPage: number,
  ): Promise<readonly CleanupAuthUser[]>;
  getAuthUserById(userId: string): Promise<CleanupAuthUser | null>;
  getProfileFavorite(userId: string): Promise<boolean | null>;
  deleteAuthUser(userId: string): Promise<void>;
  now(): Date;
  logger: Pick<Console, "info" | "error">;
}

interface CleanupCounts {
  scanned: number;
  deleted: number;
  skipped: number;
  failed: number;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "authorization, apikey, content-type, x-client-info",
      "access-control-allow-methods": "POST, OPTIONS",
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_BODY_BYTES
  ) {
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

async function hasNoSelectedUsers(request: Request): Promise<boolean> {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  const bodyText = await readBoundedBody(request);
  if (bodyText === null) {
    return false;
  }
  if (bodyText.trim().length === 0) {
    return true;
  }
  if (contentType !== "application/json") {
    return false;
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return false;
  }
  return typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body).length === 0;
}

function isEligible(
  user: CleanupAuthUser,
  ownerId: string,
  cutoffTime: number,
): boolean {
  if (user.id === ownerId || user.lastSignInAt === null) {
    return false;
  }
  const lastSignInTime = Date.parse(user.lastSignInAt);
  return Number.isFinite(lastSignInTime) && lastSignInTime <= cutoffTime;
}

function isValidAuthUser(user: CleanupAuthUser): boolean {
  return UUID_PATTERN.test(user.id) &&
    (user.lastSignInAt === null || typeof user.lastSignInAt === "string");
}

async function listInactiveCandidates(
  dependencies: CleanupDependencies,
  ownerId: string,
  cutoffTime: number,
): Promise<{ users: CleanupAuthUser[]; scanned: number; skipped: number }> {
  const candidates = new Map<string, CleanupAuthUser>();
  const seenIds = new Set<string>();
  let scanned = 0;
  let skipped = 0;
  for (let page = 1;; page += 1) {
    const users = await dependencies.listAuthUsers(page, PAGE_SIZE);
    if (!Array.isArray(users)) {
      throw new Error("Auth user enumeration returned invalid data");
    }
    for (const user of users) {
      if (!isValidAuthUser(user)) {
        throw new Error("Auth user enumeration returned invalid data");
      }
      if (seenIds.has(user.id)) {
        continue;
      }
      seenIds.add(user.id);
      scanned += 1;
      if (isEligible(user, ownerId, cutoffTime)) {
        candidates.set(user.id, user);
      } else {
        skipped += 1;
      }
    }
    if (users.length < PAGE_SIZE) {
      break;
    }
  }
  return {
    users: [...candidates.values()],
    scanned,
    skipped,
  };
}

export function createInactiveCleanupHandler(
  dependencies: CleanupDependencies,
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

    const accessToken = getBearerToken(request);
    if (!accessToken || accessToken.length > 8192) {
      return jsonResponse(403, { error: "Service role required" });
    }

    let isServiceRole: boolean;
    try {
      isServiceRole = await dependencies.verifyServiceRoleToken(accessToken);
    } catch {
      dependencies.logger.error("service role verification failed");
      return jsonResponse(500, { error: "Unable to verify scheduled request" });
    }
    if (!isServiceRole) {
      return jsonResponse(403, { error: "Service role required" });
    }

    let hasNoSelectedUsersInput: boolean;
    try {
      hasNoSelectedUsersInput = await hasNoSelectedUsers(request);
    } catch {
      hasNoSelectedUsersInput = false;
    }
    if (!hasNoSelectedUsersInput) {
      return jsonResponse(400, { error: "User-selected IDs are not accepted" });
    }

    try {
      const ownerId = await dependencies.getOwnerId();
      if (!ownerId || !UUID_PATTERN.test(ownerId)) {
        throw new Error("configured owner is unavailable");
      }
      const now = dependencies.now().getTime();
      if (!Number.isFinite(now)) {
        throw new Error("cleanup clock is invalid");
      }
      const cutoffTime = now - THIRTY_DAYS_MS;
      const candidates = await listInactiveCandidates(
        dependencies,
        ownerId,
        cutoffTime,
      );
      const counts: CleanupCounts = {
        scanned: candidates.scanned,
        deleted: 0,
        skipped: candidates.skipped,
        failed: 0,
      };

      for (const candidate of candidates.users) {
        let isFavorite: boolean | null;
        try {
          isFavorite = await dependencies.getProfileFavorite(candidate.id);
        } catch {
          counts.failed += 1;
          dependencies.logger.error(
            "inactive user profile lookup failed",
            candidate.id,
          );
          continue;
        }
        if (isFavorite === null || isFavorite) {
          counts.skipped += 1;
          continue;
        }

        let currentUser: CleanupAuthUser | null;
        try {
          currentUser = await dependencies.getAuthUserById(candidate.id);
        } catch {
          counts.failed += 1;
          dependencies.logger.error(
            "inactive user verification failed",
            candidate.id,
          );
          continue;
        }
        if (!currentUser) {
          counts.skipped += 1;
          continue;
        }
        if (!isValidAuthUser(currentUser)) {
          counts.failed += 1;
          dependencies.logger.error(
            "inactive user verification returned invalid data",
            candidate.id,
          );
          continue;
        }
        if (!isEligible(currentUser, ownerId, cutoffTime)) {
          counts.skipped += 1;
          continue;
        }

        try {
          await dependencies.deleteAuthUser(candidate.id);
          counts.deleted += 1;
          dependencies.logger.info("inactive user deleted", candidate.id);
        } catch {
          counts.failed += 1;
          dependencies.logger.error(
            "inactive user deletion failed",
            candidate.id,
          );
        }
      }

      dependencies.logger.info("inactive account cleanup completed", {
        ...counts,
      });
      return jsonResponse(counts.failed === 0 ? 200 : 500, { ...counts });
    } catch (error) {
      dependencies.logger.error(
        "inactive account cleanup failed",
        error instanceof Error ? error.message : "unknown error",
      );
      return jsonResponse(500, { error: "Inactive account cleanup failed" });
    }
  };
}
