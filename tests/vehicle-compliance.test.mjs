import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, { exports: compiled.exports, module: compiled,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), Date, Intl });
  return compiled.exports;
}
const compliance = load("lib\\vehicle-compliance.ts");
const { getVehicleExpiryState, getEffectiveVehicleStatus, getJapanDate, splitVehicleOwner } = compliance;
const components = load("components\\vehicle-compliance.tsx", { "@/lib/vehicle-compliance": compliance });
const source = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const vehicle = { id: "synthetic-vehicle", name: "Alphard", plate: "TEST 1234",
  ownerCompany: "株式会社NTC 本社営業所", seats: "7", fuelType: "レギュラー",
  inspectionExpiry: "2026-11-21", liabilityExpiry: "2026-11-11", notes: "", status: "运营中" };

test("vehicle expiry uses a calendar month, including clamped month ends and the expiry day", () => {
  for (const [expiry, today, expected] of [
    ["2026-12-26", "2026-11-25", "normal"],
    ["2026-12-26", "2026-11-26", "warning"],
    ["2026-12-26", "2026-12-26", "warning"],
    ["2026-12-26", "2026-12-27", "expired"],
    ["2026-03-31", "2026-02-27", "normal"],
    ["2026-03-31", "2026-02-28", "warning"],
    ["2028-03-31", "2028-02-28", "normal"],
    ["2028-03-31", "2028-02-29", "warning"],
    ["2027-01-17", "2026-12-16", "normal"],
    ["2027-01-17", "2026-12-17", "warning"],
    ["", "2026-11-12", "normal"],
  ]) assert.equal(getVehicleExpiryState(expiry, today), expected, `${expiry} on ${today}`);
  assert.throws(() => getVehicleExpiryState("2026-02-30", "2026-01-01"), /Invalid vehicle expiry date/);
});

test("Japan midnight changes effective status regardless of the browser timezone", () => {
  assert.equal(getJapanDate(new Date("2026-11-12T14:59:59Z")), "2026-11-12");
  assert.equal(getJapanDate(new Date("2026-11-12T15:00:00Z")), "2026-11-13");
  const expiring = { ...vehicle, inspectionExpiry: "2026-11-12", liabilityExpiry: "" };
  assert.equal(getEffectiveVehicleStatus(expiring, getJapanDate(new Date("2026-11-12T14:59:59Z"))), "运营中");
  assert.equal(getEffectiveVehicleStatus(expiring, getJapanDate(new Date("2026-11-12T15:00:00Z"))), "停运中");
});

test("either expired date stops operation, renewal restores only an originally operating vehicle", () => {
  const today = "2026-11-12";
  for (const field of ["inspectionExpiry", "liabilityExpiry"]) {
    const active = { ...vehicle, inspectionExpiry: "", liabilityExpiry: "", [field]: "2026-11-11" };
    assert.equal(getEffectiveVehicleStatus(active, today), "停运中");
    const renewed = { ...active, [field]: "2027-11-11" };
    assert.equal(getEffectiveVehicleStatus(renewed, today), "运营中");
    assert.equal(getEffectiveVehicleStatus({ ...renewed, status: "停运中" }, today), "停运中");
    assert.equal(active.status, "运营中", "automatic expiry must not overwrite the manual status");
  }
  assert.equal(getEffectiveVehicleStatus({ ...vehicle, inspectionExpiry: "", liabilityExpiry: "" }, today), "运营中");
});

test("owner labels put the office below the full company name without changing the saved value", () => {
  for (const owner of ["株式会社NTC 本社営業所", "ウィナーリンクス株式会社　本社営業所", "株式会社NTC\n本社営業所"]) {
    const label = splitVehicleOwner(owner);
    assert.equal(label.office, "本社営業所");
    assert.equal(label.company, owner.split(/[\s\u3000]+/)[0]);
    const html = renderToStaticMarkup(React.createElement(components.VehicleOwnerLabel, { owner }));
    assert.match(html, /vehicle-owner-company">[^<]+<\/span><span class="vehicle-owner-office">本社営業所/);
  }
  for (const owner of ["大川株式会社", "日本栄進交通株式会社", "株式会社 NTC", ""]) {
    assert.equal(splitVehicleOwner(owner).company, owner);
    assert.equal(splitVehicleOwner(owner).office, "");
  }
});

function renderVehicleTable() {
  const start = source.lastIndexOf("<table", source.indexOf('data-table="vehicles"'));
  const table = source.slice(start, source.indexOf("</table>", start) + "</table>".length);
  const context = {
    require, exports: {}, ...components,
    vehicleToday: "2026-11-12", getVehicleDisplayStatus: item => getEffectiveVehicleStatus(item, "2026-11-12"),
    filteredVehicleRows: [vehicle, { ...vehicle, id: "second", ownerCompany: "大川株式会社",
      inspectionExpiry: "2026-12-26", liabilityExpiry: "" }],
    openEditVehicle() {}, deleteVehicle() {},
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`globalThis.render = () => (${table});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return renderToStaticMarkup(context.render());
}

test("the actual vehicle list shows independent yellow/red expiry badges and automatic stopped status", () => {
  const html = renderVehicleTable();
  assert.equal((html.match(/<th /g) || []).length, 10);
  assert.equal((html.match(/<td /g) || []).length, 20);
  assert.match(html, /vehicle-owner-office">本社営業所/);
  assert.match(html, /vehicle-expiry--warning[^>]*>.*?<time dateTime="2026-11-21"/);
  assert.match(html, /vehicle-expiry--expired[^>]*>.*?<time dateTime="2026-11-11"/);
  assert.match(html, /vehicle-expiry--normal[^>]*>.*?<time dateTime="2026-12-26"/);
  assert.match(html, /期限切れ・停运中/);
  assert.match(html, />停运中<\/span>/);
  assert.match(html, />运营中<\/span>/);
  assert.match(html, /编辑/);
  assert.match(html, /削除/);
  const css = readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.match(css, /\.vehicle-owner-label\s*\{[^}]*flex-direction: column/);
  assert.match(css, /\.vehicle-expiry--warning\s*\{[^}]*background: #fef9c3/);
  assert.match(css, /\.vehicle-expiry--expired\s*\{[^}]*background: #fee2e2/);
});

test("the live dashboard updates compliance dates on minute ticks, focus and visibility changes", () => {
  const effect = source.match(/useEffect\(\(\) => \{\s*const updateDate = [\s\S]*?\n  \}, \[\]\);/)[0];
  const handlers = new Map();
  const dates = [], removed = [];
  let today = "2026-11-12", tick, cleanup, cleared;
  const target = { addEventListener: (name, callback) => handlers.set(name, callback),
    removeEventListener: (name, callback) => { assert.equal(handlers.get(name), callback); removed.push(name); } };
  vm.runInNewContext(effect, {
    useEffect: callback => { cleanup = callback(); },
    setVehicleToday: value => dates.push(value), getJapanDate: () => today,
    window: { ...target,
      setInterval: (callback, delay) => { assert.equal(delay, 60000); tick = callback; return 5; },
      clearInterval: timer => { cleared = timer; } },
    document: target,
  });
  today = "2026-11-13"; tick();
  handlers.get("focus")(); handlers.get("visibilitychange")();
  assert.deepEqual(dates, ["2026-11-13", "2026-11-13", "2026-11-13"]);
  cleanup();
  assert.equal(cleared, 5);
  assert.deepEqual(removed, ["focus", "visibilitychange"]);
});

test("calendar and reservation availability continue to use the same effective status rule", () => {
  let wrapper;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "getVehicleDisplayStatus") wrapper = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.match(wrapper, /return getEffectiveVehicleStatus\(vehicle, vehicleToday\)/);
  assert.match(source, /outOfService: getVehicleDisplayStatus\(vehicle\) !== "运营中"/);
  assert.match(source, /const isVehicleAvailable = getVehicleDisplayStatus\(vehicleRecord\) === "运营中"/);
  assert.match(source, /!formVehicle \|\| getVehicleDisplayStatus\(formVehicle\) !== "运营中"/);
  const { OrderVehiclePlateSelect } = load("components\\order-vehicle-plate-select.tsx", {
    "@/lib/vehicle-order": load("lib\\vehicle-order.ts"),
  });
  for (const financeMode of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(OrderVehiclePlateSelect, {
      vehicles: [vehicle], vehicleName: vehicle.name, vehiclePlate: vehicle.plate,
      getStatus: item => getEffectiveVehicleStatus(item, "2026-11-12"), onSelect() {}, financeMode,
    }));
    assert.equal(html.includes("不可用于新予約"), !financeMode);
    assert.equal(/<option[^>]*value="synthetic-vehicle"[^>]*disabled/.test(html), !financeMode);
  }
});

test("vehicle list browser preview uses actual JSX and production CSS", () => {
  if (!process.env.VEHICLE_COMPLIANCE_PREVIEW) return;
  const cssDir = path.join(root, ".next\\static\\chunks");
  const css = readdirSync(cssDir).filter(file => file.endsWith(".css"))
    .map(file => readFileSync(path.join(cssDir, file), "utf8")).join("\n");
  writeFileSync(process.env.VEHICLE_COMPLIANCE_PREVIEW,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main class="dashboard p-4"><div class="list-panel overflow-x-auto border bg-white">${renderVehicleTable()}</div></main>`);
});
