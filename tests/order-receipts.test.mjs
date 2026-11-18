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
  vm.runInNewContext(output, {
    module: compiled, exports: compiled.exports, require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    Request, Response, Headers, URL, AbortController, setTimeout, clearTimeout,
    console: { error() {} }, ...globals,
  });
  return compiled.exports;
}
const schemas = load("lib/driver/order-receipts.ts");
const receiptPrint = load("lib/order-receipt-print.ts", { "@/lib/driver/order-receipts": schemas });
const printMock = { "@/lib/order-receipt-print": receiptPrint, "@/lib/print-a4": { printA4Html: async () => {} } };
const { jsonResponse } = load("lib/api-response.ts");
const id = "f4900250-0000-4000-8000-000000000001";
const rows = [
  { bucket: "driver-finance-receipts", path: "company.jpg", category: "company", detail: "Parking" },
  { bucket: "driver-finance-receipts", path: "trip.jpg", category: "trip", detail: "Toll" },
  { bucket: "driver-fuel-receipts", path: "fuel.jpg", category: "fuel", detail: "Fuel" },
];
const data = { enabled: true, receipts: rows.map(row => ({ ...row, url: `https://receipts.example/${row.path}` })) };
function handler({ enabled = true, profile = { role: "user" }, result = rows, error = null, signing = "ok",
  advances = [], switchResult = { switched: true }, origin = true } = {}) {
  const calls = []; const signs = [];
  const api = load("app/api/order-receipts/route.ts", {
    "@/lib/api-response": { jsonResponse }, "@/lib/driver/order-receipts": schemas,
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => enabled, isDriverPwaTestMode: () => false },
    "@/lib/driver/assignment-action": { isDriverActionOrigin: () => origin },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ profile, supabase: {
      rpc: async (name, args) => { calls.push({ name, args }); return {
        data: name === "staff_order_advances" ? advances : name === "staff_delete_advance_item" ? { deleted: true } :
          name === "staff_switch_advance_item" ? switchResult : result, error }; },
      storage: { from: bucket => ({ createSignedUrls: async (paths, expiry) => {
        signs.push({ bucket, paths, expiry });
        return { error: signing === "failed" ? new Error("failed") : null,
          data: paths.map(path => ({ path, signedUrl: `https://receipts.example/${path}`, error: signing === "partial" ? "missing" : null })) };
      } }) },
    } }) },
  }, { process: { env: { NODE_ENV: "production" } } });
  return { ...api, calls, signs };
}
function request(query = `orderId=${id}&date=2026-10-27`) { return new Request(`https://staff.example/api/order-receipts?${query}`); }

test("staff switch API guards access, origin and strict versioned inputs and never hides conflicts", async () => {
  const body = { orderId: id, date: "2026-10-27", claimId: id, expectedVersion: 2, category: "trip" };
  const post = (value = body, headers = { "Content-Type": "application/json" }) =>
    new Request("https://staff.example/api/order-receipts", { method: "POST", headers, body: JSON.stringify(value) });
  assert.equal((await handler({ enabled: false }).POST(post())).status, 404);
  assert.equal((await handler({ profile: null }).POST(post())).status, 403);
  assert.equal((await handler({ origin: false }).POST(post())).status, 403);
  assert.equal((await handler().POST(post(body, {}))).status, 415);
  for (const value of [{ ...body, expectedVersion: 0 }, { ...body, category: "fuel" }, { ...body, driverId: id }])
    assert.equal((await handler().POST(post(value))).status, 400);
  const h = handler();
  assert.deepEqual(await (await h.POST(post())).json(), { switched: true });
  assert.equal(h.calls[0].name, "staff_switch_advance_item");
  assert.equal(h.calls[0].args.expected_version, 2);
  assert.equal(h.calls[0].args.target_category, "trip");
  assert.equal(h.calls[0].args.target_expense, null);
  const single = handler();
  assert.equal((await single.POST(post({ ...body, expenseId: id }))).status, 200);
  assert.equal(single.calls[0].args.target_expense, id);
  const deletion = handler();
  assert.equal((await deletion.POST(post({ orderId: id, date: body.date, claimId: id, expenseId: id,
    expectedVersion: 2, action: "delete" }))).status, 200);
  assert.equal(deletion.calls[0].name, "staff_delete_advance_item");
  assert.equal((await handler({ error: { code: "40001" } }).POST(post())).status, 409);
  assert.equal((await handler({ error: { code: "42501" } }).POST(post())).status, 403);
  assert.equal((await handler({ switchResult: null }).POST(post())).status, 503);
});

test("order receipt API gates test mode and staff, validates exact order/date and signs only RPC results", async () => {
  const off = handler({ enabled: false });
  assert.deepEqual(await (await off.GET(request())).json(), { enabled: false, receipts: [] });
  assert.equal(off.calls.length, 0);
  const denied = handler({ profile: null });
  assert.equal((await denied.GET(request())).status, 403);
  assert.equal(denied.calls.length, 0);
  for (const query of ["", "orderId=no&date=2026-10-27", `orderId=${id}&date=2026-02-30`,
    `orderId=${id}&date=2026-10-27&date=2026-10-28`, `orderId=${id}&date=2026-10-27&driverId=x`,
    `orderId=${id}&date=2026-10-27&path=other.jpg`]) {
    const h = handler();
    assert.equal((await h.GET(request(query))).status, 400);
    assert.equal(h.calls.length, 0);
  }
  const h = handler();
  const response = await h.GET(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), { ...data, advances: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    { name: "staff_order_receipts", args: { target_order: id, target_date: "2026-10-27" } },
    { name: "staff_order_advances", args: { target_order: id, target_date: "2026-10-27" } },
  ]);
  assert.equal(h.signs.length, 2);
  assert.ok(h.signs.every(sign => sign.expiry === 300));
  const empty = handler({ result: [] });
  assert.deepEqual(await (await empty.GET(request())).json(), { enabled: true, receipts: [], advances: [] });
  assert.equal(empty.signs.length, 0);
});

test("receipt API never disguises access, malformed rows or partial signing failures as no receipts", async () => {
  for (const [options, status] of [
    [{ error: { code: "42501" } }, 403], [{ error: { code: "XX000" } }, 503],
    [{ result: null }, 503], [{ result: [{ ...rows[0], price: 99 }] }, 503],
    [{ result: [{ ...rows[0], bucket: "public" }] }, 503],
    [{ signing: "failed" }, 503], [{ signing: "partial" }, 503],
  ]) assert.equal((await handler(options).GET(request())).status, status);
});

const css = readFileSync(new URL("../components/order-receipts.module.css", import.meta.url), "utf8");
const styleMock = { default: Object.fromEntries([...css.matchAll(/\.([a-zA-Z]+)/g)].map(match => [match[1], match[1]])) };
test("receipt preview stays fixed in the current viewport rather than the bottom of a long finance editor", () => {
  const dialogStyle = css.match(/\.dialog\s*\{([^}]+)\}/)?.[1];
  assert.ok(dialogStyle);
  assert.match(dialogStyle, /position:\s*fixed/);
  assert.match(dialogStyle, /inset:\s*0/);
  assert.match(dialogStyle, /margin:\s*auto/);
  assert.match(dialogStyle, /max-height:\s*94dvh/);
});
test("gallery renders compact categorized thumbnails and opens a large native modal without form submits", () => {
  const states = [data, "", null, 0, [], false, ""];
  let cursor; let dialogProps; let thumbnail; let closeButton; const effects = [];
  const runtime = require("react/jsx-runtime");
  function capture(create) {
    return (type, props, ...rest) => {
      if (type === "dialog") dialogProps = props;
      if (type === "button" && props.className === "thumbnail") thumbnail = props;
      if (type === "button" && props.className === "close") closeButton = props;
      return create(type, props, ...rest);
    };
  }
  const Component = load("components/order-receipts.tsx", {
    ...printMock,
    react: { ...React, useEffect: effect => effects.push(effect), useRef: () => ({ current: null }),
      useState: initial => { const i = cursor++; return i < states.length ?
        [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }] : [initial, () => {}]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "./order-receipts.module.css": styleMock, "@/lib/driver/order-receipts": schemas, "@/lib/supabase/browser": {},
  }).OrderReceipts;
  function render() { cursor = 0; effects.length = 0; return renderToStaticMarkup(React.createElement(Component, { orderId: id, date: "2026-10-27" })); }
  let html = render();
  assert.match(html, /aria-label="立替小票"/);
  assert.match(html, /<span>立替小票<\/span>/);
  assert.doesNotMatch(html, /運転士小票（仅已批准）/);
  assert.equal((html.match(/class="thumbnail"/g) ?? []).length, 3);
  for (const label of ["社報立替", "旅報立替", "燃油費"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /待审核|已驳回|<dialog/);
  assert.equal((html.match(/type="button"/g) ?? []).length, 5);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 4);
  assert.match(html, /class="actions"><button[^>]*>小票刷新<\/button><button[^>]*disabled=""[^>]*>立替小票批量打印/);
  assert.ok(html.indexOf('class="actions"') > html.lastIndexOf('class="thumbnail"'));
  assert.ok(html.indexOf('class="photoArea"') < html.indexOf('class="groups"'));
  assert.doesNotMatch(html, /aria-label="打印燃油費/);
  thumbnail.onClick();
  assert.equal(states[2].category, "fuel");
  html = render();
  assert.match(html, /<dialog[^>]*aria-label="小票大图"/);
  assert.match(html, /class="large"/);
  let stopped = false;
  dialogProps.onCancel({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(states[2], null);
  states[2] = data.receipts[0];
  render(); closeButton.onClick();
  assert.equal(states[2], null);
  states[2] = data.receipts[0];
  render(); let prevented = false;
  stopped = false;
  dialogProps.onKeyDown({ key: "Escape", preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(states[2], null);
  states[2] = data.receipts[0];
  render(); dialogProps.onClick({ target: {}, currentTarget: {} });
  assert.notEqual(states[2], null);
  const target = {};
  dialogProps.onClick({ target, currentTarget: target });
  assert.equal(states[2], null);
  if (process.env.ORDER_RECEIPTS_LAYOUT_FILE) {
    const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="700"><rect width="300" height="700" fill="#fff"/><text x="30" y="80" font-size="24">TEST RECEIPT</text><text x="30" y="140">Parking 1,000 JPY</text></svg>')}`;
    states[0] = { enabled: true, receipts: data.receipts.map(item => ({ ...item, url: image })) };
    states[2] = states[0].receipts[0];
    writeFileSync(process.env.ORDER_RECEIPTS_LAYOUT_FILE,
      `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body>${render()}</body></html>`);
  }
  states[0] = { enabled: false, receipts: [] };
  assert.equal(render(), "");
});

test("receipt gallery is mounted for each exact order and service date including batch finance", () => {
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /<OrderReceipts key=\{`receipts-\$\{financeOrder\.id\}-\$\{date\}`\} orderId=\{financeOrder\.id\} date=\{date\}/);
  assert.equal((source.match(/<OrderReceipts /g) || []).length, 1);
  const note = source.indexOf("                                    外注運転士备注");
  const gallery = source.indexOf("<OrderReceipts ");
  assert.ok(note > source.indexOf('{section.title === "立替費用" && ('));
  assert.ok(gallery > note && gallery < source.indexOf('<legend className="px-1 text-sm font-semibold">運転士工資'));
  assert.match(source, /JSON\.stringify\(accountingForm\) !== JSON\.stringify\(accountingFormBaseline\)/);
  assert.match(source, /onSwitching=\{busy => \{\s*dialogSavingRef\.current = busy/);
  assert.match(source, /driverAdvanceCompanyReport: updated\.driverAdvanceCompanyReport/);
  assert.match(source, /driverAdvanceTripReport: updated\.driverAdvanceTripReport/);
  const textarea = source.slice(note, source.indexOf("/>", note));
  assert.match(textarea, /rows=\{2\}/);
  assert.match(textarea, /className="[^"]*\bh-12\b[^"]*"/);
  assert.doesNotMatch(textarea, /h-24|flex-1/);
});

test("gallery refreshes short-lived URLs and clears hidden or signed-out data without late restoration", async () => {
  const states = [null, "", null, 0, [], false, ""]; const effects = []; const events = {};
  let cursor = 0; let resolve; let onAuth; let interval; let aborted; let unsubscribed = false;
  const doc = { visibilityState: "visible", addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener() {} };
  const Component = load("components/order-receipts.tsx", {
    ...printMock,
    react: { ...React, useEffect: effect => effects.push(effect), useRef: () => ({ current: null }),
      useState: () => { const i = cursor++; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "./order-receipts.module.css": styleMock, "@/lib/driver/order-receipts": schemas,
    "@/lib/supabase/browser": { createClient: () => ({ auth: { onAuthStateChange: fn => {
      onAuth = fn; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } };
    } } }) },
  }, {
    document: doc, setTimeout: (fn, delay) => { interval = { fn, delay }; return 1; }, clearTimeout() {},
    fetch: async (_url, options) => { aborted = options.signal; return new Promise(done => { resolve = done; }); },
  }).OrderReceipts;
  renderToStaticMarkup(React.createElement(Component, { orderId: id, date: "2026-10-27" }));
  const cleanup = effects[0]();
  resolve(Response.json(data)); await new Promise(done => setImmediate(done));
  assert.equal(states[0].receipts.length, 3);
  assert.equal(interval.delay, 240000);
  states[4] = ["company.jpg"];
  interval.fn(); assert.equal(states[0], null);
  assert.equal(states[4].length, 0);
  doc.visibilityState = "hidden"; events.visibilitychange();
  assert.equal(aborted.aborted, true);
  resolve(Response.json(data)); await new Promise(done => setImmediate(done));
  assert.equal(states[0], null);
  doc.visibilityState = "visible"; events.visibilitychange();
  onAuth("SIGNED_OUT");
  resolve(Response.json(data)); await new Promise(done => setImmediate(done));
  assert.equal(states[0], null);
  assert.equal(states[2], null);
  cleanup(); assert.equal(unsubscribed, true);
});

test("advance collage excludes fuel, escapes content and lays out every receipt without cropping across A4 pages", () => {
  const receipts = Array.from({ length: 13 }, (_, index) => ({
    ...data.receipts[index % 2], path: `${index}.jpg`,
    detail: index === 0 ? '<script>"&' : `Receipt ${index}`,
    url: `https://receipts.example/${index}.jpg?a=1&b=2`,
  }));
  const html = receiptPrint.buildOrderReceiptPrintHtml([...receipts, data.receipts[2]], "2026-10-27");
  assert.equal((html.match(/<section class="page">/g) ?? []).length, 3);
  assert.equal((html.match(/<img /g) ?? []).length, 13);
  assert.doesNotMatch(html, /fuel.jpg|<script>/);
  assert.match(html, /&lt;script&gt;&quot;&amp;/);
  assert.match(html, /a=1&amp;b=2/);
  assert.match(html, /object-fit: contain/);
  assert.match(html, /size: A4 landscape/);
  assert.match(html, /\.sheet \{ width: 277mm/);
  assert.match(html, /\.page \{ height: 187mm/);
  assert.match(html, /\.collage \{[^}]*height: 165mm/);
  assert.match(html, /3 \/ 3/);
  assert.match(html, /grid-template-columns:repeat\(1,minmax\(0,1fr\)\)/);
  assert.throws(() => receiptPrint.buildOrderReceiptPrintHtml([data.receipts[2]], "2026-10-27"), /勾选/);
  if (process.env.ORDER_RECEIPTS_PRINT_FILE) {
    writeFileSync(process.env.ORDER_RECEIPTS_PRINT_FILE, receiptPrint.buildOrderReceiptPrintHtml(receipts.map((receipt, index) => ({
      ...receipt,
      url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${index % 2 ? 300 : 700}" height="${index % 2 ? 900 : 400}"><rect width="100%" height="100%" fill="#f3f4f6" stroke="#111"/><text x="20" y="60" font-size="26">TEST RECEIPT ${index + 1}</text><text x="20" y="110" font-size="22">Parking 1,000 JPY</text></svg>`)}`,
    })), "2026-10-27"));
  }
});

test("category and individual selection print only chosen advances, guard double clicks and expose print failures", async () => {
  const states = [data, "", null, 0, [], false, ""];
  const requestRef = { current: null };
  let cursor = 0; const controls = new Map(); const calls = [];
  let finish;
  const runtime = require("react/jsx-runtime");
  const capture = create => (type, props, ...rest) => {
    if (type === "input") controls.set(props["aria-label"], props);
    if (type === "button" && ["print", "refresh"].includes(props.className)) controls.set(props.className, props);
    return create(type, props, ...rest);
  };
  const Component = load("components/order-receipts.tsx", {
    ...printMock,
    "@/lib/print-a4": { printA4Html: (html, title, options) => {
      calls.push({ html, title, options }); return new Promise((resolve, reject) => { finish = { resolve, reject }; });
    } },
    react: { ...React, useEffect() {}, useRef: () => requestRef,
      useState: initial => { const i = cursor++; if (i >= states.length) states[i] = initial;
        return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "./order-receipts.module.css": styleMock, "@/lib/driver/order-receipts": schemas, "@/lib/supabase/browser": {},
  }).OrderReceipts;
  const render = () => { cursor = 0; controls.clear(); return renderToStaticMarkup(React.createElement(Component, { orderId: id, date: "2026-10-27" })); };
  render(); assert.equal(controls.get("print").disabled, true);
  controls.get("全选社報立替小票").onChange({ target: { checked: true } });
  render(); controls.get("全选旅報立替小票").onChange({ target: { checked: true } });
  render(); assert.match(controls.get("print").children, /2张/);
  controls.get("打印社報立替小票 1：Parking").onChange({ target: { checked: false } });
  render(); assert.equal(controls.get("全选社報立替小票").checked, false);
  const button = controls.get("print");
  button.onClick(); button.onClick();
  assert.equal(calls.length, 1);
  assert.match(calls[0].html, /trip.jpg/);
  assert.doesNotMatch(calls[0].html, /company.jpg|fuel.jpg/);
  finish.reject(new Error("Image failed")); await new Promise(done => setImmediate(done));
  assert.match(render(), /role="alert"[^>]*>立替小票打印失败/);
  controls.get("print").onClick();
  controls.get("refresh").onClick();
  assert.equal(calls[1].options.signal.aborted, true);
  finish.reject(new Error("Aborted")); await new Promise(done => setImmediate(done));
  assert.equal(states[4].length, 0);
  assert.equal(states[6], "");
});

test("desktop switch uses latest claim version, blocks unsaved edits and double clicks and distinguishes refresh failures", async () => {
  const advance = { claimId: id, category: "company", version: 7, amount: 1500, detail: "Parking",
    expenses: [{ id, type: "company", detail: "Parking", amount: 1500, receipts: [] }] };
  const states = [{ ...data, advances: [advance] }, "", null, 0, [], false, "", false, "", ""];
  const refs = []; let cursor = 0; let refCursor = 0; let button; let resolve;
  let writes = 0; let refreshed = 0; let payload; let deleteButton; let confirmed = false;
  const runtime = require("react/jsx-runtime");
  const capture = create => (type, props, ...rest) => {
    if (type === "button" && props.children === "旅报") button = props;
    if (type === "button" && props.children === "削除") deleteButton = props;
    return create(type, props, ...rest);
  };
  const Component = load("components/order-receipts.tsx", {
    ...printMock,
    react: { ...React, useEffect() {},
      useRef: initial => { const i = refCursor++; return refs[i] ??= { current: initial }; },
      useState: initial => { const i = cursor++; if (i >= states.length) states[i] = initial;
        return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "./order-receipts.module.css": styleMock, "@/lib/driver/order-receipts": schemas, "@/lib/supabase/browser": {},
  }, { window: { confirm: () => confirmed }, fetch: (_url, options) => { writes++; payload = JSON.parse(options.body);
    return new Promise(done => { resolve = done; }); } }).OrderReceipts;
  const render = (blocked = false, fail = false) => {
    cursor = 0; refCursor = 0;
    return renderToStaticMarkup(React.createElement(Component, {
      orderId: id, date: "2026-10-27", blocked,
      onChanged: async () => { refreshed++; if (fail) throw new Error("Refresh failed"); },
    }));
  };
  render(true); assert.equal(button.disabled, true); button.onClick(); assert.equal(writes, 0);
  const layout = render();
  const left = layout.indexOf('aria-label="社報立替明细列表"');
  const right = layout.indexOf('aria-label="旅報立替明细列表"');
  assert.ok(left >= 0 && right > left);
  const row = layout.slice(left, right);
  assert.match(row, /class="advanceHeading"><span>社報立替<\/span><span class="advanceAmount">¥1,500<\/span>/);
  assert.match(layout.slice(right), /class="advanceHeading"><span>旅報立替<\/span><span class="advanceAmount">¥0<\/span>/);
  const detailRow = row.slice(row.indexOf('class="advanceRow"'));
  assert.ok(detailRow.indexOf('class="advanceDetail">Parking') < detailRow.indexOf('class="advanceAmount">¥1,500'));
  assert.ok(detailRow.indexOf('class="advanceAmount">¥1,500') < detailRow.indexOf("切换为旅報立替"));
  assert.match(layout.slice(right), /暂无明细/);
  assert.match(css, /\.advanceColumns \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  if (process.env.ORDER_ADVANCE_COLUMNS_FILE)
    writeFileSync(process.env.ORDER_ADVANCE_COLUMNS_FILE,
      `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><body>${layout}</body></html>`);
  const first = button; first.onClick(); first.onClick();
  assert.equal(writes, 1);
  assert.deepEqual(payload, { orderId: id, date: "2026-10-27", claimId: id, expenseId: id, expectedVersion: 7, category: "trip" });
  resolve(Response.json({ switched: true })); await new Promise(done => setImmediate(done));
  assert.equal(refreshed, 1);
  assert.match(render(), /订单财务已同步/);
  states[0] = { ...data, advances: [advance] };
  render(false, true); button.onClick();
  resolve(Response.json({ switched: true })); await new Promise(done => setImmediate(done));
  assert.match(render(), /类别已切换，但订单汇总刷新失败/);
  assert.equal(writes, 2);
  states[0] = { ...data, advances: [advance] };
  render(); deleteButton.onClick(); assert.equal(writes, 2);
  confirmed = true; deleteButton.onClick(); assert.equal(writes, 3);
  assert.equal(payload.action, "delete"); assert.equal(payload.expenseId, id);
  assert.equal(payload.category, undefined);
  resolve(Response.json({ deleted: true })); await new Promise(done => setImmediate(done));
  assert.match(render(), /已削除明细及票据关联/);
});

test("desktop form refresh applies switched fields without losing other finances and refuses late draft overwrites", async () => {
  const filename = fileURLToPath(new URL("../app/page.tsx", import.meta.url));
  const source = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "OrderReceipts") {
      callback = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(source) === "onChanged")
        ?.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(callback);
  const output = ts.transpileModule(`module.exports = ${callback.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const form = { day: { driverAdvanceCompanyReport: 1600, driverAdvanceTripReport: 200, fuelCost: 6000, fixedWage: 5000 } };
  const current = { current: form }; const failed = { current: false }; let applied; let baseline; let mutate = false;
  const compiled = { exports: {} };
  vm.runInNewContext(output, {
    module: compiled, accountingForm: form, accountingFormCurrent: current, accountingAdvanceSyncFailed: failed,
    financeOrder: { id }, date: "2026-10-27", financeKey: "day",
    refreshApprovedOrderFinance: async (_signal, deliver) => {
      if (mutate) current.current = { ...form, day: { ...form.day, fuelCost: 7000 } };
      deliver([{ id, financeByDate: { "2026-10-27": { driverAdvanceCompanyReport: 100, driverAdvanceTripReport: 1700 } } }]);
    },
    setAccountingForm: next => { applied = next; },
    setAccountingFormBaseline: next => { baseline = next; },
  });
  await compiled.exports(new AbortController().signal);
  assert.equal(applied.day.driverAdvanceCompanyReport, 100);
  assert.equal(applied.day.driverAdvanceTripReport, 1700);
  assert.equal(applied.day.fuelCost, 6000);
  assert.equal(applied.day.fixedWage, 5000);
  assert.equal(applied, baseline);
  assert.equal(failed.current, false);
  mutate = true; applied = null;
  await assert.rejects(compiled.exports(new AbortController().signal), /新的修改/);
  assert.equal(applied, null);
  assert.equal(failed.current, true);
});

test("print helper waits for all images and cancels late printing without leaving private frames", async () => {
  let decode; let afterPrint; let removed = 0; let printed = 0;
  const content = { classList: { contains: name => name === "expand-pages" }, style: {} };
  const doc = {
    open() {}, write() {}, close() {}, fonts: { ready: Promise.resolve() },
    images: [{ decode: () => new Promise(resolve => { decode = resolve; }) }],
    querySelector: name => name === ".content" ? content : { clientWidth: 718 },
  };
  const helper = load("lib/print-a4.ts", {}, { document: {
    createElement: () => ({ style: {}, contentDocument: doc, contentWindow: {
      addEventListener: (_name, callback) => { afterPrint = callback; }, focus() {}, print: () => { printed++; },
    }, remove: () => { removed++; } }), body: { appendChild() {} },
  } }).printA4Html;
  const request = new AbortController();
  const pending = helper("<html></html>", "立替小票", { signal: request.signal });
  await new Promise(done => setImmediate(done));
  assert.equal(printed, 0);
  request.abort(); decode();
  await assert.rejects(pending);
  assert.equal(printed, 0);
  assert.ok(removed > 0);
  const successful = helper("<html></html>", "立替小票");
  await new Promise(done => setImmediate(done)); decode(); await successful;
  assert.equal(printed, 1);
  const before = removed; afterPrint(); assert.equal(removed, before + 1);
  doc.images = [{ decode: async () => { throw new Error("Missing image"); } }];
  await assert.rejects(helper("<html></html>", "立替小票", { imageErrorMessage: "小票读取失败" }), /小票读取失败/);
  assert.equal(printed, 1);
  assert.equal(removed, before + 2);
});
