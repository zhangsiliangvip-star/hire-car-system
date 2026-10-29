import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(relative, mocks = {}, environment = process.env) {
  const filename = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(output, {
    exports: compiledModule.exports, module: compiledModule,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    process: { ...process, env: environment }, Response, Headers, URL,
    console: { error() {} },
  }, { filename });
  return compiledModule.exports;
}
const runtime = load("lib/driver/test-runtime.ts");
const validEnvironment = {
  DRIVER_PWA_TEST_MODE: "zsipqwipauzgbqvppwjf",
  NEXT_PUBLIC_SUPABASE_URL: "https://zsipqwipauzgbqvppwjf.supabase.co",
};
const jsonResponse = (body, init = {}) => Response.json(body, {
  ...init,
  headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" },
});

test("driver feature is off by default and cannot activate against production", () => {
  assert.equal(runtime.isDriverPwaTestMode(validEnvironment), true);
  assert.equal(runtime.isDriverPwaEnabled({}), false);
  assert.equal(runtime.isDriverPwaEnabled(validEnvironment), true);
  for (const environment of [
    { ...validEnvironment, NEXT_PUBLIC_SUPABASE_URL: "https://acuhvzpsitnevfztbbtv.supabase.co" },
    { ...validEnvironment, DRIVER_PWA_TEST_MODE: "true" },
  ]) assert.throws(() => runtime.isDriverPwaEnabled(environment), /isolated/);
  for (const pathname of ["/driver", "/driver/orders/1", "/api/driver", "/api/driver/me"]) {
    assert.equal(runtime.isDriverPath(pathname), true);
  }
  for (const pathname of ["/drivers", "/driver-admin", "/api/driver-wages", "/api/data", "/"]) {
    assert.equal(runtime.isDriverPath(pathname), false);
  }
});

test("production activation is explicit, project-bound, and mutually exclusive with test mode", () => {
  const production = {
    DRIVER_PWA_PRODUCTION_PROJECT: "acuhvzpsitnevfztbbtv",
    NEXT_PUBLIC_SUPABASE_URL: "https://acuhvzpsitnevfztbbtv.supabase.co",
  };
  assert.equal(runtime.isDriverPwaEnabled(production), true);
  assert.equal(runtime.isDriverPwaTestMode(production), false);
  assert.equal(runtime.isDriverPwaEnabled({ NEXT_PUBLIC_SUPABASE_URL: production.NEXT_PUBLIC_SUPABASE_URL }), false);
  for (const environment of [
    { ...production, DRIVER_PWA_PRODUCTION_PROJECT: "true" },
    { ...production, NEXT_PUBLIC_SUPABASE_URL: validEnvironment.NEXT_PUBLIC_SUPABASE_URL },
    { ...validEnvironment, DRIVER_PWA_PRODUCTION_PROJECT: production.DRIVER_PWA_PRODUCTION_PROJECT },
    { ...production, DRIVER_PWA_TEST_MODE: validEnvironment.DRIVER_PWA_TEST_MODE },
  ]) assert.throws(() => runtime.isDriverPwaEnabled(environment));
  assert.throws(() => runtime.isDriverPwaTestMode({ ...validEnvironment, NEXT_PUBLIC_SUPABASE_URL: production.NEXT_PUBLIC_SUPABASE_URL }));
});
async function me({ enabled = true, user = { id: "self" }, authError = null,
  data = [], error = null, greetings = { globalSlogan: "Welcome", personalSlogan: "Hello" },
  greetingError = null } = {}) {
  let created = 0;
  let calledRpc = false;
  const mocks = {
    "server-only": {},
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => enabled },
    "@/lib/supabase/server": {
      createClient: async () => {
        created++;
        return {
          auth: { getUser: async () => ({ data: { user }, error: authError }) },
          rpc: async (name) => {
            if (name === "driver_portal_greetings") return { data: greetings, error: greetingError };
            assert.equal(name, "driver_identity");
            calledRpc = true;
            return { data, error };
          },
        };
      },
    },
  };
  const authorization = load("lib/driver/authorization.ts", mocks);
  const route = load("app/api/driver/me/route.ts", {
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/authorization": authorization,
  });
  return { response: await route.GET(), created, calledRpc };
}

test("identity endpoint is disabled outside test mode without touching Auth", async () => {
  const result = await me({ enabled: false });
  assert.equal(result.response.status, 404);
  assert.equal(result.created, 0);
});
test("identity endpoint rejects anonymous, pending, suspended and revoked identities", async () => {
  const anonymous = await me({ user: null });
  assert.equal(anonymous.response.status, 401);
  assert.equal(anonymous.calledRpc, false);
  const missingSession = await me({ user: null, authError: { name: "AuthSessionMissingError" } });
  assert.equal(missingSession.response.status, 401);
  assert.equal((await me({ data: [] })).response.status, 403);
});
test("identity endpoint returns exactly the minimal DTO and no sensitive RPC extras", async () => {
  const result = await me({ data: [{
    driver_id: "driver-a", region_id: "region-a", driver_name: "Test Driver", version: 1,
    finance_by_date: { secret: true }, email: "private@example.invalid",
  }] });
  assert.equal(result.response.status, 200);
  assert.deepEqual(await result.response.json(), {
    driverId: "driver-a", regionId: "region-a", name: "Test Driver", version: 1,
    globalSlogan: "Welcome", personalSlogan: "Hello",
  });
  assert.equal(result.response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(result.response.headers.get("Vary"), "Cookie");
});
test("identity endpoint fails explicitly on Auth, RPC or nonunique identity errors", async () => {
  for (const [options, status] of [
    [{ authError: { name: "AuthApiError", code: "unavailable" } }, 503],
    [{ error: { code: "XX000" } }, 503],
    [{ data: null }, 503],
    [{ data: [{}, {}] }, 503],
    [{ data: [{ driver_id: "driver-a", region_id: "region-a", driver_name: "Test Driver", version: 1 }],
      greetingError: { code: "XX000" } }, 500],
    [{ data: [{ driver_id: "driver-a", region_id: "region-a", driver_name: "Test Driver", version: 1 }],
      greetings: { globalSlogan: "Welcome" } }, 500],
  ]) assert.equal((await me(options)).response.status, status);
});

async function proxyResult(pathname, { enabled = true, staff = false, driver = false,
  rpcError = null, signedIn = true, nodeEnv = "production" } = {}) {
  let rpcCalls = 0;
  const withCookies = (response) => Object.assign(response, { cookies: { getAll: () => [], set() {} } });
  const next = {
    next: () => withCookies(new Response(null)),
    json: (body, init) => Response.json(body, init),
    redirect: (url) => withCookies(new Response(null, { status: 307, headers: { Location: url.toString() } })),
  };
  const proxy = load("proxy.ts", {
    "@supabase/ssr": { createServerClient: () => ({
      auth: { getClaims: async () => ({ data: { claims: signedIn ? { sub: "self" } : null } }) },
      rpc: async (name) => {
        assert.ok(["is_staff", "driver_identity"].includes(name), name);
        rpcCalls++;
        if (name === "driver_identity") return { data: driver ? [{ driver_id: "d" }] : [], error: rpcError };
        return { data: staff, error: rpcError };
      },
    }) },
    "next/server": { NextResponse: next },
    "@/lib/supabase/config": { getSupabaseConfig: () => ({ url: "test", publishableKey: "test" }) },
    "@/lib/driver/test-runtime": { ...runtime, isDriverPwaEnabled: () => enabled },
  }, { NODE_ENV: nodeEnv });
  const url = new URL(pathname, "https://test.example");
  const response = await proxy.proxy({
    nextUrl: url, url: url.toString(),
    cookies: { getAll: () => [], set() {} },
  });
  return { response, rpcCalls };
}

test("development HMR bypasses login without exempting app routes or production", async () => {
  assert.equal((await proxyResult("/_next/hmr", { signedIn: false, nodeEnv: "development" })).response.status, 200);
  assert.equal((await proxyResult("/_next/hmr", { signedIn: false })).response.status, 307);
  for (const path of ["/driver", "/_next/hmr/private", "/_next/hmr-other"]) {
    assert.equal((await proxyResult(path, { signedIn: false, nodeEnv: "development" })).response.status, 307);
  }
  assert.equal((await proxyResult("/api/driver/me", { signedIn: false, nodeEnv: "development" })).response.status, 401);
  assert.equal((await proxyResult("/api/data", { nodeEnv: "development" })).response.status, 403);
});

test("phone development origin is allowed only in isolated test configuration", () => {
  const filename = fileURLToPath(new URL("../next.config.ts", import.meta.url));
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const enabled of [false, true]) {
    const compiledModule = { exports: {} };
    vm.runInNewContext(output, {
      exports: compiledModule.exports, module: compiledModule,
      process: { env: enabled ? validEnvironment : {} },
    });
    const config = compiledModule.exports.default;
    assert.deepEqual(Array.from(config.allowedDevOrigins ?? []), enabled ? ["172.20.10.4"] : []);
  }
});

test("signed-in users skip the login form only for the matching role", async () => {
  const location = async (path, options) => {
    const { response } = await proxyResult(path, options);
    return response.status === 307 ? new URL(response.headers.get("Location")).pathname + new URL(response.headers.get("Location")).search : response.status;
  };
  assert.equal(await location("/login", { staff: true }), "/");
  assert.equal(await location("/login?next=%2Freports%3Fm%3D1", { staff: true }), "/reports?m=1");
  for (const next of ["//evil.example", "https://evil.example", "/login", "/driver/login"]) {
    assert.equal(await location(`/login?next=${encodeURIComponent(next)}`, { staff: true }), "/", next);
  }
  assert.equal(await location("/login", { driver: true }), "/driver");
  assert.equal(await location("/driver/login", { driver: true }), "/driver");
  assert.equal(await location("/driver/login", { staff: true }), 200);
  assert.equal(await location("/login"), 200);
  assert.equal(await location("/login", { staff: true, driver: true, rpcError: { code: "XX000" } }), 200);
  assert.equal(await location("/login", { signedIn: false }), 200);
  assert.equal(await location("/driver/login", { signedIn: false }), 200);
  assert.equal(await location("/login", { enabled: false }), "/");
});
test("logout only ends the current device session", () => {
  for (const file of ["app/page.tsx", "app/driver/driver-brand.tsx", "app/driver/login/page.tsx"]) {
    const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
    assert.doesNotMatch(source, /auth\.signOut\(\)/, file);
    assert.match(source, /auth\.signOut\(\{ scope: "local" \}\)/, file);
  }
});
test("test proxy rejects driver or pending access to legacy pages and all backend APIs", async () => {
  for (const path of ["/", "/api/data", "/api/admin/accounts", "/api/invoices/number", "/api/driver-wages"]) {
    const { response } = await proxyResult(path);
    assert.equal(response.status, 403, path);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  }
});
test("test proxy preserves staff and production paths and authenticates driver endpoints", async () => {
  assert.equal((await proxyResult("/api/data", { staff: true })).response.status, 200);
  const production = await proxyResult("/api/data", { enabled: false });
  assert.equal(production.response.status, 200);
  assert.equal(production.rpcCalls, 0);
  const driver = await proxyResult("/api/driver/me");
  assert.equal(driver.response.status, 200);
  assert.equal(driver.rpcCalls, 0);
  assert.equal((await proxyResult("/api/driver/me", { signedIn: false })).response.status, 401);
  assert.equal((await proxyResult("/driver", { signedIn: false })).response.status, 307);
  assert.equal((await proxyResult("/api/data", { rpcError: { code: "XX000" } })).response.status, 503);
});
test("legacy DAL independently denies driver and pending identities before loading profile", async () => {
  let profileQueries = 0;
  const { getAuthenticatedProfile } = load("lib/supabase/authorization.ts", {
    "server-only": {},
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => true },
    "@/lib/supabase/server": { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "driver" } } }) },
      rpc: async () => ({ data: false, error: null }),
      from: () => { profileQueries++; throw new Error("Must not load a nonstaff profile"); },
    }) },
  });
  const result = await getAuthenticatedProfile();
  assert.equal(result.profile, null);
  assert.equal(result.user.id, "driver");
  assert.equal(profileQueries, 0);
});

test("legacy DAL preserves staff and production profiles and fails closed on identity RPC errors", async () => {
  const row = {
    id: "staff", email: "staff@example.invalid", full_name: "Test Staff",
    company: "Example", position: "Dispatcher", region_id: "region-a",
    role: "user", email_confirmed: true,
  };
  for (const enabled of [false, true]) {
    let rpcCalls = 0;
    const { getAuthenticatedProfile } = load("lib/supabase/authorization.ts", {
      "server-only": {},
      "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => enabled },
      "@/lib/supabase/server": { createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: row.id } } }) },
        rpc: async () => { rpcCalls++; return { data: true, error: null }; },
        from: () => ({ select: () => ({ eq: () => ({
          single: async () => ({ data: row, error: null }),
        }) }) }),
      }) },
    });
    const { profile } = await getAuthenticatedProfile();
    assert.equal(profile.id, row.id);
    assert.equal(profile.role, "user");
    assert.equal(profile.regionId, row.region_id);
    assert.equal(rpcCalls, enabled ? 1 : 0);
  }
  const { getAuthenticatedProfile } = load("lib/supabase/authorization.ts", {
    "server-only": {},
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => true },
    "@/lib/supabase/server": { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: row.id } } }) },
      rpc: async () => ({ data: null, error: { message: "Unavailable" } }),
      from: () => { throw new Error("Must not query profiles on RPC failure"); },
    }) },
  });
  await assert.rejects(getAuthenticatedProfile(), /Failed to verify staff identity/);
});
