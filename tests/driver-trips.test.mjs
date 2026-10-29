import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(relative, mocks = {}, globals = {}) {
  const filename = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: compiledModule.exports, module: compiledModule,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] :
      name === "@/components/driver-trip-notes" ? load("components/driver-trip-notes.tsx", { ...mocks, react: React }) :
      name === "@/app/driver/navigation" ? load("app/driver/navigation.tsx", mocks) : require(name),
    process, Request, Response, Headers, URL, Intl, Date, crypto: webcrypto,
    console: { error() {} }, ...globals,
  }, { filename });
  return compiledModule.exports;
}
const orders = load("lib/driver/orders.ts");
const reports = load("lib/driver/reports.ts");
const { jsonResponse } = load("lib/api-response.ts");
const id = "e6000000-0000-4000-8000-000000000001";
const row = {
  assignment_id: id, order_id: "order-a", service_date: "2026-10-27",
  departure_time: "09:30", pickup: "Airport", destination: "Hotel", vehicle: "Test car",
  status: "assigned", version: 1, finance_by_date: { secret: true },
};

function route(relative, { deny, data = [], error = null, historyData = [], historyError = null, defaults, defaultsError = null } = {}) {
  const calls = [];
  const mocks = {
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/orders": orders,
    "@/lib/driver/reports": reports,
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => false },
    "@/lib/driver/authorization": { requireDriver: async () => deny ?
      { response: jsonResponse({ error: "Denied" }, { status: deny }) } :
      { response: null, supabase: { rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "driver_report_defaults") return {
          error: defaultsError,
          data: defaults ?? { serviceDate: args.target_date, driverName: "Driver", orders: [{
            assignmentId: id, time: "09:30", pickup: "Airport", destination: "Hotel",
            vehicleNumber: "足立300い4968", depot: null,
          }] },
        };
        if (name === "driver_historical_orders") return { data: historyData, error: historyError };
        return { data, error };
      } } } },
  };
  mocks["@/lib/driver/assignment-action"] = load("lib/driver/assignment-action.ts", mocks);
  const result = load(relative, mocks);
  return { ...result, calls };
}
const getRoute = "app/api/driver/orders/route.ts";
const postRoute = "app/api/driver/assignments/[id]/acknowledge/route.ts";
const eventRoute = "app/api/driver/assignments/[id]/events/route.ts";
const notesRoute = "app/api/driver/assignments/[id]/notes/route.ts";
test("phone origin accepts only exact test host on the isolated development binding", () => {
  const { isDriverActionOrigin } = load("lib/driver/assignment-action.ts", {
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/orders": orders,
    "@/lib/driver/authorization": {},
    "@/lib/driver/test-runtime": {},
  });
  const make = (origin, host, url = "http://0.0.0.0:3100/api/driver/test") => new Request(url, {
    headers: { ...(origin === null ? {} : { Origin: origin }), Host: host },
  });
  for (const host of ["172.20.10.4:3100","localhost:3100","127.0.0.1:3100"]) {
    assert.equal(isDriverActionOrigin(make(`http://${host}`, host), true), true);
    assert.equal(isDriverActionOrigin(make(`http://${host}`, host), false), false);
  }
  for (const [origin,host] of [
    [null,"172.20.10.4:3100"],["null","172.20.10.4:3100"],
    ["http://evil.example","evil.example"],
    ["http://172.20.10.4:3100","evil.example"],
    ["http://172.20.10.4:3101","172.20.10.4:3101"],
    ["https://172.20.10.4:3100","172.20.10.4:3100"],
    ["http://172.20.10.4:3100.evil.example","172.20.10.4:3100"],
  ]) assert.equal(isDriverActionOrigin(make(origin,host), true), false);
  assert.equal(isDriverActionOrigin(make("http://172.20.10.4:3100","172.20.10.4:3100",
    "https://production.example/api/driver/test"), true), false);
  assert.equal(isDriverActionOrigin(make("https://driver.example","driver.example",
    "https://driver.example/api/driver/test")), true);
});
const get = (query) => new Request(`https://driver.example/api/driver/orders${query}`);
const context = { params: Promise.resolve({ id }) };
const requestBody = { expectedVersion: 1, requestId: id };
function post({ body = requestBody, origin = "https://driver.example", contentType = "application/json" } = {}) {
  return new Request(`https://driver.example/api/driver/assignments/${id}/acknowledge`, {
    method: "POST",
    headers: { ...(origin === null ? {} : { Origin: origin }), "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("driver projection excludes all finance, identity and unexpected fields", () => {
  const projected = orders.projectDriverTrip(row);
  assert.deepEqual(Object.keys(projected).sort(), [
    "assignmentId","orderId","date","time","pickup","destination","vehicle","status","version",
  ].sort());
  assert.equal(projected.status, "assigned");
  for (const status of orders.tripStates) {
    assert.equal(orders.projectDriverTrip({ ...row, status }).status, status);
  }
  assert.throws(() => orders.projectDriverTrip({ ...row, status: "revoked" }), /Unexpected/);
});
test("historical driver projection is read-only and has a strict safe-field allowlist", () => {
  const historical = orders.projectHistoricalDriverTrip({
    order_id: "a6000000-0000-4000-8000-000000000001", service_date: "2026-10-26", departure_time: "08:00",
    pickup: "Airport", destination: "Hotel", vehicle: "Test car", vehicle_number: "Plate",
    order_name: "Order", trip_summary: "Summary", notes: "Notes",
  });
  assert.equal(historical.historical, true);
  assert.equal(historical.status, "historical");
  assert.equal(historical.assignmentId, null);
  assert.deepEqual(Object.keys(historical).sort(), [
    "assignmentId","date","destination","details","historical","orderId","pickup",
    "status","time","vehicle","vehicleNumber","version",
  ].sort());
  assert.throws(() => orders.projectHistoricalDriverTrip({
    order_id: "a6000000-0000-4000-8000-000000000001", service_date: "2026-10-26", departure_time: "08:00",
    pickup: "Airport", destination: "Hotel", vehicle: "Test car", vehicle_number: "Plate",
    order_name: "Order", trip_summary: "Summary", notes: "Notes", order_price: 10,
  }));
});
test("execution actions allow one step forward or backward including completed to in-service", () => {
  for (let i = 0; i < orders.tripStates.length - 1; i++) {
    const state = orders.tripStates[i];
    assert.equal(orders.tripActions[state].state, orders.tripStates[i + 1]);
    assert.ok(orders.tripStatusLabels[state]);
  }
  assert.equal(orders.tripActions.completed, undefined);
  assert.equal(orders.tripPreviousStates.assigned, undefined);
  for (let i = 1; i < orders.tripStates.length; i++) {
    const state = orders.tripStates[i];
    assert.equal(orders.tripPreviousStates[state], orders.tripStates[i - 1]);
    assert.equal(orders.tripEventSchema.safeParse({ ...requestBody, state: orders.tripStates[i - 1] }).success, true);
  }
});
test("trip list date picker follows tomorrow and changes the shared date without retaining old trips", () => {
  const states = ["2026-10-27", { name: "Synthetic Driver" }, [orders.projectDriverTrip(row)], false, "Old error", "Old notice", 0, false];
  let cursor = 0;
  const Component = load("app/driver/trips.tsx", {
    react: { ...React, useEffect() {}, useRef: value => ({ current: value }),
      useState() { const i = cursor++; return [states[i], value => { states[i] = value; }]; } },
    "next/link": { default: "a" },
    "@/lib/supabase/browser": {},
    "@/lib/driver/orders": { ...orders, japanDate: offset => offset ? "2026-10-28" : "2026-10-27" },
  }).default;
  const tree = Component({});
  const elements = node => !node || typeof node !== "object" ? [] :
    Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
  const picker = elements(tree).find(node => node.type === "input" && node.props.type === "date");
  assert.ok(picker);
  const html = renderToStaticMarkup(tree);
  assert.ok(html.indexOf("明天") < html.indexOf('aria-label="選択行程日期"'));
  picker.props.onChange({ target: { value: "" } });
  assert.equal(states[0], "2026-10-27");
  picker.props.onChange({ target: { value: "2026-11-03" } });
  assert.equal(states[0], "2026-11-03"); assert.equal(states[2].length, 0);
  assert.equal(states[3], true); assert.equal(states[4], ""); assert.equal(states[5], "");
});
test("phone detail renders only the current legal action and never financial fields", () => {
  for (const status of orders.tripStates) {
    let cursor = 0;
    const values = ["2026-10-27", { name: "Synthetic Driver" },
      [{ ...orders.projectDriverTripDetail({ ...row, status, order_name: "<Order>", trip_summary: "Airport\nHotel", notes: "<script>private notes</script>" }),
        vehicleNumber: "足立300い4968" }], false, "", "", 0, false];
    const Component = load("app/driver/trips.tsx", {
      react: { ...React, useEffect() {}, useRef: (value) => ({ current: value }),
        useState: () => [values[cursor++], () => {}] },
      "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
      "@/lib/supabase/browser": { createClient: () => { throw Error("Render must not access Auth"); } },
      "@/lib/driver/orders": orders,
    }).default;
    const html = renderToStaticMarkup(React.createElement(Component, { assignmentId: id, orderId: "order-a" }));
    assert.ok(html.includes(orders.tripStatusLabels[status]));
    assert.ok(html.indexOf("車両</span>") < html.indexOf("車両番号</span>"));
    assert.ok(html.includes("足立300い4968"));
    assert.ok(html.includes("訂単名称")); assert.ok(html.includes("行程簡概")); assert.ok(html.includes("備考"));
    assert.ok(html.includes("&lt;Order&gt;")); assert.ok(html.includes("Airport\nHotel"));
    assert.ok(html.includes("&lt;script&gt;private notes&lt;/script&gt;"));
    assert.doesNotMatch(html, /<script>/);
    assert.equal(html.includes(">退回上一步</button>"), status !== "assigned");
    for (const [source, action] of Object.entries(orders.tripActions)) {
      assert.equal(html.includes(`>${action.label}</button>`), source === status);
    }
    assert.doesNotMatch(html, /finance_by_date|99999|order_price|secret/);
    assert.doesNotMatch(html, /仅在安全停車|行程状態不直接入账|驾驶中请勿操作手机/);
  }
});
test("Japan service date handles midnight and year rollover", () => {
  assert.equal(orders.japanDate(0, new Date("2026-10-26T15:00:00Z")), "2026-10-27");
  assert.equal(orders.japanDate(1, new Date("2026-12-31T14:59:59Z")), "2027-01-01");
  assert.equal(orders.serviceDateSchema.safeParse("2026-02-30").success, false);
});
test("home summarizes daily orders compactly with leading order numbers and bottom-right plates", () => {
  let cursor = 0;
  const trip = orders.projectDriverTripDetail({ ...row, order_name: "Home order",
    trip_summary: "Daily route\nSecond line", notes: "Bring sign\nCall on arrival",
    pickup: "東京駅 & 丸の内", destination: "成田空港" });
  trip.vehicleNumber = "足立300い4968";
  const second = orders.projectDriverTripDetail({ ...row, assignment_id: id.replace(/1$/, "2"),
    order_id: "order-b", departure_time: "13:00", status: "completed", order_name: "Second order",
    trip_summary: "Station to hotel", notes: "" });
  second.vehicleNumber = "品川500あ1234";
  const values = ["2026-10-27", { name: "Driver" }, [trip, second], false, "", "", 0, false];
  const Component = load("app/driver/trips.tsx", {
    react: { ...React, useEffect() {}, useRef: value => ({ current: value }), useState: () => [values[cursor++], () => {}] },
    "next/link": { default: "a" }, "@/lib/supabase/browser": {}, "@/lib/driver/orders": orders,
  }).default;
  const html = renderToStaticMarkup(React.createElement(Component, {}));
  assert.match(html, /全部訂単行程/);
  assert.match(html, /Home order/); assert.match(html, /Daily route\nSecond line/);
  assert.match(html, /訂単 1/); assert.match(html, /訂単 2/);
  assert.doesNotMatch(html, /序号/);
  assert.ok(html.indexOf("訂単 1") < html.indexOf("Home order"));
  assert.ok(html.indexOf("訂単 2") < html.indexOf("Second order"));
  assert.ok(html.indexOf("Daily route\nSecond line") < html.indexOf("車両番号：足立300い4968"));
  assert.match(html, /class="driver-daily-order"/);
  assert.match(html, /class="driver-muted driver-daily-plate"/);
  assert.match(html, /Second order/); assert.match(html, /Station to hotel/);
  assert.match(html, /車両番号：足立300い4968/); assert.match(html, /車両番号：品川500あ1234/);
  assert.match(html, /配車時間/); assert.match(html, /09:30/);
  assert.match(html, /Bring sign\nCall on arrival/);
  assert.ok(html.indexOf("車両</span>") < html.indexOf("車両番号</span>"));
  assert.ok(html.includes("足立300い4968"));
  assert.equal((html.match(/打开Google Maps导航/g) || []).length, 4);
  assert.ok(html.includes(orders.tripNavigationUrl(trip.pickup).replaceAll("&", "&amp;")));
  const url = new URL(orders.tripNavigationUrl(" javascript:alert(1)&destination=other "));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.searchParams.get("destination"), "javascript:alert(1)&destination=other");
  assert.equal(url.searchParams.get("travelmode"), "driving");
  assert.equal(orders.tripNavigationUrl("  "), null);
});
test("historical trip cards stay read-only without explanatory clutter", () => {
  for (const detail of [false, true]) {
    let cursor = 0;
    const trip = { ...orders.projectDriverTripDetail({ ...row, order_name: "Historical order", trip_summary: "Airport to hotel", notes: "" }),
      historical: true, assignmentId: null, status: "historical" };
    const values = ["2026-10-27", { name: "Driver" }, [trip], false, "", "", 0, false];
    const Component = load("app/driver/trips.tsx", {
      react: { ...React, useEffect() {}, useRef: value => ({ current: value }), useState: () => [values[cursor++], () => {}] },
      "next/link": { default: "a" }, "@/lib/supabase/browser": {}, "@/lib/driver/orders": orders,
    }).default;
    const html = renderToStaticMarkup(React.createElement(Component, detail ? { orderId: trip.orderId } : {}));
    assert.match(html, /历史訂単（只读）/);
    assert.doesNotMatch(html, /历史记录仅供查看|仅在安全停車|行程状態不直接入账|驾驶中请勿操作手机/);
    assert.doesNotMatch(html, /查看行程 ›|退回上一步/);
    for (const action of Object.values(orders.tripActions)) {
      assert.equal(html.includes(`>${action.label}</button>`), false);
    }
  }
});
test("driver portal slogans replace the home banner and personalized name greeting", () => {
  let cursor = 0;
  const values = ["2026-10-27",
    { name: "Driver", globalSlogan: "一路平安", personalSlogan: "安全驾驶，准時抵达" },
    [], false, "", "", 0, false];
  const Component = load("app/driver/trips.tsx", {
    react: { ...React, useEffect() {}, useRef: value => ({ current: value }), useState: () => [values[cursor++], () => {}] },
    "next/link": { default: "a" }, "@/lib/supabase/browser": {}, "@/lib/driver/orders": orders,
  }).default;
  const html = renderToStaticMarkup(React.createElement(Component, {}));
  assert.match(html, /一路平安/);
  assert.match(html, /安全驾驶，准時抵达/);
  assert.doesNotMatch(html, /仅显示本人有效派单|日本時間/);
  assert.doesNotMatch(html, /平安出行，美好的一天|Driver，你好/);
});
test("phone rollback asks for confirmation, posts only the preceding state and locks double taps", async () => {
  for (const status of orders.tripStates.slice(1)) {
    let cursor = 0; let confirmed = false; let resolve; const calls = [];
    const values = ["2026-10-27", { name: "Synthetic Driver" },
      [orders.projectDriverTrip({ ...row, status, version: 6 })], false, "", "", 0, false];
    const Component = load("app/driver/trips.tsx", {
      react: { ...React, useEffect() {}, useRef: value => ({ current: value }),
        useState: () => { const i = cursor++; return [values[i], value => { values[i] = value; }]; } },
      "next/link": { default: "a" }, "@/lib/supabase/browser": {}, "@/lib/driver/orders": orders,
    }, { window: { confirm: () => confirmed }, fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Promise(done => { resolve = done; });
    } }).default;
    const tree = Component({ assignmentId: id, orderId: "order-a" });
    const elements = node => !node || typeof node !== "object" ? [] :
      Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
    const back = elements(tree).find(e => e.type === "button" && e.props.children === "退回上一步");
    await back.props.onClick();
    assert.equal(calls.length, 0);
    confirmed = true;
    const pending = back.props.onClick();
    await back.props.onClick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `/api/driver/assignments/${id}/events`);
    assert.equal(calls[0].body.state, orders.tripPreviousStates[status]);
    assert.equal(calls[0].body.expectedVersion, 6);
    assert.ok(orders.assignmentIdSchema.safeParse(calls[0].body.requestId).success);
    resolve(Response.json({ version: 7, status: orders.tripPreviousStates[status] }));
    await pending;
    assert.match(values[5], /操作已记录/);
  }
});
test("LAN-compatible request IDs are unique valid UUID v4 without randomUUID", () => {
  const ids = Array.from({ length: 100 }, () => orders.createDriverRequestId());
  assert.equal(new Set(ids).size, 100);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(orders.assignmentIdSchema.safeParse(id).success, true);
  }
});
test("notes API validates identity, origin, assignment and a strict notes-only payload", async () => {
  const body = { expectedNotes: "Before", notes: "After\n备注" };
  for (const deny of [401, 403, 404, 503]) {
    const handler = route(notesRoute, { deny });
    assert.equal((await handler.POST(post({ body }), context)).status, deny);
    assert.equal(handler.calls.length, 0);
  }
  for (const [options, status] of [
    [{ body, origin: "https://evil.example" }, 403],
    [{ body, origin: null }, 403],
    [{ body, contentType: "text/plain" }, 415],
    [{ body: "{" }, 400],
    [{ body: { ...body, driverId: id } }, 400],
    [{ body: { ...body, notes: "x".repeat(5001) } }, 400],
    [{ body: { notes: "Missing baseline" } }, 400],
    [{ body: "x".repeat(100001) }, 413],
  ]) {
    const handler = route(notesRoute);
    assert.equal((await handler.POST(post(options), context)).status, status);
    assert.equal(handler.calls.length, 0);
  }
  const handler = route(notesRoute);
  assert.equal((await handler.POST(post({ body }), { params: Promise.resolve({ id: "invalid" }) })).status, 404);
  assert.equal(handler.calls.length, 0);
});
test("notes API saves only shared order notes and surfaces conflicts and unconfirmed saves", async () => {
  for (const notes of ["Updated\n备注", ""]) {
    const handler = route(notesRoute, { data: notes });
    const response = await handler.POST(post({ body: { expectedNotes: "Before", notes } }), context);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { notes });
    assert.equal(handler.calls[0].name, "update_driver_order_notes");
    assert.deepEqual(JSON.parse(JSON.stringify(handler.calls[0].args)), {
      target_assignment: id, expected_notes: "Before", target_notes: notes,
    });
  }
  for (const [code, status] of [["40001", 409], ["42501", 403], ["P0002", 404], ["22023", 422], ["XX000", 503]]) {
    const handler = route(notesRoute, { error: { code } });
    const response = await handler.POST(post({ body: { expectedNotes: "", notes: "New" } }), context);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
  }
  for (const data of [null, {}, "Different"]) {
    const handler = route(notesRoute, { data });
    assert.equal((await handler.POST(post({ body: { expectedNotes: "", notes: "New" } }), context)).status, 503);
  }
});
test("notes editor retains drafts during polling, locks saves, and preserves input on failure", async () => {
  const elements = node => !node || typeof node !== "object" ? [] :
    Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
  for (const status of [200, 409, 503]) {
    const values = [null, false, "", ""];
    let cursor = 0; let resolve; let calls = 0; let saved; let conflicts = 0;
    const locks = [];
    const refs = [];
    let refCursor = 0;
    const Component = load("components/driver-trip-notes.tsx", {
      react: { ...React,
        useRef: value => refs[refCursor++] ?? (refs[refCursor - 1] = { current: value }),
        useState: () => { const i = cursor++; return [values[i], value => {
          values[i] = typeof value === "function" ? value(values[i]) : value;
        }]; } },
    }, { fetch: async (url, options) => {
      calls++;
      assert.equal(url, `/api/driver/assignments/${id}/notes`);
      assert.deepEqual(JSON.parse(options.body), { notes: "Draft", expectedNotes: "Before" });
      return new Promise(done => { resolve = done; });
    } }).default;
    const props = { assignmentId: id, notes: "Before", disabled: false,
      onSavingChange: value => locks.push(value), onSaved: value => { saved = value; }, onConflict: () => conflicts++ };
    const render = (next = props) => { cursor = 0; refCursor = 0; return Component(next); };
    elements(render()).find(e => e.type === "textarea").props.onChange({ target: { value: "Draft" } });
    const tree = render({ ...props, notes: "Polled" });
    assert.equal(elements(tree).find(e => e.type === "textarea").props.value, "Draft");
    const save = elements(tree).find(e => e.type === "button" && e.props.children === "保存備考");
    save.props.onClick(); save.props.onClick();
    assert.equal(calls, 1);
    resolve(Response.json(status === 200 ? { notes: "Draft" } : { error: "Save rejected" }, { status }));
    await new Promise(done => setImmediate(done));
    assert.deepEqual(locks, [true, false]);
    if (status === 200) {
      assert.equal(saved, "Draft"); assert.equal(values[0], null); assert.match(values[3], /已保存/);
    } else {
      assert.equal(saved, undefined); assert.equal(values[0].notes, "Draft");
      assert.equal(values[2], "Save rejected");
      assert.equal(conflicts, status === 409 ? 1 : 0);
      const cancel = elements(render({ ...props, notes: "Polled" })).find(e => e.type === "button" && e.props.children === "取消编辑");
      cancel.props.onClick();
      assert.equal(elements(render({ ...props, notes: "Polled" })).find(e => e.type === "textarea").props.value, "Polled");
    }
  }
});
test("notes migration locks and authorizes assigned orders and updates no other field", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261116000000_driver_order_notes.sql", import.meta.url), "utf8");
  assert.match(sql, /security definer set search_path=''/);
  assert.match(sql, /for update of o/);
  assert.match(sql, /user_id=\(select auth\.uid\(\)\) and status='active' for share/);
  assert.match(sql, /driver_id=link\.driver_id and region_id=link\.region_id for update/);
  assert.match(sql, /public\.driver_orders\(null,target_assignment\)/);
  assert.match(sql, /coalesce\(item\.notes,''\) is distinct from expected_notes/);
  assert.match(sql, /errcode='40001'/);
  assert.match(sql, /update public\.orders set notes=target_notes where id=item\.id/);
  assert.match(sql, /revoke all .* from public,anon/);
  assert.doesNotMatch(sql, /grant .* on public\.orders|update public\.driver_assignments/i);
});
test("list API checks identity before RPC and validates exact query shape", async () => {
  for (const status of [401,403,404,503]) {
    const handler = route(getRoute, { deny: status });
    assert.equal((await handler.GET(get("?date=2026-10-27"))).status, status);
    assert.equal(handler.calls.length, 0);
  }
  for (const query of [
    "", "?date=invalid", "?date=2026-02-30", "?assignmentId=invalid", "?assignmentId=",
    "?assignmentId=&date=2026-10-27",
    `?assignmentId=${id}&date=2026-10-27`, "?date=2026-10-27&date=2026-10-28",
    "?date=2026-10-27&driverId=other", "?date=2026-10-27&regionId=other",
  ]) {
    const handler = route(getRoute);
    assert.equal((await handler.GET(get(query))).status, 400, query);
    assert.equal(handler.calls.length, 0);
  }
});
test("list and detail API use only dedicated RPC and minimal no-store DTO", async () => {
  for (const query of ["?date=2026-10-27", `?assignmentId=${id}`]) {
    const handler = route(getRoute, { data: [{ ...row, order_name: "Order", trip_summary: "Daily summary", notes: "Notes" }] });
    const response = await handler.GET(get(query));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
    const body = await response.json();
    assert.equal(body.trips.length, 1);
    assert.equal(body.trips[0].assignmentId, id);
    const detail = query.includes("assignmentId");
    assert.equal(Object.keys(body.trips[0]).length, 11);
    assert.equal(body.trips[0].vehicleNumber, "足立300い4968");
    assert.equal(handler.calls[0].name, detail ? "driver_trip_detail" : "driver_orders");
    assert.deepEqual(Object.keys(handler.calls[0].args), detail ? ["target_assignment"] : ["target_date"]);
    assert.deepEqual(body.trips[0].details, { orderName: "Order", tripSummary: "Daily summary", notes: "Notes" });
    if (!detail) assert.equal(handler.calls[1].name, "driver_trip_detail");
  }
  assert.equal((await route(getRoute).GET(get(`?assignmentId=${id}`))).status, 404);
  assert.equal((await route(getRoute, { error: { code: "XX000" } }).GET(get("?date=2026-10-27"))).status, 503);
  assert.equal((await route(getRoute, { data: [row] }).GET(get(`?assignmentId=${id}`))).status, 500);
  assert.equal((await route(getRoute, { data: [row] }).GET(get("?date=2026-10-27"))).status, 500);
  assert.equal((await route(getRoute, { historyError: { code: "XX000" } }).GET(get("?date=2026-10-27"))).status, 503);
  const empty = await route(getRoute).GET(get("?date=2026-10-27"));
  assert.deepEqual(await empty.json(), { trips: [] });
});
test("past-date API adds only strictly projected read-only historical orders", async () => {
  const handler = route(getRoute, { historyData: [{
    order_id: "a6000000-0000-4000-8000-000000000001", service_date: "2026-10-26", departure_time: "08:00",
    pickup: "Airport", destination: "Hotel", vehicle: "Test car", vehicle_number: "Plate",
    order_name: "Order", trip_summary: "Summary", notes: "Notes",
  }] });
  const response = await handler.GET(get("?date=2026-10-26"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.trips.length, 1);
  assert.equal(body.trips[0].historical, true);
  assert.equal(body.trips[0].assignmentId, null);
  assert.equal(body.trips[0].vehicleNumber, "Plate");
  assert.deepEqual(handler.calls.map(call => call.name), ["driver_orders", "driver_historical_orders"]);
});
test("vehicle numbers are assignment/date matched and failures never silently become blank plates", async () => {
  const data = [{ ...row, order_name: "Order", trip_summary: "", notes: "" }];
  for (const options of [
    { defaultsError: { code: "XX000" } },
    { defaults: { serviceDate: "2026-10-28", driverName: "Driver", orders: [] } },
    { defaults: { serviceDate: row.service_date, driverName: "Driver", orders: [] } },
  ]) {
    const response = await route(getRoute, { data, ...options }).GET(get(`?assignmentId=${id}`));
    assert.equal(response.status, 500);
  }
  const response = await route(getRoute, { data, defaults: {
    serviceDate: row.service_date, driverName: "Driver", orders: [{
      assignmentId: id, time: "", pickup: "", destination: "", vehicleNumber: "", depot: null,
    }],
  } }).GET(get(`?assignmentId=${id}`));
  assert.equal((await response.json()).trips[0].vehicleNumber, "");
});
test("acknowledgement enforces identity origin content type size and strict payload", async () => {
  assert.equal((await route(postRoute, { deny: 403 }).POST(post(), context)).status, 403);
  for (const origin of [null, "https://evil.example"]) {
    const handler = route(postRoute);
    assert.equal((await handler.POST(post({ origin }), context)).status, 403);
    assert.equal(handler.calls.length, 0);
  }
  assert.equal((await route(postRoute).POST(post({ contentType: "text/plain" }), context)).status, 415);
  assert.equal((await route(postRoute).POST(post({ body: "x".repeat(1025) }), context)).status, 413);
  for (const body of ["{", {}, { ...requestBody, driverId: id }, { ...requestBody, expectedVersion: 0 },
    { ...requestBody, requestId: "invalid" }, { ...requestBody, expectedVersion: 1.1 }]) {
    const handler = route(postRoute);
    assert.equal((await handler.POST(post({ body }), context)).status, 400);
    assert.equal(handler.calls.length, 0);
  }
  assert.equal((await route(postRoute).POST(post(), { params: Promise.resolve({ id: "invalid" }) })).status, 404);
});
test("acknowledgement surfaces conflicts, revocation and database faults", async () => {
  for (const [code, status] of [["P0002",404],["42501",403],["40001",409],["23505",409],["22023",422],["XX000",503]]) {
    const response = await route(postRoute, { error: { code } }).POST(post(), context);
    assert.equal(response.status, status);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
});
test("acknowledgement forwards version/idempotency and rejects invalid success-shaped output", async () => {
  const handler = route(postRoute, { data: 2 });
  const response = await handler.POST(post(), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version: 2, status: "acknowledged" });
  assert.equal(handler.calls[0].name, "acknowledge_driver_assignment");
  assert.equal(handler.calls[0].args.target_request, id);
  assert.equal(handler.calls[0].args.target_assignment, id);
  assert.equal(handler.calls[0].args.expected_version, 1);
  for (const data of [null, 0, "2", 1.5]) {
    assert.equal((await route(postRoute, { data }).POST(post(), context)).status, 500);
  }
});
test("execution endpoint preserves identity and shared request protections", async () => {
  for (const status of [401,403,404,503]) {
    const handler = route(eventRoute, { deny: status });
    assert.equal((await handler.POST(post({ body: { ...requestBody, state: "en_route" } }), context)).status, status);
    assert.equal(handler.calls.length, 0);
  }
  for (const [options, status] of [
    [{ origin: "https://evil.example" },403],
    [{ origin: null },403],
    [{ contentType: "text/plain" },415],
    [{ body: "x".repeat(1025) },413],
    [{ body: "{" },400],
    ...["revoked","cancelled","unknown",null].map(state => [{ body: { ...requestBody, state } },400]),
    [{ body: { ...requestBody, state: "en_route", driverId: id } },400],
    [{ body: { ...requestBody, state: "en_route", occurredAt: "2099-01-01" } },400],
    [{ body: { ...requestBody, state: "en_route", expectedVersion: 0 } },400],
    [{ body: { ...requestBody, state: "en_route", requestId: "invalid" } },400],
  ]) {
    const handler = route(eventRoute);
    assert.equal((await handler.POST(post(options), context)).status, status);
    assert.equal(handler.calls.length, 0);
  }
});
test("execution endpoint sends exact target state and returns minimal uncached result", async () => {
  for (const state of orders.tripStates) {
    const handler = route(eventRoute, { data: 3 });
    const response = await handler.POST(post({ body: { ...requestBody, state } }), context);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: 3, status: state });
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    assert.deepEqual(JSON.parse(JSON.stringify(handler.calls)), [{
      name: "transition_driver_assignment",
      args: { target_assignment: id, expected_version: 1, target_request: id, target_state: state },
    }]);
  }
  for (const [code,status] of [["P0002",404],["42501",403],["40001",409],["23505",409],["22023",422],["XX000",503]]) {
    assert.equal((await route(eventRoute, { error: { code } }).POST(
      post({ body: { ...requestBody, state: "completed" } }), context)).status, status);
  }
  assert.equal((await route(eventRoute, { data: null }).POST(
    post({ body: { ...requestBody, state: "completed" } }), context)).status, 500);
});
test("refresh keeps current trips visible and locks actions until fresh data arrives", () => {
  const trip = orders.projectDriverTrip(row);
  const states = ["2026-10-27", { name: "Driver" }, [trip], false, "Old error", "", 0, false, false];
  let cursor = 0;
  const options = {
    react: { ...React, useEffect() {}, useRef: value => ({ current: value }),
      useState() { const i = cursor++; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "next/link": { default: "a" }, "@/lib/supabase/browser": {}, "@/lib/driver/orders": orders,
  };
  const Component = load("app/driver/trips.tsx", options).default;
  const elements = node => !node || typeof node !== "object" ? [] :
    Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
  const tree = elements(Component({}));
  assert.equal(tree.find(node => node.type === "button" && node.props.children === "刷新"), undefined);
  const calendar = tree.find(node => node.type === "a" && node.props.href === "/driver/calendar");
  assert.equal(calendar.props.children, "日历");
  const source = readFileSync(new URL("../app/driver/trips.tsx", import.meta.url), "utf8");
  assert.match(source, /function refresh\(\) \{ setRefreshing\(true\); setError\(""\); setRevision/);
  states[8] = true;
  cursor = 0;
  const html = renderToStaticMarkup(React.createElement(Component, { assignmentId: id, orderId: trip.orderId }));
  assert.match(html, /正在更新…/);
  assert.doesNotMatch(html, /正在核验并读取行程/);
  for (const button of html.match(/<button class="driver-button[^"]*"[^>]*>/g)) assert.match(button, /disabled/);
  assert.match(source, /await Promise\.all\(\[\s*fetch\("\/api\/driver\/me"/);
});
