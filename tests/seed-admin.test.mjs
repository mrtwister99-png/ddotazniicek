import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAdminApi,
  loadAdminSeedConfig,
  seedAdminAccount,
} from '../scripts/seed-admin.mjs';

const config = {
  supabaseUrl: 'https://project.example.test',
  serviceRoleKey: 'test-service-role',
  email: 'admin@dotaznicek.local',
  username: 'admin',
  role: 'admin',
  password: 'not-a-real-password-for-tests',
};

test('loads the configured admin seed values without defaulting the password', () => {
  assert.deepEqual(
    loadAdminSeedConfig({
      SUPABASE_URL: config.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
      ADMIN_SEED_EMAIL: config.email,
      ADMIN_SEED_USERNAME: config.username,
      ADMIN_SEED_ROLE: config.role,
      ADMIN_SEED_PASSWORD: config.password,
    }),
    config,
  );

  assert.throws(
    () =>
      loadAdminSeedConfig({
        SUPABASE_URL: config.supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
        ADMIN_SEED_EMAIL: config.email,
        ADMIN_SEED_USERNAME: config.username,
        ADMIN_SEED_ROLE: config.role,
      }),
    /ADMIN_SEED_PASSWORD/,
  );
});

test('uses the app Supabase URL when the private seed URL is left blank', () => {
  assert.equal(
    loadAdminSeedConfig({
      SUPABASE_URL: '',
      EXPO_PUBLIC_SUPABASE_URL: config.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
      ADMIN_SEED_EMAIL: config.email,
      ADMIN_SEED_USERNAME: config.username,
      ADMIN_SEED_ROLE: config.role,
      ADMIN_SEED_PASSWORD: config.password,
    }).supabaseUrl,
    config.supabaseUrl,
  );
});

test('sends the password only to Auth Admin API and handles empty REST responses', async () => {
  const requests = [];
  const replies = [
    new Response(JSON.stringify({ users: [] }), { status: 200 }),
    new Response('[]', { status: 200 }),
    new Response(JSON.stringify({
      id: 'user-2',
      email: config.email,
      app_metadata: { role: 'admin' },
      user_metadata: { username: 'admin' },
    }), { status: 201 }),
    new Response(null, { status: 201 }),
    new Response(null, { status: 204 }),
  ];
  const api = createAdminApi({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return replies.shift();
    },
  });

  const user = await api.findAuthUserByEmail(config.email);
  assert.equal(user, null);
  assert.equal(await api.findProfileIdByUsername(config.username), null);
  const created = await api.createAuthUser({
    email: config.email,
    password: config.password,
    email_confirm: true,
    app_metadata: { role: 'admin' },
    user_metadata: { username: 'admin' },
  });
  await api.upsertProfileUsername(created.id, config.username);
  await api.grantAdminRole(created.id);

  assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
    '/auth/v1/admin/users',
    '/rest/v1/profiles',
    '/auth/v1/admin/users',
    '/rest/v1/profiles',
    '/rest/v1/rpc/grant_admin_role',
  ]);
  assert.equal(
    new URL(requests[0].url).searchParams.get('per_page'),
    '1000',
  );
  assert.equal(requests[2].options.headers.Authorization, 'Bearer test-service-role');
  assert.equal(
    JSON.parse(requests[2].options.body).password,
    config.password,
  );
  assert.deepEqual(JSON.parse(requests[3].options.body), {
    id: 'user-2',
    username: 'admin',
  });
  assert.equal(
    JSON.stringify(requests.slice(3).map(({ options }) => options.body))
      .includes(config.password),
    false,
  );
});

test('does not expose Auth API error bodies in thrown errors', async () => {
  const api = createAdminApi({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    fetchImpl: async () =>
      new Response('sensitive response body', { status: 500 }),
  });

  await assert.rejects(
    api.findAuthUserByEmail(config.email),
    (error) => {
      assert.match(error.message, /HTTP 500/);
      assert.doesNotMatch(error.message, /sensitive response body/);
      return true;
    },
  );
});

test('creates an Auth user then synchronizes profile username and admin role', async () => {
  const calls = [];
  const api = {
    findAuthUserByEmail: async (email) => {
      calls.push(['findAuthUserByEmail', email]);
      return null;
    },
    findProfileIdByUsername: async (username) => {
      calls.push(['findProfileIdByUsername', username]);
      return null;
    },
    createAuthUser: async (attributes) => {
      calls.push(['createAuthUser', attributes]);
      return {
        id: 'user-1',
        app_metadata: attributes.app_metadata,
        user_metadata: attributes.user_metadata,
      };
    },
    updateAuthUser: async () => {
      assert.fail('a new account should not be updated');
    },
    upsertProfileUsername: async (userId, username) => {
      calls.push(['upsertProfileUsername', userId, username]);
    },
    grantAdminRole: async (userId) => {
      calls.push(['grantAdminRole', userId]);
    },
  };

  const result = await seedAdminAccount(config, api);

  assert.deepEqual(result, {
    id: 'user-1',
    email: config.email,
    username: config.username,
    role: 'admin',
  });
  assert.deepEqual(calls.map(([name]) => name), [
    'findAuthUserByEmail',
    'findProfileIdByUsername',
    'createAuthUser',
    'upsertProfileUsername',
    'grantAdminRole',
  ]);
  assert.deepEqual(calls[2][1], {
    email: config.email,
    password: config.password,
    email_confirm: true,
    app_metadata: { role: 'admin' },
    user_metadata: { username: 'admin' },
  });
});

test('updates an existing admin idempotently while preserving server metadata', async () => {
  let updatedAttributes;
  let grantedUserId;
  const existingUser = {
    id: 'existing-user',
    email: config.email,
    app_metadata: {
      provider: 'email',
      providers: ['email'],
      existing_server_flag: true,
    },
    user_metadata: { username: 'old-name' },
  };
  const api = {
    findAuthUserByEmail: async () => existingUser,
    findProfileIdByUsername: async () => existingUser.id,
    updateAuthUser: async (userId, attributes) => {
      assert.equal(userId, existingUser.id);
      updatedAttributes = attributes;
      return { ...existingUser, ...attributes };
    },
    createAuthUser: async () => {
      assert.fail('an existing account should not be recreated');
    },
    upsertProfileUsername: async (userId, username) => {
      assert.equal(userId, existingUser.id);
      assert.equal(username, config.username);
    },
    grantAdminRole: async (userId) => {
      grantedUserId = userId;
    },
  };

  await seedAdminAccount(config, api);

  assert.equal(updatedAttributes.app_metadata.role, 'admin');
  assert.equal(updatedAttributes.app_metadata.existing_server_flag, true);
  assert.deepEqual(updatedAttributes.user_metadata, { username: 'admin' });
  assert.equal(grantedUserId, existingUser.id);
});

test('refuses to claim a username owned by a different Auth user', async () => {
  let authWriteAttempted = false;
  const api = {
    findAuthUserByEmail: async () => null,
    findProfileIdByUsername: async () => 'different-user',
    createAuthUser: async () => {
      authWriteAttempted = true;
      throw new Error('must not create');
    },
    updateAuthUser: async () => {
      authWriteAttempted = true;
      throw new Error('must not update');
    },
    upsertProfileUsername: async () => {},
    grantAdminRole: async () => {},
  };

  await assert.rejects(seedAdminAccount(config, api), /username.*already/);
  assert.equal(authWriteAttempted, false);
});

test('refuses to overwrite the singleton owner', async () => {
  const api = {
    findAuthUserByEmail: async () => ({
      id: 'owner-user',
      email: config.email,
      app_metadata: { dotaznicek_admin_owner: true },
      user_metadata: {},
    }),
    findProfileIdByUsername: async () => 'owner-user',
    createAuthUser: async () => assert.fail('must not create'),
    updateAuthUser: async () => assert.fail('must not update'),
    upsertProfileUsername: async () => assert.fail('must not update profile'),
    grantAdminRole: async () => assert.fail('must not change owner role'),
  };

  await assert.rejects(seedAdminAccount(config, api), /owner account/);
});
