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
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, { module: compiled, exports: compiled.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] :
      name === "@/components/order-receipts" ? { ReceiptDialog: ({ receipt, close }) =>
        React.createElement("dialog", { "aria-label": "小票大图" },
          React.createElement("button", { type: "button", onClick: close }, "关闭"),
          React.createElement("img", { src: receipt.url, alt: receipt.detail })) } :
      name === "@/app/driver/navigation" ? load("app/driver/navigation.tsx", mocks, globals) :
      name.endsWith(".css") ? {} : require(name),
    Request, Response, Headers, URL, Date, Intl, process, console: { error() {} }, ...globals,
  });
  return compiled.exports;
}
const fuel = load("lib/driver/fuel.ts");
const finance = load("lib/driver/finance.ts", { "./fuel": fuel });
const { jsonResponse } = load("lib/api-response.ts");
const { isDriverActionOrigin } = load("lib/driver/assignment-action.ts", {
  "@/lib/api-response": { jsonResponse }, "@/lib/driver/authorization": {},
  "@/lib/driver/orders": {}, "@/lib/driver/test-runtime": {},
});
const id = "c6000000-0000-4000-8000-000000000001";
const expense = { id, type: "company", detail: "Parking", amount: 1500, receipts: [] };
const claim = { assignmentId: id, category: "company", version: 1, status: "pending", expenses: [expense],
  overtimeHours: 0, reviewNote: "", submittedAt: "2026-10-27T00:00:00Z" };
const data = { fuelClaims: [], trips: [{ assignmentId: id, date: "2026-10-27", orderName: "Synthetic order",
  pickup: "Synthetic pickup",
  destination: "Synthetic destination", existingOvertimeHours: 0, claims: [] }],
  wages: [{ date: "2026-10-27", base: 10000, bonus: 500, overtime: 3000, advances: 1500 }],
  manualItems: [{ name: "Synthetic adjustment", amount: -500 }] };
const command = { assignmentId: id, category: "company", expectedVersion: 0, requestId: id, expenses: [expense], overtimeHours: 0 };
const fuelClaim = { id, assignmentId: id, date: "2026-10-27", version: 1, status: "pending",
  amount: 6000, receipts: [], reviewNote: "" };
const fuelCommand = { assignmentId: id, date: "2026-10-27", expectedVersion: 0, requestId: id,
  amount: 6000, receipts: [] };

test("driver and staff receipt links use the shared popup instead of bottom-of-page image cards", () => {
  for (const relative of ["app/driver/finance/finance.tsx", "app/driver-finance-review/review.tsx"]) {
    const source = readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
    assert.match(source, /import \{ ReceiptDialog \} from "@\/components\/order-receipts"/);
    assert.match(source, /receipt && <ReceiptDialog receipt=\{\{ url: receipt,/);
    assert.match(source, /close=\{\(\) => setReceipt\(""\)\}/);
    assert.doesNotMatch(source, /receipt && <section|<img[^>]*src=\{receipt\}/);
  }
});
function handler({ admin = false, dailyFuel = false, denied = 0, testMode = true, role = "admin",
  result = data, historical = { trips: [] }, error = null } = {}) {
  const calls = [];
  const supabase = { rpc: async (name, args) => {
    calls.push({ name, args }); return { data: ["driver_daily_fuel_data", "admin_driver_daily_fuel"].includes(name) ? [] :
      name === "driver_historical_finance_data_v2" ? historical :
      name === "driver_finance_data_v2" && result ? Object.fromEntries(Object.entries(result).filter(([key]) => key !== "fuelClaims")) : result, error };
  } };
  const exports = load(admin ? "app/api/driver-finance-review/route.ts" :
    dailyFuel ? "app/api/driver/fuel/route.ts" : "app/api/driver/finance/route.ts", {
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/finance": finance,
    "@/lib/driver/fuel": fuel,
    "@/lib/driver/authorization": { requireDriver: async () => denied
      ? { response: jsonResponse({ error: "Denied" }, { status: denied }) } : { supabase } },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ supabase, profile: role ? { role } : null }) },
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => testMode },
    "@/lib/driver/assignment-action": { isDriverActionOrigin },
  });
  return { ...exports, calls };
}
function request(body = command, origin = "https://driver.example", contentType = "application/json", admin = false) {
  return new Request(`https://driver.example/api/${admin ? "driver-finance-review" : "driver/finance"}`, {
    method: "POST", headers: { Origin: origin, "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
test("finance validates yen, decimal hours, strict ownership, receipt counts and unique items", () => {
  assert.equal(finance.financeSubmissionSchema.safeParse(command).success, true);
  assert.equal(finance.financeSubmissionSchema.safeParse({ ...command, category: "overtime", expenses: [], overtimeHours: 1.5 }).success, true);
  for (const change of [{ overtimeHours: -1 }, { overtimeHours: 1000 }, { overtimeHours: 1.234 },
    { driverId: id }, { category: "trip" }, { category: "overtime" }, { expenses: [] },
    { overtimeHours: 1.5 }, { expectedVersion: -1 }, { expenses: [expense, expense] },
    { expenses: [{ ...expense, amount: 0 }] }, { expenses: [{ ...expense, amount: 1.5 }] },
    { expenses: [{ ...expense, amount: 100000000000000 }] }, { expenses: [{ ...expense, detail: " " }] },
    { expenses: [{ ...expense, receipts: ["https://external.invalid/x.jpg"] }] },
    { expenses: [{ ...expense, receipts: Array(6).fill(`${id}/${id}/${id}.jpg`) }] },
    { expenses: [{ ...expense, profit: 10 }] }, { expenses: Array(51).fill(expense) }])
    assert.equal(finance.financeSubmissionSchema.safeParse({ ...command, ...change }).success, false);
  assert.equal(finance.financeSubmissionSchema.safeParse({ ...command,
    expenses: [expense, { ...expense, id: id.replace(/1$/, "2"), amount: 99999999999999 }] }).success, false);
  assert.equal(finance.financeReviewSchema.safeParse({ assignmentId: id, category: "company", expectedVersion: 1, decision: "rejected", note: " " }).success, false);
  assert.deepEqual(JSON.parse(JSON.stringify(finance.expenseTotals([expense, { ...expense, type: "trip", amount: 2000 }]))),
    { company: 1500, trip: 2000 });
});
test("daily fuel validates linked order, integer cost and private photo paths", () => {
  assert.equal(fuel.fuelSubmissionSchema.safeParse(fuelCommand).success, true);
  for (const patch of [{ assignmentId: "" }, { amount: 0 }, { amount: 1.5 }, { amount: 100000000000000 },
    { date: "2026-02-30" }, { driverId: id }, { receipts: ["https://external.invalid/x.jpg"] },
    { receipts: Array(6).fill(`${id}/2026-10-27/${id}.jpg`) }])
    assert.equal(fuel.fuelSubmissionSchema.safeParse({ ...fuelCommand, ...patch }).success, false);
});
test("daily fuel API protects identity, origin, size, payload and version", async () => {
  for (const denied of [401, 403, 404]) {
    const h = handler({ dailyFuel: true, denied });
    assert.equal((await h.POST(request(fuelCommand))).status, denied);
    assert.equal(h.calls.length, 0);
  }
  for (const [req, status] of [[request(fuelCommand, "https://evil.example"), 403],
    [request(fuelCommand, "https://driver.example", "text/plain"), 415], [request("x".repeat(4097)), 413],
    [request("{"), 400], [request({ ...fuelCommand, driverId: id }), 400]]) {
    const h = handler({ dailyFuel: true });
    assert.equal((await h.POST(req)).status, status); assert.equal(h.calls.length, 0);
  }
  const h = handler({ dailyFuel: true, result: fuelClaim });
  const response = await h.POST(request(fuelCommand));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), { claim: fuelClaim });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: "submit_driver_daily_fuel", args: {
    target_date: fuelCommand.date, target_assignment: id, expected_version: 0, target_request: id,
    amount: 6000, receipts: [],
  } }]);
  for (const [code, status] of [["42501", 403], ["40001", 409], ["22023", 422], ["XX000", 503]])
    assert.equal((await handler({ dailyFuel: true, error: { code } }).POST(request(fuelCommand))).status, status);
});
test("daily fuel approval uses separate fuel ID and never the advance RPC", async () => {
  const command = { fuelId: id, expectedVersion: 1, decision: "approved", note: "" };
  const h = handler({ admin: true, result: { ...fuelClaim, status: "approved", version: 2 } });
  assert.equal((await h.POST(request(command))).status, 200);
  assert.equal(h.calls[0].name, "review_driver_daily_fuel");
  assert.equal(h.calls[0].args.target_fuel, id);
  const invalid = handler({ admin: true });
  assert.equal((await invalid.POST(request({ ...command, decision: "rejected" }))).status, 400);
  assert.equal(invalid.calls.length, 0);
});
test("finance read denies identities before RPC and rejects ownership selectors", async () => {
  for (const denied of [401, 403, 404]) {
    const h = handler({ denied });
    assert.equal((await h.GET(new Request("https://driver.example/api/driver/finance?month=2026-10"))).status, denied);
    assert.equal((await h.POST(request())).status, denied);
    assert.equal(h.calls.length, 0);
  }
  for (const query of ["", "?month=2026-13", `?month=2026-10&driverId=${id}`, "?month=2026-10&regionId=x"]) {
    const h = handler();
    assert.equal((await h.GET(new Request(`https://driver.example/api/driver/finance${query}`))).status, 400);
    assert.equal(h.calls.length, 0);
  }
});
test("finance read is a minimal no-store projection including manual payroll adjustments", async () => {
  const h = handler();
  const response = await h.GET(new Request("https://driver.example/api/driver/finance?month=2026-10"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), data);
  assert.deepEqual(h.calls.map(call => call.name), ["ensure_driver_historical_finance_links",
    "driver_finance_data_v2", "driver_daily_fuel_data", "driver_historical_finance_data_v2"]);
  assert.equal(h.calls[1].args.target_month, "2026-10");
  for (const result of [{ ...data, profit: 100 }, { ...data, wages: [{ ...data.wages[0], customerCharge: 100 }] }, null])
    assert.equal((await handler({ result }).GET(new Request("https://driver.example/api/driver/finance?month=2026-10"))).status, 500);
});
test("finance writes protect origins, JSON type, size and strict fields", async () => {
  for (const [req, status] of [[request(command, "https://evil.example"), 403], [request(command, "null"), 403],
    [request(command, "https://driver.example", "text/plain"), 415], [request("x".repeat(65537)), 413],
    [request("{"), 400], [request({ ...command, driverId: id }), 400]]) {
    const h = handler();
    assert.equal((await h.POST(req)).status, status);
    assert.equal(h.calls.length, 0);
  }
});
test("finance submit forwards exact version and idempotency key and validates success", async () => {
  const h = handler({ result: claim });
  const response = await h.POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claim });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: "submit_driver_finance",
    args: { target_assignment: id, target_category: "company", expected_version: 0, target_request: id, items: [expense], hours: 0 } }]);
  assert.equal((await handler({ result: null }).POST(request())).status, 500);
  for (const [code, status] of [["42501", 403], ["40001", 409], ["22023", 422], ["XX000", 503]])
    assert.equal((await handler({ error: { code } }).POST(request())).status, status);
});
test("historical finance read merges validated trips and uses the audited-link submit RPC", async () => {
  const historicalTrip = { assignmentId: id.replace(/1$/, "9"), historical: true, date: "2026-10-10",
    pickup: "Past pickup", destination: "Past destination", existingOvertimeHours: 0, claims: [] };
  const read = handler({ historical: { trips: [historicalTrip] } });
  const response = await read.GET(new Request("https://driver.example/api/driver/finance?month=2026-10"));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).trips.at(-1), historicalTrip);
  const historicalClaim = { ...claim, assignmentId: historicalTrip.assignmentId, historical: true };
  const submit = handler({ result: historicalClaim });
  const saved = await submit.POST(request({ ...command, assignmentId: historicalTrip.assignmentId, historical: true }));
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(submit.calls)), [{ name: "submit_driver_historical_finance",
    args: { target_link: historicalTrip.assignmentId, target_category: "company", expected_version: 0,
      target_request: id, items: [expense], hours: 0 } }]);
});
test("review is test-only and admin-only for reads and writes", async () => {
  for (const options of [{ testMode: false }, { role: "user" }, { role: null }]) {
    const h = handler({ admin: true, ...options });
    const status = options.testMode === false ? 404 : 403;
    assert.equal((await h.GET(new Request("https://driver.example/api/driver-finance-review?month=2026-10"))).status, status);
    assert.equal((await h.POST(request())).status, status);
    assert.equal(h.calls.length, 0);
  }
});
test("review forwards strict decision and version, requires reason on rejection", async () => {
  const decision = { assignmentId: id, category: "company", expectedVersion: 1, decision: "approved", note: "" };
  const h = handler({ admin: true, result: { ...claim, version: 2, status: "approved" } });
  assert.equal((await h.POST(request(decision, undefined, undefined, true))).status, 200);
  assert.equal(h.calls[0].name, "review_driver_finance");
  assert.equal(h.calls[0].args.expected_version, 1);
  for (const [body, status] of [[{ ...decision, decision: "rejected" }, 400],
    [{ ...decision, amount: 10 }, 400], ["x".repeat(4097), 413]]) {
    const invalid = handler({ admin: true });
    assert.equal((await invalid.POST(request(body, undefined, undefined, true))).status, status);
    assert.equal(invalid.calls.length, 0);
  }
  assert.equal((await handler({ admin: true, error: { code: "40001" } }).POST(request(decision))).status, 409);
});
function renderFinance({ status = null, withEffects = false, fetch: fetchMock, view = "claims", confirm = () => true,
  refresh = () => Response.json(data) } = {}) {
  const selectedClaim = status ? { ...claim, status } : null;
  const states = ["2026-10", "2026-10-27", { ...data, trips: [
    { ...data.trips[0], claims: selectedClaim ? [selectedClaim] : [] },
    { ...data.trips[0], assignmentId: id.replace(/1$/, "2"), claims: [{ ...claim, category: "trip",
      assignmentId: id.replace(/1$/, "2"), expenses: [{ ...expense, type: "trip", amount: 2000 }] }] },
  ] }, id, [expense], "1.5", false, false, "", "", 0, "", view];
  const effects = [], refs = [], events = {}, buttons = [], inputs = [], uploads = [];
  const document = { visibilityState: "visible", addEventListener(name, fn) { events[name] = fn; }, removeEventListener() {} };
  let cursor = 0, refCursor = 0;
  const runtime = require("react/jsx-runtime");
  const jsx = original => (type, props, ...rest) => {
    if (type === "button") buttons.push(props);
    if (type === "input") inputs.push(props);
    return original(type, props, ...rest);
  };
  const Component = load("app/driver/finance/finance.tsx", {
    react: { ...React, useEffect(fn) { if (withEffects) effects.push(fn); },
      useRef(value) { const i = refCursor++; return refs[i] ||= { current: value }; },
      useState(value) { const i = cursor++; if (i >= states.length) states[i] = typeof value === "function" ? value() : value;
        return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: jsx(runtime.jsx), jsxs: jsx(runtime.jsxs) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/driver/orders": { createDriverRequestId: () => id, japanDate: () => "2026-10-27" },
    "@/lib/driver/finance": finance,
    "@/lib/driver/fuel": fuel,
    "@/lib/supabase/browser": { createClient: () => ({ auth: {
      getUser: async () => ({ data: { user: { id } }, error: null }),
      onAuthStateChange(fn) { events.auth = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    }, storage: { from: bucket => ({ upload: async (path, file, options) => {
      uploads.push({ bucket, path, file, options }); return { error: null };
    } }) } }) },
  }, { fetch: (url, init) => init?.method === "POST" || withEffects ? fetchMock(url, init) : refresh(url, init), AbortController,
    document,
    window: { confirm }, location: { replace() {} } }).default;
  function render() {
    cursor = 0; refCursor = 0; buttons.length = 0; inputs.length = 0;
    return renderToStaticMarkup(React.createElement(Component));
  }
  const html = render();
  return { html, states, effects, events, buttons, inputs, document, uploads, render };
}

test("history finance link loads the selected date and existing claim for editing", async () => {
  for (const available of [true, false]) {
    const states = [], refs = [], effects = [];
    let cursor = 0, refCursor = 0, requested;
    const historical = { ...data, trips: available ? [{ ...data.trips[0], historical: true, claims: [claim] }] : [],
      fuelClaims: [fuelClaim] };
    const Component = load("app/driver/finance/finance.tsx", {
      react: { ...React, useEffect: effect => effects.push(effect),
        useRef: value => refs[refCursor++] ??= { current: value },
        useState: initial => {
          const index = cursor++;
          if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
          return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
        } },
      "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
      "@/lib/driver/orders": { createDriverRequestId: () => id, japanDate: () => "2026-11-25" },
      "@/lib/driver/finance": finance, "@/lib/driver/fuel": fuel,
      "@/lib/supabase/browser": { createClient: () => ({ auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      } }) },
    }, { AbortController, document: { addEventListener() {}, removeEventListener() {} },
      location: { replace() {} }, fetch: async url => { requested = url; return Response.json(historical); } }).default;
    function render() { cursor = 0; refCursor = 0; effects.length = 0;
      return Component({ initialDate: "2026-10-27", initialAssignmentId: id }); }
    render(); const cleanup = effects[0]();
    await new Promise(done => setImmediate(done));
    const html = renderToStaticMarkup(render());
    assert.equal(requested, "/api/driver/finance?month=2026-10");
    assert.equal(states[1], "2026-10-27");
    assert.equal(states[13], "6000");
    if (available) {
      assert.equal(states[3], id);
      assert.match(html, /value="Parking"/);
      assert.match(html, /保存社報立替并提交/);
    } else assert.match(html, /所选财务記録不存在或当前不可修改/);
    cleanup();
  }
});

test("driver receipt URL opens a popup without adding a bottom card or discarding unsaved drafts", () => {
  const h = renderFinance();
  h.states[11] = "https://receipts.example/private-signed.jpg";
  const html = h.render();
  assert.match(html, /<dialog aria-label="小票大图">/);
  assert.match(html, /src="https:\/\/receipts.example\/private-signed.jpg"/);
  assert.doesNotMatch(html, /class="finance-receipt"/);
  assert.equal(h.states[4][0].amount, 1500);
  assert.equal(h.states[5], "1.5");
});

test("receipt uploads show a single Japanese picker label while keeping native multi-file inputs", () => {
  const h = renderFinance();
  const pickers = h.html.match(/<span class="finance-file-picker">[\s\S]*?<\/span><\/label>/g) ?? [];
  assert.equal(pickers.length, 2);
  for (const picker of pickers) {
    assert.equal((picker.match(/ファイルを選択/g) ?? []).length, 1);
    assert.match(picker, /type="file"/);
    assert.match(picker, /multiple=""/);
    assert.doesNotMatch(picker, /ファイル未選択/);
  }
  const css = readFileSync(new URL("../app/driver/finance/finance.css", import.meta.url), "utf8");
  assert.match(css, /\.finance-file-picker input\[type=file\]\{[^}]*opacity:0/);
  assert.match(css, /\.finance-file-picker:focus-within/);
});

test("mobile finance renders both categories, all-order daily totals and complete monthly wages", () => {
  const { html } = renderFinance();
  assert.doesNotMatch(html, /本人有效行程可申報/);
  for (const text of ["社報", "旅報", "¥1,500", "¥2,000", "最多5张", 'multiple=""'])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /刷新财务/);
  assert.equal((html.match(/type="month"/g) ?? []).length, 0);
  assert.doesNotMatch(html, /<input type="date"[^>]* min=|<input type="date"[^>]* max=/);
  const companyCard = html.split('aria-label="社報立替"')[1].split("</section>")[0];
  const tripCard = html.split('aria-label="旅報立替"')[1].split("</section>")[0];
  assert.match(companyCard, /<\/h2><p class="driver-muted">此费用无需向发单方请求<\/p>/);
  assert.match(tripCard, /<\/h2><p class="driver-muted">此费用需要向发单方额外请求<\/p>/);
  assert.doesNotMatch(companyCard, /此费用需要向发单方额外请求/);
  assert.doesNotMatch(tripCard, /此费用无需向发单方请求/);
  const wagesHarness = renderFinance({ view: "wages" });
  const wages = wagesHarness.html;
  assert.equal(wagesHarness.inputs.some(input => input.type === "month"), false);
  assert.doesNotMatch(wages, /刷新财务/);
  assert.doesNotMatch(wages, /只读，应発金額包含/);
  for (const text of ["¥14,500", "Synthetic adjustment", "本月工資"]) assert.ok(wages.includes(text), text);
  if (process.env.DRIVER_FINANCE_LAYOUT_FILE) {
    const css = ["app/driver/driver.css", "app/driver/finance/finance.css"].map(path =>
      readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8")).join("\n");
    writeFileSync(process.env.DRIVER_FINANCE_LAYOUT_FILE,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}${css}</style><div class="driver-app">${html}</div>`);
  }
});

test("order selectors show order names and use a readable fallback when all labels are blank", () => {
  const h = renderFinance();
  const options = h.html.match(/<option[^>]*>[^<]*<\/option>/g)?.join("") || "";
  assert.match(options, /Synthetic order/);
  assert.doesNotMatch(options, /Synthetic pickup|Synthetic destination|→|历史訂単/);
  h.states[2].trips[0].orderName = "";
  h.states[2].trips[0].pickup = "";
  h.states[2].trips[0].destination = "";
  assert.match(h.render().match(/<option[^>]*>[^<]*<\/option>/g)?.join("") || "", /未命名订单/);
});

test("future orders allow advance prefill but block overtime and fuel submissions", () => {
  const calls = [];
  const h = renderFinance({ fetch: async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ claim });
  } });
  h.states[1] = "2026-10-28";
  for (const trip of h.states[2].trips) trip.date = "2026-10-28";
  const html = h.render();
  assert.doesNotMatch(html, /本人有效行程可申報/);
  assert.match(html, /未到用車日期，暂不能申報燃油費/);
  assert.equal(h.buttons.find(button => button.children === "保存社報立替并提交").disabled, false);
  assert.equal(h.buttons.find(button => button.children === "保存超時并提交").disabled, true);
  assert.equal(h.buttons.find(button => button.children === "保存燃油費并提交").disabled, true);
  h.buttons.find(button => button.children === "保存超時并提交").onClick();
  h.buttons.find(button => button.children === "保存燃油費并提交").onClick();
  assert.deepEqual(calls, []);
});

test("driver fuel and advance submissions immediately expose approved posting", async () => {
  const fuelResponse = handler({ dailyFuel: true, result: { ...fuelClaim, status: "approved", version: 2 } });
  const response = await fuelResponse.POST(request(fuelCommand));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).claim.status, "approved");
  const advanceResponse = handler({ result: { ...claim, status: "approved", version: 2 } });
  const advance = await advanceResponse.POST(request());
  assert.equal(advance.status, 200);
  assert.equal((await advance.json()).claim.status, "approved");
  const h = renderFinance({ fetch: async () => Response.json({
    claim: { ...claim, status: "approved", version: 2 },
  }) });
  h.render();
  const submit = h.buttons.find(button => button.children === "保存社報立替并提交");
  assert.ok(submit);
  submit.onClick({ currentTarget: { value: "company" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.render(), /已保存并更新訂単当天财务/);
  assert.doesNotMatch(h.html, /本人有效行程可申報/);
});

test("daily fuel card omits explanation and overtime submission remains editable after direct posting", async () => {
  const h = renderFinance({ fetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.category, "overtime");
    return Response.json({ claim: { ...claim, category: "overtime", expenses: [],
      overtimeHours: body.overtimeHours, status: "approved", version: 2 } });
  } });
  const card = h.html.split("<h2>当日燃油費</h2>")[1].split("</section>")[0];
  assert.ok(card.startsWith('<fieldset'));
  assert.doesNotMatch(card, /公司支付／油卡|更换訂単会|請勿重复手工录入/);
  h.buttons.find(button => button.children === "保存超時并提交").onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.states[2].trips[0].claims[0].overtimeHours, 1.5);
  assert.match(h.render(), /超時申報已保存并更新訂単当天财务/);
  assert.ok(h.buttons.some(button => button.children === "保存超時并提交"));
});

test("direct-posting migration keeps original submission idempotency and applies only advances and fuel", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261129000000_driver_expenses_direct_posting.sql", import.meta.url), "utf8");
  assert.match(sql, /target_category in \(''company'',''trip''\)/);
  assert.match(sql, /post_driver_advance_claim\(c\.claim_id\)/);
  assert.match(sql, /post_driver_fuel_claim\(f\.id\)/);
  assert.match(sql, /for share of ord','for update of ord/);
  assert.match(sql, /replace\(pg_get_functiondef\(signature::regprocedure\),chr\(13\),''\)/);
  assert.match(sql, /amount:=coalesce\(\(f->>'fuelCost'\)::numeric,0\)\+c\.amount/);
  assert.match(sql, /driverAdvanceCompanyReport' else 'driverAdvanceTripReport/);
  assert.match(sql, /from public,anon,authenticated/);
  assert.doesNotMatch(sql, /drop function|create trigger|update public\.driver_finance_claims set status='approved'[^;]*where status='pending'/);
});
test("historical claims show their source, submit with the history flag and exclude daily fuel", async () => {
  const calls = [];
  const h = renderFinance({ fetch: async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ claim: { ...claim, historical: true } });
  } });
  h.states[2].trips = [h.states[2].trips[0]];
  h.states[2].trips[0].historical = true;
  const html = h.render();
  assert.match(html, /历史訂単/);
  assert.equal(h.buttons.find(button => button.children === "保存燃油費并提交").disabled, true);
  h.buttons.find(button => button.children === "保存社報立替并提交")
    .onClick({ currentTarget: { value: "company" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].historical, true);
});
test("top buttons switch exclusive views while preserving the claim draft", () => {
  const h = renderFinance();
  assert.ok(h.html.includes("運転士立替汇総"));
  assert.equal(h.html.includes("<span>应発金額</span>"), false);
  h.buttons.find(button => button.children === "月工資").onClick();
  const wages = h.render();
  assert.ok(wages.includes("应発金額"));
  assert.equal(wages.includes("運転士立替汇総"), false);
  assert.equal(wages.includes("提交后台确认"), false);
  assert.match(wages, /aria-pressed="true">月工資/);
  h.buttons.find(button => button.children === "立替申報").onClick();
  const claims = h.render();
  assert.ok(claims.includes('value="Parking"'));
  assert.ok(claims.includes('value="1.5"'));
  assert.match(claims, /aria-pressed="true">立替申報/);
  assert.equal(h.states[3], id);
});
test("date then order then categories precede the final all-order driver advance summary", () => {
  const h = renderFinance();
  const markers = ["用車日期", "選択当天訂単", "<h2>社報立替</h2>", "<h2>旅報立替</h2>", "運転士立替汇総"];
  let position = -1;
  for (const marker of markers) {
    const next = h.html.indexOf(marker, position + 1);
    assert.ok(next > position, marker);
    position = next;
  }
  assert.ok(h.html.includes("¥3,500"));
  h.states[3] = "";
  const blank = h.render();
  assert.equal(blank.includes("<h2>社報立替</h2>"), false);
  assert.equal(blank.includes("<h2>旅報立替</h2>"), false);
  assert.equal(blank.includes("保存社報立替并提交"), false);
});
test("today shortcut crosses months safely and resets date-dependent drafts", () => {
  const h = renderFinance();
  h.states[0] = "2026-09"; h.states[1] = "2026-09-10";
  h.render(); h.buttons.find(button => button.children === "当日").onClick();
  assert.equal(h.states[0], "2026-10"); assert.equal(h.states[1], "2026-10-27");
  assert.equal(h.states[2], null); assert.equal(h.states[3], ""); assert.equal(h.states[4].length, 0);
});
test("today shortcut on the selected day preserves unsaved fields without confirmation", () => {
  const h = renderFinance({ confirm: () => { throw new Error("Unnecessary discard confirmation"); } });
  h.states[13] = "6000"; h.states[15] = id;
  h.render(); h.buttons.find(button => button.children === "当日").onClick();
  assert.equal(h.states[4][0].amount, 1500); assert.equal(h.states[13], "6000"); assert.equal(h.states[15], id);
});
test("finance effect fetches initial data and restores the selected day's fuel", async () => {
  const urls = [];
  const h = renderFinance({ withEffects: true, fetch: async url => {
    urls.push(url); return Response.json({ ...data, fuelClaims: [fuelClaim] });
  } });
  const cleanup = h.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(urls, ["/api/driver/finance?month=2026-10"]);
  assert.equal(h.states[13], "6000"); assert.equal(h.states[15], id);
  assert.equal(h.states[7], false);
  cleanup();
});
test("fuel remains daily when changing orders and does not enter advance/payable totals", async () => {
  const calls = [];
  const h = renderFinance({ fetch: async (_url, init) => {
    calls.push(JSON.parse(init.body)); return Response.json({ claim: fuelClaim });
  } });
  // Appended fuel draft state: amount, receipts, and explicitly chosen order.
  h.states[13] = "6000"; h.states[14] = []; h.states[15] = id;
  const html = h.render();
  assert.ok(html.indexOf("当日燃油費") > html.indexOf("超時申報"));
  assert.ok(html.indexOf("運転士立替汇総") > html.indexOf("当日燃油費"));
  assert.ok(html.includes("¥3,500")); // company 1500 + trip 2000, excludes fuel 6000
  h.buttons.find(button => button.children === "保存燃油費并提交").onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].assignmentId, id); assert.equal(calls[0].amount, 6000);
  assert.equal(h.states[2].fuelClaims.length, 1);
  h.states[3] = id.replace(/1$/, "2");
  h.render();
  assert.equal(h.states[15], id);
  assert.equal(h.buttons.some(button => button.children === "保存燃油費并提交"), true);
  h.buttons.find(button => button.children === "月工資").onClick();
  assert.match(h.render(), /<span>应発金額<\/span><strong>¥14,500<\/strong>/);
});
test("expense detail and amount share a compact left-to-right row", () => {
  const { html } = renderFinance();
  assert.match(html, /class="finance-expense-row"><label[^>]*>明細<input[^>]*><\/label><label[^>]*>金額（JPY）<input[^>]*><\/label><\/div>/);
});
test("advance categories render as separate simultaneous cards with their own entry controls", () => {
  const h = renderFinance();
  for (const label of ["社報立替", "旅報立替"]) {
    const card = h.html.split(`aria-label="${label}"`)[1].split("</section>")[0];
    assert.ok(card.includes(`<h2>${label}</h2>`));
    assert.ok(card.includes(`＋添加${label}明細`));
    assert.ok(card.includes(`保存${label}并提交`));
  }
  assert.equal(h.buttons.some(button => ["社報立替", "旅報立替"].includes(button.children)), false);
  h.buttons.find(button => Array.isArray(button.children) && button.children.join("") === "＋添加旅報立替明細").onClick();
  assert.equal(h.states[4][1].type, "trip");
  h.render();
  assert.equal(h.inputs.filter(input => input.type === "file").length, 3);
  assert.ok(h.render().includes('value="Parking"'));
});
test("monthly wages separate bonus and overtime and include booked advances exactly once in payable totals", () => {
  const { html } = renderFinance({ view: "wages" });
  assert.match(html, /<span>奖励工資<\/span><strong>¥500<\/strong>/);
  assert.match(html, /<span>超時工資<\/span><strong>¥3,000<\/strong>/);
  assert.match(html, /<span>后台已记運転士立替<\/span><strong>¥1,500<\/strong>/);
  assert.match(html, /<span>2026-10-27<\/span><strong>¥15,000<\/strong>/);
  assert.match(html, /<span>应発金額<\/span><strong>¥14,500<\/strong><\/div><\/section><\/main>$/);
});
test("each advance category saves its own payload without locking or losing the other draft", async () => {
  const calls = [];
  const h = renderFinance({ fetch: async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    return Response.json({ claim: { ...claim, category: body.category, expenses: body.expenses } });
  } });
  const tripExpense = { ...expense, id: id.replace(/1$/, "3"), type: "trip", detail: "Trip draft", amount: 800 };
  h.states[4] = [expense, tripExpense];
  h.render();
  h.buttons.find(button => button.children === "保存社報立替并提交").onClick({ currentTarget: { value: "company" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].category, "company");
  assert.deepEqual(calls[0].expenses, [expense]);
  assert.equal(calls[0].overtimeHours, 0);
  assert.equal(h.states[2].trips[0].claims[0].category, "company");
  assert.equal(h.states[4].length, 2);
  assert.equal(h.states[5], "1.5");
  h.render();
  const tripHtml = h.render();
  assert.ok(tripHtml.includes('value="Trip draft"'));
  const companyCard = tripHtml.split('aria-label="社報立替"')[1].split("</section>")[0];
  const tripCard = tripHtml.split('aria-label="旅報立替"')[1].split("</section>")[0];
  assert.equal(companyCard.includes('<fieldset disabled=""'), false);
  assert.equal(tripCard.includes('<fieldset disabled=""'), false);
  assert.equal(h.buttons.some(button => button.children === "保存社報立替并提交"), true);
  h.buttons.find(button => button.children === "保存旅報立替并提交").onClick({ currentTarget: { value: "trip" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[1].category, "trip");
  assert.equal(calls[1].expectedVersion, 0);
  assert.deepEqual(calls[1].expenses, [tripExpense]);
  assert.equal(h.states[2].trips[0].claims.length, 2);
  h.render();
  h.buttons.find(button => button.children === "保存超時并提交").onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[2].category, "overtime");
  assert.equal(calls[2].expenses.length, 0);
  assert.equal(calls[2].overtimeHours, 1.5);
});
test("admin review separates notes, requests, and state updates by category on the same assignment", async () => {
  const rows = ["company", "trip"].map(category => ({ driverName: "Synthetic", date: "2026-10-27",
    pickup: "", destination: "", claim: { ...claim, category,
      expenses: [{ ...expense, type: category }] } }));
  const states = ["2026-10", rows, "", "", false,
  { [`${id}-company`]: "Company note", [`${id}-trip`]: "Trip note" }, 0, "", []];
  const buttons = [], calls = [];
  let cursor = 0;
  const runtime = require("react/jsx-runtime");
  const capture = original => (type, props, ...rest) => {
    if (type === "button") buttons.push(props);
    return original(type, props, ...rest);
  };
  const Component = load("app/driver-finance-review/review.tsx", {
    react: { ...React, useEffect() {}, useRef: value => ({ current: value }),
      useState() { const i = cursor++; return [states[i],
        value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/lib/driver/finance": finance, "@/lib/driver/fuel": fuel, "@/lib/driver/orders": {}, "@/lib/supabase/browser": {},
  }, { window: { confirm: () => true }, fetch: async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    return Response.json({ claim: { ...claim, status: "approved", version: 2 } });
  } }).default;
  renderToStaticMarkup(React.createElement(Component));
  buttons.filter(button => button.children === "确认并入账")[0].onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].category, "company");
  assert.equal(calls[0].note, "Company note");
  assert.equal(states[1][0].claim.status, "approved");
  assert.equal(states[1][1].claim.status, "pending");
});
test("pending, approved and rejected claims remain editable with save and receipt controls", () => {
  for (const status of ["pending", "approved", "rejected"]) {
    const { html } = renderFinance({ status });
    assert.equal(html.includes('<fieldset disabled=""'), false);
    for (const label of ["保存社報立替并提交", "保存旅報立替并提交", "保存超時并提交", "保存燃油費并提交", "削除此明細"]) {
      assert.ok(html.includes(label), `${status}: ${label}`);
    }
  }
});

test("correction schemas permit clearing existing advances/fuel but not empty initial submissions", () => {
  assert.equal(finance.financeSubmissionSchema.safeParse({ ...command, expectedVersion: 2, expenses: [] }).success, true);
  assert.equal(finance.financeSubmissionSchema.safeParse({ ...command, expenses: [] }).success, false);
  assert.equal(fuel.fuelSubmissionSchema.safeParse({ ...fuelCommand, expectedVersion: 2, amount: 0 }).success, true);
  assert.equal(fuel.fuelSubmissionSchema.safeParse({ ...fuelCommand, amount: 0 }).success, false);
  assert.equal(fuel.fuelClaimSchema.safeParse({ ...fuelClaim, amount: 0 }).success, true);
});

test("approved finance corrections send the latest version and preserve the other category's draft", async () => {
  const calls = [];
  const h = renderFinance({ status: "approved", fetch: async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    return Response.json({ claim: { ...claim, expenses: body.expenses, status: "approved", version: 4 } });
  } });
  const tripDraft = { ...expense, id: id.replace(/1$/, "3"), type: "trip", amount: 800 };
  h.states[4] = [tripDraft];
  h.render();
  h.buttons.find(button => button.children === "保存社報立替并提交").onClick({ currentTarget: { value: "company" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].expectedVersion, 1);
  assert.deepEqual(calls[0].expenses, []);
  assert.equal(h.states[2].trips[0].claims.find(item => item.category === "company").version, 4);
  assert.equal(h.states[4][0], tripDraft);
  assert.match(h.render(), /已保存并更新訂単当天财务/);
});

test("saved corrections refresh server-calculated wages without losing other drafts or offering duplicate approval on refresh failure", async () => {
  for (const fail of [false, true]) {
    const h = renderFinance({ status: "approved", fetch: async () => Response.json({
      claim: { ...claim, status: "approved", version: 3 },
    }), refresh: () => fail ? Response.json({ error: "Read failed" }, { status: 503 })
      : Response.json({ ...data, wages: [{ ...data.wages[0], advances: 500 }] }) });
    const draft = { ...expense, id: id.replace(/1$/, "4"), type: "trip", amount: 200 };
    h.states[4].push(draft);
    h.render();
    h.buttons.find(button => button.children === "保存社報立替并提交").onClick({ currentTarget: { value: "company" } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.states[2].trips[0].claims[0].version, 3);
    assert.equal(h.states[4].at(-1), draft);
    if (fail) assert.match(h.render(), /费用已保存，但月工資汇总刷新失败/);
    else assert.equal(h.states[2].wages[0].advances, 500);
  }
});
test("wheel scrolling monetary and overtime inputs blurs without changing values", () => {
  const h = renderFinance();
  for (const input of h.inputs.filter(input => input.type === "number")) {
    let blurred = false;
    input.onWheel({ currentTarget: { blur() { blurred = true; } } });
    assert.equal(blurred, true);
  }
  assert.equal(h.states[4][0].amount, 1500);
  assert.equal(h.states[5], "1.5");
});
test("receipt upload enforces five photos and 5MB, preserves the file selection snapshot", async () => {
  for (const files of [[{ type: "image/svg+xml", size: 10 }], [{ type: "image/jpeg", size: 5242881 }],
    Array(6).fill({ type: "image/jpeg", size: 100 })]) {
    const h = renderFinance();
    h.inputs.find(input => input.type === "file").onChange({ target: { files, value: "fake" } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.uploads.length, 0);
    assert.ok(h.states[8].length > 0);
  }
  const h = renderFinance();
  const files = [{ type: "image/jpeg", size: 5242880 }, { type: "image/png", size: 100 }];
  const target = { files, value: "fake" };
  h.inputs.find(input => input.type === "file").onChange({ target });
  files.length = 0;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(target.value, "");
  assert.equal(h.uploads.length, 2);
  assert.equal(h.states[4][0].receipts.length, 2);
  for (const upload of h.uploads) {
    assert.equal(upload.bucket, "driver-finance-receipts");
    assert.ok(upload.path.startsWith(`${id}/${id}/company/`));
    assert.equal(upload.options.upsert, false);
  }
});
test("fuel photos upload to a private daily path rather than an advance/order path", async () => {
  const h = renderFinance();
  const fileInputs = h.inputs.filter(input => input.type === "file");
  fileInputs.at(-1).onChange({ target: { files: [{ type: "image/jpeg", size: 100 }], value: "fake" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].bucket, "driver-fuel-receipts");
  assert.ok(h.uploads[0].path.startsWith(`${id}/2026-10-27/`));
  assert.equal(h.states[14].length, 1);
});
test("late finance submit cannot repopulate private state after page hides", async () => {
  let resolveSubmit;
  const pendingResponse = new Promise(resolve => { resolveSubmit = resolve; });
  const h = renderFinance({ withEffects: true, fetch: async (_url, init) => init?.method === "POST"
    ? pendingResponse : Response.json(data) });
  const cleanup = h.effects[0]();
  const submit = h.buttons.find(button => button.children === "保存社報立替并提交");
  assert.ok(submit);
  const work = submit.onClick({ currentTarget: { value: "company" } });
  // The actual handler returns void from the button; let the async request reach its await.
  await Promise.resolve();
  h.events.auth("SIGNED_OUT");
  resolveSubmit(Response.json({ claim }));
  await work;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.states[2], null);
  assert.equal(h.states[4].length, 0);
  assert.equal(h.states[11], "");
  cleanup();
});
test("native photo picker preserves the draft but never bypasses logout clearing", () => {
  const h = renderFinance({ withEffects: true, fetch: () => new Promise(() => {}) });
  const cleanup = h.effects[0]();
  h.inputs.find(input => input.type === "file").onClick();
  h.document.visibilityState = "hidden";
  h.events.visibilitychange();
  assert.equal(h.states[4].length, 1);
  assert.ok(h.states[2]);
  h.events.auth("SIGNED_OUT");
  assert.equal(h.states[4].length, 0);
  assert.equal(h.states[2], null);
  cleanup();
});
