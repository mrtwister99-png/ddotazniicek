import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_SIZE = 100;
const EXPECTED_ADMIN_EMAIL = "admin@dotaznicek.local";
const EXPECTED_ADMIN_USERNAME = "admin";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredValue(environment, key) {
  const value = environment[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadAdminSeedConfig(environment = process.env) {
  const supabaseUrl =
    environment.SUPABASE_URL || environment.EXPO_PUBLIC_SUPABASE_URL;
  if (typeof supabaseUrl !== "string" || supabaseUrl.length === 0) {
    throw new Error("Missing required environment variable: SUPABASE_URL");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL must be an absolute URL");
  }
  const isLocalHttp =
    parsedUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== "https:" && !isLocalHttp) {
    throw new Error("SUPABASE_URL must use HTTPS outside local development");
  }
  if (parsedUrl.search || parsedUrl.hash) {
    throw new Error("SUPABASE_URL must not contain a query or fragment");
  }

  const email = requiredValue(environment, "ADMIN_SEED_EMAIL");
  const username = requiredValue(environment, "ADMIN_SEED_USERNAME");
  const role = requiredValue(environment, "ADMIN_SEED_ROLE");
  if (email !== EXPECTED_ADMIN_EMAIL) {
    throw new Error(`ADMIN_SEED_EMAIL must be ${EXPECTED_ADMIN_EMAIL}`);
  }
  if (username !== EXPECTED_ADMIN_USERNAME) {
    throw new Error(`ADMIN_SEED_USERNAME must be ${EXPECTED_ADMIN_USERNAME}`);
  }
  if (role !== "admin") {
    throw new Error("ADMIN_SEED_ROLE must be admin");
  }

  return {
    supabaseUrl: parsedUrl.toString().replace(/\/+$/, ""),
    serviceRoleKey: requiredValue(environment, "SUPABASE_SERVICE_ROLE_KEY"),
    email,
    username,
    role,
    password: requiredValue(environment, "ADMIN_SEED_PASSWORD"),
  };
}

function readAuthUser(value) {
  const user = isRecord(value) && isRecord(value.user) ? value.user : value;
  if (!isRecord(user) || typeof user.id !== "string") {
    throw new Error("Supabase Auth returned an invalid user record");
  }
  return {
    id: user.id,
    email: typeof user.email === "string" ? user.email : "",
    app_metadata: isRecord(user.app_metadata) ? user.app_metadata : {},
    user_metadata: isRecord(user.user_metadata) ? user.user_metadata : {},
  };
}

export function createAdminApi({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = fetch,
}) {
  async function request(path, { method = "GET", body, prefer } = {}) {
    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (prefer) {
      headers.Prefer = prefer;
    }

    const url = `${supabaseUrl}${path}`;
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error("Supabase request failed before receiving a response");
    }
    if (!response.ok) {
      throw new Error(`Supabase request failed with HTTP ${response.status}`);
    }
    if (response.status === 204) {
      return null;
    }
    try {
      const responseText = await response.text();
      return responseText.trim() === "" ? null : JSON.parse(responseText);
    } catch {
      throw new Error("Supabase returned an invalid response");
    }
  }

  return {
    async findAuthUserByEmail(email) {
      for (let page = 1; ; page += 1) {
        const result = await request(
          `/auth/v1/admin/users?page=${page}&per_page=${PAGE_SIZE}`,
        );
        if (!isRecord(result) || !Array.isArray(result.users)) {
          throw new Error("Supabase Auth returned an invalid user list");
        }
        const match = result.users
          .map(readAuthUser)
          .find((user) => user.email.toLowerCase() === email.toLowerCase());
        if (match) {
          return match;
        }
        if (result.users.length < PAGE_SIZE) {
          return null;
        }
      }
    },

    async findProfileIdByUsername(username) {
      const query = new URLSearchParams({
        select: "id",
        username_normalized: `eq.${username.toLowerCase()}`,
        limit: "2",
      });
      const result = await request(`/rest/v1/profiles?${query}`);
      if (
        !Array.isArray(result) ||
        result.some(
          (profile) => !isRecord(profile) || typeof profile.id !== "string",
        )
      ) {
        throw new Error("Supabase returned an invalid profile lookup");
      }
      if (result.length > 1) {
        throw new Error("The configured admin username is not unique");
      }
      return result[0]?.id ?? null;
    },

    async createAuthUser(attributes) {
      const result = await request("/auth/v1/admin/users", {
        method: "POST",
        body: attributes,
      });
      return readAuthUser(result);
    },

    async updateAuthUser(userId, attributes) {
      const result = await request(
        `/auth/v1/admin/users/${encodeURIComponent(userId)}`,
        { method: "PUT", body: attributes },
      );
      return readAuthUser(result);
    },

    async upsertProfileUsername(userId, username) {
      await request("/rest/v1/profiles?on_conflict=id", {
        method: "POST",
        body: { id: userId, username },
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    },

    async grantAdminRole(userId) {
      await request("/rest/v1/rpc/grant_admin_role", {
        method: "POST",
        body: { p_user_id: userId },
      });
    },
  };
}

export async function seedAdminAccount(config, api) {
  const existingUser = await api.findAuthUserByEmail(config.email);
  if (existingUser?.app_metadata.dotaznicek_admin_owner === true) {
    throw new Error("Refusing to overwrite the singleton owner account");
  }

  const existingUsernameOwner = await api.findProfileIdByUsername(
    config.username,
  );
  if (existingUsernameOwner && existingUsernameOwner !== existingUser?.id) {
    throw new Error("The configured admin username is already in use");
  }

  const attributes = {
    email: config.email,
    password: config.password,
    email_confirm: true,
    app_metadata: {
      ...existingUser?.app_metadata,
      role: config.role,
    },
    user_metadata: {
      ...existingUser?.user_metadata,
      username: config.username,
    },
  };
  const user = existingUser
    ? await api.updateAuthUser(existingUser.id, attributes)
    : await api.createAuthUser(attributes);
  if (!user || typeof user.id !== "string" || user.id.length === 0) {
    throw new Error("Supabase Auth did not return the seeded account");
  }

  await api.upsertProfileUsername(user.id, config.username);
  await api.grantAdminRole(user.id);

  return {
    id: user.id,
    email: config.email,
    username: config.username,
    role: config.role,
  };
}

async function main() {
  const config = loadAdminSeedConfig();
  const result = await seedAdminAccount(config, createAdminApi(config));
  console.info(
    `Admin account is ready: ${result.email} (${result.username}, ${result.role})`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    const message =
      error instanceof Error ? error.message : "Unknown seed failure";
    console.error(`Admin seed failed: ${message}`);
    process.exitCode = 1;
  });
}
