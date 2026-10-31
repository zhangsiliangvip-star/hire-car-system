import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(relative, mocks = {}, globals = {}) {
  const filename = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, { module: compiled, exports: compiled.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    Request, Response, Headers, URL, Date, Intl, AbortController, process: { env: { SUPABASE_SERVICE_ROLE_KEY: "test-key-not-real" } },
    console: { error() {} }, ...globals,
  });
  return compiled.exports;
}
const schemas = load("lib/driver/profile.ts");
const { jsonResponse } = load("lib/api-response.ts");
const id = "c6000000-0000-4000-8000-000000000001";
const userId = "c6000000-0000-4000-8000-000000000002";
const contacts = { phone: "", wechat: "", whatsapp: "", licenseExpiry: "" };
const profile = { ...contacts, prompted: false, version: 0 };
const account = { driverId: id, userId, email: "driver@example.invalid", status: "active", version: 1 };
const plain = value => JSON.parse(JSON.stringify(value));
function request(body, origin = "https://driver.example", type = "application/json") {
  return new Request("https://driver.example/api/test", { method: "POST",
    headers: { origin, "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function api({ admin = false, enabled = true, role = "admin", denied = 0, linked = false, result = profile,
  error = null, bindError = null, authError = null, secret = true } = {}) {
  const calls = [], authCalls = [];
  const supabase = { async rpc(name, args) {
    calls.push({ name, args });
    if (name === "admin_driver_login_target") return { data: { driverId: id, name: "Driver", regionId: id,
      userId: linked ? userId : null, status: linked ? "active" : null, version: linked ? 1 : null }, error };
    if (name === "bind_driver_identity") return { error: bindError };
    return { data: result, error };
  } };
  const exports = load(admin ? "app/api/admin/driver-accounts/route.ts" : "app/api/driver/profile/route.ts", {
    "@/lib/api-response": { jsonResponse }, "@/lib/driver/profile": schemas,
    "@/lib/driver/authorization": { requireDriver: async () => denied
      ? { response: jsonResponse({ error: "Denied" }, { status: denied }) } : { response: null, supabase } },
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => enabled },
    "@/lib/driver/assignment-action": { isDriverActionOrigin: req => req.headers.get("origin") === "https://driver.example" },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ supabase,
      profile: role ? { role, regionId: id } : null }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ auth: { admin: {
      async createUser(body) { authCalls.push({ create: body }); return { data: { user: authError ? null : { id: userId } }, error: authError }; },
      async updateUserById(id, body) { authCalls.push({ update: id, body }); return { error: authError }; },
    } } }) },
  }, { process: { env: { SUPABASE_SERVICE_ROLE_KEY: secret ? "fake-unit-test-key" : undefined } } });
  return { ...exports, calls, authCalls };
}
test("profile allows all four blanks and skip, rejects ownership or privilege fields", () => {
  assert.ok(schemas.driverProfileCommandSchema.safeParse({ action: "save", expectedVersion: 0, ...contacts }).success);
  assert.ok(schemas.driverProfileCommandSchema.safeParse({ action: "skip", expectedVersion: 0 }).success);
  for (const patch of [{ driverId: id }, { name: "Other" }, { email: "other@example.invalid" }, { licenseExpiry: "2026-02-30" }])
    assert.equal(schemas.driverProfileCommandSchema.safeParse({ action: "save", expectedVersion: 0, ...contacts, ...patch }).success, false);
  assert.equal(schemas.driverProfileCommandSchema.safeParse({ action: "skip", expectedVersion: 0, ...contacts }).success, false);
});
test("self profile routes require active identity, return minimal no-store projection", async () => {
  for (const denied of [401, 403, 404]) {
    const h = api({ denied }); assert.equal((await h.GET()).status, denied);
    assert.equal((await h.POST(request({ action: "skip", expectedVersion: 0 }))).status, denied); assert.equal(h.calls.length, 0);
  }
  const h = api(); const response = await h.GET();
  assert.equal(response.status, 200); assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), profile);
  assert.equal((await api({ result: { ...profile, password: "must-not-return" } }).GET()).status, 503);
});
test("self profile skip never clears existing contacts, save forwards only optional contacts", async () => {
  const skip = api(); assert.equal((await skip.POST(request({ action: "skip", expectedVersion: 3 }))).status, 200);
  assert.deepEqual(plain(skip.calls), [{ name: "update_driver_own_profile", args: { action: "skip", expected_version: 3, contacts: {} } }]);
  const save = api(); assert.equal((await save.POST(request({ action: "save", expectedVersion: 0, ...contacts }))).status, 200);
  assert.deepEqual(plain(save.calls[0].args.contacts), contacts);
  for (const [code, status] of [["40001", 409], ["42501", 403], ["XX000", 503]])
    assert.equal((await api({ error: { code } }).POST(request({ action: "skip", expectedVersion: 0 }))).status, status);
});
test("account management is gated; staff can read and manage through region-scoped RPCs, drivers cannot", async () => {
  const disabled = api({ admin: true, enabled: false });
  assert.deepEqual(await (await disabled.GET()).json(), {
    enabled: false, canManage: false, isAdmin: false, manageableRegionId: null, accounts: [],
  });
  assert.equal((await disabled.POST(request({}))).status, 404); assert.equal(disabled.authCalls.length, 0);
  for (const role of [null]) {
    const h = api({ admin: true, role });
    assert.equal((await h.GET()).status, 403); assert.equal((await h.PUT(request({}))).status, 403); assert.equal(h.calls.length, 0);
  }
  const h = api({ admin: true, result: [account] });
  assert.deepEqual(await (await h.GET()).json(), {
    enabled: true, canManage: true, isAdmin: true, manageableRegionId: id, accounts: [account],
  });
  const staff = api({ admin: true, role: "user", result: [account] });
  assert.deepEqual(await (await staff.GET()).json(), {
    enabled: true, canManage: true, isAdmin: false, manageableRegionId: id, accounts: [account],
  });
  assert.equal((await staff.POST(request({ driverId: id, email: "driver@example.invalid",
    password: "Test-only-password-123" }))).status, 201);
  const staffReset = api({ admin: true, role: "user", linked: true });
  assert.equal((await staffReset.PUT(request({ driverId: id, userId, expectedVersion: 1,
    password: "Test-only-password-123" }))).status, 200);
});
test("account and profile writes reject foreign origin malformed JSON types excessive size and unknown fields", async () => {
  for (const admin of [false, true]) {
    const content = admin ? { driverId: id, email: "driver@example.invalid", password: "Test-only-password-123" } : { action: "skip", expectedVersion: 0 };
    for (const [req, status] of [[request(content, "https://evil.example"), 403], [request(content, undefined, "text/plain"), 415],
      [request("x".repeat(8193)), 413], [request("{"), 400], [request({ ...content, role: "admin" }), 400]]) {
      const h = api({ admin }); assert.equal((await h.POST(req)).status, status); assert.equal(h.authCalls.length, 0);
    }
  }
});
test("creating driver auth uses independent account and binds only the selected driver, never generic staff creation", async () => {
  const h = api({ admin: true });
  const response = await h.POST(request({ driverId: id, email: "DRIVER@example.invalid", password: "Test-only-password-123" }));
  assert.equal(response.status, 201);
  assert.equal(h.authCalls[0].create.email, "driver@example.invalid");
  assert.equal(h.authCalls[0].create.email_confirm, true);
  assert.equal(h.authCalls[0].create.user_metadata.role, undefined);
  assert.deepEqual(plain(h.calls.at(-1)), { name: "bind_driver_identity", args: { target_user: userId, target_driver: id } });
  assert.equal(JSON.stringify(await response.json()).includes("password"), false);
});
test("existing emails are never hijacked, duplicate driver bindings and missing server key do not mutate auth", async () => {
  const command = { driverId: id, email: "driver@example.invalid", password: "Test-only-password-123" };
  const linked = api({ admin: true, linked: true }); assert.equal((await linked.POST(request(command))).status, 409); assert.equal(linked.authCalls.length, 0);
  const missing = api({ admin: true, secret: false }); assert.equal((await missing.POST(request(command))).status, 503); assert.equal(missing.authCalls.length, 0);
  const duplicate = api({ admin: true, authError: { code: "email_exists" } });
  assert.equal((await duplicate.POST(request(command))).status, 409);
  assert.equal(duplicate.calls.some(call => call.name === "bind_driver_identity"), false);
  const partial = api({ admin: true, bindError: { code: "23505" } });
  const response = await partial.POST(request(command)); assert.equal(response.status, 503);
  assert.match((await response.json()).error, /已创建但運転士绑定未完成/);
});
test("password reset targets only exact linked driver/version and never stores or returns cleartext", async () => {
  const command = { driverId: id, userId, expectedVersion: 1, password: "Test-only-password-123" };
  const h = api({ admin: true, linked: true });
  const response = await h.PUT(request(command)); assert.equal(response.status, 200);
  assert.deepEqual(plain(h.authCalls), [{ update: userId, body: { password: command.password } }]);
  assert.deepEqual(await response.json(), { ok: true });
  for (const patch of [{ expectedVersion: 2 }, { userId: id }]) {
    const stale = api({ admin: true, linked: true }); assert.equal((await stale.PUT(request({ ...command, ...patch }))).status, 409);
    assert.equal(stale.authCalls.length, 0);
  }
});
test("driver login routes first login to optional profile and subsequent login to trips", async () => {
  for (const prompted of [false, true]) {
    let submit, destination;
    const Login = load("app/driver/login/page.tsx", {
      react: { ...React, useState: initial => [initial, () => {}] },
      "next/navigation": { useRouter: () => ({ replace: path => { destination = path; } }) },
      "@/lib/driver/profile": schemas,
      "@/lib/supabase/browser": { createClient: () => ({ auth: { signInWithPassword: async () => ({ error: null }) } }) },
      "react/jsx-runtime": { ...require("react/jsx-runtime"),
        jsx(type, props, ...rest) { if (type === "form") submit = props.onSubmit; return require("react/jsx-runtime").jsx(type, props, ...rest); },
        jsxs(type, props, ...rest) { if (type === "form") submit = props.onSubmit; return require("react/jsx-runtime").jsxs(type, props, ...rest); } },
    }, { FormData: class { get(field) { return field === "email" ? "driver@example.invalid" : "Test-only-password-123"; } },
      fetch: async url => Response.json(url.endsWith("/me") ? {} : { ...profile, prompted }) }).default;
    renderToStaticMarkup(React.createElement(Login));
    await submit({ preventDefault() {}, currentTarget: {} });
    assert.equal(destination, prompted ? "/driver" : "/driver/profile");
  }
});
test("driver list exposes email and write-only password fields; inputs clear on hide and no password storage added", () => {
  const source = readFileSync(fileURLToPath(new URL("../components/driver-login-fields.tsx", import.meta.url)), "utf8");
  assert.match(source, /type=\{visible \? "text" : "password"\}/);
  assert.match(source, /setPassword\(""\)/);
  assert.match(source, /document.visibilityState === "hidden"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.doesNotMatch(source, /保存后不回显密码/);
  assert.match(source, /grid-cols-\[minmax\(0,1fr\)_3rem_5rem\]/);
  assert.equal((source.match(/className="h-10 /g) || []).length, 4);
  const page = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
  const driverTable = page.slice(page.indexOf('data-table="drivers"'), page.indexOf("</table>", page.indexOf('data-table="drivers"')));
  const loginManagement = page.slice(page.indexOf('{activeView === "login"'), page.indexOf('{activeView === "orderFinance"'));
  assert.match(driverTable, /登录邮箱<\/th>/); assert.match(driverTable, /登录密码<\/th>/);
  assert.match(driverTable, /<DriverLoginFields driverId=\{driver\.id\}/);
  assert.doesNotMatch(loginManagement, /DriverLoginFields|driver-login-accounts/);
  assert.match(source, /manageableRegionId === regionId/);
  assert.match(page, /regionId=\{driver\.regionId\}/);
  const profileSource = readFileSync(fileURLToPath(new URL("../app/driver/profile/page.tsx", import.meta.url)), "utf8");
  assert.match(profileSource, /暂時跳过，进入行程/);
  assert.doesNotMatch(profileSource, / required[ >]/);
});
test("driver profile displays four optional fields and skipping posts no contact changes", async () => {
  const states = [profile, profile, false, "", 0], buttons = [], inputs = [], calls = [];
  let cursor = 0, destination;
  const runtime = require("react/jsx-runtime");
  const capture = original => (type, props, ...rest) => {
    if (type === "button") buttons.push(props);
    if (type === "input") inputs.push(props);
    return original(type, props, ...rest);
  };
  const Profile = load("app/driver/profile/page.tsx", {
    react: { ...React, useEffect() {}, useRef: value => ({ current: value }),
      useState() { const i = cursor++; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "next/navigation": { useRouter: () => ({ replace: path => { destination = path; } }) },
    "@/app/driver/navigation": { default: () => null }, "@/lib/driver/profile": schemas, "@/lib/supabase/browser": {},
  }, { window: { confirm: () => true }, fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ ...profile, prompted: true, version: 1 }); } }).default;
  const html = renderToStaticMarkup(React.createElement(Profile));
  assert.equal(inputs.length, 4); assert.ok(inputs.every(input => !input.required));
  assert.match(html, /携帯番号/); assert.match(html, /免許有効期限/);
  if (process.env.DRIVER_PROFILE_LAYOUT_FILE) {
    const css = readFileSync(fileURLToPath(new URL("../app/driver/driver.css", import.meta.url)), "utf8");
    writeFileSync(process.env.DRIVER_PROFILE_LAYOUT_FILE,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}${css}</style><div class="driver-app">${html}</div>`);
  }
  buttons.find(button => button.children === "暂時跳过，进入行程").onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [{ action: "skip", expectedVersion: 0 }]);
  assert.equal(destination, "/driver");
});
test("admin password visibility toggles and hidden page clears password", () => {
  const states = ["", "Test-only-password-123", false, false, "", ""], effects = [], events = {}, buttons = [], inputs = [], refs = [];
  let cursor = 0, refCursor = 0;
  const runtime = require("react/jsx-runtime");
  const capture = original => (type, props, ...rest) => {
    if (type === "button") buttons.push(props);
    if (type === "input") inputs.push(props);
    return original(type, props, ...rest);
  };
  const document = { visibilityState: "visible", addEventListener(name, fn) { events[name] = fn; }, removeEventListener() {} };
  const { DriverLoginFields } = load("components/driver-login-fields.tsx", {
    react: { ...React, useEffect(fn) { effects.push(fn); },
      useContext: () => ({ data: { enabled: true, canManage: true, isAdmin: true,
        manageableRegionId: null, accounts: [account] }, error: "", reload() {} }),
      useRef(value) { const i = refCursor++; return refs[i] ||= { current: value }; },
      useState() { const i = cursor++; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "@/lib/driver/profile": schemas,
    "@/lib/supabase/browser": { createClient: () => ({ auth: { onAuthStateChange(fn) {
      events.auth = fn; return { data: { subscription: { unsubscribe() {} } } };
    } } }) },
  }, { document });
  function render() {
    cursor = 0; refCursor = 0; buttons.length = 0; inputs.length = 0;
    return renderToStaticMarkup(React.createElement(DriverLoginFields, { driverId: id, name: "Driver" }));
  }
  render(); const cleanup = effects[0]();
  assert.equal(inputs[0].type, "password");
  buttons.find(button => button.children === "显示").onClick();
  render(); assert.equal(inputs[0].type, "text");
  document.visibilityState = "hidden"; events.visibilitychange();
  assert.equal(states[1], ""); assert.equal(states[2], false);
  cleanup();
});
