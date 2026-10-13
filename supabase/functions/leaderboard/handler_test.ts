import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import {
  createLeaderboardHandler,
  type LeaderboardDependencies,
  type LeaderboardRow,
} from "./handler.ts";

function makeDependencies(
  overrides: Partial<LeaderboardDependencies> = {},
): LeaderboardDependencies {
  return {
    getAuthenticatedUser: async (token) =>
      token === "valid-token" ? { id: "caller-id" } : null,
    listLeaderboardRows: async () => [],
    logger: { error: () => {} },
    ...overrides,
  };
}

function getRequest(token?: string): Request {
  return new Request("https://example.test/functions/v1/leaderboard", {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

Deno.test("rejects requests without a valid Auth user", async () => {
  let listedRows = false;
  const handler = createLeaderboardHandler(makeDependencies({
    getAuthenticatedUser: async () => null,
    listLeaderboardRows: async () => {
      listedRows = true;
      return [];
    },
  }));

  const response = await handler(getRequest("invalid-token"));

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "Authentication required" });
  assertEquals(listedRows, false);
});

Deno.test("returns only rank names and aggregate points", async () => {
  const rows: LeaderboardRow[] = [
    {
      userId: "user-z",
      username: "zeta",
      displayName: "Zed",
      points: 4,
    },
    {
      userId: "user-b",
      username: "bee",
      displayName: "Bea",
      points: 12,
    },
    {
      userId: "user-a",
      username: "alex",
      displayName: "Alex",
      points: 12,
    },
  ];
  const response = await createLeaderboardHandler(
    makeDependencies({ listLeaderboardRows: async () => rows }),
  )(getRequest("valid-token"));

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, {
    entries: [
      { rank: 1, username: "alex", display_name: "Alex", points: 12 },
      { rank: 2, username: "bee", display_name: "Bea", points: 12 },
      { rank: 3, username: "zeta", display_name: "Zed", points: 4 },
    ],
  });
  assertEquals(Object.keys(body.entries[0]).sort(), [
    "display_name",
    "points",
    "rank",
    "username",
  ]);
  assert(!JSON.stringify(body).includes("userId"));
  assert(!JSON.stringify(body).includes("email"));
  assert(!JSON.stringify(body).includes("answers"));
});

Deno.test("includes profiles with zero points", async () => {
  const rows: LeaderboardRow[] = [
    { userId: "user-zero", username: "new", displayName: null, points: 0 },
    { userId: "user-points", username: "star", displayName: "Star", points: 3 },
  ];
  const response = await createLeaderboardHandler(
    makeDependencies({ listLeaderboardRows: async () => rows }),
  )(getRequest("valid-token"));

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.entries[0].points, 3);
  assertEquals(body.entries[1], {
    rank: 2,
    username: "new",
    display_name: null,
    points: 0,
  });
});

Deno.test("returns an empty list when there are no profiles", async () => {
  const response = await createLeaderboardHandler(makeDependencies())(
    getRequest("valid-token"),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { entries: [] });
});
