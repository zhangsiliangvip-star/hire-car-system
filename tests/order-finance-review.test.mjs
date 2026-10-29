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
const fuel = load("lib/driver/fuel.ts");
const finance = load("lib/driver/finance.ts", { "./fuel": fuel });
const receiptSchemas = load("lib/driver/order-receipts.ts");
const reviewSchemas = load("lib/driver/order-review.ts", { "./finance": finance, "./fuel": fuel });
const { jsonResponse } = load("lib/api-response.ts");
const id = "f4900260-0000-4000-8000-000000000001";
const second = id.replace(/1$/, "2");
const path = `${id}/${id}/company/${id}.jpg`;
const rows = [
  { kind: "finance", orderId: id, date: "2026-10-25", driverName: "Test driver", claim: {
    assignmentId: id, category: "company", version: 1, status: "pending",
    expenses: [{ id, type: "company", detail: "Parking", amount: 1000, receipts: [path] }],
    overtimeHours: 0, reviewNote: "", submittedAt: "2026-10-25T10:00:00Z",
  } },
  { kind: "finance", orderId: id, date: "2026-10-25", driverName: "Test driver", claim: {
    assignmentId: id, category: "overtime", version: 3, status: "pending", expenses: [],
    overtimeHours: 1.5, reviewNote: "", submittedAt: "2026-10-25T10:00:00Z",
  } },
  { kind: "fuel", orderId: id, date: "2026-10-26", driverName: "Test driver", claim: {
    id: second, assignmentId: second, date: "2026-10-26", version: 1, status: "pending", amount: 2000,
    receipts: [`${id}/2026-10-26/${second}.jpg`], reviewNote: "",
  } },
  { kind: "finance", orderId: second, date: "2026-10-25", driverName: "Other driver", claim: {
    assignmentId: second, category: "trip", version: 1, status: "pending",
    expenses: [{ id: second, type: "trip", detail: "Other order", amount: 500, receipts: [] }],
    overtimeHours: 0, reviewNote: "", submittedAt: "2026-10-25T10:00:00Z",
  } },
];
function api({ enabled = true, role = "admin", result = rows, error = null } = {}) {
  const calls = [];
  const handler = load("app/api/order-finance-review/route.ts", {
    "@/lib/api-response": { jsonResponse }, "@/lib/driver/order-review": reviewSchemas,
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => enabled },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ profile: role ? { role } : null,
      supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data: result, error }; } } }) },
  });
  return { ...handler, calls };
}
test("pending order API is test/admin-only, strict by month, and never accepts reviewed claims", async () => {
  const request = query => new Request(`https://staff.example/api/order-finance-review${query}`);
  const off = api({ enabled: false });
  assert.deepEqual(await (await off.GET(request("?month=2026-10"))).json(), { enabled: false, rows: [] });
  assert.equal(off.calls.length, 0);
  for (const role of [null, "user", "driver"]) {
    const handler = api({ role });
    assert.equal((await handler.GET(request("?month=2026-10"))).status, 403);
    assert.equal(handler.calls.length, 0);
  }
  for (const query of ["", "?month=2026-13", "?month=2026-10&month=2026-11", "?month=2026-10&driverId=x", "?month=2026-10&status=approved"]) {
    const handler = api();
    assert.equal((await handler.GET(request(query))).status, 400);
    assert.equal(handler.calls.length, 0);
  }
  const handler = api();
  const response = await handler.GET(request("?month=2026-10"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), { enabled: true, rows });
  assert.deepEqual(JSON.parse(JSON.stringify(handler.calls)), [{ name: "admin_order_finance_pending", args: { target_month: "2026-10" } }]);
  for (const options of [{ result: null }, { result: [{ ...rows[0], price: 99 }] },
    { result: [{ ...rows[0], claim: { ...rows[0].claim, status: "approved" } }] }, { error: { code: "XX000" } }])
    assert.equal((await api(options).GET(request("?month=2026-10"))).status, 503);
});

function controller({ mode = "ok", blocked = false } = {}) {
  const states = [{ enabled: true, rows: structuredClone(rows) }, "", "", { orderId: id, name: "Test order" }, false, 0];
  const refs = []; const effects = []; let cursor; let refCursor; let props; let context;
  const calls = []; let approved = 0; let resolve;
  let visible; let authCallback;
  const runtime = require("react/jsx-runtime");
  const document = { visibilityState: "visible", addEventListener: (_name, fn) => { visible = fn; }, removeEventListener() {} };
  function capture(create) {
    return (type, input, ...rest) => {
      if (typeof type === "function" && type.name === "ReviewDialog") { props = input; return null; }
      if (input?.value?.open) context = input.value;
      return create(type, input, ...rest);
    };
  }
  const Component = load("components/order-finance-review.tsx", {
    react: { ...React, useEffect: effect => effects.push(effect), useRef: initial => {
      const i = refCursor++; refs[i] ??= { current: initial }; return refs[i];
    }, useState: () => {
      const i = cursor++; return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }];
    } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "@/lib/driver/order-review": reviewSchemas, "@/lib/driver/finance": finance,
    "@/lib/driver/fuel": fuel, "@/lib/driver/order-receipts": receiptSchemas,
    "@/components/order-receipts": {}, "./order-receipts.module.css": { default: {} },
    "@/lib/supabase/browser": { createClient: () => ({ auth: { onAuthStateChange: fn => {
      authCallback = fn; return { data: { subscription: { unsubscribe() {} } } };
    } } }) },
  }, {
    document, window: { confirm: () => true },
    fetch: async (url, options) => {
      if (!options.method) return Response.json({ enabled: true, rows });
      const body = JSON.parse(options.body); calls.push({ url, body });
      const row = body.fuelId ? rows[2] : rows.find(item => item.kind === "finance" &&
        item.claim.assignmentId === body.assignmentId && item.claim.category === body.category);
      const claim = { ...row.claim, status: body.decision, version: mode === "mismatch" ? 99 : row.claim.version + 1 };
      const response = mode === "conflict" ? Response.json({ error: "状態已变化，請刷新。" }, { status: 409 }) :
        Response.json(row.kind === "fuel" ? { fuelClaim: claim } : { claim });
      if (mode === "late") return new Promise(done => { resolve = () => done(response); });
      return response;
    },
  }).OrderFinanceReviewProvider;
  function render() {
    cursor = 0; refCursor = 0; effects.length = 0;
    return renderToStaticMarkup(React.createElement(Component, {
      month: "2026-10", enabled: true, blocked,
      onApproved: async signal => {
        assert.equal(signal.aborted, false); approved++;
        if (mode === "refresh-failed") throw new Error("refresh failed");
      },
    }, "List"));
  }
  render();
  return { states, refs, calls, render, effects,
    get props() { return props; }, get context() { return context; }, get approved() { return approved; },
    resolve: () => resolve(), hide: () => { document.visibilityState = "hidden"; visible(); },
    signOut: () => authCallback("SIGNED_OUT"),
  };
}
test("order review drawer isolates the order and rejects without booking, removing only the exact pending category", async () => {
  const c = controller();
  assert.equal(c.props.rows.length, 3);
  assert.ok(c.props.rows.every(row => row.orderId === id));
  await c.props.review(rows[0], "rejected", "");
  assert.match(c.states[1], /填写原因/);
  assert.equal(c.calls.length, 0);
  await c.props.review(rows[0], "rejected", "Duplicate receipt");
  assert.equal(c.calls[0].url, "/api/driver-finance-review");
  assert.deepEqual(c.calls[0].body, { assignmentId: id, category: "company", expectedVersion: 1, decision: "rejected", note: "Duplicate receipt" });
  assert.equal(c.states[0].rows.length, 3);
  assert.ok(c.states[0].rows.some(row => row.kind === "finance" && row.claim.category === "overtime"));
  assert.ok(c.states[0].rows.some(row => row.orderId === second));
  assert.equal(c.approved, 0);
  assert.match(c.states[2], /未计入金額.*記録保留/);
});
test("approvals use exact claim versions and refresh totals for advances, overtime and daily fuel", async () => {
  for (const row of rows.slice(0, 3)) {
    const c = controller();
    await c.props.review(row, "approved", "");
    assert.equal(c.approved, 1);
    assert.equal(c.states[0].rows.length, 3);
    assert.ok(!c.states[0].rows.some(item => reviewSchemas.orderReviewKey(item) === reviewSchemas.orderReviewKey(row)));
    if (row.kind === "fuel") assert.deepEqual(c.calls[0].body, { fuelId: second, expectedVersion: 1, decision: "approved", note: "" });
    else assert.equal(c.calls[0].body.category, row.claim.category);
  }
});
test("review conflicts and malformed success preserve pending rows; refresh failure never offers duplicate approval", async () => {
  for (const mode of ["conflict", "mismatch", "refresh-failed"]) {
    const c = controller({ mode });
    await c.props.review(rows[0], "approved", "");
    assert.equal(c.states[0].rows.length, mode === "refresh-failed" ? 3 : 4);
    assert.match(c.states[1], mode === "refresh-failed" ? /已批准入账.*勿重复批准/ : /刷新/);
    assert.equal(c.states[4], false);
  }
  const blocked = controller({ blocked: true });
  await blocked.props.review(rows[0], "approved", "");
  assert.equal(blocked.calls.length, 0);
});
test("review locks double clicks and late writes cannot restore hidden or signed-out state", async () => {
  for (const event of ["hide", "signOut"]) {
    const c = controller({ mode: "late" });
    const cleanup = c.effects[0]();
    await new Promise(done => setImmediate(done));
    const first = c.props.review(rows[0], "approved", "");
    await c.props.review(rows[0], "approved", "");
    assert.equal(c.calls.length, 1);
    c[event](); c.resolve(); await first;
    assert.equal(c.states[0], null);
    assert.equal(c.states[3], null);
    assert.equal(c.states[2], "");
    assert.equal(c.approved, 0);
    cleanup();
  }
});

test("drawer shows dates, drivers, details, amounts, overtime and compact photos with visible review errors", () => {
  const runtime = require("react/jsx-runtime"); let cursor = 0; let drawer; let drawerProps;
  const Component = load("components/order-finance-review.tsx", {
    react: { ...React, useEffect() {}, useRef: v => ({ current: v }),
      useState: initial => {
        const values = [{ enabled: true, rows }, "Review error", "", { orderId: id, name: "Test order" }, false, 0];
        const i = cursor++; return [i < values.length ? values[i] : initial, () => {}];
      } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "@/lib/driver/order-review": reviewSchemas, "@/lib/driver/finance": finance, "@/lib/driver/fuel": fuel,
    "@/lib/driver/order-receipts": receiptSchemas, "@/components/order-receipts": {},
    "./order-receipts.module.css": { default: { dialog: "review-dialog" } }, "@/lib/supabase/browser": {},
  }).OrderFinanceReviewProvider;
  function capture(create) { return (type, props, ...rest) => {
    if (typeof type === "function" && type.name === "ReviewDialog") { drawer = type; drawerProps = props; return null; }
    return create(type, props, ...rest);
  }; }
  renderToStaticMarkup(React.createElement(Component, { month: "2026-10", enabled: true, blocked: false, onApproved() {} }));
  // Render the actual drawer in a fresh React hook scope with empty notes.
  cursor = 6;
  const html = renderToStaticMarkup(React.createElement(drawer, drawerProps));
  for (const text of ["訂単财务审核", "2026-10-25", "2026-10-26", "Test driver", "Parking", "1,000 JPY", "2,000 JPY",
    "1.5 小時", "批准入账", "驳回移除", "保留記録", "Review error"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Other driver|Other order/);
  assert.equal((html.match(/>批准入账<\/button>/g) ?? []).length, 3);
  assert.equal((html.match(/>驳回移除<\/button>/g) ?? []).length, 3);
  if (process.env.ORDER_REVIEW_LAYOUT_FILE) {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace('@import "tailwindcss";', "");
    writeFileSync(process.env.ORDER_REVIEW_LAYOUT_FILE,
      `<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}
      .review-dialog{width:min(900px,94vw);max-height:90vh;margin:auto;overflow:auto}</style><body>${html}</body></html>`);
  }
});

test("pending receipt thumbnails use private buckets, open large previews and suppress late signed URLs", async () => {
  for (const kind of ["finance", "fuel"]) for (const cancelled of [false, true]) {
    let cursor = 0; const effects = []; let drawer; let drawerProps; let photos; let photoProps;
    let thumb; let preview; let resolve; const signs = [];
    const row = kind === "finance" ? rows[0] : rows[2];
    const providerStates = [{ enabled: true, rows: [row] }, "", "", { orderId: id, name: "Test order" }, false, 0];
    let states = providerStates;
    const runtime = require("react/jsx-runtime");
    function capture(create) { return (type, props, ...rest) => {
      if (typeof type === "function" && type.name === "ReviewDialog") { drawer = type; drawerProps = props; return null; }
      if (typeof type === "function" && type.name === "PendingPhotos") { photos = type; photoProps = props; return null; }
      if (props?.className === "thumbnail") thumb = props;
      if (type === "preview") { preview = props; return null; }
      return create(type, props, ...rest);
    }; }
    const Component = load("components/order-finance-review.tsx", {
      react: { ...React, useEffect: effect => effects.push(effect), useRef: v => ({ current: v }),
        useState: initial => { const i = cursor++; if (i >= states.length) return [initial, () => {}];
          return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
      "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
      "@/lib/driver/order-review": reviewSchemas, "@/lib/driver/finance": finance, "@/lib/driver/fuel": fuel,
      "@/lib/driver/order-receipts": receiptSchemas, "@/components/order-receipts": { ReceiptDialog: "preview" },
      "./order-receipts.module.css": { default: { thumbnail: "thumbnail" } },
      "@/lib/supabase/browser": { createClient: () => ({ storage: { from: bucket => ({
        createSignedUrls: async (paths, expiry) => {
          signs.push({ bucket, paths, expiry });
          return new Promise(done => { resolve = () => done({ data: paths.map(path => ({
            path, signedUrl: `https://private.example/${path}`, error: null,
          })), error: null }); });
        },
      }) } }) },
    }, { setTimeout: () => 1, clearTimeout() {} }).OrderFinanceReviewProvider;
    renderToStaticMarkup(React.createElement(Component, { month: "2026-10", enabled: true, blocked: false, onApproved() {} }));
    cursor = 6;
    renderToStaticMarkup(React.createElement(drawer, drawerProps));
    states = [null, null, "", 0]; cursor = 0; effects.length = 0;
    renderToStaticMarkup(React.createElement(photos, photoProps));
    const cleanup = effects[0]();
    assert.equal(signs[0].bucket, kind === "fuel" ? "driver-fuel-receipts" : "driver-finance-receipts");
    assert.equal(signs[0].expiry, 300);
    if (cancelled) cleanup();
    resolve(); await new Promise(done => setImmediate(done));
    if (cancelled) { assert.equal(states[0], null); continue; }
    cursor = 0; renderToStaticMarkup(React.createElement(photos, photoProps));
    assert.match(thumb["aria-label"], /点击放大/);
    thumb.onClick();
    cursor = 0; renderToStaticMarkup(React.createElement(photos, photoProps));
    assert.equal(preview.receipt.url, states[0][0].url);
    preview.close();
    assert.equal(states[1], null);
    cleanup();
  }
});

test("order finance list wires review with save protection and explicit server-only totals synchronization", () => {
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /<OrderFinanceReviewButton orderId=\{order\.id\} name=\{order\.customer/);
  assert.match(source, /blocked=\{pendingSaveCount > 0 \|\| Boolean\(persistenceError\)\}/);
  assert.match(source, /onApproved=\{refreshApprovedOrderFinance\}/);
  assert.match(source, /syncOrders\(\(payload as DashboardData\)\.orders, version\)/);
});
