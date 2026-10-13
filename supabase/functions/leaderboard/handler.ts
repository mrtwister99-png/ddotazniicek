export interface LeaderboardRow {
  userId: string;
  username: string | null;
  displayName: string | null;
  points: number;
}

export interface LeaderboardDependencies {
  getAuthenticatedUser(
    accessToken: string,
  ): Promise<{ id: string } | null>;
  listLeaderboardRows(): Promise<readonly LeaderboardRow[]>;
  logger: Pick<Console, "error">;
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
      "access-control-allow-methods": "GET, OPTIONS",
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

function compareText(left: string, right: string): number {
  const normalizedLeft = left.normalize("NFKC").toLowerCase();
  const normalizedRight = right.normalize("NFKC").toLowerCase();
  if (normalizedLeft < normalizedRight) {
    return -1;
  }
  if (normalizedLeft > normalizedRight) {
    return 1;
  }
  return 0;
}

function validateRow(row: LeaderboardRow): void {
  if (
    typeof row.userId !== "string" ||
    (row.username !== null && typeof row.username !== "string") ||
    (row.displayName !== null && typeof row.displayName !== "string") ||
    !Number.isFinite(row.points)
  ) {
    throw new Error("leaderboard query returned invalid data");
  }
}

function toPublicEntries(rows: readonly LeaderboardRow[]) {
  const ordered = [...rows];
  for (const row of ordered) {
    validateRow(row);
  }
  ordered.sort((left, right) => {
    if (left.points !== right.points) {
      return right.points - left.points;
    }
    const nameOrder = compareText(
      left.displayName ?? left.username ?? "",
      right.displayName ?? right.username ?? "",
    );
    if (nameOrder !== 0) {
      return nameOrder;
    }
    const usernameOrder = compareText(
      left.username ?? "",
      right.username ?? "",
    );
    return usernameOrder !== 0
      ? usernameOrder
      : compareText(left.userId, right.userId);
  });

  return ordered.map((row, index) => ({
    rank: index + 1,
    username: row.username,
    display_name: row.displayName,
    points: row.points,
  }));
}

export function createLeaderboardHandler(
  dependencies: LeaderboardDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers":
            "authorization, apikey, content-type, x-client-info",
          "access-control-allow-methods": "GET, OPTIONS",
        },
      });
    }
    if (request.method !== "GET") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const accessToken = getBearerToken(request);
    if (!accessToken || accessToken.length > 8192) {
      return jsonResponse(401, { error: "Authentication required" });
    }

    try {
      const user = await dependencies.getAuthenticatedUser(accessToken);
      if (!user) {
        return jsonResponse(401, { error: "Authentication required" });
      }

      const rows = await dependencies.listLeaderboardRows();
      return jsonResponse(200, { entries: toPublicEntries(rows) });
    } catch (error) {
      dependencies.logger.error("leaderboard request failed", error);
      return jsonResponse(500, { error: "Unable to load leaderboard" });
    }
  };
}
