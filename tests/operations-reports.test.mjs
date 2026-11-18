import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
  }).outputText, { module: compiled, exports: compiled.exports, require: name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith("@/")) {
      const base = name.slice(2);
      const suffix = existsSync(fileURLToPath(new URL(`../${base}.ts`, import.meta.url))) ? ".ts" : ".tsx";
      return load(base + suffix, name === "@/components/report-duty-fields" ? {} : mocks, globals);
    }
    return require(name);
  }, Request, Response, Headers, URL, URLSearchParams, AbortController, DOMException, Date, Intl, process,
  setTimeout, clearTimeout, console: { error() {} }, ...globals });
  return compiled.exports;
}
const reportLib = load("lib/driver/reports.ts");
const schemas = load("lib/operations-reports.ts");
const printing = load("lib/operations-report-print.ts");
const id = "f6900280-0000-4000-8000-000000000001";
const region = "f2900280-0000-4000-8000-000000000001";
const editorStyles = Object.fromEntries([
  "dialog", "content", "title", "intro", "form", "association", "associationNote", "header",
  "sectionTitle", "headerGrid", "journey", "journeyHint", "journeyTable", "cellInput",
  "rowAction", "removeButton", "addButton", "extras", "restRow", "stickyActions",
  "cancelButton", "saveButton", "error",
].map(name => [name, `editor-${name}`]));
const report = { id, serviceDate: "2026-10-25", version: 1,
  header: { vehicleNumber: "Synthetic plate", driverName: "Manual driver", passengerCount: 2,
    dutyStartDate: "2026-10-25", dutyStartTime: "08:00", dutyEndDate: "2026-10-26", dutyEndTime: "10:30" },
  departedAt: "2026-10-25T09:00:00.123456+09:00", departureAddress: "出库車库", departureKm: 100,
  returnedAt: "2026-10-25T18:00:00+09:00", returnAddress: "归库車库", returnKm: 180,
  stops: [{ id: "f7900280-0000-4000-8000-000000000001", address: "第一经由地", arrivedAt: "2026-10-25T10:00:00+09:00",
    arrivedKm: 110, departedAt: "2026-10-25T11:00:00+09:00", departedKm: 111, plannedKm: 110 },
  { id: "f7900280-0000-4000-8000-000000000002", address: "最后经由地", arrivedAt: "2026-10-25T12:00:00+09:00",
    arrivedKm: 120, departedAt: "2026-10-25T13:00:00+09:00", departedKm: 121, plannedKm: null }],
  rests: [{ startedAt: "2026-10-25T14:00:00+09:00", endedAt: "2026-10-25T14:30:00+09:00" }] };
const row = { regionId: region, driverName: "Linked driver", company: "Synthetic company", operationsManager: "Synthetic manager", report };
const normalize = data => JSON.parse(JSON.stringify(data));
test("operation display omits years in Japan time without changing stored dates or timestamp precision", () => {
  assert.equal(schemas.operationDateLabel("2026-10-25"), "10/25");
  assert.equal(schemas.operationTimeLabel("2026-12-31T15:05:00Z"), "00:05");
  assert.equal(schemas.operationTimeLabel(null), "—");
  assert.equal(schemas.operationInstant("2026-10-25T09:00:00", report.departedAt), report.departedAt);
});
function writeLayout(name, markup) {
  if (!process.env.OPERATIONS_LAYOUT_DIR || !process.env.OPERATIONS_LAYOUT_CSS) return;
  writeFileSync(`${process.env.OPERATIONS_LAYOUT_DIR}\\operations-${name}.html`,
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Synthetic operations ${name}</title><style>${readFileSync(process.env.OPERATIONS_LAYOUT_CSS, "utf8")}</style></head>
    <body><main class="min-w-0 p-4">${markup}</main></body></html>`);
}
function api({ enabled = true, denied = false, data = [row], error = null } = {}) {
  const calls = [];
  return { calls, ...load("app/api/operations-reports/route.ts", {
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => enabled },
    "@/lib/driver/assignment-action": { isDriverActionOrigin: r => r.headers.get("origin") === new URL(r.url).origin },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ profile: denied ? null : { role: "user", regionId: region },
      supabase: { rpc: async (...args) => { calls.push(args); return { data, error }; } } }) },
  }) };
}
const editCommand = { action: "edit", requestId: "f8900280-0000-4000-8000-000000000001", reason: "Synthetic correction", report };
function post(body, headers = {}, query = "") {
  return new Request(`https://staff.example/api/operations-reports${query}`, { method: "POST",
    headers: { origin: "https://staff.example", "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body) });
}
test("staff report list enforces feature/auth/query gates and returns uncached minimal monthly data", async () => {
  const get = query => new Request(`https://staff.example/api/operations-reports${query}`);
  const off = api({ enabled: false });
  assert.deepEqual(await (await off.GET(get("?month=2026-10"))).json(), { enabled: false, rows: [] });
  assert.equal(off.calls.length, 0);
  assert.equal((await api({ denied: true }).GET(get("?month=2026-10"))).status, 403);
  for (const query of ["", "?month=2026-13", "?month=2026-10&month=2026-11", "?month=2026-10&driverId=x",
    "?month=2026-10&region=bad", "?month=0000-01"]) {
    const h = api();
    assert.equal((await h.GET(get(query))).status, 400);
    assert.equal(h.calls.length, 0);
  }
  const h = api();
  const response = await h.GET(get(`?month=2026-10&region=${region}`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), { enabled: true, rows: [row] });
  assert.deepEqual(normalize(h.calls), [["staff_operation_reports", { target_month: "2026-10", target_region: region }]]);
  for (const options of [{ data: null }, { data: [{ ...row, password: "no" }] }, { error: { code: "XX000" } }])
    assert.equal((await api(options).GET(get("?month=2026-10"))).status, 503);
  assert.equal((await api({ error: { code: "42501" } }).GET(get("?month=2026-10"))).status, 403);
});
test("staff edits and permanent deletion use versioned strict commands with request protections", async () => {
  const h = api({ data: { action: "edit", report: { ...report, version: 2 } } });
  const response = await h.POST(post(editCommand));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.equal((await response.json()).report.version, 2);
  assert.deepEqual(normalize(h.calls), [["staff_operation_report_command", { command: editCommand }]]);
  const command = { action: "delete", reportId: id, expectedVersion: 1 };
  assert.equal((await api({ data: { action: "delete", deletedId: id } }).POST(post(command))).status, 200);
  for (const [request, status] of [[post(editCommand, { origin: "https://other.example" }), 403],
    [post(editCommand, { "Content-Type": "text/plain" }), 415], [post("{"), 400],
    [post("x".repeat(131073)), 413], [post(editCommand, {}, "?region=x"), 400],
    [post({ ...editCommand, driverId: id }), 400], [post({ ...editCommand, reason: "" }), 400],
    [post({ ...command, expectedVersion: 0 }), 400],
    [post({ ...editCommand, report: { ...report, driverId: id } }), 400]]) {
    const handler = api();
    assert.equal((await handler.POST(request)).status, status);
    assert.equal(handler.calls.length, 0);
  }
  assert.equal((await api({ denied: true }).POST(post(editCommand))).status, 403);
  assert.equal((await api({ enabled: false }).POST(post(editCommand))).status, 403);
  for (const [code, status] of [["42501", 403], ["P0002", 404], ["40001", 409], ["23505", 409],
    ["22023", 422], ["23514", 422], ["XX000", 503]]) {
    assert.equal((await api({ error: { code } }).POST(post(editCommand))).status, status);
  }
  for (const data of [{}, { action: "delete", deletedId: id }, { action: "edit", report }, { action: "edit", report: { ...report, id: region } }])
    assert.equal((await api({ data }).POST(post(editCommand))).status, 503);
});
test("dated duty hours preserve >24h and year rollover without subtracting rests or guessing legacy dates", () => {
  assert.equal(reportLib.dutyDuration(report), 26.5 * 3600000);
  assert.equal(reportLib.durationLabel(reportLib.dutyDuration(report)), "26小時30分");
  assert.equal(reportLib.dutyDuration({ ...report, header: { ...report.header, dutyStartDate: null } }), null);
  assert.equal(reportLib.dutyDuration({ ...report, header: { ...report.header, dutyEndTime: null } }), null);
  assert.equal(reportLib.dutyDuration({ ...report, header: { ...report.header, dutyEndDate: "2026-10-24" } }), null);
  assert.equal(reportLib.defaultDutyEndDate("2026-12-31", "23:00", "02:00"), "2027-01-01");
  assert.equal(reportLib.defaultDutyEndDate("2028-02-28", "23:00", "02:00"), "2028-02-29");
  assert.equal(reportLib.defaultDutyEndDate("2026-10-25", "08:00", "18:00"), "2026-10-25");
  assert.equal(reportLib.reportHeaderSchema.safeParse({ ...report.header, serviceDate: report.serviceDate }).success, true);
  assert.equal(reportLib.reportHeaderSchema.safeParse({ ...report.header, serviceDate: report.serviceDate, dutyEndDate: "2026-10-24" }).success, false);
  assert.equal(schemas.operationInstant("2026-10-25T09:00:00", report.departedAt), report.departedAt);
  assert.equal(schemas.operationInstant("2026-10-25T10:00:00", report.departedAt), "2026-10-25T01:00:00.000Z");
  const departure = reportLib.stopTime("23:45", "2026-10-25T00:00:00+09:00");
  const arrival = reportLib.stopTime("23:55", departure);
  const nextDeparture = reportLib.stopTime("00:15", arrival);
  assert.equal(reportLib.reportTime(nextDeparture), "2026-10-26 00:15:00");
  assert.equal(reportLib.reportOnDate(report, "2026-10-26").departedAt, "2026-10-26T00:00:00.123456Z");
  const other = { ...row, company: "Other", report: { ...report, id: region, header: { ...report.header, vehicleNumber: "Other plate" } } };
  assert.deepEqual(normalize(schemas.filterOperationRows([row, other], "Synthetic company", "", report.serviceDate)), [row]);
  assert.equal(schemas.filterOperationRows([row], "", "Other plate", "").length, 0);
  assert.equal(schemas.filterOperationRows([row], "", "", "2026-10-26").length, 0);
});

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  return [node, ...elements(node.props.children)];
}
function screen(seed = { enabled: true, rows: [row] }, globals = {}) {
  const states = [seed, "", "", 0, "", "", null, false];
  const effects = []; const refs = []; let cursor = 0; let refCursor = 0; let auth;
  const listeners = {};
  const document = { visibilityState: "visible", addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {} };
  const ui = load("components/operations-reports.tsx", {
    react: { ...React, useState: initial => { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
      useRef: value => refs[refCursor++] ?? (refs[refCursor - 1] = { current: value }), useEffect: fn => effects.push(fn) },
    "@/lib/supabase/browser": { createClient: () => ({ auth: { onAuthStateChange: fn => {
      auth = fn; return { data: { subscription: { unsubscribe() {} } } };
    } } }) },
    "@/lib/driver/orders": { createDriverRequestId: () => id, japanDate: () => "2026-10-25" },
    "@/lib/operations-report-print": { printOperationsReports: globals.printOperationsReports ?? (async () => {}) },
    "@/components/operations-report-editor.module.css": { default: editorStyles },
  }, { document, window: { confirm: () => true, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {} },
    setTimeout: () => 1, clearTimeout() {}, ...globals });
  cursor = states.length;
  const outer = ui.OperationsReports({ region });
  const monthElement = elements(outer).find(e => typeof e.type === "function" && e.type.name === "OperationMonth");
  const Month = monthElement.type;
  const render = (printMonth = "2026-10", selectedDate = "2026-10-25") => {
    cursor = 0; refCursor = 0; effects.length = 0;
    return Month({ ...monthElement.props, printMonth, selectedDate, region });
  };
  return { states, refs, effects, render, document, listeners, outer, signOut: () => auth("SIGNED_OUT") };
}
test("operation list includes required columns, first/last stops, open reports and destructive confirmation", async () => {
  let command;
  const h = screen(undefined, { fetch: async (url, options) => {
    command = JSON.parse(options.body); return Response.json({ action: "delete", deletedId: id });
  } });
  let tree = h.render();
  const html = renderToStaticMarkup(tree);
  writeLayout("list", html);
  const controls = elements(tree);
  const companyFilter = controls.findIndex(element => element.type === "select");
  const runDateFilter = controls.findIndex(element => element.type === "input" && element.props["aria-label"] === "运行日期");
  const monthPrintButton = controls.findIndex(element => element.type === "button" && element.props.children === "月批量打印");
  const printMonthFilter = controls.findIndex(element => element.type === "input" && element.props["aria-label"] === "月批量打印月份");
  assert.ok(companyFilter < runDateFilter);
  assert.ok(monthPrintButton < printMonthFilter);
  assert.match(html, /operations-report-table w-full table-fixed/);
  assert.doesNotMatch(html, /min-w-\[1700px\]|overflow-x-auto/);
  for (const label of ["会社", "車両番号", "出勤点呼時間", "開始地点", "出発時間", "接客地点", "下客地点",
    "終了地点", "到着時間", "退勤点呼時間", "工作総時长", "编辑", "削除", "导出PDF", "月批量打印", "26小時30分"])
    assert.ok(html.includes(label), label);
  assert.ok(html.includes("第一经由地")); assert.ok(html.includes("最后经由地"));
  assert.doesNotMatch(html, /第一个经由地|最后一个经由地/);
  const pickupCell = elements(tree).find(element => element.type === "td" && element.props["data-label"] === "接客地点");
  const dropoffCell = elements(tree).find(element => element.type === "td" && element.props["data-label"] === "下客地点");
  assert.equal([pickupCell.props.children].flat().filter(child => typeof child === "string").join(""), "第一经由地");
  assert.equal([dropoffCell.props.children].flat().filter(child => typeof child === "string").join(""), "最后经由地");
  assert.doesNotMatch(html, />状態<|>已归库<|>出库中</);
  const headings = elements(tree).filter(e => e.type === "th");
  assert.equal(headings.length, 13);
  for (const label of ["日期", "車両番号", "運転手", "出勤点呼時間", "開始地点", "出発時間",
    "接客地点", "下客地点", "終了地点", "到着時間", "退勤点呼時間", "工作総時长", "操作"])
    assert.ok(elements(tree).some(e => e.type === "td" && e.props["data-label"] === label), label);
  for (const cell of elements(tree).filter(e => e.type === "th" || e.type === "td"))
    assert.ok(cell.props.className.split(" ").includes("text-center"));
  const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.dashboard \.operations-report-table\s*\{[^}]*min-width: 0;[^}]*font-size: 0\.6875rem;/);
  assert.match(styles, /\.dashboard \.operations-report-table :is\(th, td\)\s*\{[^}]*padding: 0\.65rem 0\.4rem;/);
  assert.match(styles, /\.dashboard \.operations-report-table tbody tr:nth-child\(even\)/);
  assert.match(styles, /@media \(max-width: 639px\)\s*\{[\s\S]*?\.dashboard \.operations-report-table thead\s*\{\s*display: none;/);
  assert.match(styles, /\.dashboard \.operations-report-table td\[data-label\]::before\s*\{[^}]*content: attr\(data-label\);/);
  assert.match(styles, /@media \(max-width: 900px\) and \(orientation: landscape\)\s*\{[\s\S]*?\.dashboard \.operations-report-table-region\s*\{[^}]*overflow-x: auto;[\s\S]*?\.dashboard \.operations-report-table,\s*\.dashboard \.operations-report-table tbody\s*\{[^}]*width: 1200px;[\s\S]*?\.dashboard \.operations-report-table thead\s*\{\s*display: table-header-group;/);
  assert.match(html, /list-panel operations-report-table-region border bg-white/);
  const actionCell = elements(tree).filter(e => e.type === "td").at(-1);
  assert.ok(actionCell.props.children.props.className.split(" ").includes("list-action-buttons"));
  assert.equal(headings.some(e => e.props.children === "会社"), false);
  assert.equal(elements(tree).some(e => e.type === "td" && e.props.children === row.company), false);
  for (const value of ["08:00", "09:00", "18:00", "10:30"])
    assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /\d{2}\/\d{2} \d{2}:\d{2}/);
  assert.match(html, /2026-10-25 运行：1 份日報/);
  assert.doesNotMatch(html, /訂単名称/);
  const buttons = elements(tree).filter(e => e.type === "button");
  await buttons.find(b => b.props.children === "削除").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(command, { action: "delete", reportId: id, expectedVersion: 1 });
  assert.equal(h.states[0].rows.length, 0);
  assert.match(h.states[2], /永久削除/);
  h.states[0] = { enabled: true, rows: [{ ...row, report: { ...report, returnedAt: null, returnAddress: null, returnKm: null } }] };
  tree = h.render();
  assert.match(renderToStaticMarkup(tree), /出库中/);
  assert.doesNotMatch(renderToStaticMarkup(tree), />状態<|>已归库<|>出库中</);
  assert.ok(renderToStaticMarkup(tree).includes("第一经由地"));
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /id: "orders", label: "予約管理"[^]*?id: "operations", label: "運行管理"/);
  assert.match(source, /activeView === "operations"/);
});
test("operations daily list renders the selected date while monthly print fetches its separately selected month", async () => {
  const past = { ...row, report: { ...report, id: region, serviceDate: "2026-10-24" } };
  const future = { ...row, report: { ...report, id: "f6900280-0000-4000-8000-000000000002", serviceDate: "2026-10-26" } };
  let printArgs;
  const h = screen({ enabled: true, rows: [past, row, future] }, {
    fetch: async url => {
      assert.match(url, /month=2025-03/);
      return Response.json({ enabled: true, rows: [{ ...row, report: { ...report, serviceDate: "2025-03-12" } }] });
    },
    printOperationsReports: async (...args) => { printArgs = args; },
  });
  const tree = h.render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /2026-10-25 运行：1 份日報/);
  assert.match(html, /第一经由地/);
  assert.doesNotMatch(html, /10\/24|10\/26/);
  const dateInput = elements(tree).find(element => element.type === "input" && element.props["aria-label"] === "运行日期");
  assert.equal(dateInput.props.value, "2026-10-25");
  dateInput.props.onChange({ target: { value: "2026-10-24" } });
  assert.equal(h.states[9], "2026-10-24");
  const printTree = h.render("2025-03");
  const monthInput = elements(printTree).find(element => element.type === "input" && element.props.type === "month");
  assert.equal(monthInput.props["aria-label"], "月批量打印月份");
  const printButton = elements(printTree).find(element => element.type === "button" && element.props.children === "月批量打印");
  await printButton.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(printArgs[0].length, 1);
  assert.equal(printArgs[1], "03月 運行日報");
});
test("operations date selector requests and shows past dates", async () => {
  const past = { ...row, report: { ...report, id: region, serviceDate: "2026-10-24" } };
  let requested;
  const h = screen({ enabled: true, rows: [past, row] }, { fetch: async url => {
    requested = url;
    return Response.json({ enabled: true, rows: [past, row] });
  } });
  h.render("2026-10", "2026-10-24");
  await h.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(requested, /month=2026-10/);
  const html = renderToStaticMarkup(h.render("2026-10", "2026-10-24"));
  assert.match(html, /2026-10-24 运行：1 份日報/);
  assert.ok(html.includes("第一经由地"));
  assert.doesNotMatch(html, /2026-10-25 运行|10\/25/);
});
test("monthly reads reject wrong scope and late hidden or signed-out responses", async () => {
  for (const action of ["hidden", "signed-out", "wrong-region", "wrong-month", "duplicate"]) {
    let done; let signal;
    const h = screen(null, { fetch: async (url, options) => {
      assert.match(url, /month=2026-10/); assert.match(url, new RegExp(`region=${region}`));
      signal = options.signal; return new Promise(resolve => { done = resolve; });
    } });
    h.render(); const cleanup = h.effects[0]();
    if (action === "hidden") { h.document.visibilityState = "hidden"; h.listeners.visibilitychange(); }
    if (action === "signed-out") h.signOut();
    done(Response.json({ enabled: true, rows: action === "wrong-region" ? [{ ...row, regionId: id }] :
      action === "wrong-month" ? [{ ...row, report: { ...report, serviceDate: "2026-11-01" } }] :
      action === "duplicate" ? [row, row] : [row] }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.states[0], null);
    if (["hidden", "signed-out"].includes(action)) assert.equal(signal.aborted, true);
    else assert.match(h.states[1], /不一致/);
    cleanup();
  }
});
test("cancelled or unconfirmed deletions never remove reports or show a false success", async () => {
  for (const mode of ["cancel", "conflict", "invalid-result"]) {
    let calls = 0;
    const h = screen(undefined, {
      window: { confirm: () => mode !== "cancel", addEventListener() {}, removeEventListener() {} },
      fetch: async () => { calls++; return mode === "conflict" ? Response.json({ error: "Version conflict: refresh" }, { status: 409 }) :
        Response.json({ action: "delete", deletedId: region }); },
    });
    const tree = h.render();
    elements(tree).find(e => e.type === "button" && e.props.children === "削除").props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.states[0].rows.length, 1);
    assert.equal(h.states[2], "");
    assert.equal(calls, mode === "cancel" ? 0 : 1);
    if (mode !== "cancel") assert.ok(h.states[1].length > 0);
  }
});
test("duty fields auto-roll end date until manually overridden for multi-day work", () => {
  const states = []; let cursor = 0;
  const Component = load("components/report-duty-fields.tsx", {
    react: { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial;
      return [states[i], value => { states[i] = value; }]; } },
  }).ReportDutyFields;
  const render = () => { cursor = 0; return elements(Component({ serviceDate: "2026-12-31", disabled: false })); };
  assert.equal(render().find(element => element.props.name === "dutyStartTime").props.type, "time");
  render().find(e => e.props.name === "dutyStartTime").props.onChange({ target: { value: "23:00" } });
  render().find(e => e.props.name === "dutyEndTime").props.onChange({ target: { value: "02:00" } });
  assert.equal(render().find(e => e.props.name === "dutyEndDate").props.value, "2027-01-01");
  render().find(e => e.props.name === "dutyEndDate").props.onChange({ target: { value: "2027-01-02" } });
  render().find(e => e.props.name === "dutyEndTime").props.onChange({ target: { value: "03:00" } });
  assert.equal(render().find(e => e.props.name === "dutyEndDate").props.value, "2027-01-02");
});
test("manual duty clock inputs format four digits and preserve automatic overnight dates", () => {
  const states = []; let cursor = 0;
  const Component = load("components/report-duty-fields.tsx", {
    react: { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial;
      return [states[i], value => { states[i] = value; }]; } },
  }).ReportDutyFields;
  const render = () => { cursor = 0; return elements(Component({
    serviceDate: "2026-12-31", disabled: false, manualTimeInput: true,
  })); };
  const start = () => render().find(element => element.props.name === "dutyStartTime");
  const end = () => render().find(element => element.props.name === "dutyEndTime");
  start().props.onChange({ target: { value: "2300" } });
  end().props.onChange({ target: { value: "0200" } });
  assert.equal(render().find(element => element.props.name === "dutyEndDate").props.value, "2027-01-01");
  const startInput = start();
  startInput.props.onBlur({ target: { value: "2300" } });
  assert.equal(start().props.value, "23:00");
  assert.equal(start().props.type, "text");
  assert.equal(end().props.inputMode, "numeric");
});
test("full editor posts header and stops, preserves hidden rests and records an automatic reason", async () => {
  for (const mode of ["success", "conflict", "unmounted"]) {
    let cursor = 0; let refCursor = 0; let done; let command; let saved = 0;
    const states = [report.stops, false, false, ""];
    const refs = []; const effects = [];
    const fields = { serviceDate: report.serviceDate, ...report.header, dutyStartTime: "0800", dutyEndTime: "1030",
      vehicleBaseline: report.header.vehicleNumber,
      departedAt: "0900",
      departureAddress: "Updated departure", departureKm: 100, returnedAt: reportLib.toJapanInput(report.returnedAt).slice(11, 16),
      returnAddress: report.returnAddress, returnKm: report.returnKm, reason: "Full correction" };
    for (const stop of report.stops) {
      fields[`${stop.id}.address`] = stop.address;
      fields[`${stop.id}.arrivedAt`] = stop.id === report.stops[0].id ? "1000" : reportLib.toJapanInput(stop.arrivedAt).slice(11, 16);
      fields[`${stop.id}.departedAt`] = stop.id === report.stops[0].id ? "1100" : reportLib.toJapanInput(stop.departedAt).slice(11, 16);
      fields[`${stop.id}.km`] = stop.departedKm ?? stop.arrivedKm ?? stop.plannedKm ?? "";
      fields[`${stop.id}.plannedKm`] = stop.plannedKm ?? "";
    }
    const editorModule = load("components/operations-reports.tsx", {
      react: { ...React, useState: () => { const i = cursor++; return [states[i], value => { states[i] = value; }]; },
        useRef: value => { const i = refCursor++; return refs[i] ?? (refs[i] = { current: i === 0 ? { showModal() {}, close() {} } : value }); },
        useEffect: fn => effects.push(fn) },
      "@/lib/supabase/browser": {}, "@/lib/driver/orders": { createDriverRequestId: () => id },
      "@/components/operations-report-editor.module.css": { default: editorStyles },
    }, { window: { addEventListener() {}, removeEventListener() {}, confirm: () => true },
      FormData: class { get(name) { return fields[name] ?? ""; } },
      fetch: async (url, options) => {
        assert.equal(url, "/api/operations-reports");
        command = JSON.parse(options.body); return new Promise(resolve => { done = resolve; });
      } });
    const Editor = editorModule.OperationReportEditor;
    const tree = Editor({ row, onClose() {}, onSaved: () => { saved++; } });
    if (mode === "success") {
      const markup = renderToStaticMarkup(tree);
      writeLayout("editor", markup);
      assert.match(markup, /type="text"[^>]*placeholder="0800"[^>]*name="departedAt"/);
      assert.match(markup, /type="text"[^>]*placeholder="0800"[^>]*name="[^"]+\.arrivedAt"/);
      assert.match(markup, /type="text"[^>]*placeholder="0800"[^>]*name="[^"]+\.departedAt"/);
      assert.match(markup, /type="text" inputMode="numeric" maxLength="5" placeholder="0800"[^>]*name="dutyStartTime"/);
      assert.match(markup, /type="text" inputMode="numeric" maxLength="5" placeholder="0800"[^>]*name="dutyEndTime"/);
      assert.equal(editorModule.formatOperationClockInput("0800"), "08:00");
      assert.equal(editorModule.formatOperationClockInput("8:00"), "08:00");
      assert.equal(editorModule.formatOperationClockInput("25:60"), "25:60");
      assert.throws(() => reportLib.stopTime(editorModule.formatOperationClockInput("2560"), "2026-10-25T00:00:00+09:00"),
        /有效時間/);
      const departureTime = elements(tree).find(element => element.type === "input" && element.props.name === "departedAt");
      const displayValue = { value: "0800" };
      departureTime.props.onBlur({ currentTarget: displayValue });
      assert.equal(displayValue.value, "08:00");
      assert.match(markup, /经由地 1 公里表/);
      assert.doesNotMatch(markup, /到着公里表|出発公里表|出発日期時間|到着日期時間/);
      assert.match(markup, /基本信息与点呼/);
      const summaryMarkup = markup.match(/<section[^>]*aria-label="本次汇总">([\s\S]*?)<\/section>/)?.[1];
      assert.ok(summaryMarkup);
      assert.deepEqual([...summaryMarkup.matchAll(/<span>([^<]+)<\/span>/g)].map(match => match[1]),
        ["当日公里数", "休憩時間", "拘束時間"]);
      assert.match(summaryMarkup, /<span>当日公里数<\/span><strong>80 km<\/strong>/);
      assert.match(markup, /<span>拘束時間<\/span><strong>26小時30分<\/strong>/);
      assert.match(markup, /<span>休憩時間<\/span><strong>2小時0分<\/strong>/);
      assert.doesNotMatch(markup, /休息记录|休息 1|修改原因/);
      assert.match(markup, /<h2[^>]*>乘務日報 · Linked driver<\/h2>/);
      assert.match(markup, /aria-label="出库经由地归库"/);
      assert.match(markup, /<th>项目<\/th><th>地址<\/th><th>公里数<\/th><th>到着<\/th><th>出发<\/th><th>操作<\/th>/);
      assert.match(markup, /<col style="width:56px"\/><col\/><col style="width:100px"\/><col style="width:90px"\/><col style="width:90px"\/><col style="width:78px"\/>/);
      assert.match(markup, /<th>開始地点<\/th><td><input[^>]*aria-label="開始地点"/);
      assert.match(markup, /<th>終了地点<\/th><td><input[^>]*aria-label="終了地点"/);
      assert.match(markup, /type="text" inputMode="decimal" maxLength="16"[^>]*name="departureKm"/);
      assert.match(markup, /type="text" inputMode="decimal" maxLength="16"[^>]*name="returnKm"/);
      assert.match(markup, /type="text" inputMode="decimal" maxLength="16"[^>]*name="[^"]+\.km"/);
      assert.doesNotMatch(markup, /aria-label="[^"]*公里表"[^>]*type="number"/);
      assert.match(markup, /role="group" aria-label="日报编辑操作" class="editor-stickyActions"/);
      const editorCss = readFileSync(new URL("../components/operations-report-editor.module.css", import.meta.url), "utf8");
      assert.match(editorCss, /@media\(min-width:700px\)\{[^}]+\}\.journeyTable col:nth-child\(2\)\{width:32%!important}\.journeyTable col:nth-child\(3\)\{width:16%!important}\.journeyTable col:nth-child\(4\),\.journeyTable col:nth-child\(5\)\{width:16%!important}/);
      assert.match(editorCss, /\.journeyTable col:nth-child\(2\)\{width:18%!important}/);
      assert.match(editorCss, /\.journeyTable col:nth-child\(3\)\{width:17%!important}/);
      assert.match(editorCss, /\.journeyTable col:nth-child\(4\),\.journeyTable col:nth-child\(5\)\{width:17%!important}/);
      assert.match(editorCss, /\.journeyTable col:nth-child\(6\)\{width:21%!important}/);
      assert.match(markup, /<button type="button"[^>]*>取消<\/button>/);
      assert.match(markup, /<button class="editor-saveButton"[^>]*>保存修改<\/button>/);
      const stopRow = markup.match(/<tbody[^>]*data-stop-id="[^"]+"[^>]*>([\s\S]*?)<\/tbody>/)[1];
      assert.equal((stopRow.match(/aria-label="经由地 1 公里表"/g) ?? []).length, 1);
      assert.equal((stopRow.match(/<tr/g) ?? []).length, 1);
      assert.match(stopRow, /aria-label="削除经由地 1">削除<\/button>/);
      assert.ok(stopRow.indexOf('name="f7900280-0000-4000-8000-000000000001.departedAt"') <
        stopRow.indexOf('aria-label="削除经由地 1"'));
      assert.match(markup, /例如 0800[\s\S]*?显示为 08:00/);
      assert.doesNotMatch(markup, /移除经由地/);
      assert.doesNotMatch(markup, /计划公里表/);
      for (const label of ["日期", "車両番号", "運転手", "客数", "出勤点呼日期", "退勤点呼日期",
        "出勤点呼時間", "退勤点呼時間"])
        assert.ok(markup.includes(label), label);
    }
    const cleanup = effects[0]();
    const form = elements(tree).find(e => e.type === "form");
    const first = form.props.onSubmit({ preventDefault() {}, currentTarget: {} });
    await form.props.onSubmit({ preventDefault() {}, currentTarget: {} });
    assert.equal(command.report.departedAt, report.departedAt);
    assert.deepEqual(normalize(command.report.stops), normalize(report.stops.map(stop => {
      const km = stop.departedKm ?? stop.arrivedKm ?? stop.plannedKm ?? null;
      return { ...stop, arrivedKm: stop.arrivedAt ? km : null, departedKm: stop.departedAt ? km : null,
        plannedKm: stop.plannedKm ?? null };
    })));
    assert.deepEqual(command.report.rests, report.rests);
    assert.deepEqual(command.report.header, report.header);
    assert.equal(command.report.header.dutyStartTime, "08:00");
    assert.equal(command.report.header.dutyEndTime, "10:30");
    assert.equal(command.reason, "电脑端编辑乘务日报");
    if (mode === "unmounted") cleanup();
    const { vehicleBaseline, ...savedHeader } = command.report.header;
    assert.equal(vehicleBaseline, undefined);
    done(mode === "conflict" ? Response.json({ error: "Version conflict: refresh" }, { status: 409 }) :
      Response.json({ action: "edit", report: { ...command.report, header: savedHeader, version: 2 } }));
    await first;
    assert.equal(saved, mode === "success" ? 1 : 0);
    if (mode === "conflict") assert.match(states[3], /Version conflict/);
    cleanup();
  }
});
test("editor saves added and removed stops using their own timestamps, including date changes", async () => {
  for (const action of ["add", "remove", "replace"]) for (const changeDate of [false, true]) {
    let cursor = 0; let refCursor = 0; let command; let saved = 0;
    const original = { ...report, stops: report.stops.map((stop, index) => ({
      ...stop, arrivedAt: `2026-10-25T${index === 0 ? "10:00:12.123456" : "10:00:45.654321"}+09:00`,
      departedAt: `2026-10-25T${index === 0 ? "10:00:20.234567" : "11:00:56.765432"}+09:00`,
    })) };
    const states = [original.stops, false, false, ""];
    const refs = [];
    const fields = { serviceDate: changeDate ? "2026-10-26" : report.serviceDate, ...report.header,
      departedAt: "0900", departureAddress: report.departureAddress, departureKm: report.departureKm,
      returnedAt: "1800", returnAddress: report.returnAddress, returnKm: report.returnKm };
    fields.dutyStartDate = fields.serviceDate;
    fields.dutyEndDate = fields.serviceDate;
    fields.dutyEndTime = "2000";
    const Editor = load("components/operations-reports.tsx", {
      react: { ...React,
        useState: () => { const i = cursor++; return [states[i], value => {
          states[i] = typeof value === "function" ? value(states[i]) : value;
        }]; },
        useRef: value => { const i = refCursor++; return refs[i] ?? (refs[i] = { current: value }); },
        useEffect() {},
      },
      "@/lib/supabase/browser": {}, "@/lib/driver/orders": { createDriverRequestId: () => id },
      "@/components/operations-report-editor.module.css": { default: editorStyles },
    }, {
      window: { confirm: () => true },
      FormData: class { get(name) { return fields[name] ?? ""; } },
      fetch: async (_url, options) => {
        command = JSON.parse(options.body);
        return Response.json({ action: "edit", report: { ...command.report, version: 2 } });
      },
    }).OperationReportEditor;
    const render = () => {
      cursor = 0; refCursor = 0;
      return Editor({ row: { ...row, report: original }, onClose() {}, onSaved: () => { saved++; } });
    };
    if (action !== "add") {
      elements(render()).find(element => element.props["aria-label"] === "削除经由地 1").props.onClick();
    }
    if (action !== "remove") {
      elements(render()).find(element => element.type === "button" && element.props.children === "＋ 经由地").props.onClick();
    }
    for (const stop of states[0]) {
      const added = stop.id === id;
      fields[`${stop.id}.address`] = added ? "Added destination" : stop.address;
      fields[`${stop.id}.arrivedAt`] = added ? "1400" : reportLib.toJapanInput(stop.arrivedAt).slice(11, 16);
      fields[`${stop.id}.departedAt`] = added ? "1500" : reportLib.toJapanInput(stop.departedAt).slice(11, 16);
      fields[`${stop.id}.km`] = added ? 150 : stop.departedKm;
    }
    await elements(render()).find(element => element.type === "form").props.onSubmit({
      preventDefault() {}, currentTarget: {},
    });
    assert.equal(states[3], "", `${action}, changeDate=${changeDate}: ${states[3]}`);
    assert.equal(saved, 1);
    assert.deepEqual(command.report.stops.map(stop => stop.id), Array.from(states[0], stop => stop.id));
    const dated = reportLib.reportOnDate({ ...original, stops: states[0] }, fields.serviceDate);
    for (const stop of command.report.stops) {
      if (stop.id === id) {
        assert.equal(stop.arrivedAt, `${fields.serviceDate}T05:00:00.000Z`);
        assert.equal(stop.departedAt, `${fields.serviceDate}T06:00:00.000Z`);
        assert.equal(stop.address, "Added destination");
      } else {
        const expected = dated.stops.find(item => item.id === stop.id);
        assert.equal(stop.arrivedAt, expected.arrivedAt);
        assert.equal(stop.departedAt, expected.departedAt);
      }
    }
  }
});
test("PDF and monthly print contain one complete escaped sheet per report in service-date order", () => {
  const long = { ...row, company: '<img src=x onerror="alert(1)">', report: { ...report,
    id: region, serviceDate: "2026-10-26", stops: Array.from({ length: 100 }, (_, i) =>
      ({ ...report.stops[0], id: `f7900280-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, address: `经由地 ${i + 1} ${"地点".repeat(40)}` })) } };
  const html = printing.buildOperationsPrintHtml([long, row], "Synthetic month");
  assert.equal((html.match(/<section class="sheet">/g) ?? []).length, 2);
  assert.equal((html.match(/class="stop-entry"/g) ?? []).length, 102);
  assert.ok(html.indexOf('class="service-date">10/25') < html.indexOf('class="service-date">10/26'));
  assert.doesNotMatch(html, /2026-10-/);
  for (const value of ["08:00", "09:00", "10:00", "11:00", "18:00", "10:30"])
    assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /\d{2}\/\d{2} \d{2}:\d{2}/);
  assert.doesNotMatch(html, /26小時30分/); assert.match(html, /2小時0分/); assert.match(html, /休息記録/);
  assert.doesNotMatch(html, /拘束時間/);
  assert.match(html, /class="total-rest">2小時0分<\/td>/);
  const totalsTable = html.match(/<table class="totals">([\s\S]*?)<\/table>/)[1];
  assert.ok(totalsTable.indexOf("休憩時間") > totalsTable.indexOf("メーター数"));
  assert.match(html, /80 km/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img src=x/);
  const firstStop = html.match(/<tbody class="stop-entry" data-stop-id="[^"]+">([\s\S]*?)<\/tbody>/)[1];
  assert.equal((firstStop.match(/class="odometer"/g) ?? []).length, 1);
  assert.match(firstStop, /111 km/);
  assert.doesNotMatch(firstStop, /class="odometer">110 km/);
  assert.match(firstStop, /class="stop-rest">1小時0分/);
  assert.doesNotMatch(html, /予定距離|class="planned"|日本時間|已归库|出库中（未完成）|\d+\.\d+ km/);
  assert.match(html, /<th colspan="2">時間<\/th>/);
  assert.match(html, /body\{font:12px/);
  assert.match(html, /\.inspection\{font-size:12px\}/);
  assert.match(html, /break-after:page/);
  assert.throws(() => printing.buildOperationsPrintHtml([], "empty"), /没有可打印/);
  if (process.env.OPERATIONS_PRINT_FIXTURE) writeFileSync(process.env.OPERATIONS_PRINT_FIXTURE, html);
});
test("export uses integer kilometers, per-stop rest totals and compact header without status or planned distance", () => {
  const sample = { ...row, report: { ...report, departureKm: 100.4, returnKm: 180.6,
    stops: report.stops.map(stop => ({ ...stop, departedKm: 111.6, plannedKm: 98765.4 })) } };
  const html = printing.buildOperationsPrintHtml([sample], "Compact report");
  assert.match(html, /<th>開始<\/th><td class="place">/);
  assert.match(html, /<th>終了<\/th><td class="place">/);
  assert.doesNotMatch(html, /<th>(?:出库|归库)<\/th>/);
  assert.match(html, /class="odometer">100 km/);
  assert.match(html, /class="odometer">112 km/);
  assert.match(html, /class="odometer">181 km/);
  assert.match(html, /class="total-distance">80 km<\/td>/);
  assert.equal((html.match(/class="stop-rest">1小時0分/g) ?? []).length, 2);
  assert.match(html, /class="total-rest">2小時0分/);
  const journeyColumns = [...html.match(/<table class="journey"><colgroup>(.*?)<\/colgroup>/)[1]
    .matchAll(/width:(\d+)%/g)].map(match => Number(match[1]));
  const totalColumns = [...html.match(/<table class="totals"><colgroup>(.*?)<\/colgroup>/)[1]
    .matchAll(/width:(\d+)%/g)].map(match => Number(match[1]));
  assert.equal(totalColumns.slice(0, 3).reduce((sum, width) => sum + width, 0),
    journeyColumns.slice(0, 4).reduce((sum, width) => sum + width, 0));
  assert.equal(totalColumns[3], journeyColumns[4]);
  assert.equal(totalColumns[4], journeyColumns[5]);
  assert.doesNotMatch(html, /98765|予定距離|日本時間|已归库|出库中|\d+\.\d+ km/);
  const header = html.match(/<table class="report-header">([\s\S]*?)<\/table>/)[1];
  assert.match(header, /class="service-date">10\/25/);
  assert.match(header, /<th>乗車人数<\/th><td>2<\/td>/);
  const headerRows = [...header.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(match => match[1]);
  assert.match(headerRows[1], /class="service-date">10\/25<\/td><td colspan="5">Synthetic company<\/td>/);
  assert.doesNotMatch(header, /<th>所属<\/th>/);
  assert.match(headerRows[1], /<th>乗車人数<\/th><td>2<\/td>/);
  assert.doesNotMatch(headerRows[1], /運転士|車両番号/);
  assert.match(headerRows[2], /^<th colspan="2">運転士<\/th><td colspan="2">[\s\S]*?<\/td>\s*<th colspan="2">出勤時間（始業点呼）<\/th><td colspan="3" class="clock">08:00<\/td>/);
  assert.match(headerRows[3], /^<th colspan="2">車両番号<\/th><td colspan="2">[\s\S]*?<\/td>\s*<th colspan="2">退勤時間（終業点呼）<\/th><td colspan="3" class="clock">/);
  assert.doesNotMatch(headerRows[2], /車両番号|退勤時間/);
  assert.doesNotMatch(headerRows[3], /運転士|出勤時間/);
  assert.doesNotMatch(headerRows[2], /所属|service-date/);
  const headerWidths = [...header.matchAll(/width:(\d+)%/g)].map(match => Number(match[1]));
  const cellWidths = markup => [...markup.matchAll(/<(?:th|td)([^>]*)>/g)].map(match =>
    Number(match[1].match(/colspan="(\d+)"/)?.[1] ?? 1));
  const widthsForRow = markup => {
    let column = 0;
    return cellWidths(markup).map(span => {
      const width = headerWidths.slice(column, column + span).reduce((sum, value) => sum + value, 0);
      column += span;
      return width;
    });
  };
  assert.deepEqual(widthsForRow(headerRows[1]), [20, 60, 10, 10]);
  assert.deepEqual(widthsForRow(headerRows[2]), [20, 30, 20, 30]);
  assert.deepEqual(widthsForRow(headerRows[3]), widthsForRow(headerRows[2]));
  for (const table of ["report-header", "journey", "totals"]) {
    const markup = html.match(new RegExp(`<table class="${table}">([\\s\\S]*?)</table>`))[1];
    const group = markup.match(/<colgroup>([\s\S]*?)<\/colgroup>/)[1];
    assert.equal([...group.matchAll(/width:(\d+)%/g)].reduce((sum, match) => sum + Number(match[1]), 0), 100);
  }
  const blankTimes = printing.buildOperationsPrintHtml([{ ...row, report: { ...report,
    stops: [{ ...report.stops[0], arrivedAt: null, departedAt: null, arrivedKm: null, departedKm: null }] } }], "No times");
  assert.match(blankTimes, /class="stop-rest">0小時0分/);
  if (process.env.OPERATIONS_PRINT_PREVIEW) writeFileSync(process.env.OPERATIONS_PRINT_PREVIEW, html);
});
test("paper-style report uses only filled stops and keeps the lower inspection form blank and unchanged", () => {
  const empty = { id: "f7900280-0000-4000-8000-000000000003", address: "", arrivedAt: null, departedAt: null,
    arrivedKm: null, departedKm: null, plannedKm: null };
  const variants = [[], [empty], [report.stops[0], empty, report.stops[1]], [{ ...empty, plannedKm: 0 }]];
  let lower;
  for (const [index, stops] of variants.entries()) {
    const html = printing.buildOperationsPrintHtml([{ ...row, report: { ...report, stops } }], "Paper form");
    const expected = [0, 0, 2, 1][index];
    assert.equal((html.match(/class="stop-entry"/g) ?? []).length, expected);
    assert.doesNotMatch(html, /（空白）/);
    assert.match(html, /乗　務　日　報/);
    for (const label of ["始業時アルコールチェック", "終業時アルコールチェック", "運行管理者＆補助者",
      "報告及び特記事項", "給油量", "日　常　点　検", "エンジンルーム点検", "ブレーキペダル",
      "灯火装置及び方向", "携帯式アルコールチェッカー番号", "車両掃除", "ＥＴＣ使用"])
      assert.ok(html.includes(label), label);
    const form = html.match(/<div class="paper-lower">([\s\S]*?)<\/article>/)[1];
    if (lower) assert.equal(form, lower);
    lower = form;
    assert.match(form, /class="manager-sign">Synthetic manager<\/td>/);
    assert.doesNotMatch(form, /Manual driver|08:00|100\.0/);
    assert.doesNotMatch(html, /<footer>|工時＝|○为原表印刷符号|日報版本/);
    if (index === 2) {
      assert.ok(html.includes(`<th rowspan="2">1</th>`));
      assert.ok(html.includes(`<th rowspan="2">2</th>`));
      assert.doesNotMatch(html, /<th rowspan="2">3<\/th>/);
      assert.ok(html.indexOf("第一经由地") < html.indexOf("最后经由地"));
    }
  }
});
test("company operations manager prints only in its designated field and is escaped or blank when unavailable", () => {
  const html = printing.buildOperationsPrintHtml([{ ...row, operationsManager: '<b>Manager & Co</b>' }], "Manager mapping");
  assert.match(html, /class="manager-sign">&lt;b&gt;Manager &amp; Co&lt;\/b&gt;<\/td>/);
  assert.equal((html.match(/&lt;b&gt;Manager/g) ?? []).length, 1);
  assert.match(html, /<td colspan="5">Synthetic company<\/td>/);
  const missing = printing.buildOperationsPrintHtml([{ ...row, operationsManager: null }], "Missing");
  assert.match(missing, /class="manager-sign"><\/td>/);
  assert.equal(schemas.operationRowSchema.safeParse({ ...row, operationsManager: 123 }).success, false);
  const { operationsManager: omitted, ...legacy } = row;
  assert.equal(omitted, "Synthetic manager");
  assert.equal(schemas.operationRowSchema.safeParse(legacy).success, false);
});
test("printing scales each report independently and removes private frames on completion or abort", async () => {
  let removed = 0; let printed = 0; let after;
  const contents = [{ scrollHeight: 2000, scrollWidth: 700, style: {} }, { scrollHeight: 500, scrollWidth: 700, style: {} }];
  const doc = { open() {}, write() {}, close() {}, fonts: { ready: Promise.resolve() },
    querySelectorAll: () => contents.map(content => ({ clientHeight: 1000, clientWidth: 700, querySelector: () => content })) };
  const view = { addEventListener: (event, fn) => { assert.equal(event, "afterprint"); after = fn; }, focus() {}, print: () => { printed++; } };
  const mock = load("lib/operations-report-print.ts", {}, { document: { createElement: () =>
    ({ style: {}, contentDocument: doc, contentWindow: view, remove: () => { removed++; } }), body: { appendChild() {} } } });
  const controller = new AbortController();
  await mock.printOperationsReports([row, row], "month", controller.signal);
  assert.equal(contents[0].style.transform, "scale(0.5)");
  assert.equal(contents[1].style.transform, "scale(1)");
  assert.equal(printed, 1); assert.equal(removed, 0);
  after(); assert.equal(removed, 1);
  await assert.rejects(mock.printOperationsReports([row], "aborted", AbortSignal.abort()), { name: "AbortError" });
});
