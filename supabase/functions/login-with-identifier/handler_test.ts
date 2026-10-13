import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { createLoginHandler, type LoginDependencies } from "./handler.ts";

const session = { access_token: "access-token" };
const user = { id: "user-id" };
const secret = "test-admin-secret-with-at-least-32-bytes";

function makeDependencies(
  overrides: Partial<LoginDependencies> = {},
): LoginDependencies {
  return {
    adminLoginSecret: secret,
    consumeRateLimit: async () => true,
    findUsernameEmail: async () => "user@example.test",
    getOwnerId: async () => null,
    findAdminAuthUser: async () => null,
    createAdminAuthUser: async () => ({ id: "owner-id" }),
    updateAdminAuthUser: async () => {},
    bootstrapAdminOwner: async () => {},
    signIn: async () => ({ session, user }),
    logger: { info: () => {}, error: () => {} },
    ...overrides,
  };
}

async function postLogin(
  identifier: string,
  password: string,
  ip = "127.0.0.1",
) {
  return await createLoginHandler(makeDependencies())(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": ip,
      },
      body: JSON.stringify({ identifier, password }),
    }),
  );
}

Deno.test("blank identifier and the server secret provision an owner session", async () => {
  const calls: string[] = [];
  const handler = createLoginHandler(makeDependencies({
    getOwnerId: async () => {
      calls.push("get-owner");
      return null;
    },
    createAdminAuthUser: async (email, password) => {
      calls.push(
        `create:${email.endsWith("@dotaznicek.invalid")}:${
          password === secret
        }`,
      );
      return { id: "owner-id" };
    },
    bootstrapAdminOwner: async (id) => {
      calls.push(`bootstrap:${id}`);
    },
    signIn: async (email, password) => {
      calls.push(
        `sign-in:${email.endsWith("@dotaznicek.invalid")}:${
          password === secret
        }`,
      );
      return { session, user };
    },
  }));
  const response = await handler(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.1",
      },
      body: JSON.stringify({ identifier: "  ", password: secret }),
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { session, user });
  assertEquals(calls, [
    "get-owner",
    "create:true:true",
    "bootstrap:owner-id",
    "sign-in:true:true",
  ]);
});

Deno.test("wrong admin secret returns the generic auth error without provisioning", async () => {
  let provisioned = false;
  const response = await createLoginHandler(makeDependencies({
    getOwnerId: async () => {
      provisioned = true;
      return null;
    },
  }))(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.2",
      },
      body: JSON.stringify({ identifier: "", password: "wrong" }),
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: "Invalid identifier or password",
  });
  assertEquals(provisioned, false);
});

Deno.test("an undersized configured admin secret is treated as server misconfiguration", async () => {
  const logged: string[] = [];
  const handler = createLoginHandler(makeDependencies({
    adminLoginSecret: "short",
    logger: {
      info: (message) => logged.push(message),
      error: (message) => logged.push(message),
    },
  }));
  const response = await handler(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.5",
      },
      body: JSON.stringify({ identifier: "", password: "short" }),
    }),
  );

  assertEquals(response.status, 503);
  assertEquals(logged, [
    "admin login attempt",
    "admin login unavailable",
    "login service unavailable",
  ]);
  assert(!logged.join(" ").includes("short"));
});

Deno.test("a secret in a non-empty identifier never takes the admin branch", async () => {
  const calls: string[] = [];
  const handler = createLoginHandler(makeDependencies({
    findUsernameEmail: async (username) => {
      calls.push(`lookup:${username}`);
      return null;
    },
    getOwnerId: async () => {
      calls.push("owner");
      return null;
    },
    signIn: async (email) => {
      calls.push(`sign-in:${email}`);
      return null;
    },
  }));
  const response = await handler(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.3",
      },
      body: JSON.stringify({ identifier: secret, password: secret }),
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: "Invalid identifier or password",
  });
  assertEquals(calls.length, 2);
  assert(!calls.some((call) => call === "owner"));
});

Deno.test("the internal owner Auth email cannot log in through the normal branch", async () => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  const hash = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  let signInAttempted = false;
  const handler = createLoginHandler(makeDependencies({
    signIn: async () => {
      signInAttempted = true;
      return { session, user };
    },
  }));
  const response = await handler(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.12",
      },
      body: JSON.stringify({
        identifier: `admin-${hash}@dotaznicek.invalid`,
        password: secret,
      }),
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: "Invalid identifier or password",
  });
  assertEquals(signInAttempted, false);
});

Deno.test("username login resolves privately then authenticates through Supabase Auth", async () => {
  const calls: string[] = [];
  const handler = createLoginHandler(makeDependencies({
    findUsernameEmail: async (username) => {
      calls.push(`lookup:${username}`);
      return "private@example.test";
    },
    signIn: async (email, password) => {
      calls.push(`sign-in:${email}:${password}`);
      return { session, user };
    },
  }));
  const response = await handler(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.6",
      },
      body: JSON.stringify({
        identifier: "  MiXed   Name ",
        password: "user-password",
      }),
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(calls, [
    "lookup:mixed name",
    "sign-in:private@example.test:user-password",
  ]);
});

Deno.test("email login bypasses username lookup and normalizes the e-mail", async () => {
  const calls: string[] = [];
  const handler = createLoginHandler(makeDependencies({
    findUsernameEmail: async () => {
      calls.push("username-lookup");
      return null;
    },
    signIn: async (email) => {
      calls.push(`sign-in:${email}`);
      return { session, user };
    },
  }));
  const response = await handler(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.8",
      },
      body: JSON.stringify({
        identifier: " Test.User@Example.Test ",
        password: "user-password",
      }),
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(calls, ["sign-in:test.user@example.test"]);
});

Deno.test("rate limits admin attempts before provisioning", async () => {
  let lookedUp = false;
  let attemptedBuckets: readonly string[] = [];
  const handler = createLoginHandler(makeDependencies({
    consumeRateLimit: async (buckets) => {
      attemptedBuckets = buckets;
      return false;
    },
    findUsernameEmail: async () => {
      lookedUp = true;
      return null;
    },
  }));
  const response = await handler(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.4",
      },
      body: JSON.stringify({ identifier: "", password: secret }),
    }),
  );

  assertEquals(response.status, 429);
  assertEquals(attemptedBuckets.length, 1);
  assert(attemptedBuckets.every((bucket) => /^[0-9a-f]{64}$/.test(bucket)));
  assertEquals(lookedUp, false);
});

Deno.test(
  "login fails closed when the edge runtime provides no rate-limit IP",
  async () => {
    let rateLimited = false;
    const response = await createLoginHandler(makeDependencies({
      consumeRateLimit: async () => {
        rateLimited = true;
        return true;
      },
    }))(
      new Request("https://example.test/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: "", password: secret }),
      }),
    );

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      error: "Unable to sign in right now",
    });
    assertEquals(rateLimited, false);
  },
);

Deno.test("invalid credentials and unknown identifiers have the same public response", async () => {
  const makeResponse = (email: string | null) =>
    createLoginHandler(makeDependencies({
      findUsernameEmail: async () => email,
      signIn: async () => null,
    }))(
      new Request("https://example.test/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.10",
        },
        body: JSON.stringify({ identifier: "name", password: "bad-password" }),
      }),
    );

  const unknown = await makeResponse(null);
  const wrongPassword = await makeResponse("private@example.test");
  assertEquals(unknown.status, wrongPassword.status);
  assertEquals(await unknown.json(), await wrongPassword.json());
});

Deno.test("admin auth-email collision is rejected unless the account is marked as the owner", async () => {
  const handler = createLoginHandler(makeDependencies({
    findAdminAuthUser: async () => ({
      id: "unmarked-id",
      isMarkedOwner: false,
    }),
  }));
  const response = await handler(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.11",
      },
      body: JSON.stringify({ identifier: "", password: secret }),
    }),
  );

  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: "Unable to sign in right now" });
});

Deno.test("secret rotation preserves the owner Auth UUID", async () => {
  const rotatedSecret = `${secret}-rotated`;
  const calls: string[] = [];
  const handler = createLoginHandler(makeDependencies({
    adminLoginSecret: rotatedSecret,
    getOwnerId: async () => "existing-owner-id",
    updateAdminAuthUser: async (id, email, password) => {
      calls.push(
        `update:${id}:${email.endsWith("@dotaznicek.invalid")}:${password}`,
      );
    },
    bootstrapAdminOwner: async (id) => {
      calls.push(`bootstrap:${id}`);
    },
    signIn: async (email, password) => {
      calls.push(
        `sign-in:${email.endsWith("@dotaznicek.invalid")}:${password}`,
      );
      return { session, user };
    },
  }));
  const response = await handler(
    new Request("https://example.test/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.9",
      },
      body: JSON.stringify({ identifier: "", password: rotatedSecret }),
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(calls, [
    `update:existing-owner-id:true:${rotatedSecret}`,
    "bootstrap:existing-owner-id",
    `sign-in:true:${rotatedSecret}`,
  ]);
});

Deno.test("malformed and oversized login requests are rejected", async () => {
  const malformed = await postLogin("", "");
  assertEquals(malformed.status, 400);

  const oversized = await createLoginHandler(makeDependencies())(
    new Request("https://example.test/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: "a".repeat(9000), password: "x" }),
    }),
  );
  assertEquals(oversized.status, 400);
});

Deno.test("CORS preflight returns an empty 204 response", async () => {
  const response = await createLoginHandler(makeDependencies())(
    new Request("https://example.test/login", { method: "OPTIONS" }),
  );

  assertEquals(response.status, 204);
  assertEquals(await response.text(), "");
  assertEquals(
    response.headers.get("access-control-allow-methods"),
    "POST, OPTIONS",
  );
});
