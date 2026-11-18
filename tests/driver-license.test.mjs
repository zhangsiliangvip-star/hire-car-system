import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText, { module: compiled, exports: compiled.exports, Date, Intl,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] :
      name.startsWith("@/") ? load(`${name.slice(2).replaceAll("/", "\\")}${name.startsWith("@/components/") ? ".tsx" : ".ts"}`, mocks) : require(name),
  });
  return compiled.exports;
}
const compliance = load("lib\\vehicle-compliance.ts");
const license = load("lib\\driver-license.ts");
const components = load("components\\vehicle-compliance.tsx");
const source = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
const today = "2026-11-12";
const drivers = [
  { id: "expired", name: "Expired Driver", regionId: "region", licenseExpiry: "2026-11-11" },
  { id: "warning", name: "Warning Driver", regionId: "region", licenseExpiry: "2026-12-12" },
  { id: "normal", name: "Valid Driver", reading: "Synthetic pinyin", attendanceDays: 33, regionId: "region", licenseExpiry: "2026-12-13" },
  { id: "missing", name: "Missing Date", regionId: "region", licenseExpiry: "" },
];
const walk = node => !React.isValidElement(node) ? [] :
  [node, ...React.Children.toArray(node.props.children).flatMap(walk)];

test("departed drivers are hidden only in management and new dispatch, leave stays selectable and historical finance retains access", () => {
  const active = { ...drivers[2], employmentStatus: "在職" };
  const departed = { ...drivers[3], employmentStatus: "離職" };
  const leave = { ...drivers[1], employmentStatus: "休暇" };
  const records = [active, departed, leave];
  assert.equal(license.findDepartedDriver(records, ` ${departed.name} `, "region")?.id, departed.id);
  assert.equal(license.findDepartedDriver(records, departed.name, "other"), undefined);
  const start = source.indexOf("const driverRows =");
  const declaration = source.slice(start, source.indexOf("const unregisteredVehicleNames =", start));
  for (const showDepartedDrivers of [false, true]) {
    const context = { driverRecords: records, unregisteredDriverNames: [], orders: [],
      showDepartedDrivers, rankDriversByMonthlyAttendance: value => value, toDateKey: () => today };
    context.filterDriversByEmploymentType = load("lib\\driver-selection.ts").filterDriversByEmploymentType;
    context.driverEmploymentTypeFilter = "常勤";
    vm.runInNewContext(ts.transpileModule(declaration + "\nglobalThis.result = driverRows;",
      { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
    assert.equal(context.result.some(driver => driver.id === departed.id), showDepartedDrivers);
    assert.ok(context.result.some(driver => driver.id === leave.id));
  }
  for (const enforceLicense of [true, false]) {
    const states = [], errors = [], selected = [];
    let cursor = 0;
    const { DriverSelectionDialog } = load("components\\driver-selection-dialog.tsx", {
      react: { ...React, useEffect() {}, useRef: () => ({ current: null }), useState: initial => {
        const index = cursor++; if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = value; errors.push(value); }];
      } },
    });
    const render = () => { cursor = 0; return DriverSelectionDialog({ drivers: records, selected: "",
      today, enforceLicense, onSelect: name => selected.push(name), onClose() {} }); };
    let nodes = walk(render());
    assert.equal(nodes.some(node => node.type === "button" && String(node.key).endsWith(`$${departed.id}`)), !enforceLicense);
    assert.ok(nodes.some(node => node.type === "button" && String(node.key).endsWith(`$${leave.id}`)));
    nodes.find(node => node.props["aria-label"] === "手動输入運転士姓名").props.onChange({ target: { value: departed.name } });
    nodes = walk(render());
    nodes.find(node => node.type === "button" && node.props.children === "選任").props.onClick();
    assert.equal(selected.includes(departed.name), !enforceLicense);
    if (enforceLicense) assert.ok(errors.some(value => typeof value === "string" && value.includes("已離職")));
  }
});

test("driver licence warning, expiry and renewal share exact vehicle calendar-month boundaries", () => {
  for (const [expiry, date, expected] of [
    ["2026-12-12", "2026-11-11", "normal"], ["2026-12-12", today, "warning"],
    ["2026-12-12", "2026-12-12", "warning"], ["2026-12-12", "2026-12-13", "expired"],
    ["2028-03-31", "2028-02-29", "warning"], ["2026-03-31", "2026-02-28", "warning"],
    ["", today, "normal"],
  ]) {
    assert.equal(compliance.getVehicleExpiryState(expiry, date), expected);
    assert.equal(license.isDriverLicenseExpired({ licenseExpiry: expiry }, date), expected === "expired");
  }
  assert.equal(license.isDriverLicenseExpired(drivers[0], today), true);
  assert.equal(license.isDriverLicenseExpired({ ...drivers[0], licenseExpiry: "2027-11-11" }, today), false);
  assert.equal(license.findExpiredDriver(drivers, " Expired Driver ", "region", today)?.id, "expired");
  assert.equal(license.findExpiredDriver(drivers, "Expired Driver", "other-region", today), undefined);
  assert.equal(license.findExpiredDriver(drivers, "External Driver", "region", today), undefined);
});

for (const enforceLicense of [true, false])
test(`driver picker ${enforceLicense ? "blocks expired assignments including manual names" : "retains historical finance/filter access"}`, () => {
  const states = [], errors = [], selected = [];
  let cursor = 0, closed = 0;
  const { DriverSelectionDialog } = load("components\\driver-selection-dialog.tsx", {
    react: { ...React, useEffect() {}, useRef: () => ({ current: null }),
      useState: initial => {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = value; errors.push(value); }];
      } },
  });
  function render() {
    cursor = 0;
    return DriverSelectionDialog({ drivers, selected: "", today, enforceLicense,
      onSelect: name => selected.push(name), onClose: () => closed++ });
  }
  const tree = render();
  const buttons = walk(tree).filter(node => node.type === "button");
  const expired = buttons.find(button => String(button.key).endsWith("$expired"));
  assert.equal(expired.props.disabled, enforceLicense);
  expired.props.onClick();
  assert.equal(selected.length, enforceLicense ? 0 : 1);
  for (const key of ["warning", "normal", "missing"]) {
    const button = buttons.find(item => String(item.key).endsWith(`$${key}`));
    assert.equal(button.props.disabled, false);
    button.props.onClick();
  }
  walk(render()).find(node => node.props["aria-label"] === "手動输入運転士姓名")
    .props.onChange({ target: { value: "Expired Driver" } });
  const manual = walk(render()).find(node => node.type === "button" && node.props.children === "選任");
  manual.props.onClick();
  assert.equal(selected.filter(name => name === "Expired Driver").length, enforceLicense ? 0 : 2);
  assert.equal(closed, selected.length);
  const html = renderToStaticMarkup(render());
  assert.doesNotMatch(html, /Synthetic pinyin|<time|vehicle-expiry--/);
  for (const driver of drivers) if (driver.licenseExpiry) assert.ok(!html.includes(driver.licenseExpiry));
  assert.match(html, /Valid Driver/);
  assert.match(html, /前月及当月 · 33天/);
  assert.match(html, enforceLicense ? /免許过期・不可用/ : /免許过期・仅历史核对/);
  walk(render()).find(node => node.props["aria-label"] === "搜索運転士")
    .props.onChange({ target: { value: "synthetic PINYIN" } });
  const searchResults = walk(render()).filter(node => node.type === "button");
  assert.ok(searchResults.some(button => String(button.key).endsWith("$normal")));
  assert.ok(!searchResults.some(button => String(button.key).endsWith("$warning")));
  if (enforceLicense) assert.ok(errors.some(value => typeof value === "string" && value.includes("不可選任")));
});

test("reservation creation, edited assignments, batch imports and accounting all reject expired assignments", () => {
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const name of ["importBatchOrders", "addOrder", "saveAccountingDrivers"])
    assert.match(functions.get(name), /findExpiredDriver\(/, name);
  assert.match(functions.get("addOrder"), /!unchanged && findExpiredDriver/);
  assert.match(functions.get("saveAccountingDrivers"), /date >= vehicleToday/);
  assert.match(functions.get("isDriverLicenseExpired"), /licenseExpired\(driver, vehicleToday\)/);
  assert.match(source, /enforceLicense=\{driverSelectionTarget !== "driver-finance-filter"/);
  const select = readFileSync(path.join(root, "components\\finance-driver-select.tsx"), "utf8");
  assert.match(select, /enforceLicense=\{serviceDate >= licenseToday\}/);
});

test("actual save handlers stop expired assignments before any mutation", async () => {
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["importBatchOrders", "addOrder", "saveAccountingDrivers"]);
  const functions = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) functions.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const order = { id: "order", regionId: "region", date: today, endDate: today, offDates: [],
    driver: "", financeByDate: {} };
  const messages = [];
  let mutated = false;
  const context = {
    require, exports: {}, ...license, ...load("lib\\order-drivers.ts"),
    alert: message => messages.push(message),
    dialogSavingRef: { current: false }, requireSpecificRegionForNewData: () => true,
    parseImportedOrderDetails: () => [{ pickup: "Start", destination: "End" }],
    batchOrderInput: "", batchOrderVehicle: "car", availableVehicleRecords: [{ id: "car" }],
    batchOrderDate: today, batchOrderDriver: drivers[0].name,
    driverRecords: drivers, allDriverRecords: drivers, vehicleToday: today,
    getRegionForNewRecords: () => "region",
    createId: () => { mutated = true; throw new Error("Cannot reach mutation"); },
    setOrders: () => { mutated = true; throw new Error("Cannot mutate assignments"); },
    editingOrderId: null, orders: [], form: { ...order, customer: "Test", driver: drivers[0].name,
      orderPrice: 0,       orderSource: "", company: "", salesRep: "", flightNumber: "" },
    orderFormVehicles: [], resolveOrderVehicle: () => ({ plate: "TEST" }),
    getVehicleDisplayStatus: () => "运营中",
    getOrderDateKeys: () => [today],
    parseAccountingKey: () => ({ orderId: order.id, date: today }),
    allOrders: [order],
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(functions.join("\n") +
    "\nglobalThis.handlers = { importBatchOrders, addOrder, saveAccountingDrivers };", {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  context.handlers.importBatchOrders();
  context.handlers.addOrder();
  await context.handlers.saveAccountingDrivers(["order:day"], drivers[0].name);
  assert.equal(mutated, false);
  assert.equal(messages.length, 3);
  for (const message of messages) assert.match(message, /免許已过期/);
  messages.length = 0;
  const departed = { ...drivers[0], licenseExpiry: "2027-12-01", employmentStatus: "離職" };
  context.driverRecords = [departed]; context.allDriverRecords = [departed];
  context.handlers.importBatchOrders();
  context.handlers.addOrder();
  await context.handlers.saveAccountingDrivers(["order:day"], departed.name);
  assert.equal(mutated, false);
  assert.equal(messages.length, 3);
  for (const message of messages) assert.match(message, /已離職/);
});

function renderDriverTable() {
  const start = source.lastIndexOf("<table", source.indexOf('data-table="drivers"'));
  const table = source.slice(start, source.indexOf("</table>", start) + "</table>".length);
  const context = {
    require, exports: {}, ...components,
    driverRows: drivers, visibleDriverRows: drivers, vehicleToday: today,
    formatMobilePhone: load("lib\\phone-format.ts").formatMobilePhone,
    isDriverLicenseExpired: driver => license.isDriverLicenseExpired(driver, today),
    driverSloganDrafts: {}, DriverMobileDialog: () => null,
    openEditDriver() {}, deleteDriver() {}, setDriverSloganDrafts() {}, setDriverRecords() {},
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`globalThis.render = () => (${table});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return renderToStaticMarkup(context.render());
}

test("actual driver list displays yellow/red licences without changing columns, and preserves empty dates", () => {
  const html = renderDriverTable();
  assert.equal((html.match(/<th /g) || []).length, 7);
  assert.equal((html.match(/<td /g) || []).length, 28);
  const nameCells = [...html.matchAll(/<td data-label="運転士"[^>]*>([\s\S]*?)<\/td>/g)];
  assert.equal(nameCells.length, drivers.length);
  for (const [index, cell] of nameCells.entries()) assert.equal(cell[1], drivers[index].name);
  assert.doesNotMatch(html, /在職|休暇|離職/);
  assert.match(html, /vehicle-expiry--expired[^>]*>.*?<time dateTime="2026-11-11"/);
  assert.match(html, /vehicle-expiry--warning[^>]*>.*?<time dateTime="2026-12-12"/);
  assert.match(html, /vehicle-expiry--normal[^>]*>.*?<time dateTime="2026-12-13"/);
  assert.match(html, /免許期限切れ・運転士不可用/);
  assert.match(html, /vehicle-expiry--normal[^>]*>-<\/span>/);
});

test("driver licence preview uses the actual list with production CSS", () => {
  if (!process.env.DRIVER_LICENSE_PREVIEW) return;
  const cssDir = path.join(root, ".next\\static\\chunks");
  const css = readdirSync(cssDir).filter(file => file.endsWith(".css"))
    .map(file => readFileSync(path.join(cssDir, file), "utf8")).join("\n");
  writeFileSync(process.env.DRIVER_LICENSE_PREVIEW,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main class="dashboard p-4"><div class="list-panel overflow-x-auto border bg-white">${renderDriverTable()}</div></main>`);
});
