import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import {
  type CleanupAuthUser,
  type CleanupDependencies,
  createInactiveCleanupHandler,
} from "./handler.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const eligibleUserId = "22222222-2222-4222-8222-222222222222";
const recentUserId = "33333333-3333-4333-8333-333333333333";
const favoriteUserId = "44444444-4444-4444-8444-444444444444";
const noProfileUserId = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-11-01T03:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeDependencies(
  users: readonly CleanupAuthUser[] = [],
  overrides: Partial<CleanupDependencies> = {},
): CleanupDependencies {
  const deletedIds: string[] = [];
  return {
    verifyServiceRoleToken: async (token) =>
      token === "valid-service-role-token",
    getOwnerId: async () => ownerId,
    listAuthUsers: async (page) => page === 1 ? users : [],
    getAuthUserById: async (userId) =>
      users.find((user) => user.id === userId) ?? null,
    getProfileFavorite: async () => false,
    deleteAuthUser: async (userId) => {
      deletedIds.push(userId);
    },
    now: () => new Date(NOW),
    logger: { info: () => {}, error: () => {} },
    ...overrides,
  };
}

function postCleanup(
  token = "valid-service-role-token",
  body: Record<string, unknown> = {},
): Request {
  return new Request(
    "https://example.test/functions/v1/cleanup-inactive-users",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

Deno.test("deletes only users older than 30 days", async () => {
  const users: CleanupAuthUser[] = [
    { id: eligibleUserId, lastSignInAt: daysAgo(31) },
    { id: recentUserId, lastSignInAt: daysAgo(29) },
    {
      id: favoriteUserId,
      lastSignInAt: daysAgo(40),
    },
    { id: noProfileUserId, lastSignInAt: daysAgo(35) },
    { id: ownerId, lastSignInAt: daysAgo(60) },
    { id: "66666666-6666-4666-8666-666666666666", lastSignInAt: null },
  ];
  const deletedIds: string[] = [];
  const response = await createInactiveCleanupHandler(makeDependencies(users, {
    getProfileFavorite: async (userId) =>
      userId === favoriteUserId
        ? true
        : userId === noProfileUserId
        ? null
        : false,
    deleteAuthUser: async (userId) => {
      deletedIds.push(userId);
    },
  }))(postCleanup());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    scanned: 6,
    deleted: 1,
    skipped: 5,
    failed: 0,
  });
  assertEquals(deletedIds, [eligibleUserId]);
});

Deno.test("keeps the exact 30-day boundary eligible", async () => {
  const user = { id: eligibleUserId, lastSignInAt: daysAgo(30) };
  const deletedIds: string[] = [];
  const response = await createInactiveCleanupHandler(
    makeDependencies([user], {
      deleteAuthUser: async (userId) => {
        deletedIds.push(userId);
      },
    }),
  )(postCleanup());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    scanned: 1,
    deleted: 1,
    skipped: 0,
    failed: 0,
  });
  assertEquals(deletedIds, [eligibleUserId]);
});

Deno.test("skips candidates that sign in before deletion", async () => {
  const user = { id: eligibleUserId, lastSignInAt: daysAgo(31) };
  const deletedIds: string[] = [];
  const response = await createInactiveCleanupHandler(
    makeDependencies([user], {
      getAuthUserById: async () => ({
        id: eligibleUserId,
        lastSignInAt: daysAgo(1),
      }),
      deleteAuthUser: async (userId) => {
        deletedIds.push(userId);
      },
    }),
  )(postCleanup());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    scanned: 1,
    deleted: 0,
    skipped: 1,
    failed: 0,
  });
  assertEquals(deletedIds, []);
});

Deno.test("skips null sign-in dates", async () => {
  let checkedProfile = false;
  const response = await createInactiveCleanupHandler(
    makeDependencies([{ id: eligibleUserId, lastSignInAt: null }], {
      getProfileFavorite: async () => {
        checkedProfile = true;
        return false;
      },
    }),
  )(postCleanup());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    scanned: 1,
    deleted: 0,
    skipped: 1,
    failed: 0,
  });
  assertEquals(checkedProfile, false);
});

Deno.test("never deletes owner or favorites", async () => {
  const users = [
    { id: ownerId, lastSignInAt: daysAgo(60) },
    { id: favoriteUserId, lastSignInAt: daysAgo(45) },
  ];
  const deletedIds: string[] = [];
  const response = await createInactiveCleanupHandler(
    makeDependencies(users, {
      getProfileFavorite: async (userId) => userId === favoriteUserId,
      deleteAuthUser: async (userId) => {
        deletedIds.push(userId);
      },
    }),
  )(postCleanup());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    scanned: 2,
    deleted: 0,
    skipped: 2,
    failed: 0,
  });
  assertEquals(deletedIds, []);
});

Deno.test("skips users with no profile", async () => {
  const response = await createInactiveCleanupHandler(
    makeDependencies([{ id: noProfileUserId, lastSignInAt: daysAgo(31) }], {
      getProfileFavorite: async () => null,
    }),
  )(postCleanup());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    scanned: 1,
    deleted: 0,
    skipped: 1,
    failed: 0,
  });
});

Deno.test("rejects non-service-role tokens before enumeration", async () => {
  let enumerated = false;
  const response = await createInactiveCleanupHandler(
    makeDependencies([], {
      verifyServiceRoleToken: async () => false,
      listAuthUsers: async () => {
        enumerated = true;
        return [];
      },
    }),
  )(postCleanup("user-token"));

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "Service role required" });
  assertEquals(enumerated, false);
});

Deno.test("rejects user-selected IDs before resolving the owner", async () => {
  let ownerResolved = false;
  const response = await createInactiveCleanupHandler(
    makeDependencies([], {
      getOwnerId: async () => {
        ownerResolved = true;
        return ownerId;
      },
    }),
  )(postCleanup("valid-service-role-token", { userIds: [eligibleUserId] }));

  assertEquals(response.status, 400);
  assertEquals(
    await response.json(),
    { error: "User-selected IDs are not accepted" },
  );
  assertEquals(ownerResolved, false);
});

Deno.test("enumerates every Auth Admin page", async () => {
  const firstPage: CleanupAuthUser[] = Array.from(
    { length: 500 },
    (_, index) => ({
      id: `aaaaaaaa-bbbb-4ccc-8ddd-${index.toString().padStart(12, "0")}`,
      lastSignInAt: daysAgo(31),
    }),
  );
  const secondPage: CleanupAuthUser[] = [
    { id: eligibleUserId, lastSignInAt: daysAgo(31) },
  ];
  const deletedIds: string[] = [];
  const response = await createInactiveCleanupHandler(
    makeDependencies([], {
      listAuthUsers: async (page) => page === 1 ? firstPage : secondPage,
      getAuthUserById: async (userId) => ({
        id: userId,
        lastSignInAt: daysAgo(31),
      }),
      deleteAuthUser: async (userId) => {
        deletedIds.push(userId);
      },
    }),
  )(postCleanup());

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    scanned: 501,
    deleted: 501,
    skipped: 0,
    failed: 0,
  });
  assertEquals(deletedIds.length, 501);
});

Deno.test("reports delete failure without success-shaped fallback", async () => {
  const user = { id: eligibleUserId, lastSignInAt: daysAgo(31) };
  const logged: unknown[][] = [];
  const response = await createInactiveCleanupHandler(
    makeDependencies([user], {
      deleteAuthUser: async () => {
        throw new Error("delete failed");
      },
      logger: {
        info: () => {},
        error: (...args) => logged.push(args),
      },
    }),
  )(postCleanup());

  assertEquals(response.status, 500);
  const responseBody = await response.json();
  assertEquals(responseBody, {
    scanned: 1,
    deleted: 0,
    skipped: 0,
    failed: 1,
  });
  assertEquals(logged, [["inactive user deletion failed", eligibleUserId]]);
  assert(!JSON.stringify(responseBody).includes(eligibleUserId));
});
