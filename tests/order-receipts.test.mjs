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
const { jsonResponse } = load("lib/api-response.ts");
const id = "f4900250-0000-4000-8000-000000000001";
const rows = [
  { bucket: "driver-finance-receipts", path: "company.jpg", category: "company", detail: "Parking" },
  { bucket: "driver-finance-receipts", path: "trip.jpg", category: "trip", detail: "Toll" },
  { bucket: "driver-fuel-receipts", path: "fuel.jpg", category: "fuel", detail: "Fuel" },
];
const data = { enabled: true, receipts: rows.map(row => ({ ...row, url: `https://receipts.example/${row.path}` })) };
function handler({ enabled = true, profile = { role: "user" }, result = rows, error = null, signing = "ok" } = {}) {
  const calls = []; const signs = [];
  const api = load("app/api/order-receipts/route.ts", {
    "@/lib/api-response": { jsonResponse }, "@/lib/driver/order-receipts": schemas,
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => enabled },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ profile, supabase: {
      rpc: async (name, args) => { calls.push({ name, args }); return { data: result, error }; },
      storage: { from: bucket => ({ createSignedUrls: async (paths, expiry) => {
        signs.push({ bucket, paths, expiry });
        return { error: signing === "failed" ? new Error("failed") : null,
          data: paths.map(path => ({ path, signedUrl: `https://receipts.example/${path}`, error: signing === "partial" ? "missing" : null })) };
      } }) },
    } }) },
  });
  return { ...api, calls, signs };
}
function request(query = `orderId=${id}&date=2026-10-27`) { return new Request(`https://staff.example/api/order-receipts?${query}`); }

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
  assert.deepEqual(await response.json(), data);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: "staff_order_receipts", args: { target_order: id, target_date: "2026-10-27" } }]);
  assert.equal(h.signs.length, 2);
  assert.ok(h.signs.every(sign => sign.expiry === 300));
  const empty = handler({ result: [] });
  assert.deepEqual(await (await empty.GET(request())).json(), { enabled: true, receipts: [] });
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
test("gallery renders compact categorized thumbnails and opens a large native modal without form submits", () => {
  const states = [data, "", null, 0];
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
    react: { ...React, useEffect: effect => effects.push(effect), useRef: () => ({ current: null }),
      useState: initial => { const i = cursor++; return i < states.length ?
        [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }] : [initial, () => {}]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "./order-receipts.module.css": styleMock, "@/lib/driver/order-receipts": schemas, "@/lib/supabase/browser": {},
  }).OrderReceipts;
  function render() { cursor = 0; effects.length = 0; return renderToStaticMarkup(React.createElement(Component, { orderId: id, date: "2026-10-27" })); }
  let html = render();
  assert.equal((html.match(/class="thumbnail"/g) ?? []).length, 3);
  for (const label of ["社报立替", "旅报立替", "燃油费"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /待审核|已驳回|<dialog/);
  assert.equal((html.match(/type="button"/g) ?? []).length, 4);
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
  const note = source.indexOf("                                    外注司机备注");
  const gallery = source.indexOf("<OrderReceipts ");
  assert.ok(note > source.indexOf('{section.title === "立替费用" && ('));
  assert.ok(gallery > note && gallery < source.indexOf('<legend className="px-1 text-sm font-semibold">司机工资'));
  const textarea = source.slice(note, source.indexOf("/>", note));
  assert.match(textarea, /rows=\{2\}/);
  assert.match(textarea, /className="[^"]*\bh-12\b[^"]*"/);
  assert.doesNotMatch(textarea, /h-24|flex-1/);
});

test("gallery refreshes short-lived URLs and clears hidden or signed-out data without late restoration", async () => {
  const states = [null, "", null, 0]; const effects = []; const events = {};
  let cursor = 0; let resolve; let onAuth; let interval; let aborted; let unsubscribed = false;
  const doc = { visibilityState: "visible", addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener() {} };
  const Component = load("components/order-receipts.tsx", {
    react: { ...React, useEffect: effect => effects.push(effect),
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
  interval.fn(); assert.equal(states[0], null);
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
