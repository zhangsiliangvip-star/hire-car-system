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
    require: name => Object.hasOwn(mocks, name) ? mocks[name] :
      name === "@/app/driver/navigation" ? load("app/driver/navigation.tsx", mocks, globals) :
      name === "@/lib/driver-selection" ? load("lib/driver-selection.ts", mocks, globals) :
      name === "@/lib/order-drivers" ? load("lib/order-drivers.ts", mocks, globals) :
      name.endsWith(".css") ? {} : require(name),
    Request, Response, Headers, URL, Date, Intl, AbortController, process, console: { error() {} }, ...globals,
  });
  return compiled.exports;
}
const shifts = load("lib/driver/shifts.ts");
const { jsonResponse } = load("lib/api-response.ts");
const { isDriverActionOrigin } = load("lib/driver/assignment-action.ts", {
  "@/lib/api-response": { jsonResponse }, "@/lib/driver/authorization": {},
  "@/lib/driver/orders": {}, "@/lib/driver/test-runtime": {},
});
const id = "c6000000-0000-4000-8000-000000000001";
const data = { month: "2026-11", version: 1, dates: ["2026-11-01", "2026-11-15"], note: "Monthly note" };
const command = { month: data.month, dates: data.dates, note: data.note, expectedVersion: 0, requestId: id };
function api({ staff = false, denied = 0, enabled = true, profile = true, result = data, error = null } = {}) {
  const calls = [];
  const supabase = { async rpc(name, args) { calls.push({ name, args }); return { data: result, error }; } };
  const exports = load(staff ? "app/api/driver-shifts/status/route.ts" : "app/api/driver/shifts/route.ts", {
    "@/lib/api-response": { jsonResponse }, "@/lib/driver/shifts": shifts,
    "@/lib/driver/assignment-action": { isDriverActionOrigin },
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => enabled },
    "@/lib/driver/authorization": { requireDriver: async () => denied
      ? { response: jsonResponse({ error: "Denied" }, { status: denied }) } : { response: null, supabase } },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ supabase, profile: profile ? { role: "user" } : null }) },
  });
  return { ...exports, calls };
}
function request(body, origin = "https://driver.example", type = "application/json") {
  return new Request("https://driver.example/api/driver/shifts", { method: "POST",
    headers: { origin, "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
const plain = value => JSON.parse(JSON.stringify(value));
test("shared top navigation has four routes, highlights each section and guards unsaved/in-flight changes", () => {
  const Navigation = load("app/driver/navigation.tsx", { "next/link": { default: "a" } }).default;
  for (const active of ["trips", "report", "finance", "shifts"]) {
    const tree = Navigation({ active });
    const links = tree.props.children;
    assert.deepEqual(plain(links.map(link => link.props.href)), ["/driver", "/driver/report", "/driver/finance", "/driver/shifts"]);
    assert.deepEqual(plain(links.map(link => link.props.children)), ["行程", "日報", "财务", "シフト"]);
    assert.equal(links.filter(link => link.props["aria-current"] === "page").length, 1);
    assert.equal(links.find(link => link.props["aria-current"] === "page").props.children,
      { trips: "行程", report: "日報", finance: "财务", shifts: "シフト" }[active]);
  }
  for (const settings of [{ busy: true }, { canLeave: () => false }, { canLeave: () => true }]) {
    let prevented = false;
    const tree = Navigation({ active: "trips", ...settings });
    tree.props.children[1].props.onClick({ preventDefault() { prevented = true; } });
    assert.equal(prevented, settings.busy === true || settings.canLeave?.() === false);
  }
  for (const file of ["trips.tsx", "report/report.tsx", "finance/finance.tsx", "shifts/shifts.tsx"]) {
    const source = readFileSync(fileURLToPath(new URL(`../app/driver/${file}`, import.meta.url)), "utf8");
    assert.match(source, /return <main[^>]*>\s*<DriverNavigation/);
  }
});
test("monthly shifts validate exact month, unique in-month dates and bounded notes", () => {
  assert.ok(shifts.shiftSubmissionSchema.safeParse(command).success);
  assert.ok(shifts.shiftSubmissionSchema.safeParse({ ...command, dates: [] }).success);
  for (const patch of [{ month: "2026-13" }, { dates: ["2026-12-01"] }, { dates: ["2026-11-31"] },
    { dates: [data.dates[0], data.dates[0]] }, { driverId: id }, { note: "x".repeat(1001) }, { expectedVersion: -1 }])
    assert.equal(shifts.shiftSubmissionSchema.safeParse({ ...command, ...patch }).success, false);
  assert.equal(shifts.shiftMonthDays("2028-02").dates.length, 29);
  assert.equal(shifts.shiftMonthDays("2026-02").dates.length, 28);
  assert.equal(shifts.shiftMonthDays("2026-11").offset, 0);
});
test("driver shifts reject identities and ownership selectors before invoking database", async () => {
  for (const denied of [401, 403, 404]) {
    const h = api({ denied });
    assert.equal((await h.GET(new Request("https://driver.example/api/driver/shifts?month=2026-11"))).status, denied);
    assert.equal((await h.POST(request(command))).status, denied);
    assert.equal(h.calls.length, 0);
  }
  const h = api();
  assert.equal((await h.GET(new Request("https://driver.example/api/driver/shifts?month=2026-11&driverId=" + id))).status, 400);
  assert.equal(h.calls.length, 0);
});
test("monthly reads return minimal uncached data and surface malformed/database failures", async () => {
  const h = api();
  const response = await h.GET(new Request("https://driver.example/api/driver/shifts?month=2026-11"));
  assert.equal(response.status, 200); assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), data);
  assert.deepEqual(plain(h.calls), [{ name: "driver_monthly_shift", args: { target_month: "2026-11" } }]);
  for (const settings of [{ result: { ...data, driverId: id } }, { result: null }, { error: { code: "XX000" } }])
    assert.equal((await api(settings).GET(new Request("https://driver.example/api/driver/shifts?month=2026-11"))).status, 503);
});
test("shift writes enforce origin JSON size and strict payload", async () => {
  for (const [req, status] of [[request(command, "https://evil.example"), 403], [request(command, undefined, "text/plain"), 415],
    [request("x".repeat(8193)), 413], [request("{"), 400], [request({ ...command, driverId: id }), 400]]) {
    const h = api(); assert.equal((await h.POST(req)).status, status); assert.equal(h.calls.length, 0);
  }
});
test("shift submission forwards version/idempotency and reports failures explicitly", async () => {
  const h = api(); const response = await h.POST(request(command));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), data);
  assert.deepEqual(plain(h.calls), [{ name: "submit_driver_monthly_shift", args: {
    target_month: "2026-11", expected_version: 0, target_request: id, rest_dates: data.dates, note: data.note,
  } }]);
  for (const [code, status] of [["40001", 409], ["42501", 403], ["22023", 422], ["XX000", 503]])
    assert.equal((await api({ error: { code } }).POST(request(command))).status, status);
});
test("staff rest hints are test-gated, staff-only and exclude driver notes", async () => {
  const disabled = api({ staff: true, enabled: false });
  assert.deepEqual(await (await disabled.POST(request({ dates: data.dates }))).json(), { enabled: false, days: [] });
  assert.equal(disabled.calls.length, 0);
  assert.equal((await api({ staff: true, profile: false }).POST(request({ dates: data.dates }))).status, 403);
  const h = api({ staff: true, result: [{ driverId: id, date: data.dates[0] }] });
  const response = await h.POST(request({ dates: data.dates }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, days: [{ driverId: id, date: data.dates[0] }] });
  assert.deepEqual(plain(h.calls), [{ name: "staff_driver_rest_days", args: { service_dates: data.dates } }]);
  assert.equal((await api({ staff: true, result: [{ driverId: id, date: data.dates[0], note: "Private" }] })
    .POST(request({ dates: data.dates }))).status, 503);
  for (const req of [request({ dates: [] }), request({ dates: ["2026-02-30"] }), request({ dates: data.dates, regionId: id })])
    assert.equal((await api({ staff: true }).POST(req)).status, 400);
});

function renderShift({ fetch: fetchMock = async () => Response.json(data), confirm = () => true } = {}) {
  const states = ["2026-11", data, [...data.dates], data.note, false, false, "", "", 0];
  const effects = [], refs = [], events = {}, buttons = [], inputs = [];
  const document = { visibilityState: "visible", addEventListener(name, fn) { events[name] = fn; }, removeEventListener() {} };
  let cursor = 0, refCursor = 0;
  const runtime = require("react/jsx-runtime");
  const capture = original => (type, props, ...rest) => {
    if (type === "button") buttons.push(props);
    if (["input", "textarea"].includes(type)) inputs.push(props);
    return original(type, props, ...rest);
  };
  const Component = load("app/driver/shifts/shifts.tsx", {
    react: { ...React, useEffect(fn) { effects.push(fn); },
      useRef(value) { const i = refCursor++; return refs[i] ||= { current: value }; },
      useState(value) { const i = cursor++; if (i >= states.length) states[i] = typeof value === "function" ? value() : value;
        return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/driver/shifts": shifts, "@/lib/driver/orders": { japanDate: () => "2026-11-01", createDriverRequestId: () => id },
    "@/lib/supabase/browser": { createClient: () => ({ auth: { onAuthStateChange(fn) {
      events.auth = fn; return { data: { subscription: { unsubscribe() {} } } };
    } } }) },
  }, { fetch: fetchMock, document, window: { confirm }, location: { replace() {} } }).default;
  function render() {
    cursor = 0; refCursor = 0; buttons.length = 0; inputs.length = 0;
    return renderToStaticMarkup(React.createElement(Component));
  }
  return { html: render(), render, states, effects, events, document, buttons, inputs };
}
test("monthly calendar allows independent multiple rest dates with notes beneath", () => {
  const h = renderShift();
  assert.equal(h.buttons.filter(button => button["aria-label"]?.startsWith("2026-11-")).length, 30);
  assert.match(h.html, /aria-label="2026-11-01" aria-pressed="true"/);
  h.buttons.find(button => button["aria-label"] === "2026-11-02").onClick();
  assert.ok(h.states[2].includes("2026-11-02")); assert.equal(h.states[2].length, 3);
  h.render(); h.buttons.find(button => button["aria-label"] === "2026-11-01").onClick();
  assert.equal(h.states[2].includes("2026-11-01"), false);
  h.inputs.find(input => input.rows === 3).onChange({ target: { value: "New note" } });
  assert.equal(h.states[3], "New note");
  assert.ok(h.html.indexOf("备注<textarea") > h.html.indexOf('aria-label="2026-11-30"'));
  if (process.env.DRIVER_SHIFT_LAYOUT_FILE) {
    const css = ["app/driver/driver.css", "app/driver/shifts/shifts.css"].map(file =>
      readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8")).join("\n");
    writeFileSync(process.env.DRIVER_SHIFT_LAYOUT_FILE,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}${css}</style><div class="driver-app">${h.html}</div>`);
  }
});
test("shifts submit exact selected month dates and notes, preserving independent months", async () => {
  const calls = [];
  const h = renderShift({ fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ ...data, version: 2 }); } });
  await h.buttons.find(button => button.children === "提交シフト").onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [{ ...command, expectedVersion: 1 }]); assert.equal(h.states[1].version, 2);
  assert.match(h.states[7], /立即生效/);
});
test("switching shift months confirms dirty drafts and clears old month values", () => {
  const h = renderShift({ confirm: () => false });
  h.states[3] = "Unsaved"; h.render();
  h.inputs.find(input => input.type === "month").onChange({ target: { value: "2026-12" } });
  assert.equal(h.states[0], "2026-11"); assert.equal(h.states[3], "Unsaved");
  const accepted = renderShift();
  accepted.inputs.find(input => input.type === "month").onChange({ target: { value: "2026-12" } });
  assert.equal(accepted.states[0], "2026-12"); assert.equal(accepted.states[1], null);
  assert.equal(accepted.states[2].length, 0); assert.equal(accepted.states[3], "");
});
test("initial shift read restores month and late submit cannot restore private data after logout", async () => {
  const h = renderShift(); const cleanup = h.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.states[1].version, 1); cleanup();
  let resolveSubmit;
  const late = new Promise(resolve => { resolveSubmit = resolve; });
  const pending = renderShift({ fetch: async (_url, init) => init?.method === "POST" ? late : Response.json(data) });
  const stop = pending.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  pending.buttons.find(button => button.children === "提交シフト").onClick();
  pending.events.auth("SIGNED_OUT");
  resolveSubmit(Response.json({ ...data, version: 2 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.states[1], null); assert.equal(pending.states[2].length, 0); assert.equal(pending.states[3], "");
  stop();
});

function renderDialog({ days = [], fetch: fetchMock, serviceDates = data.dates,
  drivers = [{ id, name: "Test Driver", reading: "test driver", serviceDays: 2 }] } = {}) {
  const states = ["", "", { key: JSON.stringify([...serviceDates].sort()), days }, "", 0];
  const effects = [], buttons = [];
  let cursor = 0, selected = "";
  const runtime = require("react/jsx-runtime");
  const capture = original => (type, props, ...rest) => {
    if (type === "button") buttons.push(props);
    return original(type, props, ...rest);
  };
  const { DriverSelectionDialog } = load("components/driver-selection-dialog.tsx", {
    react: { ...React, useEffect(fn) { effects.push(fn); }, useRef: () => ({ current: null }),
      useState() { const i = cursor++; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "@/lib/driver/shifts": shifts,
  }, { fetch: fetchMock });
  function render() {
    cursor = 0; buttons.length = 0;
    return renderToStaticMarkup(React.createElement(DriverSelectionDialog, {
      drivers, serviceDates, selected: "",
      onSelect: name => { selected = name; }, onClose() {},
    }));
  }
  return { html: render(), render, states, effects, buttons, selected: () => selected };
}
test("driver cards show red rest in bottom-right by driver ID but remain selectable", () => {
  const h = renderDialog({ days: [{ driverId: id, date: data.dates[0] }] });
  assert.match(h.html, /absolute bottom-2 right-2[^"]*text-red-600/);
  assert.match(h.html, /希望休：2026-11-01/);
  h.buttons.find(button => button.children[0]?.props?.children === "Test Driver").onClick();
  assert.equal(h.selected(), "Test Driver");
  assert.equal(renderDialog({ days: [{ driverId: "c6000000-0000-4000-8000-000000000002", date: data.dates[0] }] })
    .html.includes(">休</span>"), false);
});
test("driver selection dialog displays drivers by recorded romanized reading", () => {
  const h = renderDialog({ drivers: [
    { id: "b", name: "田中", reading: "tanaka", serviceDays: 20 },
    { id: "a", name: "佐藤", reading: "sato", serviceDays: 1 },
  ] });
  assert.ok(h.html.indexOf("佐藤") < h.html.indexOf("田中"));
  assert.ok(h.html.indexOf("sato") < h.html.indexOf("tanaka"));
});
test("rest hints fetch all actual service dates, never notes; failures explicitly warn", async () => {
  const calls = [];
  const h = renderDialog({ fetch: async (_url, init) => { calls.push(JSON.parse(init.body));
    return Response.json({ error: "休息提示读取失败" }, { status: 503 }); } });
  const cleanup = h.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [{ dates: data.dates }]);
  assert.equal(h.states[2], null); assert.match(h.render(), /role="alert"/);
  cleanup();
});
test("all assignment selection entry points supply actual service dates, excluding order off days", () => {
  const source = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
  assert.match(source, /serviceDates=\{driverSelectionDates\}/);
  assert.equal((source.match(/serviceDate=\{date\}/g) || []).length, 2);
  assert.match(source, /getOrderDateKeys\(form\)\.filter\(date => !form.offDates.includes\(date\)\)/);
  assert.match(source, /getOrderDateKeys\(driverSelectionOrder\)\.filter\(date => !driverSelectionOrder.offDates.includes\(date\)\)/);
  assert.match(source, /driverSelectionTarget === "driver-finance-filter" \? \[\]/);
  const daily = readFileSync(fileURLToPath(new URL("../components/finance-driver-select.tsx", import.meta.url)), "utf8");
  assert.match(daily, /serviceDates=\{\[serviceDate\]\}/);
});
