import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
function load(relative, mocks = {}, globals = {}) {
  const filename = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, { module: compiled, exports: compiled.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] :
      name === "@/app/driver/navigation" ? load("app/driver/navigation.tsx", mocks, globals) :
      name === "@/components/report-duty-fields" ? load("components/report-duty-fields.tsx", { "@/lib/driver/reports": reports }) :
      name === "./report.module.css" ? { default: { report: "driver-report" } } : require(name),
    Request, Response, Headers, URL, Date, Intl, process, console: { error() {} }, ...globals,
  });
  return compiled.exports;
}
const reports = load("lib/driver/reports.ts");
const { jsonResponse } = load("lib/api-response.ts");
const id = "c6000000-0000-4000-8000-000000000001";
const fixture = {
  id, serviceDate: "2026-10-27", version: 1,
  departedAt: "2026-10-27T23:00:00+09:00", departureAddress: "Synthetic depot", departureKm: 100,
  returnedAt: "2026-10-28T02:30:00+09:00", returnAddress: "Synthetic return", returnKm: 142.5,
  stops: [], rests: [
    { startedAt: "2026-10-27T23:30:00+09:00", endedAt: "2026-10-28T00:00:00+09:00" },
    { startedAt: "2026-10-28T01:00:00+09:00", endedAt: "2026-10-28T01:15:00+09:00" },
  ],
};
const checkout = { reportId: null, expectedVersion: 0, requestId: id, action: "checkout",
  payload: { useDefault: false, address: "Synthetic depot", km: 100 } };
const defaultsFixture = { serviceDate: fixture.serviceDate, driverName: "Linked driver",
  orders: [{ assignmentId: id, time: "09:00", pickup: "Airport", destination: "Hotel",
    vehicleNumber: "Linked plate", depot: { name: "Vehicle owner", address: "Owner garage" } },
  { assignmentId: id.replace(/1$/, "2"), time: "14:00", pickup: "Hotel", destination: "Airport",
    vehicleNumber: "Second plate", depot: null }] };

test("saved reports poll latest plates but never overwrite dirty or saving forms, including late responses", async () => {
  for (const mode of ["clean", "dirty", "saving", "late-dirty"]) {
    const data = { vehicleLinking: true, reports: [{ ...fixture,
      header: { vehicleNumber: "BASE", assignmentId: id, driverName: "Driver", passengerCount: 1 },
      orderOptions: [{ assignmentId: id, label: "Synthetic order", vehicleNumber: "BASE" }],
    }], depot: null };
    const states = [data, null, "", "", false, mode === "saving", 0, Date.now(),
      false, mode === "dirty", fixture.serviceDate, null, "", ""];
    let cursor = 0; const effects = []; let tick; let resolve; let signal; let cleared = false;
    const Component = load("app/driver/report/report.tsx", {
      react: { ...React, useEffect: effect => effects.push(effect), useRef: value => ({ current: value }),
        useState: () => { const index = cursor++; return [states[index], value => { states[index] = value; }]; } },
      "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
      "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
    }, { document: { visibilityState: "visible" }, AbortController,
      setInterval: (callback, delay) => { assert.equal(delay, 10000); tick = callback; return 1; },
      clearInterval: timer => { assert.equal(timer, 1); cleared = true; },
      fetch: async (url, options) => {
        assert.equal(url, "/api/driver/reports"); signal = options.signal;
        return new Promise(done => { resolve = done; });
      } }).default;
    const tree = Component();
    const cleanup = effects[1]();
    if (mode === "dirty" || mode === "saving") { assert.equal(tick, undefined); continue; }
    tick();
    if (mode === "late-dirty") {
      const walk = node => !React.isValidElement(node) ? [] :
        [node, ...React.Children.toArray(node.props.children).flatMap(walk)];
      walk(tree).find(node => node.props["aria-label"] === "日报基本信息").props.onInput();
    }
    resolve(Response.json({ ...data, reports: [{ ...data.reports[0],
      header: { ...data.reports[0].header, vehicleNumber: "NEW" } }] }));
    await new Promise(done => setImmediate(done));
    assert.equal(states[0].reports[0].header.vehicleNumber, mode === "clean" ? "NEW" : "BASE");
    cleanup(); assert.equal(signal.aborted, true); assert.equal(cleared, true);
    const html = renderToStaticMarkup(tree);
    assert.match(html, /日报关联訂単/);
    assert.match(html, /修改并保存也会更新訂単/);
  }
});

test("report defaults API validates date and identity and exposes only minimal no-store defaults", async () => {
  function defaultsHandler({ deny, result = defaultsFixture, error = null } = {}) {
    const calls = [];
    const api = load("app/api/driver/report-defaults/route.ts", {
      "@/lib/api-response": { jsonResponse }, "@/lib/driver/reports": reports,
      "@/lib/driver/authorization": { requireDriver: async () => deny ? { response: jsonResponse({}, { status: deny }) } :
        { supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data: result, error }; } } } },
    });
    return { ...api, calls };
  }
  for (const deny of [401, 403, 404, 503]) {
    const h = defaultsHandler({ deny });
    assert.equal((await h.GET(new Request("https://driver.example/api/driver/report-defaults?date=2026-10-27"))).status, deny);
    assert.equal(h.calls.length, 0);
  }
  for (const query of ["", "?date=2026-02-30", "?date=2026-10-27&driverId=x", "?date=2026-10-27&date=2026-10-28"]) {
    const h = defaultsHandler();
    assert.equal((await h.GET(new Request(`https://driver.example/api/driver/report-defaults${query}`))).status, 400);
    assert.equal(h.calls.length, 0);
  }
  const h = defaultsHandler();
  const response = await h.GET(new Request("https://driver.example/api/driver/report-defaults?date=2026-10-27"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), defaultsFixture);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: "driver_report_defaults", args: { target_date: fixture.serviceDate } }]);
  for (const options of [{ result: null }, { result: { ...defaultsFixture, password: "no" } },
    { result: { ...defaultsFixture, orders: [{ ...defaultsFixture.orders[0], price: 999 }] } }])
    assert.equal((await defaultsHandler(options).GET(new Request("https://driver.example?date=2026-10-27"))).status, 500);
  assert.equal((await defaultsHandler({ error: { code: "XX000" } }).GET(new Request("https://driver.example?date=2026-10-27"))).status, 503);
});

test("new report requires order selection, permits manual defaults and clears wrong-date defaults", async () => {
  const states = [{ reports: [], depot: { name: "Wrong depot", address: "Wrong address" } },
    null, "", "", false, false, 0, Date.now(), false, false, fixture.serviceDate, defaultsFixture, "", ""];
  const runtime = require("react/jsx-runtime");
  let cursor; let refCursor; let select; let date; let checkoutProps; let sent;
  const header = { reportValidity: () => true, fields: { serviceDate: fixture.serviceDate,
    vehicleNumber: "Manual plate", driverName: "Manual name", passengerCount: "" } };
  function capture(create) {
    return (type, props, ...rest) => {
      if (props?.["aria-label"] === "关联当天訂単") select = props;
      if (props?.name === "serviceDate") date = props;
      if (typeof type === "function" && type.name === "LocationRows") checkoutProps = props;
      return create(type, props, ...rest);
    };
  }
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React, useEffect() {}, useRef: v => ({ current: refCursor++ === 1 ? header : v }),
      useState: initial => { const i = cursor++; if (i >= states.length) return [initial, () => {}];
        return [states[i], v => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/supabase/browser": {}, "@/lib/driver/orders": { createDriverRequestId: () => id }, "@/lib/driver/reports": reports,
  }, {
    window: { confirm: () => true },
    FormData: class { constructor(form) { this.get = name => form.fields[name] ?? ""; } },
    fetch: async (_url, options) => { sent = JSON.parse(options.body); return Response.json({ report: fixture }); },
  }).default;
  function render() { cursor = 0; refCursor = 0; return renderToStaticMarkup(React.createElement(Component)); }
  let html = render();
  assert.equal(checkoutProps.disabled, true);
  assert.match(html, /请選択当天訂単/);
  select.onChange({ target: { value: id } });
  html = render();
  assert.equal(checkoutProps.disabled, false);
  assert.match(html, /value="Linked plate"/);
  assert.match(html, /value="Linked driver"/);
  assert.match(html, /value="Owner garage"/);
  assert.doesNotMatch(html, /Wrong address|Wrong depot/);
  select.onChange({ target: { value: defaultsFixture.orders[1].assignmentId } });
  html = render();
  assert.match(html, /value="Second plate"/);
  assert.match(html, /请手动填写/);
  assert.doesNotMatch(html, /value="Owner garage"/);
  assert.equal(await checkoutProps.save({ useDefault: false, address: "Manual garage", km: 100 }), true);
  assert.equal(sent.payload.useDefault, false);
  assert.equal(sent.payload.address, "Manual garage");
  assert.equal(sent.payload.header.vehicleNumber, "Manual plate");
  assert.equal(sent.payload.header.driverName, "Manual name");
  states[0] = { reports: [], depot: null };
  render();
  date.onChange({ target: { value: "2026-10-28" } });
  html = render();
  assert.equal(states[11], null);
  assert.equal(states[12], "");
  assert.equal(checkoutProps.disabled, true);
  assert.doesNotMatch(html, /value="Linked plate"|value="Second plate"|value="Owner garage"/);
  states[11] = { serviceDate: "2026-10-28", driverName: "Linked driver", orders: [] };
  html = render();
  assert.equal(checkoutProps.disabled, false);
  assert.match(html, /当天没有已派给本人的訂単/);
  states[0] = { reports: [{ ...fixture, header: { vehicleNumber: "Saved plate", driverName: "Saved name", passengerCount: null } }], depot: null };
  html = render();
  assert.match(html, /value="Saved plate"/);
  assert.match(html, /value="Saved name"/);
  assert.doesNotMatch(html, /aria-label="关联当天訂単"/);
});

test("defaults loader ignores late dates, auto-selects a single order and surfaces failures", async () => {
  for (const mode of ["cancelled", "single", "wrong-date", "failed"]) {
    const states = [{ reports: [], depot: null }, null, "", "", false, false, 0, Date.now(),
      false, false, fixture.serviceDate, null, "", ""];
    let cursor = 0; const effects = []; let resolve; let signal;
    const Component = load("app/driver/report/report.tsx", {
      react: { ...React, useEffect: effect => effects.push(effect), useRef: v => ({ current: v }),
        useState: () => { const i = cursor++; return [states[i], v => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; } },
      "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
      "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
    }, {
      AbortController, document: { visibilityState: "visible" },
      fetch: async (url, options) => {
        assert.equal(url, `/api/driver/report-defaults?date=${fixture.serviceDate}`);
        signal = options.signal;
        return new Promise(done => { resolve = done; });
      },
    }).default;
    renderToStaticMarkup(React.createElement(Component));
    const cleanup = effects[2]();
    if (mode === "cancelled") { cleanup(); assert.equal(signal.aborted, true); }
    resolve(Response.json({ ...defaultsFixture, serviceDate: mode === "wrong-date" ? "2026-10-28" : fixture.serviceDate,
      orders: [defaultsFixture.orders[0]] }, { status: mode === "failed" ? 503 : 200 }));
    await new Promise(done => setImmediate(done));
    if (mode === "single") {
      assert.equal(states[11].driverName, "Linked driver");
      assert.equal(states[12], id);
    } else {
      assert.equal(states[11], null);
      assert.equal(states[12], "");
      assert.equal(Boolean(states[13]), mode !== "cancelled");
    }
    cleanup();
  }
});
test("manual report header validates strict fields and shifts all dates preserving midnight and microseconds", () => {
  const header = { serviceDate: "2026-10-25", vehicleNumber: "TEST", driverName: "Manual", passengerCount: null };
  assert.equal(reports.reportHeaderSchema.safeParse(header).success, true);
  for (const change of [{ serviceDate: "2026-02-30" }, { passengerCount: -1 }, { passengerCount: 1.5 },
    { passengerCount: 1000 }, { driverName: "x".repeat(101) }, { driverId: id }])
    assert.equal(reports.reportHeaderSchema.safeParse({ ...header, ...change }).success, false);
  const original = { ...fixture, stops: [{ id, address: "Night stop",
    arrivedAt: "2026-10-28T00:10:32.123456+09:00", departedAt: "2026-10-28T00:30:45.654321+09:00",
    arrivedKm: 110, departedKm: 110 }] };
  const shifted = reports.reportOnDate(original, header.serviceDate);
  assert.equal(reports.toJapanInput(shifted.departedAt).slice(0, 16), "2026-10-25T23:00");
  assert.equal(shifted.stops[0].arrivedAt, "2026-10-25T15:10:32.123456Z");
  assert.equal(shifted.stops[0].departedAt, "2026-10-25T15:30:45.654321Z");
  assert.equal(reports.toJapanInput(shifted.returnedAt).slice(0, 16), "2026-10-26T02:30");
  assert.equal(reports.reportTotals(shifted).restMs, reports.reportTotals(original).restMs);
  assert.equal(reports.reportTotals(shifted).elapsedMs, reports.reportTotals(original).elapsedMs);
  assert.equal(reports.toJapanInput(shifted.rests[0].startedAt).slice(0, 10), "2026-10-25");
  assert.equal(original.serviceDate, fixture.serviceDate);
  assert.equal(reports.reportOnDate(original, original.serviceDate), original);
  const yearEnd = reports.reportOnDate(original, "2026-12-31");
  assert.equal(reports.toJapanInput(yearEnd.stops[0].arrivedAt).slice(0, 16), "2027-01-01T00:10");
  assert.equal(reports.reportTotals(yearEnd).restMs, reports.reportTotals(original).restMs);
  assert.equal(reports.reportCommandSchema.safeParse({ ...checkout, payload: { ...checkout.payload, header } }).success, true);
});
test("duty roll-call times are optional independent minute clocks and survive report date changes", () => {
  const header = { serviceDate: fixture.serviceDate, vehicleNumber: "", driverName: "", passengerCount: null,
    dutyStartTime: "23:30", dutyEndTime: "02:15" };
  assert.equal(reports.reportHeaderSchema.safeParse(header).success, true);
  assert.equal(reports.reportCommandSchema.safeParse({ ...checkout,
    payload: { ...checkout.payload, header } }).success, true);
  for (const field of ["dutyStartTime", "dutyEndTime"]) {
    for (const value of ["24:00", "12:60", "9:00", "", "12:00:00", 123, false])
      assert.equal(reports.reportHeaderSchema.safeParse({ ...header, [field]: value }).success, false);
    assert.equal(reports.reportHeaderSchema.safeParse({ ...header, [field]: null }).success, true);
  }
  const shifted = reports.reportOnDate({ ...fixture, header: {
    vehicleNumber: "", driverName: "", passengerCount: null, dutyStartTime: "23:30", dutyEndTime: "02:15",
  } }, "2026-10-25");
  assert.equal(shifted.header.dutyStartTime, "23:30");
  assert.equal(shifted.header.dutyEndTime, "02:15");
});
test("manual return is optional until filled, rolls past midnight and remains editable", () => {
  const form = fields => ({ get: name => fields[name] ?? "" });
  const open = { ...fixture, returnedAt: null, returnAddress: null, returnKm: null };
  assert.equal(reports.returnFromForm(open, form({}), fixture.departedAt), undefined);
  for (const fields of [{ address: "Depot" }, { km: "120" }, { returnedAt: "00:20" }])
    assert.throws(() => reports.returnFromForm(open, form(fields), fixture.departedAt), /同时填写/);
  const returned = reports.returnFromForm(open, form({ address: "Depot", km: "120", returnedAt: "00:20" }), fixture.departedAt);
  assert.equal(returned.returnedAt, "2026-10-27T15:20:00.000Z");
  assert.equal(reports.returnFromForm(fixture, form({ address: "Edited", km: "150", returnedAt: "02:30" }), fixture.departedAt).returnedAt, fixture.returnedAt);
  assert.throws(() => reports.returnFromForm(fixture, form({}), fixture.departedAt), /不能清空/);
  const command = { reportId: id, expectedVersion: 1, requestId: id, action: "edit_stops", payload: { stops: [], return: returned } };
  assert.equal(reports.reportCommandSchema.safeParse(command).success, true);
  assert.equal(reports.reportCommandSchema.safeParse({ ...command, payload: { stops: [], return: { ...returned, km: -1 } } }).success, false);
});
test("departure editing keeps its original Japan date, preserves seconds and validates input", () => {
  const form = fields => ({ get: name => fields[name] ?? "" });
  const fields = { address: "Edited depot", km: "99.5", departedAt: "00:15" };
  const value = reports.departureFromForm(fixture, form(fields));
  assert.equal(value.departedAt, "2026-10-26T15:15:00.000Z");
  assert.equal(value.address, "Edited depot");
  assert.equal(value.km, 99.5);
  const original = { ...fixture, departedAt: "2026-10-27T23:00:12.123456+09:00" };
  assert.equal(reports.departureFromForm(original, form({ ...fields, departedAt: "23:00" })).departedAt, original.departedAt);
  for (const departedAt of ["", "24:00", "bad"])
    assert.throws(() => reports.departureFromForm(fixture, form({ ...fields, departedAt })), /有效出库时间/);
  const command = { reportId: id, expectedVersion: 1, requestId: id, action: "edit_stops", payload: { stops: [], departure: value } };
  assert.equal(reports.reportCommandSchema.safeParse(command).success, true);
  for (const departure of [{ ...value, km: -1 }, { ...value, driverId: id },
    { ...value, departedAt: "2026-10-27T12:00" }, { ...value, address: "" }])
    assert.equal(reports.reportCommandSchema.safeParse({ ...command, payload: { stops: [], departure } }).success, false);
});
test("time-only stops roll forward in Japan across midnight, month and year boundaries", () => {
  for (const [previous, input, expected] of [
    ["2026-10-27T23:50:00+09:00", "00:10", "2026-10-27T15:10:00.000Z"],
    ["2026-10-31T23:50:00+09:00", "00:10", "2026-10-31T15:10:00.000Z"],
    ["2026-12-31T23:50:00+09:00", "00:10", "2026-12-31T15:10:00.000Z"],
    ["2026-10-27T09:00:00+09:00", "10:00", "2026-10-27T01:00:00.000Z"],
    ["2026-10-27T09:00:45+09:00", "09:00", "2026-10-27T00:00:45.000Z"],
  ]) assert.equal(reports.stopTime(input, previous), expected);
  assert.equal(reports.stopTime("", fixture.departedAt), null);
  for (const input of ["24:00", "1:30", "12:60", "12:30:01", "2026-10-27T12:30", "bad"])
    assert.throws(() => reports.stopTime(input, fixture.departedAt), /HH:mm/);
  const original = "2026-10-28T00:10:32.123456+09:00";
  assert.equal(reports.stopTime("00:10", fixture.departedAt, original), original);
  assert.equal(reports.stopTime("00:10", "2026-10-29T23:00:00+09:00", original), "2026-10-29T15:10:00.000Z");
  const first = reports.stopFromForm({ id, address: "a", arrivedAt: null, arrivedKm: null, departedAt: null, departedKm: null },
    { get: key => ({ address: "a", km: "110", arrivedAt: "23:55", departedAt: "00:10" })[key] }, fixture.departedAt);
  const second = reports.stopFromForm({ ...first, id: id.replace(/1$/, "2"), arrivedAt: null, departedAt: null },
    { get: key => ({ address: "b", km: "120", arrivedAt: "00:20", departedAt: "00:40" })[key] }, first.departedAt);
  assert.equal(first.departedAt, "2026-10-27T15:10:00.000Z");
  assert.equal(second.arrivedAt, "2026-10-27T15:20:00.000Z");
  assert.equal(second.departedAt, "2026-10-27T15:40:00.000Z");
  assert.equal(reports.reportTotals({ ...fixture, stops: [first, second] }).restMs, 35 * 60000);
});
function handler({ deny, data = { reports: [], depot: null }, error = null } = {}) {
  const calls = [];
  const route = load("app/api/driver/reports/route.ts", {
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/reports": reports,
    "@/lib/driver/assignment-action": { isDriverActionOrigin: r => r.headers.get("origin") === "https://driver.example" },
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => true },
    "@/lib/driver/authorization": { requireDriver: async () => deny ?
      { response: jsonResponse({ error: "Denied" }, { status: deny }) } :
      { response: null, supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data, error }; } } } },
  });
  return { ...route, calls };
}
test("duty order uses Japanese dates, permits future/equal/unfinished times and never tightens historical reads", () => {
  const valid = { departedAt: "2099-12-31T23:30:00+09:00", returnedAt: "2100-01-01T00:10:00+09:00",
    header: { dutyStartDate: "2099-12-31", dutyStartTime: "23:20",
      dutyEndDate: "2100-01-01", dutyEndTime: "00:20" } };
  assert.equal(reports.reportTimeOrderError(valid), null);
  assert.equal(reports.reportTimeOrderError({ ...valid,
    header: { ...valid.header, dutyStartTime: "23:30", dutyEndTime: "00:10" } }), null);
  assert.equal(reports.reportTimeOrderError({ ...valid, returnedAt: null }), null);
  assert.equal(reports.reportTimeOrderError({ ...valid, header: null }), null);
  assert.equal(reports.reportTimeOrderError({ ...valid, header: { ...valid.header, dutyStartTime: "23:31" } }),
    reports.reportTimeErrors.PDT01);
  assert.equal(reports.reportTimeOrderError({ ...valid, header: { ...valid.header, dutyEndTime: "00:09" } }),
    reports.reportTimeErrors.PDT03);
  const screenshot = { departedAt: "2026-10-27T21:31:00+09:00", returnedAt: "2026-10-27T22:40:00+09:00",
    header: { dutyStartDate: "2026-10-27", dutyStartTime: "21:26", dutyEndDate: "2026-10-27", dutyEndTime: "22:30" } };
  assert.equal(reports.reportTimeOrderError(screenshot), reports.reportTimeErrors.PDT03);
  assert.equal(reports.reportTimeOrderError({ ...screenshot, header: { ...screenshot.header, dutyEndTime: "22:45" } }), null);
  assert.equal(reports.reportSchema.safeParse({ ...fixture, header: undefined }).success, true);
});
test("time-order SQL codes return specific safe actionable errors", async () => {
  for (const [code, message] of Object.entries(reports.reportTimeErrors)) {
    const api = handler({ error: { code, message: "private database detail" } });
    const response = await api.POST(request());
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, message);
  }
});
function request(body = checkout, origin = "https://driver.example", type = "application/json") {
  return new Request("https://driver.example/api/driver/reports", { method: "POST",
    headers: { Origin: origin, "Content-Type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
test("daily totals sum stop dwell times across midnight and ignore legacy manual rests", () => {
  const r = reports.reportSchema.parse({ ...fixture, stops: [
    { id, address: "Stop 1", arrivedAt: "2026-10-27T23:45:00+09:00", departedAt: "2026-10-28T00:15:00+09:00", arrivedKm: 110, departedKm: 110 },
    { id: id.replace(/1$/, "2"), address: "Stop 2", arrivedAt: "2026-10-28T01:00:00+09:00", departedAt: "2026-10-28T01:20:00+09:00", arrivedKm: 120, departedKm: 120 },
  ] });
  const totals = reports.reportTotals(r);
  assert.equal(totals.elapsedMs, 3.5 * 3600000);
  assert.equal(totals.restMs, 50 * 60000);
  assert.equal(reports.reportTotals({ ...r, stops: [] }).restMs, 0);
  assert.equal(reports.reportTotals({ ...r, stops: [r.stops[0], { ...r.stops[1], departedAt: "2026-10-28T01:30:00+09:00" }] }).restMs, 60 * 60000);
  assert.equal(totals.distance, 42.5);
  assert.equal(reports.durationLabel(totals.elapsedMs), "3小时30分");
  assert.equal(reports.durationLabel(27 * 3600000), "27小时0分");
  assert.equal(r.serviceDate, "2026-10-27");
});
test("ongoing shift and rest totals use current time and return only finalized distance", () => {
  const r = { ...fixture, returnedAt: null, returnAddress: null, returnKm: null,
    rests: [{ startedAt: "2026-10-28T00:00:00+09:00", endedAt: null }],
    stops: [{ id, address: "Ongoing", arrivedAt: "2026-10-28T01:00:00+09:00", arrivedKm: 120, departedAt: null, departedKm: null }] };
  const totals = reports.reportTotals(r, Date.parse("2026-10-28T01:15:00+09:00"));
  assert.equal(totals.elapsedMs, 135 * 60000);
  assert.equal(totals.restMs, 15 * 60000);
  assert.equal(totals.distance, null);
  assert.equal(reports.reportTotals({ ...r, stops: [{ ...r.stops[0], arrivedAt: null, arrivedKm: null }] }).restMs, 0);
});
test("manual time input is unambiguously Japanese even across year boundary", () => {
  assert.equal(reports.toJapanInput("2026-12-31T15:00:00Z"), "2027-01-01T00:00:00");
  assert.equal(reports.fromJapanInput("2027-01-01T00:00:00"), "2026-12-31T15:00:00.000Z");
  assert.equal(reports.fromJapanInput(""), null);
});
test("checkout commands require odometers and either a default depot or explicit location", () => {
  assert.equal(reports.reportCommandSchema.safeParse(checkout).success, true);
  assert.equal(reports.reportCommandSchema.safeParse({ ...checkout, payload: { useDefault: true, address: "", km: 0 } }).success, true);
  for (const payload of [
    { useDefault: false, address: "", km: 10 },
    { useDefault: false, address: "x", km: -1 },
    { useDefault: false, address: "x", km: 0.01 },
    { useDefault: false, address: "x", km: "10" },
    { useDefault: false, address: "x", km: null },
    { useDefault: false, address: "x", km: 1, driverId: id },
    { useDefault: false, address: "x".repeat(301), km: 1 },
  ]) assert.equal(reports.reportCommandSchema.safeParse({ ...checkout, payload }).success, false);
  assert.equal(reports.reportCommandSchema.safeParse({ ...checkout, reportId: id }).success, false);
});
test("every report command has a strict payload and corrections need no reason but require time offsets", () => {
  const base = { reportId: id, expectedVersion: 1, requestId: id };
  for (const [action,payload] of [
    ["add_stop", { address: "Stop" }], ["add_stop", { address: "Stop", km: 123.4 }], ["arrive", { stopId: id, km: 10 }],
    ["depart", { stopId: id, km: 10 }],
    ["return", { useDefault: false, address: "Return", km: 20 }],
    ["edit_stop", { id, address: "Stop", arrivedAt: fixture.departedAt, arrivedKm: 100,
      departedAt: null, departedKm: null }],
  ]) {
    assert.equal(reports.reportCommandSchema.safeParse({ ...base, action, payload }).success, true, action);
    assert.equal(reports.reportCommandSchema.safeParse({ ...base, action, payload: { ...payload, regionId: id } }).success, false);
  }
  for (const payload of [
    { id, address: "Stop", arrivedAt: null, arrivedKm: null, departedAt: null, departedKm: null, reason: "obsolete" },
    { id, address: "Stop", arrivedAt: "2026-10-27T12:00:00", arrivedKm: 10, departedAt: null, departedKm: null },
  ]) assert.equal(reports.reportCommandSchema.safeParse({ ...base, action: "edit_stop", payload }).success, false);
  assert.equal(reports.reportCommandSchema.safeParse({ ...base, action: "approve", payload: {} }).success, false);
  for (const action of ["rest_start", "rest_end"])
    assert.equal(reports.reportCommandSchema.safeParse({ ...base, action, payload: {} }).success, false);
  for (const payload of [
    { address: "Stop", km: 100, arrivedAt: null, departedAt: null },
    { address: "Stop", km: 100, arrivedAt: fixture.departedAt, departedAt: null },
    { address: "Stop", km: 100, arrivedAt: fixture.departedAt, departedAt: fixture.returnedAt },
  ]) assert.equal(reports.reportCommandSchema.safeParse({ ...base, action: "add_stop", payload }).success, true);
  for (const payload of [
    { address: "Stop", km: 100, arrivedAt: null, departedAt: fixture.returnedAt },
    { address: "Stop", km: 100, arrivedAt: fixture.returnedAt, departedAt: fixture.departedAt },
    { address: "Stop", arrivedAt: fixture.departedAt },
    { address: "Stop", km: 100, arrivedAt: "2026-10-27T23:00" },
  ]) assert.equal(reports.reportCommandSchema.safeParse({ ...base, action: "add_stop", payload }).success, false);
});
test("reports API denies anonymous, suspended or pending before touching RPC", async () => {
  for (const deny of [401,403,404,503]) {
    const h = handler({ deny });
    assert.equal((await h.GET(new Request("https://driver.example/api/driver/reports"))).status, deny);
    assert.equal((await h.POST(request())).status, deny);
    assert.equal(h.calls.length, 0);
  }
});
test("blank stop removal requires a strict ID and preserves nonempty fields including zero km", async () => {
  const blank = { id, address: "", plannedKm: null, arrivedAt: null, arrivedKm: null, departedAt: null, departedKm: null };
  assert.equal(reports.isBlankReportStop(blank), true);
  for (const change of [{ address: "Filled" }, { plannedKm: 0 }, { arrivedKm: 0 }, { departedKm: 0 },
    { arrivedAt: fixture.departedAt }, { departedAt: fixture.returnedAt }])
    assert.equal(reports.isBlankReportStop({ ...blank, ...change }), false);
  const command = { reportId: id, expectedVersion: 1, requestId: id, action: "remove_stop", payload: { stopId: id } };
  const h = handler({ data: { ...fixture, stops: [], version: 2 } });
  const response = await h.POST(request(command));
  assert.equal(response.status, 200);
  assert.equal(h.calls[0].args.target_action, "remove_stop");
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args.payload)), { stopId: id });
  const denied = await handler({ error: { code: "22023" } }).POST(request(command));
  assert.equal(denied.status, 422);
  assert.match((await denied.json()).error, /只能删除全空/);
  for (const payload of [{}, { stopId: "bad" }, { stopId: id, driverId: id }, { stopId: id, force: true }]) {
    const invalid = handler();
    assert.equal((await invalid.POST(request({ ...command, payload }))).status, 400);
    assert.equal(invalid.calls.length, 0);
  }
});
test("reports GET rejects ownership selectors and uses strict minimal no-store output", async () => {
  for (const query of ["?driverId=x","?regionId=x","?date=2026-10-27"]) {
    const h = handler();
    assert.equal((await h.GET(new Request(`https://driver.example/api/driver/reports${query}`))).status, 400);
    assert.equal(h.calls.length, 0);
  }
  const h = handler({ data: { reports: [fixture], depot: null } });
  const response = await h.GET(new Request("https://driver.example/api/driver/reports"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), { reports: [fixture], depot: null });
  assert.equal(h.calls[0].name, "driver_reports");
  assert.equal((await handler({ data: { reports: [{ ...fixture, profit: 10 }], depot: null } })
    .GET(new Request("https://driver.example/api/driver/reports"))).status, 500);
});
test("report writes reject cross-origin malformed oversized or privileged payloads", async () => {
  for (const [req,status] of [
    [request(checkout,"https://evil.example"),403], [request(checkout,"null"),403],
    [request(checkout,"https://driver.example","text/plain"),415],
    [request("x".repeat(4097)),413], [request("x".repeat(131073)),413], [request("{"),400],
    [request(JSON.stringify(checkout) + " ".repeat(4096)),413],
    [request({ ...checkout, driverId: id }),400],
    [request({ ...checkout, action: "return" }),400],
    [request({ ...checkout, payload: { ...checkout.payload, occurredAt: fixture.departedAt } }),400],
  ]) {
    const h = handler();
    assert.equal((await h.POST(req)).status, status);
    assert.equal(h.calls.length, 0);
  }
});
test("batch edit permits 100 full stops beyond 4096 characters and rejects invalid shapes", async () => {
  const stop = { id, address: "x".repeat(300), arrivedAt: fixture.departedAt, departedAt: fixture.returnedAt, arrivedKm: 100, departedKm: 100 };
  const command = { reportId: id, expectedVersion: 1, requestId: id, action: "edit_stops",
    payload: { stops: Array.from({ length: 100 }, (_, i) => ({ ...stop, id: `c6000000-0000-4000-8000-${String(i).padStart(12, "0")}` })) } };
  assert.ok(JSON.stringify(command).length > 4096);
  const h = handler({ data: fixture });
  assert.equal((await h.POST(request(command))).status, 200);
  assert.equal(h.calls[0].args.payload.stops.length, 100);
  for (const payload of [{ stops: [...command.payload.stops, stop] }, { stops: [{ ...stop, profit: 1 }] }, { stops: "bad" }]) {
    const invalid = handler();
    assert.equal((await invalid.POST(request({ ...command, payload }))).status, 400);
    assert.equal(invalid.calls.length, 0);
  }
});
test("report writes preserve idempotency/version and reject invalid success-shaped output", async () => {
  const h = handler({ data: fixture });
  const response = await h.POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { report: fixture });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{
    name: "driver_report_command", args: { target_report: null, expected_version: 0,
      target_request: id, target_action: "checkout", payload: checkout.payload },
  }]);
  assert.equal((await handler({ data: null }).POST(request())).status, 500);
  const timed = handler({ data: fixture });
  const payload = { address: "Timed stop", km: 110, arrivedAt: fixture.departedAt, departedAt: fixture.returnedAt };
  assert.equal((await timed.POST(request({ reportId: id, expectedVersion: 1, requestId: id, action: "add_stop", payload }))).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(timed.calls[0].args.payload)), payload);
});
test("blank stops round-trip through write and read APIs without converting missing km to zero", async () => {
  const stop = { id, address: "", plannedKm: null, arrivedAt: null, arrivedKm: null, departedAt: null, departedKm: null };
  const report = { ...fixture, returnedAt: null, returnAddress: null, returnKm: null, stops: [stop] };
  const payload = { address: "", arrivedAt: null, departedAt: null };
  const write = handler({ data: report });
  const response = await write.POST(request({ reportId: id, expectedVersion: 1, requestId: id, action: "add_stop", payload }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).report.stops, [stop]);
  assert.equal(Object.hasOwn(write.calls[0].args.payload, "km"), false);
  const read = await handler({ data: { reports: [report], depot: null } }).GET(new Request("https://driver.example/api/driver/reports"));
  assert.equal(read.status, 200);
  assert.deepEqual((await read.json()).reports[0].stops, [stop]);
  assert.equal(reports.reportStopSchema.safeParse({ ...stop, arrivedAt: fixture.departedAt, arrivedKm: 100 }).success, false);
});
test("report database failures return explicit conflict validation and access errors", async () => {
  for (const [code,status] of [["42501",403],["P0002",404],["40001",409],["23505",409],["22023",422],["22007",422],["22P02",422],["23514",422],["XX000",503]]) {
    const response = await handler({ error: { code } }).POST(request());
    assert.equal(response.status, status);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
});
test("mobile report renders departure, stops, rest controls and completed totals", () => {
  const layouts = [];
  for (const closed of [true,false]) {
    let cursor = 0;
    const r = { ...fixture, stops: [{ id: closed ? id : id.replace(/1$/, "2"), address: "Synthetic long test stop address".repeat(4),
      arrivedAt: "2026-10-28T00:00:00+09:00", arrivedKm: 120,
      departedAt: closed ? "2026-10-28T00:15:00+09:00" : null, departedKm: closed ? 120 : null }],
      returnedAt: closed ? fixture.returnedAt : null,
      returnAddress: closed ? fixture.returnAddress : null, returnKm: closed ? fixture.returnKm : null };
    const values = [{ reports: [r], depot: null }, null, "", "", false, false, 0, Date.parse(fixture.returnedAt), false];
    const runtime = require("react/jsx-runtime");
    const checkKeys = create => (type, props, ...rest) => {
      const children = [props?.children].flat(Infinity).filter(React.isValidElement);
      const keys = children.filter(child => child.key !== null).map(child => child.key);
      assert.equal(new Set(keys).size, keys.length, "Sibling component keys must be unique");
      return create(type, props, ...rest);
    };
    const Component = load("app/driver/report/report.tsx", {
      react: { ...React, useEffect() {}, useRef: v => ({ current: v }), useState: () => [values[cursor++], () => {}] },
      "react/jsx-runtime": { ...runtime, jsx: checkKeys(runtime.jsx), jsxs: checkKeys(runtime.jsxs) },
      "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
      "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
    }).default;
    const html = renderToStaticMarkup(React.createElement(Component));
    assert.doesNotMatch(html, /<h1>|class="driver-notice"|日本时间 · 跨午夜归出库当天/);
    for (const label of ["日期", "出勤点呼时间", "退勤点呼时间", "車両番号", "運転手", "客数"]) assert.ok(html.includes(`aria-label="${label}"`));
    const headerMarkup = html.match(/<form[^>]*aria-label="日报基本信息"[^>]*>([\s\S]*?)<\/form>/)[1];
    assert.deepEqual([...headerMarkup.matchAll(/aria-label="([^"]+)"/g)].map(match => match[1]),
      ["日期", "客数", "車両番号", "運転手", "出勤点呼日期", "退勤点呼日期", "出勤点呼时间", "退勤点呼时间"]);
    assert.ok(html.indexOf('aria-label="出勤点呼时间"') < html.indexOf('aria-label="退勤点呼时间"'));
    assert.ok(html.indexOf('aria-label="運転手"') < html.indexOf('aria-label="出勤点呼时间"'));
    assert.match(html, /<details[^>]*><summary>历史日报<\/summary>/);
    assert.ok(html.indexOf('aria-label="日报基本信息"') < html.indexOf('<table'));
    assert.ok(html.indexOf('<summary>历史日报') > html.indexOf('</table>'));
    assert.ok(html.includes('class="driver-main driver-report"'));
    assert.ok(html.includes("拘束时间"));
    assert.ok(html.includes("累计休息"));
    assert.ok(html.includes("当日公里数"));
    assert.doesNotMatch(html, /出库至归库总时长|行驶公里数/);
    assert.doesNotMatch(html, /开始休息|结束休息|休息记录|停車或等候不会自动计为休息/);
    assert.doesNotMatch(html, /休息自动按各经由地到着至出发的时长累计/);
    assert.doesNotMatch(html, /归库打卡/);
    assert.equal(html.includes("42.5 km"), closed);
    assert.ok(html.includes("不采集定位"));
    assert.ok(html.includes('class="driver-stop-table driver-sheet"'));
    assert.equal((html.match(/<table\b/g) ?? []).length, 1);
    assert.equal((html.match(/<thead>/g) ?? []).length, 1);
    const routeSection = html.match(/<section[^>]*aria-label="出库经由地归库"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    assert.ok(routeSection);
    assert.ok(routeSection.includes('aria-label="出库记录"'));
    assert.ok(routeSection.includes("Synthetic depot"));
    assert.ok(routeSection.includes('aria-label="经由地 1"'));
    assert.ok(routeSection.indexOf('aria-label="出库记录"') < routeSection.indexOf('aria-label="经由地 1"'));
    assert.equal(routeSection.includes('aria-label="归库记录"'), true);
    assert.equal(routeSection.includes('id="report-edit-return"'), true);
    assert.ok(routeSection.indexOf('aria-label="出库记录"') < routeSection.indexOf('aria-label="经由地 1"'));
    assert.ok(routeSection.indexOf('aria-label="经由地 1"') < routeSection.indexOf('aria-label="归库记录"'));
    assert.equal(routeSection.includes('id="report-checkout"'), false);
    const departureHtml = html.match(/<tbody aria-label="出库记录">([\s\S]*?)<\/tbody>/)[1];
    assert.equal((departureHtml.match(/<tr\b/g) ?? []).length, 1);
    assert.match(departureHtml, /data-departure/);
    assert.match(departureHtml, /aria-label="出库地点地址"/);
    assert.match(departureHtml, /aria-label="出库公里表"/);
    assert.match(departureHtml, /aria-label="出库时间"/);
    assert.match(departureHtml, /type="time"[^>]*value="23:00"/);
    for (const label of ["归库"]) {
      const locationHtml = html.match(new RegExp(`<tbody aria-label="${label}记录">([\\s\\S]*?)</tbody>`))[1];
      assert.equal((locationHtml.match(/<tr\b/g) ?? []).length, 1);
      assert.equal((locationHtml.match(/<td\b/g) ?? []).length, 4);
      assert.match(locationHtml, /aria-label="归库时间" type="time"/);
      assert.match(locationHtml, /data-return/);
      assert.doesNotMatch(locationHtml, /scope="row">时间|>\d{4}-\d{2}-\d{2}/);
    }
    assert.match(html, /scope="col">地址<\/th><th scope="col">公里数<\/th><th scope="col">到着<\/th><th scope="col">出发/);
    assert.match(html, /class="driver-sheet-location"><th scope="row">经由1<\/th><td><form[^>]*>[\s\S]*?name="address"[\s\S]*?<\/form><\/td><td class="driver-stop-km">/);
    assert.match(html, /<input(?=[^>]*name="arrivedAt")(?=[^>]*type="time")(?=[^>]*step="60")[^>]*>/);
    assert.match(html, /<input(?=[^>]*name="departedAt")(?=[^>]*type="time")(?=[^>]*step="60")[^>]*>/);
    const stopHtml = html.match(/<tbody aria-label="经由地 1">([\s\S]*?)<\/tbody>/)[1];
    assert.equal((stopHtml.match(/type="number"/g) ?? []).length, 1);
    assert.match(stopHtml, /<input(?=[^>]*name="km")(?=[^>]*type="number")(?=[^>]*value="120")[^>]*>/);
    assert.doesNotMatch(stopHtml, /name="arrivedKm"|name="departedKm"|到着 km|出发 km/);
    assert.ok(html.includes('value="00:00"'));
    assert.doesNotMatch(routeSection, /type="(?:date|datetime-local)"/);
    assert.doesNotMatch(html.replace(/<[^>]*>/g, ""), /(?:\s|T)\d{2}:\d{2}:\d{2}/);
    assert.doesNotMatch(html, /时间打卡|本次记录：/);
    assert.doesNotMatch(html, /一键到达打卡|一键出发打卡/);
    assert.ok(html.includes("保存修改"));
    assert.equal((html.match(/>保存修改<\/button>/g) ?? []).length, 1);
    assert.equal(html.includes('value="clock"'), false);
    assert.doesNotMatch(html, /填写原因|留痕|保留记录|name="reason"/);
    layouts.push(html);
  }
  if (process.env.DRIVER_REPORT_LAYOUT_FILE) {
    const css = readFileSync(new URL("../app/driver/driver.css", import.meta.url), "utf8") +
      readFileSync(new URL("../app/driver/report/report.module.css", import.meta.url), "utf8")
        .replace(/:global\(([^)]+)\)/g, "$1").replace(/\.report\b/g, ".driver-report");
    writeFileSync(process.env.DRIVER_REPORT_LAYOUT_FILE,
      `<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}${css}</style><div class="driver-app">${layouts.join("")}</div></html>`);
  }
});

for (const mode of ["edit_stops", "manual_return", "change_date", "add_stop", "remove_stop"]) for (const success of [true, false])
test(`${mode} ${success ? "updates report" : "retains failed edits"} without reload`, async () => {
  const action = ["add_stop", "remove_stop"].includes(mode) ? mode : "edit_stops";
  const runtime = require("react/jsx-runtime");
  const stops = [0, 1].map(i => ({ id: id.replace(/1$/, String(i + 2)), address: `Stop ${i}`,
    arrivedAt: i === 0 ? fixture.departedAt : "2026-10-28T00:20:00+09:00", arrivedKm: 100 + i,
    departedAt: i === 0 ? "2026-10-28T00:10:00+09:00" : fixture.returnedAt, departedKm: 100 + i }));
  const blank = { id, address: "", plannedKm: null, arrivedAt: null, departedAt: null, arrivedKm: null, departedKm: null };
  if (mode === "remove_stop") stops.push({ ...blank, id: id.replace(/1$/, "4") }, { ...blank, id: id.replace(/1$/, "5") });
  const before = { ...fixture, stops, returnedAt: null, returnAddress: null, returnKm: null };
  const header = { serviceDate: mode === "change_date" ? "2026-10-25" : fixture.serviceDate,
    vehicleNumber: "品川 123", driverName: "Manual driver", passengerCount: 3,
    dutyStartTime: null, dutyEndTime: null, dutyStartDate: null, dutyEndDate: null };
  const dated = reports.reportOnDate(before, header.serviceDate);
  const updated = { ...dated, header: { vehicleNumber: header.vehicleNumber, driverName: header.driverName, passengerCount: header.passengerCount },
    ...(mode === "manual_return" ? { returnedAt: fixture.returnedAt, returnAddress: "Return depot", returnKm: 150 } : {}),
    version: 2, stops: action === "remove_stop" ? stops.filter((_, i) => i !== 2) : action === "add_stop" ? [...stops, blank] :
    dated.stops.map(s => ({ ...s, address: `${s.address} updated` })) };
  const states = [{ reports: [before], depot: null }, null, "", "", false, false, 0, Date.now(), false, true];
  let cursor = 0; let refCursor = 0; let toolbar; let calls = 0;
  const forms = stops.map((s, i) => ({ reportValidity: () => true, checkValidity: () => true, fields: {
    address: i === 3 ? "Unsaved last row" : s.address ? `${s.address} updated` : "", km: s.arrivedKm === null ? "" : String(s.arrivedKm),
    arrivedAt: reports.toJapanInput(s.arrivedAt).slice(11, 16), departedAt: reports.toJapanInput(s.departedAt).slice(11, 16),
  } }));
  const departureForm = { reportValidity: () => true, fields: {
    address: "Updated depot", km: "99", departedAt: "22:30",
  } };
  const headerElement = { reportValidity: () => true, fields: {
    ...header, passengerCount: "3",
  } };
  const table = { querySelector: selector => selector === "form[data-departure]" ? departureForm :
    selector === "form[data-return]" ? { reportValidity: () => true, fields: mode === "manual_return" ?
      { address: "Return depot", km: "150", returnedAt: "02:30" } : {} } :
    forms[stops.findIndex(s => selector.includes(s.id))] };
  const capture = create => (type, props, ...rest) => {
    if (typeof type === "function" && type.name === "AddStopForm") toolbar = props;
    return create(type, props, ...rest);
  };
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React, useEffect() {}, useRef: v => ({ current: refCursor++ === 0 ? table : refCursor === 2 ? headerElement : v }),
      useState: () => { const i = cursor++; return [states[i], v => { states[i] = typeof v === "function" ? v(states[i]) : v; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/supabase/browser": {}, "@/lib/driver/orders": { createDriverRequestId: () => id }, "@/lib/driver/reports": reports,
  }, {
    FormData: class { constructor(form) { this.get = name => form.fields[name] ?? ""; } },
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, "/api/driver/reports");
      const body = JSON.parse(options.body);
      assert.equal(body.action, action);
      if (action === "edit_stops") {
        assert.equal(body.payload.stops.length, 2);
        assert.deepEqual(body.payload.header, header);
        assert.deepEqual(body.payload.departure, { address: "Updated depot", km: 99,
          departedAt: mode === "change_date" ? "2026-10-25T13:30:00.000Z" : "2026-10-27T13:30:00.000Z" });
        if (mode === "change_date") {
          assert.equal(reports.toJapanInput(body.payload.stops[0].arrivedAt).slice(0, 10), "2026-10-25");
          assert.equal(reports.toJapanInput(body.payload.stops[1].departedAt).slice(0, 10), "2026-10-26");
        }
        if (mode === "manual_return") {
          assert.equal(body.payload.return.address, "Return depot");
          assert.equal(body.payload.return.km, 150);
          assert.equal(Date.parse(body.payload.return.returnedAt), Date.parse(fixture.returnedAt));
        } else assert.equal(Object.hasOwn(body.payload, "return"), false);
      } else if (action === "remove_stop") assert.deepEqual(body.payload, { stopId: stops[2].id });
      else assert.deepEqual(body.payload, { address: "", arrivedAt: null, departedAt: null });
      assert.equal(body.expectedVersion, 1);
      return success ? Response.json({ report: updated }) : Response.json({ error: "Version conflict: refresh to verify." }, { status: 409 });
    },
  }).default;
  renderToStaticMarkup(React.createElement(Component));
  assert.equal(toolbar.disabled, false);
  if (action === "edit_stops") await toolbar.saveChanges();
  else if (action === "remove_stop") await toolbar.removeStop();
  else await toolbar.save("add_stop", { address: "", arrivedAt: null, departedAt: null });
  assert.equal(calls, 1);
  assert.equal(states[0].reports[0].version, success ? 2 : 1);
  if (mode === "change_date") assert.equal(states[0].reports[0].serviceDate, success ? header.serviceDate : fixture.serviceDate);
  if (mode === "manual_return") assert.equal(states[0].reports[0].returnedAt, success ? fixture.returnedAt : null);
  assert.equal(states[0].reports[0].stops[1].address, success && action === "edit_stops" ? "Stop 1 updated" : "Stop 1");
  if (action === "add_stop") {
    assert.equal(states[0].reports[0].stops.length, success ? 3 : 2);
    assert.equal(forms[1].fields.address, "Stop 1 updated");
  }
  if (action === "remove_stop") {
    assert.equal(states[0].reports[0].stops.length, success ? 3 : 4);
    assert.equal(forms[3].fields.address, "Unsaved last row");
    if (!success) assert.match(states[2], /Version conflict/);
    forms[2].checkValidity = () => false;
    await toolbar.removeStop();
    assert.equal(calls, 1);
    assert.match(states[2], /没有可删除/);
    forms[2].checkValidity = () => true;
    forms[2].fields.km = "0";
    await toolbar.removeStop();
    assert.equal(calls, 1);
    assert.match(states[2], /没有可删除/);
  }
  assert.equal(states[4], false);
  assert.equal(states[6], 0);
  assert.equal(states[9], !success || ["add_stop", "remove_stop"].includes(action));
  assert.equal(states[3], success ? action === "add_stop" ?
    "空白经由地已保存，填写修改后请点“保存修改”。" : action === "remove_stop" ?
      "已删除一条空白经由地，其他未保存的修改仍保留。" : "已保存。" : "");
  if (!success) {
    assert.match(states[2], action === "remove_stop" ? /没有可删除/ : /Version conflict/);
    assert.equal(forms[1].fields.address, "Stop 1 updated");
  }
});

test("first and subsequent checkout use a fresh spreadsheet without mixing history", () => {
  for (const history of [false, true]) {
  let cursor = 0;
  const values = [{ reports: history ? [fixture] : [], depot: { name: "Synthetic office", address: "Synthetic default" } },
    null, "", "", false, false, 0, Date.now(), history, true, fixture.serviceDate,
    { serviceDate: fixture.serviceDate, driverName: "Linked driver", orders: [{ assignmentId: id, time: "09:00",
      pickup: "Airport", destination: "Hotel", vehicleNumber: "Linked plate", depot: { name: "Vehicle owner", address: "Owner garage" } }] }, id, ""];
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React, useEffect() {}, useRef: v => ({ current: v }), useState: () => [values[cursor++], () => {}] },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
  }).default;
  const html = renderToStaticMarkup(React.createElement(Component));
  assert.match(html, /aria-label="出库经由地归库"[\s\S]*<table[\s\S]*id="report-checkout"/);
  assert.equal((html.match(/<table\b/g) ?? []).length, 1);
  assert.match(html, /form="report-checkout"[^>]*name="km"|name="km"[^>]*form="report-checkout"/);
  assert.ok(html.includes("Vehicle owner"));
  assert.ok(html.includes("Owner garage"));
  assert.ok(html.includes('value="Linked driver"'));
  assert.ok(html.includes('value="Linked plate"'));
  assert.doesNotMatch(html, /Synthetic office|Synthetic default|type="checkbox"/);
  assert.ok(html.includes(">出库打卡</button>"));
  assert.ok(html.includes("出库后，在表格内继续添加经由地。"));
  assert.doesNotMatch(html, /aria-label="出库记录"|新经由地地址/);
  if (history) assert.ok(html.includes("新日报 · 待出库"));
  if (!history && process.env.DRIVER_REPORT_DEFAULTS_LAYOUT_FILE) {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace('@import "tailwindcss";', "");
    const reportCss = readFileSync(new URL("../app/driver/report/report.module.css", import.meta.url), "utf8")
      .replace(/\.report\b/g, ".driver-report");
    writeFileSync(process.env.DRIVER_REPORT_DEFAULTS_LAYOUT_FILE,
      `<!doctype html><html lang="zh"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n${reportCss}</style><body>${html}</body></html>`);
  }
  }
});

test("append stop stays immediately below the last time pair in the continuous table", () => {
  for (const count of [0, 1, 3]) {
    let cursor = 0;
    const stops = Array.from({ length: count }, (_, i) => ({ id: id.replace(/1$/, String(i + 2)),
      address: `Synthetic stop ${i}`, arrivedAt: fixture.departedAt, arrivedKm: 100,
      departedAt: fixture.returnedAt, departedKm: 100 }));
    const values = [{ reports: [{ ...fixture, returnedAt: null, stops }], depot: null },
      null, "", "", false, false, 0, Date.now(), false];
    const Component = load("app/driver/report/report.tsx", {
      react: { ...React, useEffect() {}, useRef: v => ({ current: v }), useState: () => [values[cursor++], () => {}] },
      "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
      "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
    }).default;
    const html = renderToStaticMarkup(React.createElement(Component));
    assert.equal((html.match(/class="driver-stop-add"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<dialog|aria-modal/);
    assert.ok(!html.includes('aria-label="新经由地公里数"'));
    assert.match(html, /aria-label="追加空白经由地"[^>]*>＋<\/button>/);
    assert.match(html, /aria-label="删除最后一条空白经由地"[^>]*>−<\/button>/);
    assert.ok(html.indexOf('aria-label="追加空白经由地"') < html.indexOf(">保存修改</button>"));
    assert.equal((html.match(/<table\b/g) ?? []).length, 1);
    if (count) {
      const groups = [...html.matchAll(/<tbody aria-label="经由地 \d+">([\s\S]*?)<\/tbody>/g)];
      assert.equal(groups.length, count);
      for (const group of groups.slice(0, -1)) assert.ok(!group[1].includes("driver-stop-add"));
      for (const group of groups) {
        assert.equal((group[1].match(/<tr\b/g) ?? []).length, 1);
        assert.equal((group[1].match(/<td\b/g) ?? []).length, 4);
        assert.match(group[1], /name="address"[\s\S]*name="km"[\s\S]*name="arrivedAt"[\s\S]*name="departedAt"/);
      }
      assert.ok(html.indexOf("driver-stop-add") > html.indexOf(groups.at(-1)[0]));
    }
    assert.ok(html.indexOf("driver-stop-add") < html.indexOf('aria-label="归库记录"'));
  }
});

test("compact stop form uses shared save and preserves seconds and distinct odometers", async () => {
  const runtime = require("react/jsx-runtime");
  let stopComponent;
  let stopProps;
  let cursor = 0;
  const errors = [];
  const stop = { id, address: "Synthetic stop", arrivedAt: "2026-10-28T00:00:42.123456+09:00",
    arrivedKm: 120, departedAt: null, departedKm: null };
  const values = [{ reports: [{ ...fixture, stops: [stop], returnedAt: null }], depot: null },
    null, "", "", false, false, 0, Date.parse(fixture.returnedAt), false];
  function capture(create) {
    return (type, props, ...rest) => {
      if (typeof type === "function" && type.name === "StopRow") { stopComponent = type; stopProps = props; }
      return create(type, props, ...rest);
    };
  }
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React, useEffect() {}, useRef: v => ({ current: v }),
      useState: () => cursor < values.length ? [values[cursor++], () => {}] : ["", v => errors.push(v)] },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
  }, {
    FormData: class { constructor(form) { this.get = name => form.fields[name] ?? ""; } },
  }).default;
  renderToStaticMarkup(React.createElement(Component));
  const calls = [];
  const save = async (action, payload) => { calls.push({ action, payload }); return true; };
  let rows = stopComponent({ ...stopProps, save });
  function findForm(node) {
    if (!React.isValidElement(node)) return null;
    if (node.type === "form") return node;
    return React.Children.toArray(node.props.children).map(findForm).find(Boolean) ?? null;
  }
  let sharedSaves = 0;
  const form = findForm(stopComponent({ ...stopProps, saveChanges: async () => { sharedSaves++; } }));
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(sharedSaves, 1);
  const fields = { address: "Updated stop", arrivedAt: "00:00",
    km: "120", departedAt: "" };
  let currentStop = stop;
  async function submit() {
      try { await save("edit_stop", reports.stopFromForm(currentStop, { get: name => fields[name] ?? "" }, fixture.departedAt)); }
      catch { errors.push("日期时间无效"); }
  }
  await submit();
  assert.equal(calls[0].action, "edit_stop");
  assert.equal(calls[0].payload.arrivedAt, stop.arrivedAt);
  assert.equal(calls[0].payload.departedAt, null);
  assert.equal(calls[0].payload.address, "Updated stop");
  assert.equal(Object.hasOwn(calls[0].payload, "reason"), false);
  fields.departedAt = "invalid";
  await submit();
  assert.equal(calls.length, 1);
  assert.match(errors.at(-1), /日期时间无效/);
  fields.departedAt = "01:02";
  await submit();
  assert.equal(calls[1].payload.departedAt, "2026-10-27T16:02:00.000Z");
  assert.equal(calls[1].payload.arrivedKm, 120);
  assert.equal(calls[1].payload.departedKm, 120);
  rows = stopComponent({ ...stopProps, stop: { ...stop, arrivedAt: null, arrivedKm: null }, save });
  const arrivalHtml = renderToStaticMarkup(rows);
  assert.doesNotMatch(arrivalHtml, /时间打卡|本次记录：/);
  assert.equal((arrivalHtml.match(/<tr\b/g) ?? []).length, 1);
  rows = stopComponent({ ...stopProps, stop: { ...stop, departedAt: fixture.returnedAt, departedKm: 125 }, save });
  currentStop = { ...stop, departedAt: fixture.returnedAt, departedKm: 125 };
  fields.km = "125";
  fields.departedAt = "02:30";
  await submit();
  assert.equal(calls[2].payload.arrivedKm, 120);
  assert.equal(calls[2].payload.departedKm, 125);
  fields.km = "126";
  await submit();
  assert.equal(calls[3].payload.arrivedKm, 126);
  assert.equal(calls[3].payload.departedKm, 126);
  rows = stopComponent({ ...stopProps, stop: { ...stop, arrivedAt: null, arrivedKm: null, plannedKm: 130 }, save });
  currentStop = { ...stop, arrivedAt: null, arrivedKm: null, plannedKm: 130 };
  fields.km = "131"; fields.arrivedAt = ""; fields.departedAt = "";
  await submit();
  assert.equal(calls[4].payload.plannedKm, 131);
  assert.equal(calls[4].payload.arrivedKm, null);
  assert.equal(calls[4].payload.departedKm, null);
});

test("each append immediately saves an empty row without a second confirmation", async () => {
  const runtime = require("react/jsx-runtime");
  let Add;
  let cursor = 0;
  const values = [{ reports: [{ ...fixture, returnedAt: null }], depot: null },
    null, "", "", false, false, 0, Date.now(), false];
  const capture = create => (type, props, ...rest) => {
    if (typeof type === "function" && type.name === "AddStopForm") Add = type;
    return create(type, props, ...rest);
  };
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React, useEffect() {}, useRef: v => ({ current: v }),
      useState: () => [values[cursor++], () => {}] },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
  }).default;
  renderToStaticMarkup(React.createElement(Component));
  const calls = [];
  let accepted = false;
  const save = async (action, payload) => { calls.push({ action, payload }); return accepted; };
  function render(error) { return Add({ disabled: false, save, error, saveChanges() {} }); }
  function find(node, predicate) {
    if (!React.isValidElement(node)) return null;
    if (predicate(node)) return node;
    return React.Children.toArray(node.props.children).map(child => find(child, predicate)).find(Boolean);
  }
  const element = render();
  const button = find(element, node => node.type === "button" && node.props["aria-label"] === "追加空白经由地");
  assert.equal(button.props.children, "＋");
  const minus = find(element, node => node.type === "button" && node.props["aria-label"] === "删除最后一条空白经由地");
  assert.equal(minus.props.children, "−");
  assert.equal(minus.props.disabled, true);
  const availableMinus = find(Add({ disabled: true, save, canRemove: true, removeStop: async () => {}, saving: false }),
    node => node.type === "button" && node.props["aria-label"] === "删除最后一条空白经由地");
  assert.equal(availableMinus.props.disabled, false);
  assert.equal(typeof availableMinus.props.onClick, "function");
  await button.props.onClick();
  assert.equal(calls.length, 1);
  accepted = true;
  await button.props.onClick();
  await button.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), Array(3).fill({ action: "add_stop",
    payload: { address: "", arrivedAt: null, departedAt: null } }));
  const html = renderToStaticMarkup(render());
  assert.doesNotMatch(html, /<form|<input|确认添加|确认追加|取消追加/);
  assert.equal((html.match(/>保存修改<\/button>/g) ?? []).length, 1);
  assert.ok(find(render(), node => node.type === "button" && node.props.children === "保存修改").props.onClick);
  assert.ok(renderToStaticMarkup(render("Synthetic API failure"))
    .includes('role="alert">Synthetic API failure'));
});
