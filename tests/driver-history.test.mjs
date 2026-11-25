import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";

const require = createRequire(import.meta.url);
function load(relative, mocks = {}, globals = {}) {
  const filename = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const compiled = { exports: {} };
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  vm.runInNewContext(output, { module: compiled, exports: compiled.exports, Request, Response, Headers, URL, Intl, Date,
    console: { error() {} },
    require: name => Object.hasOwn(mocks, name) ? mocks[name] :
      name.startsWith("@/") ? load(`${name.slice(2)}${name === "@/app/driver/navigation" ? ".tsx" : ".ts"}`, mocks, globals) : require(name),
    ...globals,
  });
  return compiled.exports;
}
const id = "c6000000-0000-4000-8000-000000000001";
const other = "c6000000-0000-4000-8000-000000000002";
const report = { id, serviceDate: "2026-10-27", version: 1, departedAt: "2026-10-27T09:00:00+09:00",
  departureAddress: "Depot", departureKm: 100, returnedAt: "2026-10-27T10:00:00+09:00",
  returnAddress: "Depot", returnKm: 110, stops: [], rests: [] };
const summary = { id, serviceDate: report.serviceDate, returnedAt: report.returnedAt };
const calendar = { month: "2026-10", entries: [
  { orderId: id, date: report.serviceDate, time: "09:00",
    orderName: "History order", status: "完了", vehicle: "Car", vehicleNumber: "123", tripSummary: "" },
  { orderId: other, date: "2026-10-26", time: "10:00",
    orderName: "Order without report", status: "完了", vehicle: "Car", vehicleNumber: "123", tripSummary: "" },
] };
const claim = { assignmentId: id, version: 1, category: "company", status: "approved",
  expenses: [{ id: other, type: "company", detail: "Parking", amount: 1500, receipts: [] }],
  overtimeHours: 0, reviewNote: "", submittedAt: "2026-10-27T10:00:00Z" };
const finance = { trips: [{ assignmentId: id, date: report.serviceDate, pickup: "Airport", destination: "Hotel",
  existingOvertimeHours: 0, claims: [claim] }],
  fuelClaims: [{ id: other, date: report.serviceDate, assignmentId: id, version: 1, status: "approved",
    amount: 500, receipts: [], reviewNote: "" }],
  wages: [{ date: report.serviceDate, base: 1000, bonus: 0, overtime: 0, advances: 1500 }], manualItems: [] };
const { jsonResponse } = load("lib/api-response.ts");
const reports = load("lib/driver/reports.ts");
const shifts = load("lib/driver/shifts.ts");
const financeLibrary = load("lib/driver/finance.ts", { "./fuel": load("lib/driver/fuel.ts") });
const calendarLibrary = load("lib/driver/calendar.ts", { "@/lib/driver/shifts": shifts });

function historyRoute({ denied, result = [summary], error = null } = {}) {
  const calls = [];
  const route = load("app/api/driver/report-history/route.ts", {
    "@/lib/api-response": { jsonResponse }, "@/lib/driver/reports": reports, "@/lib/driver/shifts": shifts,
    "@/lib/driver/authorization": { requireDriver: async () => denied ? { response: jsonResponse({}, { status: denied }) } :
      { response: null, supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data: result, error }; } } } },
  });
  return { ...route, calls };
}
const request = query => new Request(`https://driver.example/api/driver/report-history${query}`);

test("history API requires identity, validates query, scopes month and returns private data", async () => {
  const denied = historyRoute({ denied: 403 });
  assert.equal((await denied.GET(request("?month=2026-10"))).status, 403);
  assert.equal(denied.calls.length, 0);
  for (const query of ["", "?month=0000-01", "?month=2026-13", "?month=2026-10&month=2026-11",
    `?month=2026-10&reportId=${id}`, "?reportId=bad", "?driverId=other"]) {
    const h = historyRoute();
    assert.equal((await h.GET(request(query))).status, 400, query);
    assert.equal(h.calls.length, 0);
  }
  const h = historyRoute();
  const response = await h.GET(request("?month=2026-10"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), { reports: [summary] });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: "driver_report_history", args: { target_month: "2026-10" } }]);
  assert.equal((await historyRoute({ result: [summary] }).GET(request("?month=2026-11"))).status, 500);
  assert.equal((await historyRoute({ error: { code: "XX" } }).GET(request("?month=2026-10"))).status, 503);
});

test("history detail validates identity, missing records and output", async () => {
  const h = historyRoute({ result: report });
  assert.deepEqual(await (await h.GET(request(`?reportId=${id}`))).json(), { report });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: "driver_report_detail", args: { target_report: id } }]);
  assert.equal((await historyRoute({ result: null }).GET(request(`?reportId=${id}`))).status, 404);
  assert.equal((await historyRoute({ result: { ...report, id: other } }).GET(request(`?reportId=${id}`))).status, 500);
  assert.equal((await historyRoute({ result: { ...report, privateField: true } }).GET(request(`?reportId=${id}`))).status, 500);
});

test("history SQL returns all own month records and denies other drivers and regions", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create table public.driver_daily_reports(id uuid, driver_id uuid, region_id uuid, service_date date,
      departed_at timestamptz, returned_at timestamptz);
    create function public.driver_identity() returns table(driver_id uuid,region_id uuid)
      language sql as $$select nullif(current_setting('test.driver',true),'')::uuid,
       nullif(current_setting('test.region',true),'')::uuid
       where nullif(current_setting('test.driver',true),'') is not null$$;
    create function public.driver_report_projection(r public.driver_daily_reports) returns jsonb
      language sql as $$select jsonb_build_object('id',r.id,'serviceDate',r.service_date)$$;
    select set_config('test.driver','${id}',false), set_config('test.region','${other}',false);
    insert into public.driver_daily_reports
    select ('c6000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid,'${id}','${other}',
      '2026-10-01'::date,'2026-10-01T09:00Z'::timestamptz + n * interval '1 minute',null
      from generate_series(1,35) n;
    insert into public.driver_daily_reports values
      ('${id}','${id}','${other}','2026-11-01','2026-11-01T09:00Z',null),
      ('${other}','${other}','${other}','2026-10-01','2026-10-01T09:00Z',null);
  `);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261210000000_driver_report_history.sql", import.meta.url), "utf8"));
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
  assert.equal((await scalar("select public.driver_report_history($1) as value", ["2026-10"])).length, 35);
  assert.equal((await scalar("select public.driver_report_history($1) as value", ["2026-11"])).length, 1);
  assert.equal(await scalar("select public.driver_report_detail($1) as value", [other]), null);
  assert.equal((await scalar("select public.driver_report_detail($1) as value", [id])).id, id);
  await assert.rejects(scalar("select public.driver_report_history($1) as value", ["0000-01"]), /Invalid month/);
  assert.equal(await scalar("select has_function_privilege('anon','public.driver_report_detail(uuid)','EXECUTE') as value"), false);
  assert.equal(await scalar("select has_function_privilege('authenticated','public.driver_report_history(text)','EXECUTE') as value"), true);
  await db.exec(`select set_config('test.region','${id}',false)`);
  assert.equal((await scalar("select public.driver_report_history($1) as value", ["2026-10"])).length, 0);
  assert.equal(await scalar("select public.driver_report_detail($1) as value", [id]), null);
  await db.exec("select set_config('test.driver','',false)");
  await assert.rejects(scalar("select public.driver_report_history($1) as value", ["2026-10"]), /Driver required/);
  await assert.rejects(scalar("select public.driver_report_detail($1) as value", [id]), /Driver required/);
});

function historyHarness({ fail = "", delay = false } = {}) {
  const states = [], effects = [], requests = [], pending = [];
  let cursor = 0;
  const document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const Component = load("app/driver/history/history.tsx", {
    react: { ...React, useEffect: effect => effects.push(effect), useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    } },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/driver/orders": { japanDate: () => "2026-10-27" },
    "@/lib/driver/calendar": calendarLibrary, "@/lib/driver/finance": financeLibrary, "@/lib/driver/reports": reports,
    "@/lib/supabase/browser": { createClient: () => ({ auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } }) },
  }, { document, AbortController, location: { replace() {} }, fetch: (url, options) => {
    requests.push({ url, signal: options.signal });
    const emptyMonth = url.includes("month=2026-11");
    const value = url.includes("/calendar?") ? emptyMonth ? { month: "2026-11", entries: [] } : calendar :
      url.includes("/finance?") ? emptyMonth ? { trips: [], fuelClaims: [], wages: [], manualItems: [] } : finance :
        { reports: emptyMonth ? [] : [summary] };
    const response = Response.json(value, { status: url.includes(fail) && fail ? 503 : 200 });
    return delay ? new Promise(resolve => pending.push(() => resolve(response))) : Promise.resolve(response);
  } }).default;
  function render() { cursor = 0; effects.length = 0; return Component(); }
  return { states, effects, requests, pending, render };
}

test("daily history is read-only and shows orders and finance without report rows", async () => {
  const h = historyHarness();
  const initialHtml = renderToStaticMarkup(h.render());
  assert.doesNotMatch(initialHtml, /正在读取履歴/);
  const cleanup = h.effects[0]();
  await new Promise(done => setImmediate(done));
  const html = renderToStaticMarkup(h.render());
  for (const text of ["订单名称", "History order", "Order without report", "立替", "¥1,500", "燃油费", "¥500",
    "当日工资", "¥1,000"])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /月工資汇总/);
  assert.doesNotMatch(html, /当日日报|日报未完成|>修改</);
  assert.doesNotMatch(html, /href="\/driver\/(?:finance|report)\?/);
  assert.match(html, /当日工资<\/span><strong>¥1,000<\/strong>/);
  assert.match(html, /aria-current="page"[^>]*>履歴/);
  cleanup();
});

test("month changes cancel old requests and partial failures preserve available history", async () => {
  const h = historyHarness({ delay: true, fail: "/finance?" });
  const tree = h.render(); const cleanup = h.effects[0]();
  assert.equal(h.requests.length, 2);
  const walk = node => !React.isValidElement(node) ? [] :
    [node, ...React.Children.toArray(node.props.children).flatMap(walk)];
  walk(tree).find(node => node.type === "input" && node.props.type === "month").props.onChange({ target: { value: "2026-11" } });
  cleanup();
  assert.ok(h.requests.every(item => item.signal.aborted));
  h.render(); const stopNext = h.effects[0]();
  assert.ok(h.requests.slice(3).every(item => item.url.includes("month=2026-11")));
  h.pending.slice(0, 2).forEach(resolve => resolve());
  await new Promise(done => setImmediate(done));
  assert.equal(h.states[1], null);
  h.pending.slice(2).forEach(resolve => resolve());
  await new Promise(done => setImmediate(done));
  assert.equal(h.states[1].month, "2026-11");
  stopNext();
  const partial = historyHarness({ fail: "/finance?" });
  partial.render(); const stop = partial.effects[0]();
  await new Promise(done => setImmediate(done));
  const html = renderToStaticMarkup(partial.render());
  assert.doesNotMatch(html, /财务读取失败/);
  assert.match(html, /History order/);
  assert.match(html, /履歴/);
  assert.doesNotMatch(html, /月工資汇总/);
  stop();
  assert.ok(h.requests.every(item => !item.url.includes("/report-history")));
});
