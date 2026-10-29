import assert from "node:assert/strict";
import test from "node:test";
import { createTestEnvironment, testProjectRef, verifyTestConnection } from "../scripts/driver-pwa-dev.mjs";

const config = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${testProjectRef}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture",
};
const jwt = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;

test("accepts only the selected isolated project's exact HTTPS URL", () => {
  assert.equal(createTestEnvironment(config).DRIVER_PWA_TEST_MODE, testProjectRef);
  for (const url of [
    "https://acuhvzpsitnevfztbbtv.supabase.co",
    `http://${testProjectRef}.supabase.co`,
    `${config.NEXT_PUBLIC_SUPABASE_URL}/`,
    `${config.NEXT_PUBLIC_SUPABASE_URL}.example.com`,
    `https://user@${testProjectRef}.supabase.co`,
    "",
  ]) {
    assert.throws(() => createTestEnvironment({ ...config, NEXT_PUBLIC_SUPABASE_URL: url }), /startup refused/);
  }
});

test("blocks missing, placeholder, secret, mismatched and elevated legacy keys", () => {
  for (const key of [
    "", "REPLACE_WITH_TEST_KEY", "sb_secret_fixture", "invalid",
    jwt({ role: "service_role", ref: testProjectRef }),
    jwt({ role: "anon", ref: "acuhvzpsitnevfztbbtv" }),
  ]) {
    assert.throws(() => createTestEnvironment({ ...config, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }));
  }
  const key = jwt({ role: "anon", ref: testProjectRef });
  assert.equal(createTestEnvironment({ ...config, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }).NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, key);
});

test("rejects privileged or unknown configuration variables", () => {
  for (const name of ["DATABASE_URL", "NODE_OPTIONS"]) {
    assert.throws(() => createTestEnvironment({ ...config, [name]: "fixture" }), /Unsupported/);
  }
});
test("optional admin credentials must be explicitly configured for the isolated project, never inherited", async () => {
  for (const key of ["fixture", jwt({ role: "anon", ref: testProjectRef }), jwt({ role: "service_role", ref: "acuhvzpsitnevfztbbtv" })])
    assert.throws(() => createTestEnvironment({ ...config, SUPABASE_SERVICE_ROLE_KEY: key }));
  const key = jwt({ role: "service_role", ref: testProjectRef });
  const environment = createTestEnvironment({ ...config, SUPABASE_SERVICE_ROLE_KEY: key }, { SUPABASE_SERVICE_ROLE_KEY: "production-secret" });
  assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, key);
  let calls = 0;
  await verifyTestConnection(environment, async (url, options) => {
    calls++;
    assert.ok(url.startsWith(`https://${testProjectRef}.supabase.co/auth/v1/`));
    if (url.includes("/admin/users")) assert.equal(options.headers.Authorization, `Bearer ${key}`);
    return { ok: true };
  });
  assert.equal(calls, 2);
  await assert.rejects(verifyTestConnection(environment, async url => ({ ok: !url.includes("/admin/users"), status: 401 })), /optional admin key/);
});

test("scrubs production environment and dotenv fallbacks without modifying inputs", () => {
  const inherited = {
    PATH: "keep-path",
    SUPABASE_SERVICE_ROLE_KEY: "production-secret",
    DATABASE_URL: "production-db",
    VERCEL_OIDC_TOKEN: "production-token",
    NEXT_PUBLIC_SUPABASE_URL: "production-host",
  };
  const before = { ...inherited };
  const result = createTestEnvironment(config, inherited, [
    'SUPABASE_SERVICE_ROLE_KEY=dotenv-secret\nDELETE_CONFIRMATION_PASSWORD=password\nCUSTOM_BACKEND_TOKEN=secret\n',
  ]);
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "VERCEL_OIDC_TOKEN", "DELETE_CONFIRMATION_PASSWORD", "CUSTOM_BACKEND_TOKEN"]) {
    assert.equal(result[name], "");
  }
  assert.equal(result.PATH, "keep-path");
  assert.equal(result.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(result.NODE_ENV, "development");
  assert.deepEqual(inherited, before);
});

test("checks modern key against only the selected project's Auth endpoint", async () => {
  let calls = 0;
  await verifyTestConnection(createTestEnvironment(config), async (url, options) => {
    calls++;
    assert.equal(url, `https://${testProjectRef}.supabase.co/auth/v1/settings`);
    assert.equal(options.headers.apikey, config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true };
  });
  assert.equal(calls, 1);
  await assert.rejects(
    verifyTestConnection(createTestEnvironment(config), async () => ({ ok: false, status: 401 })),
    /rejected.*401/,
  );
  await assert.rejects(
    verifyTestConnection(createTestEnvironment(config), async () => { throw new Error("Network unavailable"); }),
    /Network unavailable/,
  );
});
