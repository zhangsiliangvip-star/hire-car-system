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
const data = { fuelClaims: [], trips: [{ assignmentId: id, date: "2026-10-27", pickup: "Synthetic pickup",
  destination: "Synthetic destination", existingOvertimeHours: 0, claims: [] }],
  wages: [{ date: "2026-10-27", base: 10000, bonus: 500, overtime: 3000, advances: 1500 }],
  manualItems: [{ name: "Synthetic adjustment", amount: -500 }] };
const command = { assignmentId: id, category: "company", expectedVersion: 0, requestId: id, expenses: [expense], overtimeHours: 0 };
const fuelClaim = { id, assignmentId: id, date: "2026-10-27", version: 1, status: "pending",
  amount: 6000, receipts: [], reviewNote: "" };
const fuelCommand = { assignmentId: id, date: "2026-10-27", expectedVersion: 0, requestId: id,
  amount: 6000, receipts: [] };
function handler({ admin = false, dailyFuel = false, denied = 0, testMode = true, role = "admin",
  result = data, historical = { trips: [] }, error = null } = {}) {
  const calls = [];
  const supabase = { rpc: async (name, args) => {
    calls.push({ name, args }); return { data: ["driver_daily_fuel_data", "admin_driver_daily_fuel"].includes(name) ? [] :
      name === "driver_historical_finance_data" ? historical :
      name === "driver_finance_data" && result ? Object.fromEntries(Object.entries(result).filter(([key]) => key !== "fuelClaims")) : result, error };
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
    "driver_finance_data", "driver_daily_fuel_data", "driver_historical_finance_data"]);
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
function renderFinance({ status = null, withEffects = false, fetch: fetchMock, view = "claims", confirm = () => true } = {}) {
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
  }, { fetch: fetchMock, AbortController,
    document,
    window: { confirm }, location: { replace() {} } }).default;
  function render() {
    cursor = 0; refCursor = 0; buttons.length = 0; inputs.length = 0;
    return renderToStaticMarkup(React.createElement(Component));
  }
  const html = render();
  return { html, states, effects, events, buttons, inputs, document, uploads, render };
}
test("mobile finance renders both categories, all-order daily totals and complete monthly wages", () => {
  const { html } = renderFinance();
  for (const text of ["社報", "旅報", "¥1,500", "¥2,000", "最多5张", 'multiple=""', "刷新财务"])
    assert.ok(html.includes(text), text);
  const wages = renderFinance({ view: "wages" }).html;
  for (const text of ["¥14,500", "Synthetic adjustment", "本月工資"]) assert.ok(wages.includes(text), text);
  if (process.env.DRIVER_FINANCE_LAYOUT_FILE) {
    const css = ["app/driver/driver.css", "app/driver/finance/finance.css"].map(path =>
      readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8")).join("\n");
    writeFileSync(process.env.DRIVER_FINANCE_LAYOUT_FILE,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}${css}</style><div class="driver-app">${html}</div>`);
  }
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
  assert.equal(h.buttons.some(button => button.children === "保存燃油費并提交"), false);
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
  assert.ok(companyCard.includes('<fieldset disabled=""'));
  assert.equal(tripCard.includes('<fieldset disabled=""'), false);
  assert.equal(h.buttons.some(button => button.children === "保存社報立替并提交"), false);
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
test("pending and approved claims cannot be edited or submitted; rejected claims can", () => {
  for (const status of ["pending", "approved", "rejected"]) {
    const { html } = renderFinance({ status });
    assert.equal(html.includes('<fieldset disabled=""'), status !== "rejected");
    assert.equal(html.includes("保存社報立替并提交"), status === "rejected");
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
