import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(relative, mocks = {}, environment = process.env, globals = {}) {
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
    ...globals,
  }, { filename });
  return compiledModule.exports;
}
const runtime = load("lib/driver/test-runtime.ts");
const session = load("lib/supabase/session.ts");

test("browser SDK keeps both accounts and cookies when one account logs out", async () => {
  const { createBrowserClient } = require("@supabase/ssr");
  const jar = new Map();
  const optionsUsed = [];
  const users = {
    staff: { id: "staff", email: "staff@example.invalid", aud: "authenticated", role: "authenticated",
      app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
    driver: { id: "driver", email: "driver@example.invalid", aud: "authenticated", role: "authenticated",
      app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
  const jwt = user => [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"),
    "synthetic-signature",
  ].join(".");
  const tokens = { staff: jwt(users.staff), driver: jwt(users.driver) };
  const fakeFetch = async (url, init) => {
    if (String(url).includes("/token?grant_type=password")) {
      const user = JSON.parse(init.body).email.startsWith("driver") ? users.driver : users.staff;
      return Response.json({ access_token: tokens[user.id], refresh_token: `refresh-${user.id}`,
        expires_in: 3600, token_type: "bearer", user });
    }
    if (String(url).includes("/token?grant_type=refresh_token")) {
      const user = JSON.parse(init.body).refresh_token.includes("driver") ? users.driver : users.staff;
      return Response.json({ access_token: tokens[user.id], refresh_token: `rotated-${user.id}`,
        expires_in: 3600, token_type: "bearer", user });
    }
    if (String(url).includes("/user")) {
      const authorization = new Headers(init.headers).get("authorization");
      return Response.json(authorization === `Bearer ${tokens.driver}` ? users.driver : users.staff);
    }
    assert.match(String(url), /\/logout\?scope=local$/);
    return new Response(null, { status: 204 });
  };
  const browser = load("lib/supabase/browser.ts", {
    "@/lib/supabase/config": { getSupabaseConfig: () => ({ url: "https://test.supabase.co", publishableKey: "test" }) },
    "@/lib/supabase/session": session,
    "@supabase/ssr": { createBrowserClient: (url, key, options) => {
      optionsUsed.push(options);
      return createBrowserClient(url, key, {
        ...options, auth: { autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: fakeFetch },
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: values => values.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
        },
      });
    } },
  }, process.env, { window: {} });
  const staff = browser.createClient();
  const driver = browser.createClient("driver");
  assert.notEqual(staff, driver);
  assert.equal(browser.createClient(), staff);
  assert.equal(browser.createClient("driver"), driver);
  assert.equal(optionsUsed.length, 2);
  assert.ok(optionsUsed.every(options => options.isSingleton === false));
  assert.equal(optionsUsed[0].cookieOptions.name, "sb-test-auth-token");
  assert.equal(optionsUsed[1].cookieOptions.name, "sb-test-auth-token-driver");
  assert.equal(optionsUsed[1].auth.persistSession, true);
  assert.equal(optionsUsed[1].auth.autoRefreshToken, true);
  for (const [client, user] of [[staff, users.staff], [driver, users.driver]]) {
    const result = await client.auth.signInWithPassword({ email: user.email, password: "synthetic-password" });
    assert.equal(result.error, null);
  }
  assert.equal((await staff.auth.getSession()).data.session.user.id, "staff");
  assert.equal((await driver.auth.getSession()).data.session.user.id, "driver");
  assert.ok(jar.has("sb-test-auth-token"));
  assert.ok(jar.has("sb-test-auth-token-driver"));
  const reopenedDriver = createBrowserClient("https://test.supabase.co", "test", {
    isSingleton: false,
    cookieOptions: { name: "sb-test-auth-token-driver" },
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fakeFetch },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: values => values.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
    },
  });
  assert.equal((await reopenedDriver.auth.getSession()).data.session.user.id, "driver");
  assert.equal((await reopenedDriver.auth.refreshSession()).error, null);
  assert.equal((await staff.auth.getSession()).data.session.user.id, "staff");
  const staffCookie = jar.get("sb-test-auth-token");
  assert.equal((await driver.auth.refreshSession()).error, null);
  assert.equal((await driver.auth.getSession()).data.session.refresh_token, "rotated-driver");
  assert.equal(jar.get("sb-test-auth-token"), staffCookie);
  assert.equal((await driver.auth.signOut({ scope: "local" })).error, null);
  assert.equal((await driver.auth.getSession()).data.session, null);
  assert.equal((await staff.auth.getSession()).data.session.user.id, "staff");
  assert.equal(jar.has("sb-test-auth-token-driver"), false);
  assert.ok(jar.has("sb-test-auth-token"));
  await driver.auth.signInWithPassword({ email: users.driver.email, password: "synthetic-password" });
  assert.equal((await staff.auth.signOut({ scope: "local" })).error, null);
  assert.equal((await driver.auth.getSession()).data.session.user.id, "driver");
  assert.equal(jar.has("sb-test-auth-token"), false);
  assert.ok(jar.has("sb-test-auth-token-driver"));
  await driver.auth.signOut({ scope: "local" });
});

test("server clients select the same session cookies without cross-account refresh writes", async () => {
  const jar = new Map([["sb-test-auth-token", "staff-session"], ["sb-test-auth-token-driver", "driver-session"]]);
  const server = load("lib/supabase/server.ts", {
    "@/lib/supabase/config": { getSupabaseConfig: () => ({ url: "https://test.supabase.co", publishableKey: "test" }) },
    "@/lib/supabase/session": session,
    "next/headers": { cookies: async () => ({
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      set: (name, value) => jar.set(name, value),
    }) },
    "@supabase/ssr": { createServerClient: (_url, _key, options) => ({
      name: options.cookieOptions.name,
      read: () => options.cookies.getAll().find(cookie => cookie.name === options.cookieOptions.name).value,
      refresh: () => options.cookies.setAll([{ name: options.cookieOptions.name, value: "refreshed", options: {} }]),
    }) },
  });
  const staff = await server.createClient();
  const driver = await server.createClient("driver");
  assert.equal(staff.read(), "staff-session");
  assert.equal(driver.read(), "driver-session");
  driver.refresh();
  assert.equal(staff.read(), "staff-session");
  assert.equal(driver.read(), "refreshed");
});

test("email callbacks keep the destination session scope and reject external destinations", async () => {
  for (const [next, expectedScope, destination] of [
    ["/driver/profile", "driver", "/driver/profile"],
    ["/reset-password", "staff", "/reset-password"],
    ["https://other.example/driver/profile", "staff", "/"],
  ]) for (const failed of [false, true]) {
    let selectedScope;
    const route = load("app/auth/confirm/route.ts", {
      "next/server": { NextResponse: { redirect: url => new Response(null, {
        status: 307, headers: { Location: url.toString() },
      }) } },
      "@/lib/driver/test-runtime": runtime,
      "@/lib/supabase/server": { createClient: async scope => {
        selectedScope = scope;
        return { auth: { verifyOtp: async () => ({ error: failed ? new Error("Synthetic failure") : null }) } };
      } },
    });
    const url = new URL("https://test.example/auth/confirm");
    url.searchParams.set("next", next);
    url.searchParams.set("token_hash", "synthetic-token");
    url.searchParams.set("type", "invite");
    const response = await route.GET({ nextUrl: url, url: url.toString() });
    assert.equal(selectedScope, expectedScope);
    const login = expectedScope === "driver" ? "/driver/login" : "/login";
    assert.equal(new URL(response.headers.get("Location")).pathname, failed ? login : destination);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
});
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
      createClient: async scope => {
        assert.equal(scope, "driver");
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
  rpcError = null, signedIn = true, nodeEnv = "production", sessions = null } = {}) {
  let rpcCalls = 0;
  let cookieName;
  const withCookies = (response) => Object.assign(response, { cookies: { getAll: () => [], set() {} } });
  const next = {
    next: () => withCookies(new Response(null)),
    json: (body, init) => Response.json(body, init),
    redirect: (url) => withCookies(new Response(null, { status: 307, headers: { Location: url.toString() } })),
  };
  const proxy = load("proxy.ts", {
    "@supabase/ssr": { createServerClient: (_url, _key, options) => {
      cookieName = options.cookieOptions.name;
      const user = sessions ? sessions[cookieName] : signedIn ? "self" : null;
      return {
      auth: { getClaims: async () => ({ data: { claims: user ? { sub: user } : null } }) },
      rpc: async (name) => {
        assert.ok(["is_staff", "driver_identity"].includes(name), name);
        rpcCalls++;
        if (name === "driver_identity") return { data: (sessions ? user === "driver" : driver) ? [{ driver_id: "d" }] : [], error: rpcError };
        return { data: sessions ? user === "staff" : staff, error: rpcError };
      },
    }; } },
    "next/server": { NextResponse: next },
    "@/lib/supabase/config": { getSupabaseConfig: () => ({ url: "https://test.supabase.co", publishableKey: "test" }) },
    "@/lib/supabase/session": session,
    "@/lib/driver/test-runtime": { ...runtime, isDriverPwaEnabled: () => enabled },
  }, { NODE_ENV: nodeEnv });
  const url = new URL(pathname, "https://test.example");
  const response = await proxy.proxy({
    nextUrl: url, url: url.toString(),
    cookies: { getAll: () => [], set() {} },
  });
  return { response, rpcCalls, cookieName };
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
  assert.equal(await location("/login", { driver: true }), 200);
  assert.equal(await location("/driver/login", { driver: true }), "/driver");
  assert.equal(await location("/driver/login", { staff: true }), 200);
  assert.equal(await location("/login"), 200);
  assert.equal(await location("/login", { staff: true, driver: true, rpcError: { code: "XX000" } }), 200);
  assert.equal(await location("/login", { signedIn: false }), 200);
  assert.equal(await location("/driver/login", { signedIn: false }), 200);
  assert.equal(await location("/login", { enabled: false }), "/");
});
test("proxy uses independent staff and driver cookies on the same device", async () => {
  const sessions = { "sb-test-auth-token": "staff", "sb-test-auth-token-driver": "driver" };
  for (const path of ["/", "/api/data", "/driver-finance-review", "/api/driver-finance-review"]) {
    const result = await proxyResult(path, { sessions });
    assert.equal(result.cookieName, "sb-test-auth-token");
    assert.equal(result.response.status, 200);
  }
  for (const path of ["/driver", "/driver/report", "/api/driver/me", "/api/driver/reports"]) {
    const result = await proxyResult(path, { sessions });
    assert.equal(result.cookieName, "sb-test-auth-token-driver");
    assert.equal(result.response.status, 200);
  }
  assert.equal((await proxyResult("/api/driver/me", { sessions: { "sb-test-auth-token": "staff" } })).response.status, 401);
  assert.equal((await proxyResult("/api/data", { sessions: { "sb-test-auth-token-driver": "driver" } })).response.status, 401);
  assert.equal((await proxyResult("/login", { sessions })).response.headers.get("Location"), "https://test.example/");
  assert.equal((await proxyResult("/driver/login", { sessions })).response.headers.get("Location"), "https://test.example/driver");
  assert.equal((await proxyResult("/auth/confirm?next=/driver/profile", { sessions })).cookieName, "sb-test-auth-token-driver");
  assert.equal((await proxyResult("/auth/confirm?next=/reset-password", { sessions })).cookieName, "sb-test-auth-token");
});
test("logout only ends the current device session", () => {
  for (const file of ["app/page.tsx", "app/driver/driver-brand.tsx", "app/driver/login/page.tsx"]) {
    const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
    assert.doesNotMatch(source, /auth\.signOut\(\)/, file);
    assert.match(source, /auth\.signOut\(\{ scope: "local" \}\)/, file);
  }
});
test("every driver browser surface uses the independent driver client", () => {
  for (const file of ["driver-brand.tsx", "trips.tsx", "login/page.tsx", "profile/page.tsx",
    "calendar/calendar.tsx", "finance/finance.tsx", "report/report.tsx", "shifts/shifts.tsx"]) {
    const source = readFileSync(fileURLToPath(new URL(`../app/driver/${file}`, import.meta.url)), "utf8");
    assert.doesNotMatch(source, /createClient\(\)/, file);
    assert.match(source, /createClient\("driver"\)/, file);
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
