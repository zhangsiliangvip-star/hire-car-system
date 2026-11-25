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
import { PGlite } from "@electric-sql/pglite";

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
      name === "@/components/driver-report-duty-rows" ? load("components/driver-report-duty-rows.tsx", { "@/lib/driver/reports": reports }) :
      name === "@/lib/driver/report-draft" ? load("lib/driver/report-draft.ts") :
      name === "./report.module.css" ? { default: { report: "driver-report", floatingActions: "driver-report-actions" } } : require(name),
    Request, Response, Headers, URL, Date, Intl, process, queueMicrotask, console: { error() {} }, ...globals,
  });
  return compiled.exports;
}
const reports = load("lib/driver/reports.ts");
const { jsonResponse } = load("lib/api-response.ts");
const reportDrafts = load("lib/driver/report-draft.ts");
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
  payload: { useDefault: false, address: "Synthetic depot", km: 100, departedAt: fixture.departedAt } };
const defaultsFixture = { serviceDate: fixture.serviceDate, driverName: "Linked driver",
  orders: [{ assignmentId: id, orderName: "Linked order name", time: "09:00", pickup: "Airport", destination: "Hotel",
    vehicleNumber: "Linked plate", depot: { name: "Vehicle owner", address: "Owner garage" } },
  { assignmentId: id.replace(/1$/, "2"), orderName: "Second order name", time: "14:00", pickup: "Hotel", destination: "Airport",
    vehicleNumber: "Second plate", depot: null }] };

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}
const walkElements = node => !React.isValidElement(node) ? [] :
  [node, ...React.Children.toArray(node.props.children).flatMap(walkElements)];

function draftHarness({ storage = memoryStorage(), user = id, saved = fixture, savedReports, details = [],
  cloudDrafts = [], createdReport, initialReportId, initialDate, status = 200 } = {}) {
  const states = [], refs = [], effects = [], events = new Map();
  const headerInputs = [], tableInputs = [];
  let stateCursor = 0, refCursor = 0, authChange, cleanup;
  const requests = [];
  const document = { visibilityState: "visible",
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name) };
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React,
      useState: initial => {
        const index = stateCursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef: initial => {
        const index = refCursor++;
        return refs[index] ??= { current: initial };
      },
      useEffect: effect => effects.push(effect),
    },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/driver/orders": { createDriverRequestId: () => id }, "@/lib/driver/reports": reports,
    "@/lib/supabase/browser": { createClient: () => ({ auth: {
      getUser: async () => ({ data: { user: { id: user } }, error: null }),
      onAuthStateChange: callback => {
        authChange = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    } }) },
  }, {
    document, sessionStorage: storage, AbortController,
    window: { addEventListener: document.addEventListener, removeEventListener: document.removeEventListener,
      confirm: () => { throw new Error("Navigation must not discard the draft."); } },
    location: { replace() {} }, setInterval: () => 1, clearInterval() {},
    FormData: class {
      constructor(form) { this.get = name => form.querySelectorAll().find(input => input.name === name)?.value ?? ""; }
    },
    fetch: async (url, options) => {
      if (options?.method) requests.push({ url, options });
      if (options?.method === "POST") {
        if (url === "/api/driver/report-drafts") return Response.json({ draft: JSON.parse(options.body) });
        if (createdReport && JSON.parse(options.body).action === "checkout")
          return Response.json({ report: createdReport });
        return Response.json(status === 200 ? { report: { ...saved, version: saved.version + 1 } } : { error: "Save failed." }, { status });
      }
      if (url.startsWith("/api/driver/report-history?reportId=")) {
        const report = details.find(item => item.id === new URL(`https://driver.example${url}`).searchParams.get("reportId"));
        return Response.json(report ? { report } : { error: "Not found" }, { status: report ? 200 : 404 });
      }
      return Response.json(url.startsWith("/api/driver/report-defaults") ? defaultsFixture
        : { reports: savedReports ?? (saved ? [saved] : []), depot: null, drafts: cloudDrafts });
    },
  }).default;
  function render() {
    stateCursor = 0; refCursor = 0; effects.length = 0;
    const tree = Component({ initialReportId, initialDate });
    refs[0].current = {
      querySelectorAll: selector => selector === "[data-manual-time]" ? [] : tableInputs,
      querySelector: selector => selector === "#report-checkout" ? {
        id: "report-checkout", querySelectorAll: () => tableInputs.filter(input => input.form.id === "report-checkout"),
      } : null,
    };
    refs[1].current = { querySelectorAll: () => headerInputs, reportValidity: () => true };
    effects[3]?.();
    return tree;
  }
  async function loadPage() {
    cleanup?.(); render(); cleanup = effects[0]();
    await new Promise(done => setImmediate(done));
    return render();
  }
  async function loadDefaults() {
    render(); effects[2]();
    await new Promise(done => setImmediate(done));
    return render();
  }
  function field(formId, name, value) {
    const inputs = formId === "report-header" ? headerInputs : tableInputs;
    const input = inputs.find(item => item.form.id === formId && item.name === name);
    if (input) input.value = value;
    else inputs.push({ form: { id: formId }, name, value });
  }
  async function edit() {
    const tree = render();
    walkElements(tree).find(node => node.props["aria-label"] === "日報基本信息").props.onInput();
    tree.props.onInput();
    await new Promise(done => setImmediate(done));
    return render();
  }
  async function selectReport(reportId) {
    const select = walkElements(render()).find(node => node.type === "select" &&
      React.Children.toArray(node.props.children).some(option => option.props.value === reportId));
    await select.props.onChange({ target: { value: reportId } });
  }
  return { states, refs, storage, requests, field, edit, render, loadPage, loadDefaults, selectReport,
    signOut: () => authChange("SIGNED_OUT"),
    visibility: value => { document.visibilityState = value; events.get("visibilitychange")(); },
    pageHide: () => events.get("pagehide")(),
  };
}

test("opening reports starts fresh after completed history and still permits viewing it", async () => {
  const h = draftHarness();
  let html = renderToStaticMarkup(await h.loadPage());
  assert.match(html, /新日報/);
  assert.doesNotMatch(html, /日本時間/);
  assert.doesNotMatch(html, /value="Synthetic depot"/);
  await h.selectReport(id);
  html = renderToStaticMarkup(h.render());
  assert.match(html, /value="Synthetic depot"/);
  const reopened = draftHarness({ storage: h.storage });
  assert.match(renderToStaticMarkup(await reopened.loadPage()), /新日報/);
});

test("opening reports resumes an unfinished report even when newer history comes first", async () => {
  const active = { ...fixture, id: id.replace(/1$/, "2"), serviceDate: "2026-10-26",
    returnedAt: null, returnAddress: null, returnKm: null, departureAddress: "Active depot" };
  const h = draftHarness({ savedReports: [fixture, active] });
  let html = renderToStaticMarkup(await h.loadPage());
  assert.match(html, /value="Active depot"/);
  assert.match(html, /请先完成当前出库中的日报/);
  await h.selectReport(id);
  html = renderToStaticMarkup(h.render());
  assert.match(html, /value="Synthetic depot"/);
  const reopened = draftHarness({ savedReports: [fixture, active] });
  assert.match(renderToStaticMarkup(await reopened.loadPage()), /value="Active depot"/);
});

test("calendar date opens a report for that date unless another report is still open", async () => {
  const date = "2026-10-25";
  const h = draftHarness({ saved: null, savedReports: [], initialDate: date });
  let html = renderToStaticMarkup(await h.loadPage());
  assert.equal(h.states[10], date);
  assert.equal(h.states[8], true);
  assert.match(html, new RegExp(`value="${date}"`));

  const active = { ...fixture, id: id.replace(/1$/, "2"), serviceDate: "2026-10-26",
    returnedAt: null, returnAddress: null, returnKm: null };
  const blocked = draftHarness({ saved: null, savedReports: [active], initialDate: date });
  html = renderToStaticMarkup(await blocked.loadPage());
  assert.equal(blocked.states[1], active.id);
  assert.equal(blocked.states[10], active.serviceDate);
  assert.match(html, /请先完成 2026-10-26 的未归库日報，再填写 2026-10-25 的日報/);
});

test("new daily report shows editable garage start/end and a floating save button", async () => {
  const h = draftHarness({ saved: null, savedReports: [] });
  const html = renderToStaticMarkup(await h.loadPage());
  assert.equal((html.match(/value="車庫"/g) ?? []).length, 2);
  assert.match(html, /aria-label="日報保存"[\s\S]*?>保存<\/button>/);
  assert.match(html, /aria-label="追加空白经由地"/);
  assert.doesNotMatch(html, /保存開始地点/);
});

test("cloud draft schema is strict and preserves linked report version and stop IDs", () => {
  const cloudDraft = {
    reportId: id, version: 3, serviceDate: fixture.serviceDate, assignment: "",
    fields: { "report-edit-return/address": "車庫" }, stopIds: [id],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(reportDrafts.reportCloudDraftSchema.parse(cloudDraft))), cloudDraft);
  assert.equal(reportDrafts.reportCloudDraftSchema.safeParse({ ...cloudDraft, starting: false }).success, false);
  assert.equal(reportDrafts.reportCloudDraftSchema.safeParse({ ...cloudDraft, stopIds: ["invalid"] }).success, false);
  const migration = readFileSync(new URL("../supabase/migrations/20261215000000_driver_report_cloud_drafts.sql", import.meta.url), "utf8");
  assert.match(migration, /driver_report_draft_save/);
  assert.match(migration, /driver_report_draft_delete/);
  assert.match(migration, /clear_driver_report_draft_on_return/);
});

test("cloud draft migration scopes draft saves and removes linked drafts after return", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table public.drivers(id uuid, region_id uuid, primary key(id, region_id));
      create function public.driver_identity() returns table(driver_id uuid, region_id uuid)
        language sql stable as $$
          select current_setting('app.driver_id')::uuid, current_setting('app.region_id')::uuid
        $$;
      create table public.driver_daily_reports(
        id uuid primary key, driver_id uuid not null, region_id uuid not null, service_date date not null,
        version bigint not null, returned_at timestamptz,
        foreign key(driver_id, region_id) references public.drivers(id, region_id)
      );
    `);
    await db.exec(readFileSync(new URL("../supabase/migrations/20261215000000_driver_report_cloud_drafts.sql", import.meta.url), "utf8"));
    const regionId = id.replace(/1$/, "9");
    await db.query("insert into auth.users(id) values ($1)", [id]);
    await db.query("insert into public.drivers(id, region_id) values ($1, $2)", [id, regionId]);
    await db.query("select set_config('app.driver_id', $1, false), set_config('app.region_id', $2, false), set_config('request.jwt.claim.sub', $1, false)", [id, regionId]);
    const date = fixture.serviceDate;
    await db.query("select public.driver_report_draft_save($1, null, 0, '', '{\"address\":\"partial\"}'::jsonb, '[]'::jsonb)", [date]);
    const draftId = id.replace(/1$/, "8");
    await db.query("insert into public.driver_daily_reports(id, driver_id, region_id, service_date, version) values ($1,$2,$3,$4,1)",
      [draftId, id, regionId, date]);
    await db.query("select public.driver_report_draft_save($1, $2, 1, '', '{}'::jsonb, '[]'::jsonb)", [date, draftId]);
    assert.equal((await db.query("select jsonb_array_length(public.driver_report_drafts()) as count")).rows[0].count, 1);
    await assert.rejects(db.query("select public.driver_report_draft_save($1, $2, 2, '', '{}'::jsonb, '[]'::jsonb)", [date, draftId]),
      error => error.code === "40001");
    await db.query("update public.driver_daily_reports set returned_at=now() where id=$1", [draftId]);
    assert.equal((await db.query("select jsonb_array_length(public.driver_report_drafts()) as count")).rows[0].count, 0);
    await db.query("select public.driver_report_draft_delete($1)", [date]);
  } finally {
    await db.close();
  }
});

test("new daily report restores an incomplete cloud draft on another device", async () => {
  const date = "2026-10-25";
  const stopId = id.replace(/1$/, "2");
  const h = draftHarness({ saved: null, savedReports: [], initialDate: date, cloudDrafts: [{
    reportId: null, version: 0, serviceDate: date, assignment: "",
    fields: { "report-checkout/address": "Online depot", "report-edit-return/address": "Online return",
      [`report-stop-${stopId}/address`]: "Online stop" }, stopIds: [stopId],
  }] });
  const html = renderToStaticMarkup(await h.loadPage());
  assert.match(html, /已恢复线上未完成日报/);
  assert.match(html, /value="Online depot"/);
  assert.match(html, /value="Online return"/);
  assert.match(html, /value="Online stop"/);
});

test("saving an incomplete new report persists the cloud draft without creating a formal report", async () => {
  const h = draftHarness({ saved: null, savedReports: [] });
  await h.loadPage();
  h.field("report-checkout", "address", "Partial departure");
  await h.edit();
  const button = walkElements(h.render()).find(node => node.type === "button" &&
    node.props["aria-label"] === undefined && node.props.children === "保存");
  await button.props.onClick();
  assert.deepEqual(h.requests.map(request => request.url), ["/api/driver/report-drafts"]);
  const body = JSON.parse(h.requests[0].options.body);
  assert.equal(body.reportId, null);
  assert.equal(body.fields["report-checkout/address"], "Partial departure");
  assert.match(renderToStaticMarkup(h.render()), /未完成日报已保存到线上/);
});

test("completed departure links the saved cloud draft to the new report version", async () => {
  const date = fixture.serviceDate;
  const createdReport = { ...fixture, serviceDate: date, version: 1, returnedAt: null, returnAddress: null,
    returnKm: null, departureAddress: "車庫", departureKm: 100,
    header: { assignmentId: id, vehicleNumber: "Linked plate", driverName: "Linked driver", passengerCount: null } };
  const h = draftHarness({ saved: null, savedReports: [], createdReport });
  await h.loadPage();
  h.states[10] = date;
  await h.loadDefaults();
  h.states[12] = id;
  for (const [form, name, value] of [
    ["report-header", "serviceDate", date], ["report-header", "vehicleNumber", "Linked plate"],
    ["report-header", "driverName", "Linked driver"], ["report-header", "passengerCount", ""],
    ["report-header", "assignmentId", id], ["report-checkout", "address", "車庫"],
    ["report-checkout", "km", "100"], ["report-checkout", "departedAt", "0900"],
  ]) h.field(form, name, value);
  const button = walkElements(h.render()).find(node => node.type === "button" && node.props.children === "保存");
  await button.props.onClick();
  assert.deepEqual(h.requests.map(request => request.url),
    ["/api/driver/report-drafts", "/api/driver/reports", "/api/driver/report-drafts"]);
  const linkedDraft = JSON.parse(h.requests[2].options.body);
  assert.equal(linkedDraft.reportId, createdReport.id);
  assert.equal(linkedDraft.version, createdReport.version);
  assert.equal(linkedDraft.fields["report-edit-departure/address"], "車庫");
  assert.equal(linkedDraft.fields["report-checkout/address"], undefined);
});

test("resetting a new report on the same day retains loaded defaults", async () => {
  const h = draftHarness({ saved: null });
  await h.loadPage();
  const today = h.states[10];
  h.states[11] = { ...defaultsFixture, serviceDate: today, orders: [defaultsFixture.orders[0]] };
  h.states[12] = id;
  const button = walkElements(h.render()).find(node => node.type === "button" && node.props.children === "＋ 新建日报");
  await button.props.onClick();
  assert.equal(h.states[11].serviceDate, today);
  assert.equal(h.states[12], id);
});

test("history link opens and saves a report beyond the recent list", async () => {
  const old = { ...fixture, id: id.replace(/1$/, "2"), departureAddress: "Older depot" };
  const h = draftHarness({ initialReportId: old.id, saved: old, savedReports: [fixture], details: [old] });
  let html = renderToStaticMarkup(await h.loadPage());
  assert.match(html, /value="Older depot"/);
  h.field("report-header", "vehicleNumber", "Updated plate");
  const tree = await h.edit();
  await walkElements(tree).find(node => node.type?.name === "AddStopForm").props.save("edit_stops", { stops: [], force: true });
  html = renderToStaticMarkup(h.render());
  assert.match(html, /value="Older depot"/);
  assert.equal(h.states[0].reports.find(report => report.id === old.id).version, 2);
});

test("opening history preserves a draft for a different old report", async () => {
  const target = { ...fixture, id: id.replace(/1$/, "2"), departureAddress: "Target depot" };
  const oldDraft = { ...fixture, id: id.replace(/1$/, "3"), departureAddress: "Draft report" };
  const storage = memoryStorage();
  storage.setItem(`driver-report-draft:${id}`, JSON.stringify({
    reportId: oldDraft.id, version: oldDraft.version, serviceDate: oldDraft.serviceDate, starting: false,
    assignment: "", fields: { "report-edit-departure/address": "Unsaved depot" },
  }));
  const h = draftHarness({ storage, initialReportId: target.id, savedReports: [fixture], details: [target, oldDraft] });
  const html = renderToStaticMarkup(await h.loadPage());
  assert.match(html, /value="Unsaved depot"/);
  assert.match(html, /已恢复另一份本机草稿/);
  assert.equal(h.states[1], oldDraft.id);
  assert.notEqual(storage.length, 0);
});

test("missing history report shows an error rather than another report", async () => {
  const h = draftHarness({ initialReportId: id.replace(/1$/, "2") });
  const html = renderToStaticMarkup(await h.loadPage());
  assert.match(html, /日報不存在或无权查看/);
  assert.doesNotMatch(html, /value="Synthetic depot"/);
});

test("incomplete report fields survive app switches, navigation and reload without submitting", async () => {
  const h = draftHarness();
  await h.loadPage();
  await h.selectReport(id);
  h.field("report-header", "serviceDate", fixture.serviceDate);
  h.field("report-header", "vehicleNumber", "Draft plate");
  h.field("report-header", "passengerCount", "");
  h.field("report-header", "dutyStartTime", "2");
  h.field("report-header", "dutyEndTime", "0215");
  h.field("report-edit-departure", "address", "Unsaved depot");
  h.field("report-edit-departure", "km", "");
  h.field("report-edit-return", "address", "Unsaved return");
  const tree = await h.edit();
  assert.equal(walkElements(tree).find(node => node.type?.name === "DriverNavigation").props.canLeave(), true);
  h.visibility("hidden");
  assert.notEqual(h.states[0], null, "hiding must not destroy the live form");
  h.pageHide();
  h.visibility("visible");
  await h.loadPage();
  assert.equal(h.states[9], true);
  const restored = draftHarness({ storage: h.storage });
  const html = renderToStaticMarkup(await restored.loadPage());
  for (const value of ["Draft plate", "Unsaved depot", "Unsaved return", "0215"])
    assert.ok(html.includes(`value="${value}"`), value);
  assert.match(html, /name="dutyStartTime"[^>]*value="2"/);
  assert.match(html, /name="dutyEndTime"[^>]*value="0215"/);
  assert.doesNotMatch(html, /dutyStartDate|dutyEndDate|出勤点呼日期|退勤点呼日期/);
  assert.match(html, /name="passengerCount"[^>]*value=""/);
  assert.match(html, /aria-label="出库公里表"[^>]*value=""/);
  assert.match(html, /已恢复本机草稿/);
});

test("draft storage is account-isolated, rejects stale versions and is cleared on sign-out", async () => {
  const h = draftHarness();
  await h.loadPage();
  await h.selectReport(id);
  h.field("report-header", "vehicleNumber", "Private draft");
  await h.edit();
  const other = draftHarness({ storage: h.storage, user: id.replace(/1$/, "2") });
  assert.doesNotMatch(renderToStaticMarkup(await other.loadPage()), /Private draft/);
  const changed = draftHarness({ storage: h.storage, saved: { ...fixture, version: 2 } });
  const html = renderToStaticMarkup(await changed.loadPage());
  assert.match(html, /服务器日報已有更新/);
  assert.doesNotMatch(html, /value="Private draft"/);
  assert.equal(h.storage.length, 1, "conflicting draft is not silently discarded");
  h.signOut();
  assert.equal(h.storage.length, 0);
});

test("new report draft restores its date, selected order and incomplete departure", async () => {
  const h = draftHarness({ saved: null });
  await h.loadPage();
  h.states[10] = fixture.serviceDate;
  h.states[12] = defaultsFixture.orders[1].assignmentId;
  h.field("report-header", "serviceDate", fixture.serviceDate);
  h.field("report-checkout", "address", "New draft depot");
  h.field("report-checkout", "departedAt", "09");
  await h.edit();
  const restored = draftHarness({ storage: h.storage, saved: null });
  const html = renderToStaticMarkup(await restored.loadPage());
  assert.equal(restored.states[10], fixture.serviceDate);
  assert.equal(restored.states[12], defaultsFixture.orders[1].assignmentId);
  assert.equal(restored.states[8], true);
  assert.match(html, /value="New draft depot"/);
  assert.match(html, /name="departedAt"[^>]*value="09"/);
  await restored.loadDefaults();
  assert.equal(restored.states[12], defaultsFixture.orders[1].assignmentId, "loading defaults must not reset the restored order");
});

for (const status of [200, 409])
test(`report save ${status === 200 ? "clears" : "retains"} the local draft`, async () => {
  const h = draftHarness({ status });
  await h.loadPage();
  await h.selectReport(id);
  h.field("report-header", "vehicleNumber", "Draft");
  const tree = await h.edit();
  const save = walkElements(tree).find(node => node.type?.name === "AddStopForm").props.save;
  await save("edit_stops", { stops: [], force: true });
  assert.equal(h.storage.length, status === 200 ? 0 : 1);
});

test("stop mutations rebase the draft without losing other unfinished fields", async () => {
  const h = draftHarness();
  await h.loadPage();
  await h.selectReport(id);
  h.field("report-header", "vehicleNumber", "Unfinished plate");
  h.field(`report-stop-${id}`, "address", "Removed draft stop");
  const tree = await h.edit();
  const save = walkElements(tree).find(node => node.type?.name === "AddStopForm").props.save;
  await save("remove_stop", { stopId: id });
  const stored = JSON.parse(h.storage.getItem(`driver-report-draft:${id}`));
  assert.equal(stored.version, 2);
  assert.equal(stored.fields["report-header/vehicleNumber"], "Unfinished plate");
  assert.equal(stored.fields[`report-stop-${id}/address`], undefined);
});

test("storage errors are visible and prevent navigation from discarding edits", async () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error("Storage blocked"); };
  const h = draftHarness({ storage });
  await h.loadPage();
  await h.selectReport(id);
  h.field("report-header", "vehicleNumber", "Keep live");
  const tree = await h.edit();
  assert.equal(walkElements(tree).find(node => node.type?.name === "DriverNavigation").props.canLeave(), false);
  assert.match(renderToStaticMarkup(h.render()), /无法保留本机草稿/);
  assert.notEqual(h.states[0], null);
});

test("signing out from other driver sections clears only report draft keys", () => {
  const { clearReportDrafts } = load("lib/driver/report-draft.ts");
  const storage = memoryStorage();
  storage.setItem(`driver-report-draft:${id}`, "{}");
  storage.setItem("unrelated", "retain");
  clearReportDrafts(storage);
  assert.equal(storage.length, 1);
  assert.equal(storage.getItem("unrelated"), "retain");
  assert.match(readFileSync(new URL("../app/driver/driver-brand.tsx", import.meta.url), "utf8"),
    /signOutError\) throw signOutError;[\s\S]*clearReportDrafts\(sessionStorage\)/);
});

test("saved reports poll latest plates but never overwrite dirty or saving forms, including late responses", async () => {
  for (const mode of ["clean", "dirty", "saving", "late-dirty"]) {
    const data = { vehicleLinking: true, reports: [{ ...fixture,
      header: { vehicleNumber: "BASE", assignmentId: id, driverName: "Driver", passengerCount: 1 },
      orderOptions: [{ assignmentId: id, label: "Synthetic order", vehicleNumber: "BASE" }],
    }], depot: null };
    const states = [data, id, "", "", false, mode === "saving", 0, Date.now(),
      false, mode === "dirty", fixture.serviceDate, null, "", "", null, [], false];
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
      walk(tree).find(node => node.props["aria-label"] === "日報基本信息").props.onInput();
    }
    resolve(Response.json({ ...data, reports: [{ ...data.reports[0],
      header: { ...data.reports[0].header, vehicleNumber: "NEW" } }] }));
    await new Promise(done => setImmediate(done));
    assert.equal(states[0].reports[0].header.vehicleNumber, mode === "clean" ? "NEW" : "BASE");
    cleanup(); assert.equal(signal.aborted, true); assert.equal(cleared, true);
    const html = renderToStaticMarkup(tree);
    assert.match(html, /日報关联訂単/);
    const options = html.match(/<select name="assignmentId"[\s\S]*?<\/select>/)?.[0] || "";
    assert.match(options, /Synthetic order<\/option>/);
    assert.doesNotMatch(options, /BASE|Synthetic plate/);
    assert.doesNotMatch(html, /修改并保存也会更新訂単/);
  }
});

test("polling keeps the selected historical report outside the recent list", async () => {
  const old = { ...fixture, id: id.replace(/1$/, "2"), departureAddress: "Old depot" };
  const states = [{ reports: [fixture, old], depot: null }, old.id, "", "", false, false, 0, Date.now(),
    false, false, fixture.serviceDate, null, "", "", null, [], false];
  const effects = [];
  let cursor = 0, tick;
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React, useEffect: effect => effects.push(effect), useRef: value => ({ current: value }),
      useState: () => { const index = cursor++; return [states[index], value => { states[index] = value; }]; } },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
  }, { document: { visibilityState: "visible" }, AbortController,
    setInterval: callback => { tick = callback; return 1; }, clearInterval() {},
    fetch: async url => Response.json(url.startsWith("/api/driver/report-history?")
      ? { report: { ...old, version: 2 } } : { reports: [fixture], depot: null }),
  }).default;
  Component();
  const cleanup = effects[1]();
  tick();
  await new Promise(done => setImmediate(done));
  assert.equal(states[0].reports.find(item => item.id === old.id).version, 2);
  cleanup();
});

test("report action buttons remain fixed above the viewport", () => {
  const css = readFileSync(new URL("../app/driver/report/report.module.css", import.meta.url), "utf8");
  assert.match(css, /\.floatingActions\{[^}]*position:fixed/);
  assert.match(css, /@media\(max-width:639px\)\{[\s\S]*?\.floatingActions\{[^}]*left:0/);
});

test("new report shortcut stays visible while report data is loading", () => {
  const states = [null, null, "", "", true, false, 0, Date.now(), false, false,
    fixture.serviceDate, null, "", "", null, [], false];
  let cursor = 0;
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React, useEffect() {}, useRef: value => ({ current: value }),
      useState: () => [states[cursor++], () => {}] },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
  }).default;
  const html = renderToStaticMarkup(React.createElement(Component));
  assert.match(html, /刷新日報<\/button><button class="driver-link" disabled="" title="日报加载完成后可新建" aria-label="新建日报（日报加载完成后可新建）">＋ 新建日报<\/button>/);
});

for (const { first, differentDate } of [
  { first: "defaults", differentDate: false },
  { first: "reports", differentDate: false },
  { first: "reports", differentDate: true },
])
test(`parallel report loading preserves drafts when ${first} finishes first${differentDate ? " on a different date" : ""}`, async () => {
  const states = [], refs = [], effects = [], requests = new Map();
  const storage = memoryStorage();
  const draftDate = differentDate ? "2026-10-28" : fixture.serviceDate;
  storage.setItem(`driver-report-draft:${id}`, JSON.stringify({
    reportId: null, version: 0, serviceDate: draftDate, starting: true,
    assignment: defaultsFixture.orders[1].assignmentId, fields: { "report-checkout/address": "Draft depot" },
  }));
  let stateCursor = 0, refCursor = 0;
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React,
      useState: initial => {
        const index = stateCursor++;
        if (!(index in states)) states[index] = index === 10 ? fixture.serviceDate : typeof initial === "function" ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef: initial => refs[refCursor++] ??= { current: initial },
      useEffect: effect => effects.push(effect),
    },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
    "@/lib/supabase/browser": { createClient: () => ({ auth: {
      getUser: async () => ({ data: { user: { id } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } }) },
  }, {
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
    sessionStorage: storage, AbortController, setInterval: () => 1, clearInterval() {},
    fetch: (url, options) => new Promise(resolve => requests.set(url.includes("report-defaults") ? "defaults" : "reports",
      { resolve, signal: options.signal })),
  }).default;
  function render() { stateCursor = 0; refCursor = 0; effects.length = 0; return Component(); }
  render();
  const stopReports = effects[0]();
  const stopDefaults = effects[2]();
  assert.deepEqual([...requests.keys()].sort(), ["defaults", "reports"]);
  const results = { defaults: defaultsFixture, reports: { reports: [fixture], depot: null } };
  requests.get(first).resolve(Response.json(results[first]));
  await new Promise(done => setImmediate(done));
  render();
  const second = first === "defaults" ? "reports" : "defaults";
  let stopNewDefaults;
  if (differentDate) {
    const oldRequest = requests.get("defaults");
    stopDefaults();
    assert.equal(oldRequest.signal.aborted, true);
    stopNewDefaults = effects[2]();
    oldRequest.resolve(Response.json(defaultsFixture));
    await new Promise(done => setImmediate(done));
    assert.equal(states[11], null);
    results.defaults = { ...defaultsFixture, serviceDate: draftDate };
    assert.equal(requests.get("defaults").signal.aborted, false);
  }
  requests.get(second).resolve(Response.json(results[second]));
  await new Promise(done => setImmediate(done));
  const html = renderToStaticMarkup(render());
  assert.match(html, /value="Draft depot"/);
  assert.match(html, /已恢复本机草稿/);
  assert.equal(states[12], defaultsFixture.orders[1].assignmentId);
  assert.equal(states[11].serviceDate, draftDate);
  stopNewDefaults?.(); stopDefaults(); stopReports();
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
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: "driver_report_defaults_v2", args: { target_date: fixture.serviceDate } }]);
  for (const options of [{ result: null }, { result: { ...defaultsFixture, password: "no" } },
    { result: { ...defaultsFixture, orders: [{ ...defaultsFixture.orders[0], price: 999 }] } }])
    assert.equal((await defaultsHandler(options).GET(new Request("https://driver.example?date=2026-10-27"))).status, 500);
  assert.equal((await defaultsHandler({ error: { code: "XX000" } }).GET(new Request("https://driver.example?date=2026-10-27"))).status, 503);
});

test("incomplete new report stays editable before order selection and uses garage labels", () => {
  const states = [{ reports: [], depot: { name: "Wrong depot", address: "Wrong address" } },
    null, "", "", false, false, 0, Date.now(), false, false, fixture.serviceDate, defaultsFixture, "", "", null, [], false];
  const runtime = require("react/jsx-runtime");
  let cursor; let refCursor; let select; let date; let checkoutProps;
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
  }).default;
  function render() { cursor = 0; refCursor = 0; return renderToStaticMarkup(React.createElement(Component)); }
  let html = render();
  assert.equal(checkoutProps.disabled, false);
  assert.match(html, /請選択当天訂単/);
  const headerMarkup = html.match(/<form[^>]*aria-label="日報基本信息"[^>]*>([\s\S]*?)<\/form>/)[1];
  assert.deepEqual([...headerMarkup.matchAll(/aria-label="([^"]+)"/g)].map(match => match[1]),
    ["日期", "关联当天訂単", "車両番号", "運転手", "客数", "出勤点呼時間", "退勤点呼時間"]);
  assert.doesNotMatch(headerMarkup, /driver-card/);
  select.onChange({ target: { value: id } });
  html = render();
  assert.equal(checkoutProps.disabled, false);
  const orderOptions = html.match(/<select aria-label="关联当天訂単"[\s\S]*?<\/select>/)?.[0] || "";
  assert.match(orderOptions, /Linked order name/);
  assert.doesNotMatch(orderOptions, /09:00|Airport|Hotel|Linked plate/);
  assert.match(html, /value="Linked plate"/);
  assert.match(html, /value="Linked driver"/);
  assert.match(html, /aria-label="開始地点地址"[^>]*value="車庫"/);
  assert.doesNotMatch(html, /Wrong address|Wrong depot/);
  select.onChange({ target: { value: defaultsFixture.orders[1].assignmentId } });
  html = render();
  assert.match(html, /value="Second plate"/);
  assert.match(html, /aria-label="開始地点地址"[^>]*value="車庫"/);
  assert.match(html, /未找到車庫地址，已暂填「車庫」/);
  assert.doesNotMatch(html, /value="Owner garage"/);
  states[0] = { reports: [], depot: null };
  render();
  date.onChange({ target: { value: "2026-10-28" } });
  html = render();
  assert.equal(states[11], null);
  assert.equal(states[12], "");
  assert.equal(checkoutProps.disabled, false);
  assert.doesNotMatch(html, /value="Linked plate"|value="Second plate"|value="Owner garage"/);
  states[11] = { serviceDate: "2026-10-28", driverName: "Linked driver", orders: [] };
  html = render();
  assert.equal(checkoutProps.disabled, false);
  assert.match(html, /暂无可关联订单/);
  states[0] = { reports: [{ ...fixture, header: { vehicleNumber: "Saved plate", driverName: "Saved name", passengerCount: null } }], depot: null };
  states[1] = fixture.id;
  html = render();
  assert.match(html, /value="Saved plate"/);
  assert.match(html, /value="Saved name"/);
  assert.doesNotMatch(html, /aria-label="关联当天訂単"/);
});

test("report order selectors display only names after database projections are migrated", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create type public.driver_daily_reports as (driver_id uuid, region_id uuid, service_date date, header jsonb);
    create function public.driver_report_defaults(target_date date) returns jsonb language sql as $$
      with o as (select 'Order Name'::text as customer),
      a as (select '${id}'::uuid as assignment_id, '09:00'::text as departure_time,
        'Airport'::text as pickup, 'Hotel'::text as destination)
      select jsonb_build_object('orders',jsonb_build_array(jsonb_build_object(
        'assignmentId',a.assignment_id,'time',a.departure_time,'pickup',a.pickup,'destination',a.destination)))
      from a cross join o
    $$;
    create function public.report_order_options(r public.driver_daily_reports) returns jsonb language sql as $$
      select coalesce(jsonb_agg(jsonb_build_object('assignmentId',x.id,
        'label',concat_ws(' · ',x.time,x.customer,x.pickup||' → '||x.destination),
        'vehicleNumber',x.plate)),'[]'::jsonb)
      from (select '${id}'::uuid as id,'09:00'::text as time,'Order Name'::text as customer,
        'Airport'::text as pickup,'Hotel'::text as destination,'Plate'::text as plate) x
    $$;
  `);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261213000000_driver_report_order_names_only.sql", import.meta.url), "utf8"));
  const defaults = (await db.query("select public.driver_report_defaults_v2('2026-10-27') as value")).rows[0].value;
  const options = (await db.query("select public.report_order_options(null::public.driver_daily_reports) as value")).rows[0].value;
  assert.equal(defaults.orders[0].orderName, "Order Name");
  assert.deepEqual(options, [{ assignmentId: id, label: "Order Name", vehicleNumber: "Plate" }]);
});

test("defaults loader ignores late dates, auto-selects a single order and surfaces failures", async () => {
  for (const mode of ["cancelled", "single", "wrong-date", "failed"]) {
    const states = [{ reports: [], depot: null }, null, "", "", false, false, 0, Date.now(),
      false, false, fixture.serviceDate, null, "", "", null, [], false];
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
    assert.throws(() => reports.returnFromForm(open, form(fields), fixture.departedAt), /同時填写/);
  const returned = reports.returnFromForm(open, form({ address: "Depot", km: "120", returnedAt: "00:20" }), fixture.departedAt);
  assert.equal(returned.returnedAt, "2026-10-27T15:20:00.000Z");
  assert.equal(reports.returnFromForm(fixture, form({ address: "Edited", km: "150", returnedAt: "02:30" }), fixture.departedAt).returnedAt, fixture.returnedAt);
  assert.throws(() => reports.returnFromForm(fixture, form({}), fixture.departedAt), /不能清空/);
  const command = { reportId: id, expectedVersion: 1, requestId: id, action: "edit_stops", payload: { stops: [], return: returned } };
  assert.equal(reports.reportCommandSchema.safeParse(command).success, true);
  assert.equal(reports.reportCommandSchema.safeParse({ ...command, payload: { stops: [], return: { ...returned, km: -1 } } }).success, false);
  assert.equal(reports.reportCommandSchema.safeParse({ ...command, payload: { stops: [], return: returned, force: true } }).success, true);
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
    assert.throws(() => reports.departureFromForm(fixture, form({ ...fields, departedAt })), /有效出库時間/);
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
test("force save preserves invalid fields and out-of-order times without changing saved values", () => {
  const previous = "2026-10-27T23:00:00+09:00";
  assert.equal(reports.stopTime("09:00", previous), "2026-10-28T00:00:00.000Z");
  assert.equal(reports.stopTime("09:00", previous, null, true), "2026-10-27T00:00:00.000Z");
  assert.equal(reports.stopTime("bad", previous, previous, true), previous);
  assert.equal(reports.stopTime("", previous, previous, true), previous);
  const form = fields => ({ get: name => fields[name] ?? "" });
  const departure = reports.departureFromForm(fixture, form({ address: "", km: "-1", departedAt: "25:61" }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(departure)),
    { address: fixture.departureAddress, km: fixture.departureKm, departedAt: fixture.departedAt });
  const open = { ...fixture, returnedAt: null, returnAddress: null, returnKm: null };
  assert.equal(reports.returnFromForm(open, form({ address: "Return", km: "-1", returnedAt: "bad" }),
    fixture.departedAt, true), undefined);
  const keptReturn = reports.returnFromForm(fixture, form({ address: "", km: "99999999", returnedAt: "bad" }),
    fixture.departedAt, true);
  assert.deepEqual(JSON.parse(JSON.stringify(keptReturn)),
    { address: fixture.returnAddress, km: fixture.returnKm, returnedAt: fixture.returnedAt });
  const stop = { id, address: "Saved stop", arrivedAt: fixture.departedAt, arrivedKm: 100,
    departedAt: fixture.returnedAt, departedKm: 110 };
  const keptStop = reports.stopFromForm(stop, form({ address: "", km: "-1", arrivedAt: "bad", departedAt: "" }),
    fixture.departedAt, true);
  assert.deepEqual(JSON.parse(JSON.stringify(keptStop)), stop);
  const outOfOrderStop = reports.stopFromForm(stop, form({ address: "Saved stop", km: "110",
    arrivedAt: "08:00", departedAt: "07:00" }), fixture.departedAt, true);
  assert.ok(Date.parse(outOfOrderStop.departedAt) < Date.parse(outOfOrderStop.arrivedAt));
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
      { response: null, supabase: { rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: name === "driver_reports" ? data :
          name === "driver_report_drafts" ? data.drafts ?? [] : data, error };
      } } } },
  });
  return { ...route, calls };
}
function reportDraftHandler({ deny, data, error = null } = {}) {
  const calls = [];
  const route = load("app/api/driver/report-drafts/route.ts", {
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/report-draft": reportDrafts,
    "@/lib/driver/assignment-action": { isDriverActionOrigin: r => r.headers.get("origin") === "https://driver.example" },
    "@/lib/driver/test-runtime": { isDriverPwaTestMode: () => false },
    "@/lib/driver/authorization": { requireDriver: async () => deny ?
      { response: jsonResponse({ error: "Denied" }, { status: deny }) } :
      { response: null, supabase: { rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: data ?? args, error };
      } } } },
  });
  return { ...route, calls };
}
test("cloud draft API validates ownership, origin, shape and explicit RPC outcomes", async () => {
  const draft = { reportId: null, version: 0, serviceDate: fixture.serviceDate, assignment: "",
    fields: { "report-checkout/address": "Partial" }, stopIds: [] };
  const request = (method, url, body) => new Request(url, { method,
    headers: { Origin: "https://driver.example", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await reportDraftHandler({ deny: 401 }).POST(request("POST", "https://driver.example/api/driver/report-drafts", draft))).status, 401);
  const invalid = reportDraftHandler();
  assert.equal((await invalid.POST(request("POST", "https://driver.example/api/driver/report-drafts", { ...draft, starting: true }))).status, 400);
  assert.equal(invalid.calls.length, 0);
  assert.equal((await reportDraftHandler().DELETE(request("DELETE", "https://driver.example/api/driver/report-drafts?date=2026-02-30"))).status, 400);
  assert.equal((await reportDraftHandler().DELETE(request("DELETE", "https://driver.example/api/driver/report-drafts?date=2026-10-27", undefined))).status, 200);
  const saved = reportDraftHandler({ data: draft });
  assert.equal((await saved.POST(request("POST", "https://driver.example/api/driver/report-drafts", draft))).status, 200);
  assert.equal(saved.calls[0].name, "driver_report_draft_save");
  assert.equal((await saved.DELETE(request("DELETE", `https://driver.example/api/driver/report-drafts?date=${fixture.serviceDate}`))).status, 200);
  assert.equal(saved.calls.at(-1).name, "driver_report_draft_delete");
  assert.equal((await reportDraftHandler({ error: { code: "40001" } }).POST(
    request("POST", "https://driver.example/api/driver/report-drafts", draft))).status, 409);
});
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
  assert.equal(reports.durationLabel(totals.elapsedMs), "3小時30分");
  assert.equal(reports.durationLabel(27 * 3600000), "27小時0分");
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

test("manual clock entry formats four digits as HH:mm", () => {
  assert.equal(reports.formatManualClock("0900"), "09:00");
  assert.equal(reports.formatManualClock("2359"), "23:59");
  assert.equal(reports.formatManualClock("09:00"), "09:00");
  assert.equal(reports.formatManualClock(""), "");
});
test("checkout commands require odometers and either a default depot or explicit location", () => {
  assert.equal(reports.reportCommandSchema.safeParse(checkout).success, true);
  assert.equal(reports.reportCommandSchema.safeParse({ ...checkout,
    payload: { useDefault: true, address: "", km: 0, departedAt: fixture.departedAt } }).success, true);
  assert.equal(reports.reportCommandSchema.safeParse({ ...checkout,
    payload: { useDefault: false, address: "x", km: 1 } }).success, false);
  assert.equal(reports.reportCommandSchema.safeParse({ ...checkout,
    payload: { ...checkout.payload, departedAt: "not-a-time" } }).success, false);
  assert.equal(reports.reportCommandSchema.safeParse({ ...checkout,
    payload: { ...checkout.payload, force: true } }).success, true);
  assert.equal(reports.reportCommandSchema.safeParse({ ...checkout,
    payload: { ...checkout.payload, force: "true" } }).success, false);
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
test("force-save migration bypasses only report sequence validation", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261120000000_driver_report_force_save.sql", import.meta.url), "utf8");
  assert.match(migration, /set_config\(''app\.driver_report_force''/);
  assert.match(migration, /not force_order and \(a<t or a>finish or n<k\)/);
  assert.match(migration, /not force_order and \(b<t or b>finish or n<k\)/);
  assert.match(migration, /return_shape_check/);
  assert.match(migration, /return_km between 0 and 9999999/);
  assert.match(migration, /Invalid force-save request/);
});
test("filled stop deletion migration removes only the empty-stop restriction", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261121000000_driver_report_delete_filled_stops.sql", import.meta.url), "utf8");
  assert.match(migration, /not force_order and n<k/);
  assert.match(migration, /not force_order and \(pending or r\.returned_at<t or r\.return_km<k\)/);
  assert.match(migration, /pending and not force_order and/);
  assert.match(migration, /when ''remove_stop'' then array\[''stopId''\]/);
  assert.match(migration, /Only empty stops can be removed/);
  assert.match(migration, /Could not allow removal of filled stops/);
});
test("returned reports can append and delete stops", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261122000000_driver_report_closed_stop_edits.sql", import.meta.url), "utf8");
  assert.match(migration, /target_action not in \(''edit_stop'',''edit_stops'',''add_stop'',''remove_stop''\)/);
  assert.match(migration, /elsif target_action=''add_stop'' then[\s\S]*app\.driver_report_force/);
  assert.match(migration, /elsif target_action=''remove_stop'' then[\s\S]*app\.driver_report_force/);
});
test("manual checkout migration stores a supplied departure time and preserves legacy RPC callers", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261119000000_driver_manual_checkout.sql", import.meta.url), "utf8");
  assert.match(migration, /''departedAt'',''header''/);
  assert.match(migration, /array_remove\(array_remove\(allowed,''header''\),''departedAt''\)/);
  assert.match(migration, /coalesce\(\(payload->>''departedAt''\)::timestamptz,stamp\)/);
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
test("stop removal accepts a strict ID regardless of saved fields", async () => {
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
  assert.match((await denied.json()).error, /无法削除该经由地/);
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
  assert.deepEqual(await response.json(), { reports: [fixture], depot: null, drafts: [] });
  assert.deepEqual(h.calls.map(call => call.name).sort(), ["driver_report_drafts", "driver_reports"]);
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
    const r = { ...fixture,
      header: { assignmentId: id, dutyStartDate: fixture.serviceDate, dutyEndDate: "2026-10-28",
        dutyStartTime: "22:00", dutyEndTime: "02:30", vehicleNumber: "Synthetic plate",
        driverName: "Synthetic driver", passengerCount: 3 },
      orderOptions: [{ assignmentId: id, label: "Synthetic order name", vehicleNumber: "Synthetic plate" }],
      stops: [{ id: closed ? id : id.replace(/1$/, "2"), address: "Synthetic long test stop address".repeat(4),
      arrivedAt: "2026-10-28T00:00:00+09:00", arrivedKm: 120,
      departedAt: closed ? "2026-10-28T00:15:00+09:00" : null, departedKm: closed ? 120 : null }],
      returnedAt: closed ? fixture.returnedAt : null,
      returnAddress: closed ? fixture.returnAddress : null, returnKm: closed ? fixture.returnKm : null };
    const values = [{ reports: [r], depot: null }, r.id, "", "", false, false, 0, Date.parse(fixture.returnedAt),
      false, false, fixture.serviceDate, null, "", "", null, [], false];
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
    assert.doesNotMatch(html, /<h1>|class="driver-notice"|日本時間/);
    for (const label of ["日期", "出勤点呼時間", "退勤点呼時間", "車両番号", "運転手", "客数"]) assert.ok(html.includes(`aria-label="${label}"`));
    const headerMarkup = html.match(/<form[^>]*aria-label="日報基本信息"[^>]*>([\s\S]*?)<\/form>/)[1];
    assert.deepEqual([...headerMarkup.matchAll(/aria-label="([^"]+)"/g)].map(match => match[1]),
      ["日期", "車両番号", "運転手", "客数", "出勤点呼時間", "退勤点呼時間"]);
    assert.doesNotMatch(html, /出勤点呼日期|退勤点呼日期|dutyStartDate|name="dutyEndDate"/);
    assert.ok(headerMarkup.indexOf('aria-label="客数"') < headerMarkup.indexOf('aria-label="出勤点呼時間"'));
    assert.ok(headerMarkup.indexOf('aria-label="出勤点呼時間"') < headerMarkup.indexOf('aria-label="退勤点呼時間"'));
    assert.ok(headerMarkup.indexOf('aria-label="退勤点呼時間"') < html.indexOf('<tbody aria-label="出库記録">'));
    assert.ok(html.indexOf('<tbody aria-label="出库記録">') < html.indexOf('<tbody aria-label="归库記録">'));
    assert.doesNotMatch(html, /<tbody aria-label="出勤点呼">|<tbody aria-label="退勤点呼">|<h2>日報<\/h2>/);
    assert.match(html, /<section class="driver-card driver-stops driver-report-card" aria-label="日報">/);
    assert.match(html, /<caption class="driver-report-caption">乗務記録<\/caption>/);
    assert.match(html, /<details[^>]*><summary>历史日報<\/summary>/);
    const historyOptions = html.match(/<summary>历史日報<\/summary>[\s\S]*?<select[^>]*>([\s\S]*?)<\/select>/)?.[1];
    assert.ok(historyOptions);
    assert.match(historyOptions, new RegExp(`<option value="${fixture.id}"(?: selected="")?>${fixture.serviceDate} · Synthetic order name</option>`));
    assert.doesNotMatch(historyOptions, /已归库|出库中|\d{2}:\d{2}/);
    assert.ok(html.indexOf('aria-label="日報基本信息"') < html.indexOf('<table'));
    assert.ok(html.indexOf('<summary>历史日報') > html.indexOf('</table>'));
    assert.ok(html.includes('class="driver-main driver-report"'));
    assert.match(html, /aria-label="日報修改和保存"/);
    assert.match(html, /class="driver-report-actions" role="group" aria-label="日報修改和保存"/);
    assert.match(html, /<button[^>]*aria-pressed="true"[^>]*disabled=""[^>]*>修改中<\/button>/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>保存<\/button>/);
    assert.doesNotMatch(html, />强制保存<\/button>/);
    const reportSummary = html.match(/<section class="driver-card"><h2>本次汇総<\/h2>([\s\S]*?)<\/section>/)?.[1];
    assert.ok(reportSummary);
    assert.deepEqual([...reportSummary.matchAll(/<span>([^<]+)/g)].map(match => match[1].replace("（进行中）", "")),
      ["当日公里数", "休憩時間", "拘束時間"]);
    assert.doesNotMatch(html, /出库至归库総時长|行驶公里数/);
    assert.doesNotMatch(html, /开始休息|结束休息|休息記録|停車或等候不会自動计为休息/);
    assert.doesNotMatch(html, /休息自動按各经由地到着至出発的時长累计/);
    assert.doesNotMatch(html, /归库打卡/);
    assert.equal(html.includes("42.5 km"), closed);
    assert.doesNotMatch(html, /保存开始地点后，可在表格内继续添加经由地|不采集定位/);
    assert.ok(html.includes('class="driver-stop-table driver-sheet"'));
    assert.equal((html.match(/<table\b/g) ?? []).length, 1);
    assert.equal((html.match(/<thead>/g) ?? []).length, 1);
    const routeSection = html.match(/<section[^>]*aria-label="日報"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    assert.ok(routeSection);
    assert.doesNotMatch(routeSection, /保存修改/);
    assert.doesNotMatch(routeSection, /开始新一次出库/);
    assert.match(html, /class="driver-toolbar">[\s\S]*刷新日報<\/button>[\s\S]*＋ 新建日报<\/button>/);
    if (closed) {
      assert.match(html, /刷新日報<\/button><button class="driver-link"[^>]*aria-label="新建日报"[^>]*>＋ 新建日报<\/button>/);
      assert.doesNotMatch(html, /新建日报（请先完成当前出库中的日报）/);
    } else {
      assert.match(html, /刷新日報<\/button><button class="driver-link" disabled="" title="请先完成当前出库中的日报" aria-label="新建日报（请先完成当前出库中的日报）">＋ 新建日报<\/button>/);
    }
    assert.match(routeSection, /aria-label="追加空白经由地">/);
    assert.match(routeSection, /aria-label="削除经由地 1"[^>]*>×<\/button>/);
    assert.doesNotMatch(routeSection, /disabled=""/);
    assert.doesNotMatch(routeSection, /日報默认处于修改状态|早于上一项自動顺延/);
    assert.ok(routeSection.includes('aria-label="出库記録"'));
    assert.ok(routeSection.includes("Synthetic depot"));
    assert.ok(routeSection.includes('aria-label="经由地 1"'));
    assert.ok(routeSection.indexOf('aria-label="出库記録"') < routeSection.indexOf('aria-label="经由地 1"'));
    assert.equal(routeSection.includes('aria-label="归库記録"'), true);
    assert.equal(routeSection.includes('id="report-edit-return"'), true);
    assert.ok(routeSection.indexOf('aria-label="出库記録"') < routeSection.indexOf('aria-label="经由地 1"'));
    assert.ok(routeSection.indexOf('aria-label="经由地 1"') < routeSection.indexOf('aria-label="归库記録"'));
    assert.equal(routeSection.includes('id="report-checkout"'), false);
    const departureHtml = html.match(/<tbody aria-label="出库記録">([\s\S]*?)<\/tbody>/)[1];
    assert.equal((departureHtml.match(/<tr\b/g) ?? []).length, 1);
    assert.match(departureHtml, /data-departure/);
    assert.match(departureHtml, /scope="row" class="driver-location-label"><span>開始<br\/>地点<\/span><\/th>/);
    assert.match(departureHtml, /aria-label="開始地点地址"/);
    assert.match(departureHtml, /aria-label="出库公里表"/);
    assert.match(departureHtml, /aria-label="出库時間"/);
    assert.match(departureHtml, /data-manual-time[^>]*value="23:00"/);
    for (const label of ["归库"]) {
      const locationHtml = html.match(new RegExp(`<tbody aria-label="${label}記録">([\\s\\S]*?)</tbody>`))[1];
      assert.equal((locationHtml.match(/<tr\b/g) ?? []).length, 1);
      assert.equal((locationHtml.match(/<td\b/g) ?? []).length, 4);
      assert.match(locationHtml, /scope="row" class="driver-location-label"><span>終了<br\/>地点<\/span><\/th>/);
      assert.match(locationHtml, /aria-label="終了地点地址"/);
      assert.match(locationHtml, /aria-label="归库時間" type="text" inputMode="numeric"/);
      assert.match(locationHtml, /data-return/);
      if (!r.returnAddress) assert.match(locationHtml, /aria-label="終了地点地址"[^>]*value="車庫"/);
      assert.doesNotMatch(locationHtml, /scope="row">時間|>\d{4}-\d{2}-\d{2}/);
    }
    assert.match(html, /scope="col">地址<\/th><th scope="col">公里数<\/th><th scope="col">到着<\/th><th scope="col">出発/);
    assert.match(html, /class="driver-sheet-location"><th scope="row">经由1<\/th><td><div class="driver-stop-address"><form[^>]*>[\s\S]*?name="address"[\s\S]*?<\/form>[\s\S]*?<\/div><\/td><td class="driver-stop-km">/);
    assert.match(html, /<input(?=[^>]*name="arrivedAt")(?=[^>]*data-manual-time)(?=[^>]*inputMode="numeric")[^>]*>/);
    assert.match(html, /<input(?=[^>]*name="departedAt")(?=[^>]*data-manual-time)(?=[^>]*inputMode="numeric")[^>]*>/);
    const stopHtml = html.match(/<tbody aria-label="经由地 1">([\s\S]*?)<\/tbody>/)[1];
    assert.match(stopHtml, /aria-label="削除经由地 1"[^>]*>×<\/button>/);
    assert.equal((stopHtml.match(/type="number"/g) ?? []).length, 1);
    assert.match(stopHtml, /<input(?=[^>]*name="km")(?=[^>]*type="number")(?=[^>]*value="120")[^>]*>/);
    assert.doesNotMatch(stopHtml, /name="arrivedKm"|name="departedKm"|到着 km|出発 km/);
    assert.ok(html.includes('value="00:00"'));
    const locationRows = html.slice(html.indexOf('<tbody aria-label="出库記録">'), html.indexOf('</table>'));
    assert.doesNotMatch(locationRows, /type="(?:date|datetime-local)"/);
    assert.doesNotMatch(html.replace(/<[^>]*>/g, ""), /(?:\s|T)\d{2}:\d{2}:\d{2}/);
    assert.doesNotMatch(html, /時間打卡|本次記録：/);
    assert.doesNotMatch(html, /一键到达打卡|一键出発打卡/);
    assert.doesNotMatch(html, /保存修改/);
    assert.equal((html.match(/>保存<\/button>/g) ?? []).length, 1);
    assert.equal(html.includes('value="clock"'), false);
    assert.doesNotMatch(html, /填写原因|留痕|保留記録|name="reason"/);
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

for (const mode of ["edit_stops", "force_edit_stops", "manual_return", "change_date", "add_stop", "remove_stop"]) for (const success of [true, false])
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
    version: 2, stops: action === "remove_stop" ? stops.filter((_, i) => i !== 0) : action === "add_stop" ? [...stops, blank] :
    dated.stops.map(s => ({ ...s, address: `${s.address} updated` })) };
  const states = [{ reports: [before], depot: null }, null, "", "", false, false, 0, Date.now(), false, true,
    fixture.serviceDate, null, "", "", null, [], false];
  let cursor = 0; let refCursor = 0; let toolbar; let bottomSave; let calls = 0;
  const stopRows = new Map();
  const forms = stops.map((s, i) => ({ reportValidity: () => mode !== "force_edit_stops", checkValidity: () => true, fields: {
    address: i === 3 ? "Unsaved last row" : s.address ? `${s.address} updated` : "",
    km: mode === "force_edit_stops" && i === 0 ? "-1" : s.arrivedKm === null ? "" : String(s.arrivedKm),
    arrivedAt: mode === "force_edit_stops" && i === 0 ? "bad" : reports.toJapanInput(s.arrivedAt).slice(11, 16),
    departedAt: mode === "force_edit_stops" && i === 0 ? "" : reports.toJapanInput(s.departedAt).slice(11, 16),
  } }));
  const departureForm = { reportValidity: () => mode !== "force_edit_stops", fields: {
    address: mode === "force_edit_stops" ? "" : "Updated depot",
    km: mode === "force_edit_stops" ? "-1" : "99",
    departedAt: mode === "force_edit_stops" ? "bad" : "22:30",
  } };
  const headerElement = { reportValidity: () => mode !== "force_edit_stops", fields: {
    ...header, passengerCount: "3",
  } };
  headerElement.querySelectorAll = () => Object.entries(headerElement.fields)
    .map(([name, value]) => ({ name, value: String(value ?? ""), form: { id: "report-header" } }));
  const table = { querySelector: selector => selector === "form[data-departure]" ? departureForm :
    selector === "form[data-return]" ? { reportValidity: () => true, fields: mode === "manual_return" ?
      { address: "Return depot", km: "150", returnedAt: "02:30" } : {} } :
    forms[stops.findIndex(s => selector.includes(s.id))],
    querySelectorAll: () => forms.flatMap((form, i) => Object.entries(form.fields)
      .map(([name, value]) => ({ name, value, form: { id: `report-stop-${stops[i].id}` } }))) };
  const capture = create => (type, props, ...rest) => {
    if (typeof type === "function" && type.name === "AddStopForm") toolbar = props;
    if (typeof type === "function" && type.name === "StopRow") stopRows.set(props.stop.id, props);
    if (type === "button" && props.children === "保存") bottomSave = props;
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
    window: { confirm: () => true },
    fetch: async (url, options) => {
      if (url === "/api/driver/report-drafts")
        return Response.json({ draft: JSON.parse(options.body) });
      calls++;
      assert.equal(url, "/api/driver/reports");
      const body = JSON.parse(options.body);
      assert.equal(body.action, action);
      if (action === "edit_stops") {
        assert.equal(body.payload.stops.length, 2);
        assert.deepEqual(body.payload.header, header);
        assert.equal(body.payload.force, true);
        assert.deepEqual(body.payload.departure, mode === "force_edit_stops"
          ? { address: fixture.departureAddress, km: fixture.departureKm, departedAt: fixture.departedAt }
          : { address: "Updated depot", km: 99,
            departedAt: mode === "change_date" ? "2026-10-25T13:30:00.000Z" : "2026-10-27T13:30:00.000Z" });
        if (mode === "force_edit_stops") {
          assert.equal(body.payload.stops[0].address, "Stop 0 updated");
          assert.equal(body.payload.stops[0].arrivedAt, stops[0].arrivedAt);
          assert.equal(body.payload.stops[0].arrivedKm, stops[0].arrivedKm);
        }
        if (mode === "change_date") {
          assert.equal(reports.toJapanInput(body.payload.stops[0].arrivedAt).slice(0, 10), "2026-10-25");
          assert.equal(reports.toJapanInput(body.payload.stops[1].departedAt).slice(0, 10), "2026-10-26");
        }
        if (mode === "manual_return") {
          assert.equal(body.payload.return.address, "Return depot");
          assert.equal(body.payload.return.km, 150);
          assert.equal(Date.parse(body.payload.return.returnedAt), Date.parse(fixture.returnedAt));
        } else assert.equal(Object.hasOwn(body.payload, "return"), false);
      } else if (action === "remove_stop") assert.deepEqual(body.payload, { stopId: stops[0].id });
      else assert.deepEqual(body.payload, { address: "", arrivedAt: null, departedAt: null });
      assert.equal(body.expectedVersion, 1);
      return success ? Response.json({ report: updated }) : Response.json({ error: "Version conflict: refresh to verify." }, { status: 409 });
    },
  }).default;
  renderToStaticMarkup(React.createElement(Component));
  assert.equal(toolbar.disabled, false);
  if (action === "edit_stops") await bottomSave.onClick();
  else if (action === "remove_stop") {
    assert.equal(stopRows.get(stops[0].id).stop.address, "Stop 0");
    await stopRows.get(stops[0].id).removeStop(stops[0].id);
  }
  else await toolbar.save("add_stop", { address: "", arrivedAt: null, departedAt: null });
  assert.equal(calls, 1);
  assert.equal(states[0].reports[0].version, success ? 2 : 1);
  if (mode === "change_date") assert.equal(states[0].reports[0].serviceDate, success ? header.serviceDate : fixture.serviceDate);
  if (mode === "manual_return") assert.equal(states[0].reports[0].returnedAt, success ? fixture.returnedAt : null);
  assert.equal(states[0].reports[0].stops[1].address, success && action === "edit_stops" ? "Stop 1 updated" :
    success && action === "remove_stop" ? "" : "Stop 1");
  if (action === "add_stop") {
    assert.equal(states[0].reports[0].stops.length, success ? 3 : 2);
    assert.equal(forms[1].fields.address, "Stop 1 updated");
  }
  if (action === "remove_stop") {
    assert.equal(states[0].reports[0].stops.length, success ? 3 : 4);
    assert.equal(forms[3].fields.address, "Unsaved last row");
    if (!success) assert.match(states[2], /Version conflict/);
  }
  assert.equal(states[4], false);
  assert.equal(states[6], 0);
  assert.equal(states[9], !success || ["add_stop", "remove_stop"].includes(action));
  assert.equal(states[3], success ? action === "edit_stops" ?
    "已强制保存；无效或缺失字段沿用已保存内容，可之后修改。" : action === "add_stop" ?
      "空白经由地已添加，填写完成后請点悬浮“保存”按钮。" : action === "remove_stop" ?
        "经由地已削除，其他未保存的修改仍保留。" : "已保存。" : "");
  if (!success) {
    assert.match(states[2], /Version conflict/);
    assert.equal(forms[1].fields.address, "Stop 1 updated");
  }
});

test("first and subsequent checkout use a fresh spreadsheet without mixing history", () => {
  for (const history of [false, true]) {
  let cursor = 0;
  const values = [{ reports: history ? [fixture] : [], depot: { name: "Synthetic office", address: "Synthetic default" } },
    null, "", "", false, false, 0, Date.now(), history, true, fixture.serviceDate,
    { serviceDate: fixture.serviceDate, driverName: "Linked driver", orders: [{ assignmentId: id, time: "09:00",
      pickup: "Airport", destination: "Hotel", vehicleNumber: "Linked plate", depot: { name: "Vehicle owner", address: "Owner garage" } }] }, id, "", null, [], false];
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React, useEffect() {}, useRef: v => ({ current: v }), useState: () => [values[cursor++], () => {}] },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
  }).default;
  const html = renderToStaticMarkup(React.createElement(Component));
  assert.match(html, /aria-label="日報"[\s\S]*<table[\s\S]*id="report-checkout"/);
  assert.equal((html.match(/<table\b/g) ?? []).length, 1);
  assert.match(html, /form="report-checkout"[^>]*name="km"|name="km"[^>]*form="report-checkout"/);
  assert.doesNotMatch(html, /Vehicle owner|Owner garage/);
  assert.match(html, /aria-label="開始地点地址"[^>]*value="車庫"/);
  assert.ok(html.includes('value="Linked driver"'));
  assert.ok(html.includes('value="Linked plate"'));
  assert.doesNotMatch(html, /Synthetic office|Synthetic default|type="checkbox"/);
  assert.match(html, /class="driver-report-actions" role="group" aria-label="日報保存"[\s\S]*>保存<\/button>/);
  assert.doesNotMatch(html, /强制保存|name="force"/);
  const checkoutHtml = html.match(/<tbody aria-label="開始地点">[\s\S]*?<\/tbody>/)?.[0];
  assert.ok(checkoutHtml);
  assert.doesNotMatch(checkoutHtml, /<button/);
  assert.doesNotMatch(html, /保存开始地点后，可在表格内继续添加经由地。|日本時間/);
  assert.match(html, /aria-label="開始地点"[\s\S]*aria-label="開始地点地址"[\s\S]*aria-label="開始地点公里数"[\s\S]*aria-label="開始地点出発時間"/);
  assert.match(html, /<input(?=[^>]*name="departedAt")(?=[^>]*data-manual-time)[^>]*>/);
  assert.doesNotMatch(html, /出库打卡|打卡|出库記録|新经由地地址/);
  if (history) assert.ok(html.includes("新日報 · 待出库"));
  if (!history && process.env.DRIVER_REPORT_DEFAULTS_LAYOUT_FILE) {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace('@import "tailwindcss";', "");
    const reportCss = readFileSync(new URL("../app/driver/report/report.module.css", import.meta.url), "utf8")
      .replace(/\.report\b/g, ".driver-report");
    writeFileSync(process.env.DRIVER_REPORT_DEFAULTS_LAYOUT_FILE,
      `<!doctype html><html lang="zh"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n${reportCss}</style><body>${html}</body></html>`);
  }
  }
});

test("append stop stays inside the table and each open stop has its own delete control", () => {
  for (const count of [0, 1, 3]) {
    let cursor = 0;
    const stops = Array.from({ length: count }, (_, i) => ({ id: id.replace(/1$/, String(i + 2)),
      address: `Synthetic stop ${i}`, arrivedAt: fixture.departedAt, arrivedKm: 100,
      departedAt: fixture.returnedAt, departedKm: 100 }));
    const values = [{ reports: [{ ...fixture, returnedAt: null, stops }], depot: null },
      null, "", "", false, false, 0, Date.now(), false, false, fixture.serviceDate, null, "", "", null, [], false];
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
    assert.match(html, /<\/tbody><tbody aria-label="添加经由地">/);
    assert.doesNotMatch(html, /保存修改/);
    assert.equal((html.match(/<table\b/g) ?? []).length, 1);
    if (count) {
      const groups = [...html.matchAll(/<tbody aria-label="经由地 \d+">([\s\S]*?)<\/tbody>/g)];
      assert.equal(groups.length, count);
      for (const group of groups.slice(0, -1)) assert.doesNotMatch(group[1], /class="driver-stop-add"/);
      for (const group of groups) {
        assert.equal((group[1].match(/<tr\b/g) ?? []).length, 1);
        assert.equal((group[1].match(/<td\b/g) ?? []).length, 4);
        assert.match(group[1], /name="address"[\s\S]*name="km"[\s\S]*name="arrivedAt"[\s\S]*name="departedAt"/);
        assert.match(group[1], /aria-label="削除经由地 \d+"/);
      }
      assert.ok(html.indexOf('class="driver-stop-add"') > html.indexOf(groups.at(-1)[0]));
    }
  }
});

test("filled stop can be deleted after explicit confirmation", async () => {
  const runtime = require("react/jsx-runtime");
  let StopRow;
  const captures = create => (type, props, ...rest) => {
    if (typeof type === "function" && type.name === "StopRow") StopRow = type;
    return create(type, props, ...rest);
  };
  const filled = { id, address: "Saved stop", arrivedAt: fixture.departedAt, arrivedKm: 100,
    departedAt: fixture.returnedAt, departedKm: 110 };
  const values = [{ reports: [{ ...fixture, returnedAt: null, stops: [filled] }], depot: null },
    null, "", "", false, false, 0, Date.now(), false, false, fixture.serviceDate, null, "", "", null, [], false];
  let cursor = 0;
  const Component = load("app/driver/report/report.tsx", {
    react: { ...React, useEffect() {}, useRef: value => ({ current: value }), useState: () => [values[cursor++], () => {}] },
    "react/jsx-runtime": { ...runtime, jsx: captures(runtime.jsx), jsxs: captures(runtime.jsxs) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/supabase/browser": {}, "@/lib/driver/orders": {}, "@/lib/driver/reports": reports,
  }, { window: { confirm: message => { assert.match(message, /已填写内容也会削除/); return true; } } }).default;
  renderToStaticMarkup(React.createElement(Component));
  const deleted = [];
  const row = StopRow({ stop: filled, index: 0, disabled: false, saveChanges: async () => {},
    removeStop: async stopId => deleted.push(stopId), allowDelete: true });
  function find(node, predicate) {
    if (!React.isValidElement(node)) return null;
    if (predicate(node)) return node;
    return React.Children.toArray(node.props.children).map(child => find(child, predicate)).find(Boolean);
  }
  const button = find(row, node => node.type === "button" && node.props["aria-label"] === "削除经由地 1");
  assert.equal(button.props.disabled, false);
  await button.props.onClick();
  assert.deepEqual(deleted, [id]);
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
    null, "", "", false, false, 0, Date.parse(fixture.returnedAt), false, false, fixture.serviceDate, null, "", "", null, [], false];
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
      catch { errors.push("日期時間无效"); }
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
  assert.match(errors.at(-1), /日期時間无效/);
  fields.departedAt = "01:02";
  await submit();
  assert.equal(calls[1].payload.departedAt, "2026-10-27T16:02:00.000Z");
  assert.equal(calls[1].payload.arrivedKm, 120);
  assert.equal(calls[1].payload.departedKm, 120);
  rows = stopComponent({ ...stopProps, stop: { ...stop, arrivedAt: null, arrivedKm: null }, save });
  const arrivalHtml = renderToStaticMarkup(rows);
  assert.doesNotMatch(arrivalHtml, /時間打卡|本次記録：/);
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

test("append button immediately saves an empty row without a second confirmation", async () => {
  const runtime = require("react/jsx-runtime");
  let Add;
  let cursor = 0;
  const values = [{ reports: [{ ...fixture, returnedAt: null }], depot: null },
    null, "", "", false, false, 0, Date.now(), false, false, fixture.serviceDate, null, "", "", null, [], false];
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
  function render(_error, disabled = false) { return Add({ disabled, save }); }
  function find(node, predicate) {
    if (!React.isValidElement(node)) return null;
    if (predicate(node)) return node;
    return React.Children.toArray(node.props.children).map(child => find(child, predicate)).find(Boolean);
  }
  const element = render();
  const button = find(element, node => node.type === "button" && node.props["aria-label"] === "追加空白经由地");
  assert.equal(button.props.children, "＋");
  const locked = render(undefined, true);
  assert.equal(find(locked, node => node.type === "button" && node.props["aria-label"] === "追加空白经由地").props.disabled, true);
  await button.props.onClick();
  assert.equal(calls.length, 1);
  accepted = true;
  await button.props.onClick();
  await button.props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), Array(3).fill({ action: "add_stop",
    payload: { address: "", arrivedAt: null, departedAt: null } }));
  const html = renderToStaticMarkup(render());
  assert.doesNotMatch(html, /<form|<input|确认添加|确认追加|取消追加|削除最后一条空白经由地/);
  assert.doesNotMatch(html, /保存修改/);
  assert.doesNotMatch(renderToStaticMarkup(render("Synthetic API failure")), /Synthetic API failure/);
});
