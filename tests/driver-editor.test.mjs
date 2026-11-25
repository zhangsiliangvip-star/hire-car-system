import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
function load(relative, mocks = {}, globals = {}) {
  const filename = path.join(root, relative);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, { module: compiled, exports: compiled.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    Request, Response, Headers, URL, URLSearchParams, AbortController, Error, process, console: { error() {} }, ...globals,
  });
  return compiled.exports;
}
const bank = load("lib\\driver-bank.ts");
const address = load("lib\\driver-address.ts");
const selection = load("lib\\driver-selection.ts", { "@/lib/order-drivers": { getServiceDriver: () => "" } });
const shifts = load("lib\\driver\\shifts.ts");
const { jsonResponse } = load("lib\\api-response.ts");
const driverId = "c6000000-0000-4000-8000-000000000001";
const requestId = "c6000000-0000-4000-8000-000000000002";
const data = { month: "2026-11", version: 3, dates: ["2026-11-02"], attendanceDates: [], note: "Shared note" };
const command = { driverId, shift: { month: data.month, dates: data.dates, attendanceDates: data.attendanceDates,
  note: data.note, expectedVersion: 3, requestId } };
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const postal = load("lib\\postal-address.ts");
const client = load("lib\\api-client.ts");
const { formatDriverPhone } = load("lib\\driver-phone.ts");

test("driver mobile numbers format eleven digits immediately without altering partial or international input", () => {
  for (const [input, expected] of [["09012345678", "090-1234-5678"], ["０８０１２３４５６７８", "080-1234-5678"],
    ["090-1234-5678", "090-1234-5678"], ["090123", "090123"], ["+81 90 1234 5678", "+81 90 1234 5678"], ["", ""]])
    assert.equal(formatDriverPhone(input), expected);
  const page = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(page, /phone: formatDriverPhone\(event.target.value\)/);
});

test("company selector searches scoped names, selects and closes, supports manual values and clearing without automatic saves", () => {
  const states = [], selected = [];
  let index = 0;
  const hooks = { useState: initial => {
    const key = index++;
    if (!(key in states)) states[key] = initial;
    return [states[key], value => { states[key] = value; }];
  }, useRef: current => ({ current }), useEffect() {} };
  const { DriverCompanySelect } = load("components\\driver-company-select.tsx", { react: hooks });
  const props = { value: "Alpha", companies: ["Beta", "Alpha", "Alpha"], onChange: name => selected.push(name) };
  function render() { index = 0; return DriverCompanySelect(props); }
  const initial = render();
  assert.equal(initial.props.children[1].props["aria-expanded"], false);
  initial.props.children[1].props.onClick();
  let picker = render();
  const Dialog = picker.props.children[2].type;
  function dialog() { index = 1; return Dialog(picker.props.children[2].props).props.children; }
  let panel = dialog();
  assert.equal(panel.props.children[2].props.type, "search");
  assert.equal(panel.props.children[2].props.autoComplete, "off");
  assert.equal(panel.props.children[5].props.children[0].props.autoComplete, "off");
  assert.equal(panel.props.children[0].props.children[0].props.children[1].props.tabIndex, -1);
  if (process.env.DRIVER_COMPANY_LAYOUT_FILE) {
    const cssDir = path.join(root, ".next\\static\\chunks");
    const css = readdirSync(cssDir).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(cssDir, file), "utf8")).join("\n");
    writeFileSync(process.env.DRIVER_COMPANY_LAYOUT_FILE, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div class="fixed inset-0 flex items-center justify-center bg-slate-950/50 p-4">${renderToStaticMarkup(panel)}</div>`);
  }
  assert.equal(panel.props.children[3].props.children.length, 2);
  panel.props.children[2].props.onChange({ target: { value: "bet" } });
  panel = dialog();
  assert.equal(panel.props.children[3].props.children.length, 1);
  panel.props.children[3].props.children[0].props.onClick();
  assert.deepEqual(selected, ["Beta"]);
  assert.equal(render().props.children[1].props["aria-expanded"], false);
  render().props.children[1].props.onClick(); picker = render();
  states[1] = ""; states[2] = "";
  panel = dialog();
  panel.props.children[5].props.children[0].props.onChange({ target: { value: " Manual " } });
  dialog().props.children[5].props.children[1].props.onClick();
  assert.deepEqual(selected, ["Beta", "Manual"]);
  render().props.children[1].props.onClick(); picker = render();
  dialog().props.children[6].props.onClick();
  assert.deepEqual(selected, ["Beta", "Manual", ""]);
  const page = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(page, /allCompanyRecords.filter\(company => company.regionId ===/);
  assert.match(page, /editingDriverId \? allDriverRecords.find\(driver => driver.id === editingDriverId\)\?\.regionId/);
});

test("postal datasets resolve prefectures and preserve leading zeros without executing scripts", () => {
  const source = '$yubin({"1000001":["13","千代田区","千代田"],"0010001":["1","札幌市北区","北一条"]});';
  assert.equal(postal.readPostalAddress(source, "1000001"), "東京都千代田区千代田");
  assert.equal(postal.readPostalAddress(source, "0010001"), "北海道札幌市北区北一条");
  assert.equal(postal.readPostalAddress(source, "9999999"), null);
  assert.equal(postal.readPostalAddress('$yubin({"1006173":["13","千代田区","永田町","２丁目１１－１山王パークタワー"]});', "1006173"),
    "東京都千代田区永田町２丁目１１－１山王パークタワー");
  for (const invalid of ['alert("bad")', '$yubin({"1000001":["48","Town",""]});',
    '$yubin({"1000001":["13","Town"]});', `${source}alert("bad");`])
    assert.throws(() => postal.readPostalAddress(invalid, "1000001"));
});

function postalApi({ profile = true, status = 200, source = '$yubin({"1000001":["13","千代田区","千代田"]});', fail = false } = {}) {
  const calls = [];
  return { calls, ...load("app\\api\\postal-address\\route.ts", {
    "@/lib/api-response": { jsonResponse }, "@/lib/driver-address": address, "@/lib/postal-address": postal,
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ profile: profile ? { role: "admin" } : null }) },
  }, { AbortSignal, fetch: async (url, options) => {
    calls.push({ url, options });
    if (fail) throw new Error("offline");
    return new Response(source, { status });
  } }) };
}
const postalRequest = code => new Request(`https://staff.example/api/postal-address?postalCode=${encodeURIComponent(code)}`);
test("postal lookup requires staff and valid codes before external requests", async () => {
  const denied = postalApi({ profile: false });
  assert.equal((await denied.GET(postalRequest("1000001"))).status, 403);
  assert.equal(denied.calls.length, 0);
  for (const value of ["", "123", "../100", "12345678"]) {
    const api = postalApi();
    assert.equal((await api.GET(postalRequest(value))).status, 400);
    assert.equal(api.calls.length, 0);
  }
});
test("postal lookup normalizes full-width input and sends only the prefix to the provider", async () => {
  const api = postalApi();
  const response = await api.GET(postalRequest("〒１００－０００１"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { postalCode: "100-0001", address: "東京都千代田区千代田" });
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(api.calls[0].url, "https://yubinbango.github.io/yubinbango-data/data/100.js");
  assert.equal(api.calls[0].options.next.revalidate, 86400);
});
test("postal lookup reports unknown codes, provider outages and invalid data explicitly", async () => {
  for (const [options, status] of [[{ status: 404 }, 404], [{ source: "$yubin({});" }, 404],
    [{ status: 500 }, 503], [{ fail: true }, 503], [{ source: "invalid" }, 503]]) {
    const response = await postalApi(options).GET(postalRequest("1000001"));
    assert.equal(response.status, status);
    assert.ok((await response.json()).error);
  }
});
function postalEditor({ existing = "", confirm = true, fetchImpl } = {}) {
  const messages = [], applied = [], changed = [], timers = [], cleanups = [], requests = [];
  const hooks = { useState: initial => [initial, value => messages.push(value)], useRef: current => ({ current }),
    useEffect: effect => cleanups.push(effect()) };
  const Component = load("components\\driver-postal-code.tsx", {
    react: hooks, "@/lib/driver-address": address, "@/lib/api-client": client,
  }, { setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; },
    window: { confirm: () => confirm }, fetch: async (url, options) => {
      requests.push(options);
      return fetchImpl ? fetchImpl(url, options) : Response.json({ postalCode: "100-0001", address: "東京都千代田区千代田" });
    } }).DriverPostalCode;
  const tree = Component({ value: "1000001", address: existing,
    onChange: value => changed.push(value), onAddress: (...args) => applied.push(args) });
  const input = tree.props.children[0].props.children[1];
  const search = tree.props.children[1];
  return { messages, applied, changed, timers, cleanups, requests,
    type: value => input.props.onChange({ target: { value } }), search: () => search.props.onClick() };
}
test("postal editor debounces complete input, rejects incomplete codes and fills the address", async () => {
  const h = postalEditor();
  h.type("100"); assert.equal(h.timers.length, 0);
  h.type("1000001"); h.type("100-0001");
  assert.deepEqual(h.changed, ["100", "100-0001", "100-0001"]);
  assert.equal(h.timers[0], null); h.timers[1]();
  await tick();
  assert.deepEqual(plain(h.applied), [["100-0001", "東京都千代田区千代田", ""]]);
  assert.equal(h.requests.length, 1);
  assert.match(h.messages.at(-1), /番地/);
});
test("postal editor immediately formats seven digits, preserves leading zeros and allows partial edits", () => {
  const h = postalEditor();
  for (const value of ["0010010", "００１００１０", "001001", "001-", "", "bad"])
    h.type(value);
  assert.deepEqual(h.changed, ["001-0010", "001-0010", "001001", "001-", "", "bad"]);
});
test("postal editor preserves matching building details and confirms other address replacements", async () => {
  for (const [existing, confirm, applied] of [["東京都千代田区千代田1-2 Building", true, 0],
    ["Existing address", false, 0], ["Existing address", true, 1]]) {
    const h = postalEditor({ existing, confirm });
    h.search(); await tick();
    assert.equal(h.applied.length, applied);
  }
});
test("postal editor suppresses stale and unmounted responses and supports explicit retry after failure", async () => {
  for (const stop of [h => h.type("100"), h => h.cleanups[0]()]) {
    let resolve;
    const h = postalEditor({ fetchImpl: () => new Promise(done => { resolve = done; }) });
    h.search(); stop(h);
    assert.equal(h.requests[0].signal.aborted, true);
    resolve(Response.json({ postalCode: "100-0001", address: "東京都千代田区千代田" }));
    await tick(); assert.equal(h.applied.length, 0);
  }
  let count = 0;
  const h = postalEditor({ fetchImpl: async () => ++count === 1
    ? Response.json({ error: "未找到对应地址" }, { status: 404 })
    : Response.json({ postalCode: "100-0001", address: "東京都千代田区千代田" }) });
  h.search(); await tick(); assert.ok(h.messages.includes("未找到对应地址"));
  h.search(); await tick(); assert.equal(h.applied.length, 1);
});

test("driver bank fields preserve leading zeros, optional legacy records and reject invalid input", () => {
  assert.deepEqual(plain(bank.driverBankSchema.parse({})), {
    bankName: "", bankBranch: "", bankAccountType: "", bankAccountNumber: "", bankAccountHolder: "",
  });
  assert.equal(bank.driverBankSchema.parse({ bankAccountNumber: " 0012345 " }).bankAccountNumber, "0012345");
  assert.equal(bank.driverBankSchema.parse({ bankName: " Test Bank " }).bankName, "Test Bank");
  for (const patch of [{ bankAccountNumber: "１２３" }, { bankAccountNumber: 123 },
    { bankAccountNumber: "-123" }, { bankAccountNumber: "1".repeat(21) }, { bankAccountType: "Other" },
    { bankAccountHolder: "x".repeat(201) }])
    assert.equal(bank.driverBankSchema.safeParse(patch).success, false);
});

test("bank details round-trip between dashboard records and database rows", () => {
  const source = readFileSync(path.join(root, "app\\api\\data\\route.ts"), "utf8");
  const readStart = source.indexOf("function toDriver("), writeStart = source.indexOf("function toDriverRow(");
  const context = { toLastOperation: () => undefined, ...address };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(
    source.slice(readStart, source.indexOf("function toVehicle(", readStart)) +
    source.slice(writeStart, source.indexOf("function toVehicleRow(", writeStart)),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const original = { id: driverId, regionId: requestId, name: "Test", reading: "", phone: "", wechat: "", whatsapp: "",
    address: "Synthetic address 1-2-3", postalCode: "001-2345", companyName: "Synthetic Driver Company", employmentStatus: "在職",
    employmentType: "常勤", licenseExpiry: "", personalSlogan: "", bankName: "Bank", bankBranch: "Branch",
    bankAccountType: "普通", bankAccountNumber: "0012345", bankAccountHolder: "テスト" };
  assert.deepEqual(plain(context.toDriver(context.toDriverRow(original))), original);
  const legacy = { ...original };
  delete legacy.address; delete legacy.companyName; delete legacy.postalCode;
  assert.deepEqual(plain(context.toDriver(context.toDriverRow(legacy))), { ...legacy, address: "", companyName: "", postalCode: "" });
  const combined = { ...original, address: "〒001-2345 Synthetic address", postalCode: "" };
  const saved = context.toDriverRow(combined);
  assert.equal(saved.postal_code, "001-2345");
  assert.equal(saved.address, "Synthetic address");
  for (const employmentStatus of ["在職", "休暇", "離職"])
    assert.equal(context.toDriver(context.toDriverRow({ ...original, employmentStatus })).employmentStatus, employmentStatus);
  assert.equal(context.toDriver(context.toDriverRow({ ...original, employmentType: "非常勤" })).employmentType, "非常勤");
  const legacyDriver = context.toDriver(context.toDriverRow({ ...original, employmentType: undefined }));
  assert.equal(legacyDriver.employmentType, "常勤");
});

test("postal codes normalize and legacy address prefixes split without losing address text", () => {
  for (const value of ["0012345", "001-2345", " 〒００１－２３４５ "])
    assert.equal(address.driverPostalCodeSchema.parse(value), "001-2345");
  for (const value of ["123", "1234-567", "abc", "12345678", null, 1234567])
    assert.equal(address.driverPostalCodeSchema.safeParse(value).success, false);
  assert.equal(address.driverPostalCodeSchema.parse(undefined), "");
  for (const value of ["〒001-2345 Synthetic address", "００１－２３４５　Synthetic address", "0012345 Synthetic address"])
    assert.deepEqual(plain(address.splitDriverAddress(value)), { postalCode: "001-2345", address: "Synthetic address" });
  assert.deepEqual(plain(address.splitDriverAddress("Synthetic address 123-4567")), { postalCode: "", address: "Synthetic address 123-4567" });
  assert.deepEqual(plain(address.splitDriverAddress("〒001-2345 Original", "999-9999")),
    { postalCode: "999-9999", address: "〒001-2345 Original" });
});

test("driver API validates optional address and company lengths and trims input", () => {
  const source = readFileSync(path.join(root, "app\\api\\data\\route.ts"), "utf8");
  const block = source.slice(source.indexOf("const driverSchema ="), source.indexOf("const vehicleSchema ="));
  const z = require("zod").z;
  const context = { z, idSchema: z.string().uuid(), dateSchema: z.iso.date(), driverBankSchema: bank.driverBankSchema, ...address };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`${block}\nglobalThis.schema = driverSchema;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const base = { id: driverId, regionId: requestId, name: "Synthetic", phone: "", wechat: "", whatsapp: "", licenseExpiry: "" };
  const parsed = context.schema.parse({ ...base, address: "  Synthetic address  ", companyName: " Synthetic company " });
  assert.equal(parsed.address, "Synthetic address"); assert.equal(parsed.companyName, "Synthetic company");
  assert.equal(context.schema.parse(base).address, ""); assert.equal(context.schema.parse(base).companyName, "");
  assert.equal(context.schema.parse(base).employmentStatus, "在職");
  assert.equal(context.schema.parse(base).employmentType, "常勤");
  assert.equal(context.schema.parse({ ...base, employmentType: "非常勤" }).employmentType, "非常勤");
  assert.equal(context.schema.safeParse({ ...base, employmentType: "contract" }).success, false);
  assert.equal(context.schema.safeParse({ ...base, showInSchedule: false }).success, false);
  for (const employmentStatus of ["在職", "休暇", "離職"])
    assert.equal(context.schema.parse({ ...base, employmentStatus }).employmentStatus, employmentStatus);
  assert.equal(context.schema.safeParse({ ...base, employmentStatus: "invalid" }).success, false);
  assert.equal(context.schema.parse({ ...base, postalCode: "0012345" }).postalCode, "001-2345");
  assert.equal(context.schema.safeParse({ ...base, postalCode: "invalid" }).success, false);
  for (const patch of [{ address: "x".repeat(1001) }, { companyName: "x".repeat(201) }, { address: 123 }, { companyName: null }])
    assert.equal(context.schema.safeParse({ ...base, ...patch }).success, false);
  assert.equal(context.schema.safeParse({ ...base, address: "x".repeat(1000), companyName: "x".repeat(200) }).success, true);
});

test("driver editor initializes, saves and reloads address and company without changing outer list columns", async () => {
  const source = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("function openNewDriver()");
  const end = source.indexOf("async function saveDriverGlobalSlogan(", start);
  const context = {
    emptyDriverBank: bank.emptyDriverBank, driverBankSchema: bank.driverBankSchema, ...address,
    requireSpecificRegionForNewData: () => true, getRegionForNewRecords: () => requestId,
    dialogSavingRef: { current: false }, driverRestState: { busy: false, dirty: false },
    allDriverRecords: [], driverRecords: [], editingDriverId: null, editingDriverName: null,
    setEditingDriverId: value => { context.editingDriverId = value; },
    setEditingDriverName: value => { context.editingDriverName = value; },
    setDriverRestState: value => { context.driverRestState = value; },
    setDriverForm: value => { context.driverForm = value; }, setShowDriverForm() {},
    setDriverRecords: update => { context.driverRecords = update(context.driverRecords).map(driver => ({ ...driver, regionId: requestId }));
      context.allDriverRecords = context.driverRecords; },
    createId: () => driverId, waitForDrivers: async () => true,
    finishDialogSave: async pending => (await Promise.all(pending)).every(Boolean),
    alert: message => { throw new Error(message); },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source.slice(start, end),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  context.openNewDriver();
  assert.equal(context.driverForm.address, ""); assert.equal(context.driverForm.companyName, "");
  assert.equal(context.driverForm.postalCode, "");
  assert.equal(context.driverForm.employmentStatus, "在職");
  assert.equal(context.driverForm.employmentType, "常勤");
  Object.assign(context.driverForm, { name: "Synthetic", address: "〒001-2345 Synthetic address ", companyName: " Synthetic company " });
  await context.saveDriver();
  assert.equal(context.driverRecords[0].address, "Synthetic address");
  assert.equal(context.driverRecords[0].postalCode, "001-2345");
  assert.equal(context.driverRecords[0].companyName, "Synthetic company");
  context.openEditDriver(context.driverRecords[0]);
  assert.equal(context.driverForm.address, "Synthetic address");
  assert.equal(context.driverForm.postalCode, "001-2345");
  assert.equal(context.driverForm.companyName, "Synthetic company");
  context.driverForm.employmentType = "非常勤";
  await context.saveDriver();
  assert.equal(context.driverRecords[0].employmentType, "非常勤");
  context.openEditDriver(context.driverRecords[0]);
  assert.equal(context.driverForm.employmentType, "非常勤");
  context.driverForm.employmentType = "常勤";
  Object.assign(context.driverForm, { address: "", companyName: "", postalCode: "" });
  await context.saveDriver();
  assert.equal(context.driverRecords[0].address, ""); assert.equal(context.driverRecords[0].companyName, "");
  assert.equal(context.driverRecords[0].postalCode, "");
  for (const employmentStatus of ["離職", "休暇", "在職"]) {
    context.driverForm.employmentStatus = employmentStatus;
    await context.saveDriver();
    assert.equal(context.driverRecords[0].employmentStatus, employmentStatus);
    context.openEditDriver(context.driverRecords[0]);
    assert.equal(context.driverForm.employmentStatus, employmentStatus);
  }
  const tableStart = source.indexOf('data-table="drivers"');
  assert.ok(tableStart > 0);
  const list = source.slice(tableStart, source.indexOf("</table>", tableStart));
  assert.doesNotMatch(list, /住所先|所属会社|郵便番号|driver\.address|driver\.companyName|driver\.postalCode/);
});

test("schedule filters part-time drivers and ignores legacy hidden flags", () => {
  const drivers = [
    { id: "visible", name: "Visible" },
    { id: "legacy", name: "Legacy" },
    { id: "previously-hidden", name: "Previously hidden", showInSchedule: false },
    { id: "part-time", name: "Part-time", employmentType: "非常勤" },
  ];
  assert.deepEqual(
    plain(selection.filterScheduleDrivers(drivers).map(driver => driver.id)),
    ["visible", "legacy", "previously-hidden"],
  );
  assert.deepEqual(
    plain(selection.filterDriversByEmploymentType(drivers, "常勤").map(driver => driver.id)),
    ["visible", "legacy", "previously-hidden"],
  );
  assert.deepEqual(
    plain(selection.filterDriversByEmploymentType(drivers, "非常勤").map(driver => driver.id)),
    ["part-time"],
  );
});

test("manual driver records default to full-time and order-only names default to part-time", () => {
  const source = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("const unregisteredDriverNames =");
  const end = source.indexOf("const visibleDriverRows =", start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /employmentType: "非常勤" as const/);
  const newDriverStart = source.indexOf("function openNewDriver()");
  const newDriverEnd = source.indexOf("function openEditDriver(", newDriverStart);
  assert.match(source.slice(newDriverStart, newDriverEnd), /employmentType: "常勤"/);
});

test("driver save guards unsaved rests and invalid bank details without issuing writes", () => {
  const source = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("function saveDriver()");
  const block = source.slice(start, source.indexOf("async function saveDriverGlobalSlogan(", start));
  const alerts = [];
  const context = {
    dialogSavingRef: { current: false }, driverRestState: { busy: false, dirty: true },
    editingDriverId: null, requireSpecificRegionForNewData: () => true, getRegionForNewRecords: () => requestId,
    driverBankSchema: bank.driverBankSchema, driverForm: { bankAccountNumber: "invalid" },
    alert: message => alerts.push(message),
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  context.saveDriver(); assert.match(alerts.at(-1), /保存本月シフト希望/);
  context.driverRestState.dirty = false;
  context.saveDriver(); assert.match(alerts.at(-1), /半角数字/);
  context.driverRestState.busy = true;
  context.saveDriver(); assert.equal(alerts.length, 2);
});

function api({ profile = true, result = data, error = null } = {}) {
  const calls = [];
  const route = load("app\\api\\driver-shifts\\route.ts", {
    "@/lib/api-response": { jsonResponse }, "@/lib/driver/shifts": shifts,
    "@/lib/driver/assignment-action": { isDriverActionOrigin: req => req.headers.get("origin") === new URL(req.url).origin },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ profile: profile ? { role: "user" } : null,
      supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data: result, error }; } } }) },
  });
  return { ...route, calls };
}
function post(body = command, origin = "https://staff.example", type = "application/json") {
  return new Request("https://staff.example/api/driver-shifts", {
    method: "POST", headers: { origin, "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
test("staff shifts require staff identity and strict driver/month query", async () => {
  const denied = api({ profile: false });
  assert.equal((await denied.GET(new Request(`https://staff.example/api/driver-shifts?driverId=${driverId}&month=2026-11`))).status, 403);
  assert.equal((await denied.POST(post())).status, 403);
  assert.equal(denied.calls.length, 0);
  for (const query of ["driverId=invalid&month=2026-11", `driverId=${driverId}&month=2026-13`,
    `driverId=${driverId}&month=2026-11&regionId=${requestId}`]) {
    const h = api();
    assert.equal((await h.GET(new Request(`https://staff.example/api/driver-shifts?${query}`))).status, 400);
    assert.equal(h.calls.length, 0);
  }
});
test("staff reads and writes forward driver, monthly version, note and idempotency key", async () => {
  const h = api();
  const response = await h.GET(new Request(`https://staff.example/api/driver-shifts?driverId=${driverId}&month=2026-11`));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await response.json(), data);
  assert.equal((await h.POST(post())).status, 200);
  assert.deepEqual(plain(h.calls), [
    { name: "staff_driver_monthly_shift_v2", args: { target_driver: driverId, target_month: data.month } },
    { name: "staff_submit_driver_monthly_shift_v2", args: { target_driver: driverId, target_month: data.month,
      expected_version: 3, target_request: requestId, rest_dates: data.dates,
      attendance_dates: data.attendanceDates, note: data.note } },
  ]);
});
test("staff writes reject foreign origins, oversized/non-JSON and invalid dates without writes", async () => {
  for (const [request, status] of [[post(command, "https://other.example"), 403], [post(command, undefined, "text/plain"), 415],
    [post("x".repeat(8193)), 413], [post("{"), 400], [post({ ...command, regionId: requestId }), 400],
    [post({ ...command, shift: { ...command.shift, dates: ["2026-12-01"] } }), 400],
    [post({ ...command, shift: { ...command.shift, dates: ["2026-11-02", "2026-11-02"] } }), 400]]) {
    const h = api(); assert.equal((await h.POST(request)).status, status); assert.equal(h.calls.length, 0);
  }
});
test("staff conflicts, permissions, missing migrations and malformed responses remain errors", async () => {
  for (const [code, status] of [["40001", 409], ["42501", 403], ["22023", 422], ["PGRST202", 503], ["XX000", 503]]) {
    const h = api({ error: { code } });
    const response = await h.POST(post()); assert.equal(response.status, status);
    assert.ok((await response.json()).error);
    assert.equal((await h.GET(new Request(`https://staff.example/api/driver-shifts?driverId=${driverId}&month=2026-11`))).status, status);
  }
  assert.equal((await api({ result: null }).POST(post())).status, 503);
});

function editor({ saved = data, fetch: fetchMock = async () => Response.json(data), confirm = () => true } = {}) {
  const states = [data.month, saved, saved?.dates ?? [], saved?.note ?? "", !saved, false, "", "", 0,
    saved?.attendanceDates ?? []];
  const refs = [], effects = [], buttons = [], inputs = [], reported = [];
  let cursor = 0, refCursor = 0;
  const runtime = require("react/jsx-runtime");
  const capture = original => (type, props, ...rest) => {
    if (type === "button") buttons.push(props);
    if (type === "input" || type === "textarea") inputs.push(props);
    return original(type, props, ...rest);
  };
  const Component = load("components\\driver-rest-editor.tsx", {
    react: { ...React, useEffect(fn) { effects.push(fn); },
      useRef(value) { const i = refCursor++; return refs[i] ||= { current: value }; },
      useState(value) { const i = cursor++; if (i >= states.length) states[i] = typeof value === "function" ? value() : value;
        return [states[i], value => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "react/jsx-runtime": { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) },
    "@/lib/driver/shifts": shifts,
    "@/lib/driver/orders": { japanDate: () => "2026-11-12", createDriverRequestId: () => requestId },
  }, { fetch: fetchMock, window: { confirm } }).DriverRestEditor;
  const onStateChange = value => reported.push(plain(value));
  function tree() { cursor = 0; refCursor = 0; buttons.length = 0; inputs.length = 0; effects.length = 0;
    return Component({ driverId, onStateChange }); }
  function render() { return renderToStaticMarkup(tree()); }
  return { html: render(), render, tree, states, effects, buttons, inputs, reported };
}
test("staff calendar multi-selects dates, loads the saved month and reports unsaved changes", async () => {
  const calls = [];
  const h = editor({ saved: null, fetch: async url => { calls.push(url); return Response.json(data); } });
  h.effects[1](); await tick(); h.render();
  assert.match(calls[0], new RegExp(`driverId=${driverId}&month=2026-11`));
  assert.match(h.render(), /aria-label="2026-11-02 希望休" aria-pressed="true"/);
  assert.equal(h.buttons.filter(button => button["aria-label"]?.startsWith("2026-11-")).length, 30);
  h.buttons.find(button => button["aria-label"] === "2026-11-03").onClick();
  h.render(); h.effects[0]();
  assert.deepEqual(h.reported.at(-1), { busy: false, dirty: true });
  assert.deepEqual(plain(h.states[2]), ["2026-11-02"]);
  assert.deepEqual(plain(h.states[9]), ["2026-11-03"]);
  h.buttons.find(button => button.children === "希望休").onClick();
  h.render();
  h.buttons.find(button => button["aria-label"] === "2026-11-02 希望休").onClick();
  assert.deepEqual(plain(h.states[2]), []);
  assert.deepEqual(plain(h.states[9]), ["2026-11-03"]);
});
test("staff saves retain failed drafts, block duplicates and reuse retry request IDs", async () => {
  const calls = []; let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = editor({ fetch: async (_url, init) => { calls.push(JSON.parse(init.body));
    return calls.length === 1 ? pending : Response.json({ ...data, version: 4, dates: [] }); } });
  h.states[2] = []; h.render();
  const save = () => h.buttons.find(button => Array.isArray(button.children) ? false : button.children === "保存本月シフト希望").onClick();
  save(); save(); assert.equal(calls.length, 1);
  resolve(Response.json({ error: "Conflict: refresh first" }, { status: 409 })); await tick();
  assert.equal(h.states[6], "Conflict: refresh first"); assert.equal(h.states[1].version, 3);
  assert.equal(h.states[2].length, 0); assert.equal(h.states[5], false);
  h.render(); save(); await tick();
  assert.deepEqual(calls[0], { driverId, shift: { ...command.shift, dates: [], attendanceDates: [] } });
  assert.equal(calls[0].shift.requestId, calls[1].shift.requestId);
  assert.equal(h.states[1].version, 4); assert.match(h.states[7], /同步/);
});
test("staff month switching guards drafts and a rejected read never enables saving", async () => {
  const h = editor({ confirm: () => false });
  h.states[3] = "Unsaved note"; h.render();
  h.inputs.find(input => input.type === "month").onChange({ target: { value: "2026-12" } });
  assert.equal(h.states[0], "2026-11"); assert.equal(h.states[3], "Unsaved note");
  const accepted = editor();
  accepted.inputs.find(input => input.type === "month").onChange({ target: { value: "2026-12" } });
  assert.equal(accepted.states[0], "2026-12"); assert.equal(accepted.states[1], null);
  const failed = editor({ saved: null, fetch: async () => Response.json({ error: "Read failed" }, { status: 503 }) });
  failed.effects[1](); await tick();
  assert.equal(failed.states[1], null); assert.equal(failed.states[6], "Read failed");
  assert.doesNotMatch(failed.render(), /保存本月シフト希望/);
});
test("wide driver dialog renders all bank inputs and synchronized rest editor", () => {
  const source = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("{showDriverForm && (") + "{showDriverForm && (".length;
  const end = source.indexOf("{showVehicleForm && (", start);
  const jsx = source.slice(start, end).trim().replace(/\)\}$/, "");
  const h = editor();
  const context = { require, exports: {}, driverForm: { ...bank.emptyDriverBank, name: "测试司机", reading: "TEST DRIVER",
    phone: "", wechat: "", whatsapp: "", licenseExpiry: "", personalSlogan: "" },
    editingDriverName: "测试司机", editingDriverId: driverId, dialogSaving: false, driverRestState: { busy: false, dirty: false },
    DriverRestEditor: () => h.tree(),
    DriverPostalCode: load("components\\driver-postal-code.tsx", { "@/lib/driver-address": address, "@/lib/api-client": client }).DriverPostalCode,
    DriverCompanySelect: load("components\\driver-company-select.tsx").DriverCompanySelect,
    allCompanyRecords: [], allDriverRecords: [], getRegionForNewRecords: () => requestId,
    setDriverRestState() {}, setDriverForm() {}, setShowDriverForm() {}, saveDriver() {} };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`globalThis.render = () => (${jsx});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  const markup = renderToStaticMarkup(context.render());
  const basicFields = Array.from(markup.matchAll(/<label class="([^"]*)"[^>]*>([\s\S]*?)<\/label>/g))
    .map(([, className, content]) => ({ className, content }));
  const statusIndex = basicFields.findIndex(field => field.content.includes("在職状態"));
  assert.ok(statusIndex >= 0);
  assert.ok(basicFields[statusIndex + 1].content.includes("常勤/非常勤"));
  assert.ok(basicFields[statusIndex + 2].content.includes("個人提示（携帯表示）"));
  assert.match(basicFields[statusIndex + 2].className, /driver-editor-full/);
  assert.ok(markup.indexOf("個人提示（携帯表示）") < markup.indexOf("郵便番号"));
  assert.ok(markup.indexOf("郵便番号") < markup.indexOf("住所先"));
  assert.match(source, /<div className="driver-editor-full grid gap-3">\s*<DriverPostalCode[\s\S]*?<label className="driver-editor-field">\s*住所先/);
  assert.doesNotMatch(markup, /列表状态/);
  for (const text of ["基本资料", "常勤/非常勤", "常勤", "非常勤", "郵便番号", "住所先", "所属会社", "銀行名", "支店名", "口座種別", "口座番号", "口座名義", "保存本月シフト希望", "保存運転士资料"])
    assert.ok(markup.includes(text), text);
  assert.match(source, /<option value="常勤">常勤<\/option><option value="非常勤">非常勤<\/option>/);
  assert.match(source, /aria-label="司机类别筛选"/);
  assert.match(source, /onClick=\{\(\) => setDriverEmploymentTypeFilter\(type\)\}/);
  assert.match(markup, /type="text" inputMode="numeric" pattern="\[0-9\]\*"/);
  if (process.env.DRIVER_EDITOR_LAYOUT_FILE) {
    const cssDir = path.join(root, ".next\\static\\chunks");
    const css = readdirSync(cssDir).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(cssDir, file), "utf8")).join("\n");
    writeFileSync(process.env.DRIVER_EDITOR_LAYOUT_FILE, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><main class="dashboard">${markup}</main>`);
  }
});
