import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(relative, mocks = {}, globals = {}) {
  const filename = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const compiled = { exports: {} };
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
  }).outputText;
  vm.runInNewContext(output, { module: compiled, exports: compiled.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    Request, Response, URL, Headers, AbortController, setTimeout, clearTimeout,
    console: { error() {} }, ...globals });
  return compiled.exports;
}
const schemas = load("lib/driver/execution-status.ts");
const orders = load("lib/driver/orders.ts");
const { jsonResponse } = load("lib/api-response.ts");
const id = "f4900270-0000-4000-8000-000000000001";
const date = "2026-10-27";
const result = { date, rows: [{ orderId: id, date, status: "en_route", version: 3 }] };
function handler({ enabled = true, profile = { role: "user" }, data = result, error = null } = {}) {
  const calls = [];
  return { calls, ...load("app/api/driver-execution-status/route.ts", {
    "@/lib/api-response": { jsonResponse }, "@/lib/driver/execution-status": schemas,
    "@/lib/driver/orders": { japanDate: () => date },
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => enabled },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ profile, supabase: {
      rpc: async (...args) => { calls.push(args); return { data, error }; },
    } }) },
  }) };
}
test("staff daily status API is gated, no-store and minimal with no caller-supplied identity or date", async () => {
  const request = query => new Request(`https://staff.example/api/driver-execution-status${query}`);
  const off = handler({ enabled: false });
  assert.deepEqual(await (await off.GET(request(""))).json(), { enabled: false, date, rows: [] });
  assert.equal(off.calls.length, 0);
  const denied = handler({ profile: null });
  assert.equal((await denied.GET(request(""))).status, 403);
  assert.equal(denied.calls.length, 0);
  for (const query of ["?driverId=x", "?regionId=x", "?date=2026-10-26", "?orderId=x"]) {
    const api = handler();
    assert.equal((await api.GET(request(query))).status, 400);
    assert.equal(api.calls.length, 0);
  }
  const api = handler();
  const response = await api.GET(request(""));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), { enabled: true, ...result });
  assert.equal(api.calls[0][0], "staff_driver_execution_status");
  for (const options of [{ data: null }, { error: { code: "XX000" } },
    { data: { ...result, rows: [{ ...result.rows[0], price: 99 }] } },
    { data: { ...result, rows: [{ ...result.rows[0], status: "revoked" }] } }])
    assert.equal((await handler(options).GET(request(""))).status, 503);
});
test("calendar labels show all driver steps only on their exact service day", () => {
  const Badge = load("components/driver-execution-badge.tsx", { "@/lib/driver/orders": orders }).DriverExecutionBadge;
  for (const status of schemas.activeExecutionStates) {
    const html = renderToStaticMarkup(React.createElement(Badge, { row: { ...result.rows[0], status }, date }));
    const label = status === "assigned" ? "未确认" : orders.tripStatusLabels[status];
    assert.ok(html.includes(`司机状态：${label}`));
    assert.ok(html.includes(`>${label}</span>`));
  }
  assert.equal(renderToStaticMarkup(React.createElement(Badge, { row: undefined, date })), "");
  assert.equal(renderToStaticMarkup(React.createElement(Badge, { row: result.rows[0], date: "2026-10-26" })), "");
  assert.equal(schemas.executionStatusDataSchema.safeParse({ enabled: true, ...result,
    rows: [{ ...result.rows[0], status: "completed" }] }).success, true);
});
test("calendar database migration keeps completed status visible until its service day ends", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261112000000_driver_calendar_completed_status.sql", import.meta.url), "utf8");
  assert.match(migration, /a\.status in \(''assigned'',''acknowledged'',''en_route'',''arrived'',''in_service'',''completed''\)/);
  assert.match(migration, /Unexpected daily driver status filter/);
  const rpc = readFileSync(new URL("../supabase/migrations/20261104000000_driver_pwa.sql", import.meta.url), "utf8");
  assert.match(rpc, /where a\.service_date=day/);
});
function hook() {
  const states = [null, ""]; const effects = []; const events = {};
  let cursor = 0; let resolve; let onAuth; let interval; let signal; let calls = 0;
  let today = date;
  const document = { visibilityState: "visible", addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener() {} };
  const hooks = load("lib/use-driver-execution-status.ts", {
    react: { useEffect: effect => effects.push(effect), useState: () => {
      const i = cursor++; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }];
    } },
    "@/lib/driver/execution-status": schemas,
    "@/lib/driver/orders": { japanDate: () => today },
    "@/lib/supabase/browser": { createClient: () => ({ auth: { onAuthStateChange: fn => {
      onAuth = fn; return { data: { subscription: { unsubscribe() {} } } };
    } } }) },
  }, {
    document, window: { addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener() {} },
    setTimeout: (fn, delay) => { interval = { fn, delay }; return 1; }, clearTimeout() {},
    fetch: async (url, options) => {
      assert.equal(url, "/api/driver-execution-status"); assert.equal(options.cache, "no-store");
      calls++; signal = options.signal; return new Promise(done => { resolve = done; });
    },
  });
  hooks.useDriverExecutionStatus(true);
  const cleanup = effects[0]();
  return { states, cleanup, events, document, get interval() { return interval; }, get calls() { return calls; },
    setDay: value => { today = value; },
    get signal() { return signal; }, signOut: () => onAuth("SIGNED_OUT"),
    respond: async (data, status = 200) => { resolve(Response.json(data, { status })); await new Promise(done => setImmediate(done)); } };
}
test("one shared three-second poll reflects mobile changes and completion without modifying cards", async () => {
  const h = hook();
  await h.respond({ enabled: true, ...result });
  assert.equal(h.interval.delay, 3000);
  assert.equal(h.states[0].rows[0].status, "en_route");
  h.interval.fn();
  await h.respond({ enabled: true, date, rows: [{ ...result.rows[0], status: "in_service", version: 5 }] });
  assert.equal(h.states[0].rows[0].status, "in_service");
  h.interval.fn();
  await h.respond({ enabled: true, date, rows: [{ ...result.rows[0], status: "completed", version: 6 }] });
  assert.equal(h.states[0].rows[0].status, "completed");
  assert.equal(h.calls, 3);
  h.cleanup();
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /visibleOrders\.flatMap\(\(order\) => getVehicleSegments/);
  assert.match(source, /executionDayIndex.*barDates\.findIndex/);
  assert.match(source, /<DriverExecutionBadge row=\{execution\} date=\{barDates\[executionDayIndex\]\.date\}/);
  assert.match(source, /absolute top-0 z-20 min-w-0 px-1 text-center/);
  assert.doesNotMatch(source, /visibleOrders\.filter\([^)]*(?:completed|driverExecution)/);
});
test("poll failures are explicit, clear stale labels and retry; disabled feature stops polling", async () => {
  const h = hook();
  await h.respond({ enabled: true, ...result });
  h.interval.fn();
  await h.respond({}, 503);
  assert.equal(h.states[0], null);
  assert.match(h.states[1], /暂时不可用.*重试/);
  assert.equal(h.interval.delay, 3000);
  h.interval.fn();
  await h.respond({ enabled: false, date, rows: [] });
  assert.equal(h.states[1], "");
  h.cleanup();
});
test("inconsistent days and duplicate orders are rejected rather than shown on the wrong card", async () => {
  for (const rows of [[{ ...result.rows[0], date: "2026-10-28" }], [result.rows[0], result.rows[0]]]) {
    const h = hook();
    await h.respond({ enabled: true, date, rows });
    assert.equal(h.states[0], null);
    assert.match(h.states[1], /暂时不可用/);
    h.cleanup();
  }
});
test("hidden and signed-out views abort polls and cannot restore private data from late responses", async () => {
  for (const action of ["hidden", "signed-out", "unmounted"]) {
    const h = hook();
    if (action === "hidden") { h.document.visibilityState = "hidden"; h.events.visibilitychange(); }
    else if (action === "signed-out") h.signOut();
    else h.cleanup();
    assert.equal(h.signal.aborted, true);
    await h.respond({ enabled: true, ...result });
    assert.equal(h.states[0], null);
    if (action === "hidden") {
      h.document.visibilityState = "visible"; h.events.visibilitychange();
      h.setDay("2026-10-28");
      await h.respond({ enabled: true, date: "2026-10-28", rows: [] });
      assert.equal(h.states[0].date, "2026-10-28");
    }
    h.cleanup();
  }
});
test("midnight hides yesterday immediately without waiting for a network request", () => {
  const effects = []; let timer; let cleared = false; let current = new Date("2026-10-27T23:59:59+09:00");
  const states = [{ enabled: true, ...result }, ""]; let cursor = 0;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [current.getTime()])); }
    static now() { return current.getTime(); }
  }
  const hooks = load("lib/use-driver-execution-status.ts", {
    react: { useEffect: fn => effects.push(fn), useState: () => {
      const i = cursor++; return [states[i], value => { states[i] = value; }];
    } },
    "@/lib/driver/execution-status": schemas,
    "@/lib/driver/orders": { japanDate: offset => orders.japanDate(offset, current) },
    "@/lib/supabase/browser": {},
  }, { Date: Clock, setTimeout: (fn, delay) => { timer = { fn, delay }; return 1; },
    clearTimeout: () => { cleared = true; } });
  hooks.useDriverExecutionStatus(true);
  const cleanup = effects[1]();
  assert.equal(timer.delay, 1000);
  current = new Date("2026-10-28T00:00:00+09:00");
  timer.fn();
  assert.equal(states[0], null);
  assert.equal(timer.delay, 86400000);
  cleanup(); assert.equal(cleared, true);
});
test("yesterday's in-flight status cannot reappear after midnight", async () => {
  const h = hook();
  h.setDay("2026-10-28");
  await h.respond({ enabled: true, ...result });
  assert.equal(h.states[0], null);
  assert.match(h.states[1], /暂时不可用/);
  h.cleanup();
});
