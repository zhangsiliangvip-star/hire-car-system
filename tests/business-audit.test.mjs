import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const nodeRequire = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function load(relative, mocks = {}, globals = {}) {
  const filename = path.join(root, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(output, {
    exports: compiledModule.exports, module: compiledModule,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] :
      name === "@/lib/reservation-driver-payment" ? load("lib\\reservation-driver-payment.ts") :
      name === "@/lib/order-drivers" ? load("lib\\order-drivers.ts") :
      name === "@/lib/order-vehicles" ? load("lib\\order-vehicles.ts") :
      name === "@/lib/vehicle-order" ? load("lib\\vehicle-order.ts") :
      name === "@/lib/driver/shifts" ? load("lib\\driver\\shifts.ts") : nodeRequire(name),
    console: { error() {}, warn() {} }, URL, URLSearchParams, Date, Intl, AbortController,
    ...globals,
  }, { filename });
  return compiledModule.exports;
}
const audit = load("lib\\audit.ts");
const id = "70000000-0000-4000-8000-000000000001";
const region = "60000000-0000-4000-8000-000000000001";
const operation = { actorId: id, actorName: "Test Operator", at: "2026-10-15T18:00:00Z" };
const plain = (value) => JSON.parse(JSON.stringify(value));

test("finance dialog groups driver selection and wage quick entry below daily fare without losing wage extras", () => {
  const source = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
  const start = source.indexOf('<div className="md:col-span-2 grid gap-3 rounded border border-blue-200');
  const end = source.indexOf("<OrderVehiclePlateSelect", start);
  const block = source.slice(start, end).trim();
  assert.ok(block.indexOf("当日車費") < block.indexOf("<FinanceDriverSelect"));
  assert.ok(block.indexOf("<FinanceDriverSelect") < block.indexOf("運転士工資快捷入力"));
  assert.equal((source.slice(start).match(/<FinanceDriverSelect/g) || []).length, 1);
  const context = {
    require: nodeRequire, exports: {}, FinanceDriverSelect: "driver-select",
    allDriverRecords: [], orders: [], accountingPreviewOrder: { regionId: region },
    todayDateKey: "2026-10-27", date: "2026-10-27", financeKey: "order:day",
    finance: { driverPaymentType: "wage", driverWageMode: "percentage", driverWage: 0,
      driverBonusWage: 500, driverOvertimeRate: 1500, driverOvertimeHours: 2,
      companyAdvanceCompanyReport: 7000 },
    getServiceDriver: () => "Driver", setAccountingForm() {},
    updateAccountingFinance: (key, patch) => { assert.equal(key, "order:day"); Object.assign(context.finance, patch); },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`globalThis.render = () => (${block});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  const nodes = node => !node || typeof node !== "object" ? [] :
    Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const input = () => nodes(context.render()).find(node => node.props?.["aria-label"] === "2026-10-27 運転士工資快捷入力");
  assert.equal(input().props.disabled, false);
  input().props.onChange({ target: { value: "12000" } });
  assert.equal(context.finance.driverWage, 12000);
  assert.equal(context.finance.driverWageMode, "fixed");
  assert.equal(context.finance.driverBonusWage, 500);
  assert.equal(context.finance.driverOvertimeRate, 1500);
  assert.equal(context.finance.driverOvertimeHours, 2);
  input().props.onChange({ target: { value: "" } });
  assert.equal(context.finance.driverWage, 0);
  context.finance.driverPaymentType = "company_advance";
  const externalInput = nodes(context.render()).find(node =>
    node.props?.["aria-label"] === "2026-10-27 外注運転士費用");
  assert.equal(externalInput.props.disabled, false);
  assert.equal(externalInput.props.value, "");
  externalInput.props.onChange({ target: { value: "15000" } });
  assert.equal(context.finance.externalDriverFee, 15000);
  assert.equal(context.finance.companyAdvanceCompanyReport, 7000,
    "external driver fees do not modify the company-advance amount");
  const method = nodes(context.render()).find(node =>
    node.props?.["aria-label"] === "2026-10-27 外注運転士出金方式");
  method.props.onChange({ target: { value: "口座" } });
  assert.equal(context.finance.companyAdvancePaymentMethod, "口座");
  const status = nodes(context.render()).find(node =>
    node.props?.["aria-label"] === "2026-10-27 外注運転士出金状態");
  status.props.onChange({ target: { value: "已完成" } });
  assert.equal(context.finance.companyAdvancePaymentStatus, "已完成");
  assert.match(source, /\{ key: "externalDriverFee", label: "外注運転士費用", unit: "JPY", readOnly: true \}/);
  assert.match(source, /外注運転士出金方式[\s\S]*?disabled/);
  assert.match(source, /外注運転士出金状態[\s\S]*?disabled/);
  assert.match(source, /外注運転士备注[\s\S]*?readOnly/);
  const externalNote = nodes(context.render()).find(node =>
    node.props?.["aria-label"] === "2026-10-27 外注運転士备注");
  assert.equal(externalNote.props.value, "");
  externalNote.props.onChange({ target: { value: "外注司机：Driver" } });
  assert.equal(context.finance.companyAdvancePaymentNote, "外注司机：Driver");
  const salaryInput = nodes(context.render()).find(node =>
    node.props?.["aria-label"] === "2026-10-27 運転士工資快捷入力");
  assert.equal(salaryInput, undefined);
});

test("order time accepts numeric keypad entry and normalizes valid times on blur", () => {
  const { normalizeOrderTimeInput } = load("lib\\order-time-input.ts");
  assert.equal(normalizeOrderTimeInput("0930"), "09:30");
  assert.equal(normalizeOrderTimeInput("930"), "09:30");
  assert.equal(normalizeOrderTimeInput("9:30"), "09:30");
  assert.equal(normalizeOrderTimeInput("00:05"), "00:05");
  assert.equal(normalizeOrderTimeInput("2359"), "23:59");
  for (const invalid of ["", "2460", "2400", "12:60", "12:3", "abc"]) {
    assert.equal(normalizeOrderTimeInput(invalid), invalid);
  }

  const source = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
  const field = source.slice(source.indexOf("配車時間", source.indexOf("normalizeOrderTimeInput") ),
    source.indexOf("{/* 上車地点 */}"));
  assert.match(field, /type="text"/);
  assert.match(field, /inputMode="numeric"/);
  assert.match(field, /maxLength=\{5\}/);
  assert.match(field, /normalizeOrderTimeInput\(event\.target\.value\)/);
  assert.match(field, /0930/);
});

test("company advance external names appear in order labels but stay excluded from driver assignments", () => {
  const { getOrderDriverNames, getOrderDriverLabel, getOrderDriverLabelEntries } = load("lib\\order-drivers.ts");
  const { rankDriversByRecentService } = load("lib\\driver-selection.ts");
  const { findOrderConflicts } = load("lib\\order-conflicts.ts");
  const order = { id, regionId: region, date: "2026-10-25", endDate: "2026-10-27",
    offDates: [], driver: "Old default", time: "09:00", status: "予約確定", vehicle: "",
    financeByDate: { "2026-10-25": { driver: "Daily" }, "2026-10-26": { driver: "" },
      "2026-10-27": { driver: "", driverPaymentType: "company_advance",
        companyAdvancePaymentNote: "外注司机：External" } } };
  assert.deepEqual(plain(getOrderDriverNames(order)), ["Daily", ""]);
  assert.equal(getOrderDriverLabel(order), "Daily／未安排／External");
  assert.deepEqual(plain(getOrderDriverLabelEntries(order)), [
    { label: "Daily", isExternal: false },
    { label: "", isExternal: false },
    { label: "External", isExternal: true },
  ]);
  assert.equal(getOrderDriverLabel({ ...order, date: "2026-10-27", endDate: "2026-10-27" }), "External");
  assert.equal(getOrderDriverLabel({ ...order, financeByDate: {
    "2026-10-25": { driver: "Daily" }, "2026-10-26": { driver: "" },
    "2026-10-27": { driver: "", driverPaymentType: "company_advance",
      companyAdvancePaymentNote: "普通备注，没有外注運転士姓名" },
  } }), "Daily／未安排");
  assert.deepEqual(plain(getOrderDriverNames(order, date => date === "2026-10-27")), [""]);
  const ranked = rankDriversByRecentService(["Old default", "Daily", "External"].map((name, index) =>
    ({ id: `${index}`, name, regionId: region })), [order], "2026-10-27");
  assert.equal(ranked.find(driver => driver.name === "Old default").serviceDays, 0);
  assert.equal(ranked.find(driver => driver.name === "Daily").serviceDays, 1);
  assert.equal(ranked.find(driver => driver.name === "External").serviceDays, 0);
  const candidate = { ...order, id: "other", financeByDate: {}, driver: "Old default" };
  assert.equal(findOrderConflicts(candidate, [order]).length, 0);
  assert.equal(findOrderConflicts({ ...candidate, driver: "External" }, [order]).length, 0);
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(source, /driver: getOrderDriverLabel\(order\)/);
  assert.match(source, /allOrders\.find\(order => order\.id === selectedOrderDetailsSnapshot\.id\)/);
  assert.doesNotMatch(source, /form\[key\] = \{ \.\.\.finance, driver: defaultDriver \}/);
});

test("outsourced driver labels have a distinct badge while staff driver labels remain unbadged", () => {
  const { OrderDriverLabels } = load("components\\driver-name-label.tsx");
  const order = { date: "2026-10-27", endDate: "2026-10-27", offDates: [], driver: "",
    financeByDate: { "2026-10-27": { driver: "", driverPaymentType: "company_advance",
      companyAdvancePaymentNote: "外注運転士：External" } } };
  const externalMarkup = renderToStaticMarkup(React.createElement(OrderDriverLabels, { order }));
  assert.match(externalMarkup, /bg-amber-600[^>]*>外注<\/span>/);
  assert.match(externalMarkup, />External<\/span>/);

  const staffMarkup = renderToStaticMarkup(React.createElement(OrderDriverLabels, {
    order: { ...order, financeByDate: { "2026-10-27": { driver: "Staff" } } },
  }));
  assert.match(staffMarkup, />Staff<\/span>/);
  assert.doesNotMatch(staffMarkup, />外注<\/span>/);
});

test("daily calendar driver groups exclude external names saved in company advance notes", () => {
  const { getServiceDriver, getDriverSegments } = load("lib\\order-drivers.ts");
  const order = { driver: "Default", offDates: ["2026-10-29"], financeByDate: {
    "2026-10-27": { driver: "A" }, "2026-10-28": { driver: "A" },
    "2026-10-30": { driver: "B" }, "2026-10-31": { driver: "" },
    "2026-11-01": { driver: "", driverPaymentType: "company_advance", companyAdvancePaymentNote: "外注司机：External\nOther" },
  } };
  assert.equal(getServiceDriver(order, "2026-10-31"), "");
  assert.equal(getServiceDriver(order, "2026-11-02"), "Default");
  assert.deepEqual(plain(getDriverSegments(order, ["2026-10-27", "2026-10-28", "2026-10-29",
    "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])), [
    { driver: "A", label: "A", isExternal: false, start: 0, end: 2 },
    { driver: "B", label: "B", isExternal: false, start: 3, end: 4 },
    { driver: "", label: "", isExternal: false, start: 4, end: 5 },
    { driver: "", label: "External", isExternal: true, start: 5, end: 6 },
    { driver: "Default", label: "Default", isExternal: false, start: 6, end: 7 },
  ]);
  const externalSegments = getDriverSegments({ driver: "", offDates: [], financeByDate: {
    "2026-11-01": { driver: "", driverPaymentType: "company_advance",
      companyAdvancePaymentNote: "外注司机：External A" },
    "2026-11-02": { driver: "", driverPaymentType: "company_advance",
      companyAdvancePaymentNote: "外注司机：External B" },
  } }, ["2026-11-01", "2026-11-02"]);
  assert.deepEqual(plain(externalSegments), [
    { driver: "", label: "External A", isExternal: true, start: 0, end: 1 },
    { driver: "", label: "External B", isExternal: true, start: 1, end: 2 },
  ]);
});

test("external accounting reassignment synchronizes only its name and preserves draft amounts and payroll exclusion", async () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("  async function saveAccountingDrivers(");
  const body = source.slice(start, source.indexOf("  const accountingMixedValue", start));
  const key = `${id}|2026-10-27`;
  const finance = { driver: "", driverPaymentType: "company_advance", driverWage: 0,
    companyAdvanceCompanyReport: 100, companyAdvancePaymentNote: "外注司机：Before\nParking" };
  let records = [{ id, date: "2026-10-27", endDate: "2026-10-27", offDates: [],
    driver: "Default", financeByDate: { "2026-10-27": finance } }];
  let draft = { [key]: { ...finance, companyAdvanceCompanyReport: 999, companyAdvancePaymentNote: "外注司机：Before\nDraft remark" } };
  const context = {
    ...load("lib\\order-drivers.ts"), ...load("lib\\reservation-driver-payment.ts"),
    dialogSavingRef: { current: false }, allOrders: records, accountingForm: draft,
    parseAccountingKey: () => ({ orderId: id, date: "2026-10-27" }),
    getOrderDateKeys: () => ["2026-10-27"],
    getReservationFinance: order => ({ ...order.financeByDate }), emptyOrderFinance: {},
    alert: message => assert.fail(message), setOrders: update => { records = update(records); },
    setAccountingForm: update => { draft = update(draft); },
    waitForOrders: async () => true,
    finishDialogSave: async (saves, done) => { if ((await Promise.all(saves)).every(Boolean)) done(); },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  await context.saveAccountingDrivers([key], "After");
  assert.equal(records[0].financeByDate["2026-10-27"].companyAdvancePaymentNote, "外注司机：After\nParking");
  assert.equal(records[0].financeByDate["2026-10-27"].companyAdvanceCompanyReport, 100);
  assert.equal(draft[key].companyAdvancePaymentNote, "外注司机：After\nDraft remark");
  assert.equal(draft[key].companyAdvanceCompanyReport, 999);
  assert.equal(draft[key].driver, "");
  assert.equal(context.getServiceDriver(records[0], "2026-10-27"), "");
  assert.deepEqual(plain(context.getOrderDriverNames(records[0])), [""]);
});

test("accounting driver autosave submits only persisted finances, preserves unsaved drafts and waits for confirmation", async () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("  async function saveAccountingDrivers(");
  const body = source.slice(start, source.indexOf("  const accountingMixedValue", start));
  for (const success of [true, false]) {
    let records = [{ id, date: "2026-10-27", endDate: "2026-10-28", driver: "Default",
      vehicle: "Car", vehiclePlate: "123", financeByDate: {
        "2026-10-27": { driver: "Old", dailyFare: 100, driverWage: 50 },
        "2026-10-28": { driver: "Other", dailyFare: 200, driverWage: 75 },
      } }];
    const key = `${id}|2026-10-27`, second = `${id}|2026-10-28`;
    let draft = { [key]: { ...records[0].financeByDate["2026-10-27"], dailyFare: 9999 },
      [second]: records[0].financeByDate["2026-10-28"] };
    const alerts = [];
    let release, writes = 0;
    const context = {
      dialogSavingRef: { current: false }, allOrders: records, accountingForm: draft,
      parseAccountingKey: key => ({ orderId: key.split("|")[0], date: key.split("|")[1] }),
      getOrderDateKeys: () => ["2026-10-27", "2026-10-28"],
      getReservationFinance: order => ({ ...order.financeByDate }), emptyOrderFinance: {},
      alert: message => alerts.push(message),
      setOrders: update => { records = update(records); writes++; },
      setAccountingForm: update => { draft = update(draft); },
      waitForOrders: () => new Promise(resolve => { release = () => resolve(success); }),
      finishDialogSave: async (saves, done) => { if ((await Promise.all(saves)).every(Boolean)) done(); },
    };
    vm.createContext(context);
    vm.runInContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
    const saving = context.saveAccountingDrivers([key], "New");
    assert.equal(writes, 1);
    assert.equal(records[0].financeByDate["2026-10-27"].driver, "New");
    assert.equal(records[0].financeByDate["2026-10-27"].dailyFare, 100);
    assert.equal(records[0].financeByDate["2026-10-28"].driver, "Other");
    assert.equal(draft[key].driver, "Old");
    release();
    await saving;
    assert.equal(draft[key].driver, success ? "New" : "Old");
    assert.equal(draft[key].dailyFare, 9999);
    assert.equal(draft[second].driver, "Other");
    context.accountingForm[key].driverPaymentType = "company_advance";
    await context.saveAccountingDrivers([key], "Blocked");
    assert.equal(writes, 1);
    assert.match(alerts.at(-1), /費用类型尚未保存/);
  }
});

test("reservation batches collapse strictly by persisted import ID and preserve original first line", () => {
  const { groupReservationOrders } = load("lib\\order-batches.ts");
  const base = {
    regionId: region, date: "2026-10-22", endDate: "2026-10-22",
    vehicle: "Alphard", vehiclePlate: "1234", time: "09:00",
  };
  const orders = [
    { ...base, id: "a-second", importBatchId: "a", importBatchIndex: 1, time: "06:00" },
    { ...base, id: "legacy" },
    { ...base, id: "b", importBatchId: "b", importBatchIndex: 0 },
    { ...base, id: "a-first", importBatchId: "a", importBatchIndex: 0 },
    { ...base, id: "other-region", regionId: "other", importBatchId: "a", importBatchIndex: 0 },
    { ...base, id: "manual" },
  ];
  const before = JSON.stringify(orders);
  const rows = plain(groupReservationOrders(orders));
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.find((row) => row.order.id === "a-first"), { order: orders[3], count: 2 });
  assert.ok(rows.some((row) => row.order.id === "b" && row.count === 1));
  assert.ok(rows.some((row) => row.order.id === "other-region" && row.count === 1));
  assert.ok(rows.some((row) => row.order.id === "legacy"));
  assert.ok(rows.some((row) => row.order.id === "manual"));
  assert.equal(JSON.stringify(orders), before);
  const filtered = groupReservationOrders(orders.filter((order) => order.id !== "a-first"));
  assert.ok(filtered.some((row) => row.order.id === "a-second" && row.count === 1));
  assert.deepEqual(plain(groupReservationOrders([])), []);
  const chronological = groupReservationOrders([
    { ...base, id: "later", date: "2026-10-23" },
    { ...base, id: "afternoon", time: "14:00" },
    { ...base, id: "morning", time: "08:00" },
  ]);
  assert.deepEqual(plain(chronological.map((row) => row.order.id)), ["morning", "afternoon", "later"]);
});

test("batch imports save one ID per import, line positions and retain membership when editing", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("  function importBatchOrders()");
  const importFunction = source.slice(start, source.indexOf("  function openNewDriver()", start));
  let sequence = 0;
  let orders = [];
  const context = {
    dialogSavingRef: { current: false }, waitForOrders: () => Promise.resolve(true),
    finishDialogSave: (_saves, close) => close(),
    requireSpecificRegionForNewData: () => true,
    parseImportedOrderDetails: () => [
      { time: "09:00", pickup: "A", destination: "B" },
      { time: "06:00", pickup: "C", destination: "D" },
    ],
    createEmptyDraft: () => ({}), createId: () => `generated-${++sequence}`,
    availableVehicleRecords: [{ id: "car", name: "Alphard", plate: "1234" }],
    batchOrderVehicle: "car", batchOrderDate: "2026-10-22", batchOrderInput: "",
    batchOrderStatus: "仮予約", batchOrderDriver: "", batchOrderSource: "", batchOrderCompany: "",
    emptyOrderFinance: {},
    setOrders: (action) => { orders = action(orders); },
  };
  for (const name of ["setShowBatchOrderForm", "setBatchOrderInput", "setBatchOrderDriver",
    "setBatchOrderSource", "setBatchOrderCompany", "setBatchOrderCustomCompanyMode"]) {
    context[name] = () => {};
  }
  vm.runInNewContext(`${importFunction}\nimportBatchOrders(); importBatchOrders();`, context);
  assert.equal(orders.length, 4);
  assert.equal(orders[0].importBatchId, orders[1].importBatchId);
  assert.equal(orders[2].importBatchId, orders[3].importBatchId);
  assert.notEqual(orders[0].importBatchId, orders[2].importBatchId);
  assert.deepEqual(plain(orders.map((order) => order.importBatchIndex)), [0, 1, 0, 1]);
  const editing = source.slice(source.indexOf("  function openEditOrder("), source.indexOf("  function openAccounting("));
  assert.match(editing, /importBatchId: order\.importBatchId/);
  assert.match(editing, /importBatchIndex: order\.importBatchIndex/);
});

test("reservation table renders only the first imported order with the exact total badge", () => {
  const { groupReservationOrders, getAccountingBatchOrders } = load("lib\\order-batches.ts");
  const { getMonthlySameSourceOrders } = load("lib\\order-invoice-status.ts");
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("{groupReservationOrders(monthlyOrders)");
  const jsx = source.slice(start, source.indexOf("{monthlyOrders.length === 0", start));
  const script = ts.transpileModule(`function renderRows() { return <tbody>${jsx}</tbody>; }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: "batch-table.tsx",
  }).outputText;
  const base = {
    date: "2026-10-22", endDate: "2026-10-22", time: "09:00", status: "仮予約",
    offDates: [], financeByDate: {}, driver: "",
    importBatchId: "batch", regionId: region, customer: "First route",
    orderSource: "Source A", invoiceStatus: "未完成", vehicle: "Alphard",
  };
  const monthlyOrders = [
    { ...base, id: "second", customer: "Hidden route", importBatchIndex: 1 },
    { ...base, id: "first", importBatchIndex: 0 },
  ];
  const context = {
    ...load("lib\\order-drivers.ts"), getOrderVehicleNumber: () => "1234",
    exports: {}, require: nodeRequire, groupReservationOrders, getAccountingBatchOrders,
    getMonthlySameSourceOrders, result: null,
    monthlyOrders, ordersInSelectedMonth: monthlyOrders, orderMonth: "2026-10",
    OrderDriverLabels: load("components\\driver-name-label.tsx").OrderDriverLabels,
    invoiceStatusSavingIds: new Set(), openInvoiceStatusDialog() {},
    formatOrderDate: (date) => date, isOrderArranged: () => false, statusStyles: {},
    DriverExecutionBadge: load("components\\driver-execution-badge.tsx", {
      "@/lib/driver/orders": load("lib\\driver\\orders.ts"),
    }).DriverExecutionBadge,
    driverExecutionByOrder: new Map(), driverExecution: { data: null }, todayDateKey: "2026-10-22",
  };
  vm.runInNewContext(`${script}\nresult = renderRows();`, context);
  const markup = renderToStaticMarkup(context.result);
  assert.equal((markup.match(/<tr /g) || []).length, 1);
  assert.match(markup, /First route/);
  assert.match(markup, /合计2单/);
  assert.doesNotMatch(markup, /Hidden route|aria-expanded|展开/);
});

test("reservation accounting action distinguishes completed and incomplete status colors", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf('onClick={() => openAccounting(order)}', source.indexOf("{activeView === \"orders\""));
  const button = source.slice(source.lastIndexOf("<button", start), source.indexOf("</button>", start));
  assert.match(button, /order\.accountingStatus === "完成核算"/);
  assert.match(button, /border-emerald-200 bg-emerald-50 text-emerald-700/);
  assert.match(button, /border-amber-300 bg-amber-100 text-amber-900/);
  assert.match(button, /核算状態：\$\{order\.accountingStatus === "完成核算" \? "核算完成" : "未完成，財務統計"\}/);
});

test("accounting uses exact new import batches but preserves historical same-day grouping", () => {
  const { getAccountingBatchOrders } = load("lib\\order-batches.ts");
  const base = {
    regionId: region, date: "2026-10-22", endDate: "2026-10-22",
    vehicle: "Alphard", vehiclePlate: "1234", time: "09:00", customer: "",
  };
  const first = { ...base, id: "first", importBatchId: "batch", importBatchIndex: 0 };
  const second = { ...base, id: "second", importBatchId: "batch", importBatchIndex: 1, date: "2026-10-23" };
  const legacy = { ...base, id: "legacy" };
  const candidates = [
    second, first, legacy, { ...base, id: "legacy2" },
    { ...first, id: "different-batch", importBatchId: "other" },
    { ...first, id: "different-region", regionId: "other" },
    { ...base, id: "different-plate", vehiclePlate: "5678" },
    { ...base, id: "multi-day", endDate: "2026-10-24" },
  ];
  const ids = (order) => plain(getAccountingBatchOrders(order, candidates).map((item) => item.id));
  assert.deepEqual(ids(first), ["first", "second"]);
  assert.deepEqual(ids(legacy), ["legacy", "legacy2"]);
  assert.deepEqual(ids(candidates[7]), ["multi-day"]);
});

test("orders API validates and round-trips persistent batch metadata", async () => {
  let stored = null;
  let failure = null;
  let metadataReads = 0;
  const query = {
    select: () => query, order: () => query,
    upsert: (rows) => {
      if (!failure) stored = rows[0];
      return { select: async (columns) => {
        assert.equal(columns, "id, last_operation");
        return {
        data: failure ? null : [{ id, last_operation: operation }], error: failure,
        };
      } };
    },
    in: async () => {
      metadataReads++;
      return { data: [{ id, last_operation: operation }], error: null };
    },
  };
  const route = load("app\\api\\data\\route.ts", {
    "@/lib/supabase/authorization": {
      getAuthenticatedProfile: async () => ({
        profile: { role: "user", regionId: region },
        supabase: { from: (table) => {
          const tableQuery = { ...query, range: () => table === "orders" ? [stored] : [] };
          tableQuery.select = () => tableQuery;
          tableQuery.order = () => tableQuery;
          return tableQuery;
        } },
      }),
    },
    "@/lib/api-response": { jsonResponse: (data, init) => ({ data, status: init?.status ?? 200 }) },
    "@/lib/supabase/pagination": { readAllPages: async (fetch) => fetch(0, 999) },
    "@/lib/delete-password": {},
    "@/lib/company-seal": { isCompanySealDataUrl: () => true, MAX_SEAL_DATA_LENGTH: 350000 },
    "@/lib/audit": audit,
  });
  const order = {
    id, regionId: region, vehicle: "Alphard", vehiclePlate: "1234",
    importBatchId: "80000000-0000-4000-8000-000000000001", importBatchIndex: 0,
    date: "2026-10-22", endDate: "2026-10-22", offDates: [],
    customer: "First", phone: "", pickup: "", destination: "", time: "09:00",
    status: "仮予約", notes: "", driver: "", orderSource: "", company: "", salesRep: "",
    invoiceStatus: "未完成", invoiceSentDate: "",
  };
  const post = (entry) => route.POST({ json: async () => ({
    collection: "orders", upsert: [entry], deleteIds: [], deletePassword: "",
  }) });
  assert.equal((await post(order)).status, 200);
  assert.equal(metadataReads, 0);
  assert.equal(stored.import_batch_id, order.importBatchId);
  assert.equal(stored.import_batch_index, 0);
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(response.data.orders[0].importBatchId, order.importBatchId);
  assert.equal(response.data.orders[0].importBatchIndex, 0);
  for (const invalid of [
    { importBatchId: "invalid" }, { importBatchIndex: -1 }, { importBatchIndex: 500 },
    { importBatchIndex: 1.5 }, { importBatchId: null }, { importBatchIndex: null },
  ]) {
    assert.equal((await post({ ...order, ...invalid })).status, 400);
  }
  const legacy = { ...order };
  delete legacy.importBatchId;
  delete legacy.importBatchIndex;
  assert.equal((await post(legacy)).status, 200);
  assert.equal(stored.import_batch_id, null);
  assert.equal(stored.import_batch_index, null);
  const externalFinance = { driverPaymentType: "company_advance", driver: "",
    companyAdvanceCompanyReport: 15000, companyAdvancePaymentNote: "外注司机：Manual external" };
  assert.equal((await post({ ...order, driver: "Manual external",
    financeByDate: { [order.date]: externalFinance } })).status, 200);
  assert.equal(stored.finance_by_date[order.date].driver, "");
  const restored = (await route.GET()).data.orders[0];
  assert.equal(restored.driver, "Manual external");
  assert.equal(restored.financeByDate[order.date].driverPaymentType, "company_advance");
  assert.equal(restored.financeByDate[order.date].companyAdvanceCompanyReport, 0);
  assert.equal(restored.financeByDate[order.date].externalDriverFee, 15000);
  assert.equal(restored.financeByDate[order.date].companyAdvancePaymentNote, "外注司机：Manual external");
  assert.equal((await post({ ...order, financeByDate: { [order.date]: {
    driverPaymentType: "company_advance", companyAdvanceCompanyReport: 2500, externalDriverFee: 15000,
    companyAdvancePaymentMethod: "口座", companyAdvancePaymentStatus: "已完成",
    companyAdvancePaymentNote: "外注司机：Separate",
  } } })).status, 200);
  const separated = (await route.GET()).data.orders[0].financeByDate[order.date];
  assert.equal(separated.companyAdvanceCompanyReport, 2500);
  assert.equal(separated.externalDriverFee, 15000);
  assert.equal(separated.companyAdvancePaymentMethod, "口座");
  assert.equal(separated.companyAdvancePaymentStatus, "已完成");
  assert.equal(separated.companyAdvancePaymentNote, "外注司机：Separate");
  for (const invalid of [{ driver: "Cannot become payroll" }, { driverWage: 1 }, { driverBonusWage: 1 },
    { driverWageMode: "percentage" }, { driverOvertimeRate: 4000 }, { driverPaymentType: "bad" },
    { companyAdvanceCompanyReport: -1 }, { companyAdvanceCompanyReport: 0.1 },
    { companyAdvanceCompanyReport: 100_000_000_000_000 }, { externalDriverFee: -1 },
    { externalDriverFee: 0.1 }, { externalDriverFee: 100_000_000_000_000 },
    { companyAdvancePaymentNote: "x".repeat(1001) }]) {
    assert.equal((await post({ ...order, financeByDate: { [order.date]: { ...externalFinance, ...invalid } } })).status, 400);
  }
  assert.equal((await post({ ...order, financeByDate: { [order.date]:
    { driverPaymentType: "wage", driver: "Wage driver", driverWage: 8000, companyAdvanceCompanyReport: 1 } } })).status, 200);
  assert.equal((await post({ ...order, financeByDate: { [order.date]:
    { driverPaymentType: "wage", driver: "Wage driver", driverWage: 8000, externalDriverFee: 1 } } })).status, 400);
  assert.equal((await post({ ...order, financeByDate: { [order.date]:
    { driverPaymentType: "wage", driver: "Wage driver", driverWage: 8000 } } })).status, 200);
  assert.equal((await route.GET()).data.orders[0].financeByDate[order.date].driverWage, 8000);
  failure = { code: "PGRST204", message: "Could not find the import_batch_id column" };
  const missingMigration = await post(order);
  assert.equal(missingMigration.status, 500);
  assert.match(missingMigration.data.error, /20261102000000_order_import_batches.sql/);
});

test("vehicle statistics filter displays plates instead of vehicle names", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("value={vehicleFinanceVehicleFilter}", source.indexOf("导出車両财务表（A4）"));
  assert.ok(start !== -1);
  const filter = source.slice(start, source.indexOf("</select>", start));
  assert.ok(filter.includes("全部車両番号"));
  assert.ok(filter.includes('{vehicle.plate || "未登记番号"}'));
  assert.ok(!/>\s*\{vehicle\.name\}\s*<\/option>/.test(filter));
  assert.ok(filter.includes("value={vehicle.id}"));
});

test("calendar uses exact regional source colors with readable black or white text", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const helper = source.slice(source.indexOf("function getSourceTextColor("), source.indexOf("const sourceColorOptions ="));
  const getTextColor = vm.runInNewContext(
    ts.transpileModule(`${helper}\ngetSourceTextColor;`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
  );
  const contrast = (background, foreground) => {
    const channels = [1, 3, 5].map((offset) => {
      const channel = parseInt(background.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return foreground === "#000000" ? (luminance + 0.05) / 0.05 : 1.05 / (luminance + 0.05);
  };
  assert.equal(getTextColor("#000000"), "#ffffff");
  assert.equal(getTextColor("#ffffff"), "#000000");
  for (const red of [0, 64, 128, 192, 255]) {
    for (const green of [0, 64, 128, 192, 255]) {
      for (const blue of [0, 64, 128, 192, 255]) {
        const color = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
        assert.ok(contrast(color, getTextColor(color)) >= 4.5, color);
      }
    }
  }
  assert.match(source, /const sourceColor = orderSourceColorByRegion\.get\(`\$\{order\.regionId\}:\$\{order\.orderSource\}`\)/);
  assert.match(source, /backgroundColor: sourceColor \|\| undefined/);
  assert.match(source, /color: sourceColor \? getSourceTextColor\(sourceColor\) : undefined/);
  assert.doesNotMatch(source, /color-mix\(in srgb/);
  assert.match(source, /segment.expired \? "rounded bg-white px-1 font-semibold text-red-600"/);
});

test("reservation date filter includes service ranges, excludes off days and preserves other filters", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const script = source.slice(source.indexOf("  const ordersInSelectedMonth ="), source.indexOf("  const monthlyFinanceOrders ="));
  const base = { date: "2026-10-01", endDate: "2026-10-03", offDates: [], orderSource: "S", company: "A" };
  const orders = [
    { ...base, id: "multi" },
    { ...base, id: "off", offDates: ["2026-10-02"] },
    { ...base, id: "single", date: "2026-10-02", endDate: "" },
    { ...base, id: "later", date: "2026-10-03" },
    { ...base, id: "other-company", company: "B" },
    { ...base, id: "other-source", orderSource: "T" },
    { ...base, id: "cross-month", date: "2026-09-29" },
    { ...base, id: "outside-month", date: "2026-09-01", endDate: "2026-09-30" },
  ];
  const evaluate = (day, company = "", sourceFilter = "") => {
    const context = {
      ...load("lib\\order-drivers.ts"), ...load("lib\\order-vehicles.ts"),
      orders, orderMonth: "2026-10", orderDateFilter: day,
      orderCompanyFilter: company, orderSourceFilter: sourceFilter, UNSOURCED_ORDER: "__unsourced__",
      orderVehicleFilter: "", orderDriverFilter: "",
      UNASSIGNED_ORDER_VEHICLE: "__unassigned_vehicle__",
      UNASSIGNED_ORDER_DRIVER: "__unassigned_driver__",
      vehicleRecords: [], resolveOrderVehicle: () => undefined,
    };
    vm.runInNewContext(`${script}\nresult = monthlyOrders.map((order) => order.id);`, context);
    return plain(context.result);
  };
  assert.deepEqual(evaluate("2026-10-02", "A", "S"), ["multi", "single", "cross-month"]);
  assert.deepEqual(evaluate("", "A", "S"), ["multi", "off", "single", "later", "cross-month"]);
  assert.deepEqual(evaluate("2026-10-31"), []);
  assert.deepEqual(evaluate("2026-10-02", "B"), ["other-company"]);
  assert.match(source, /選択预约年份，当前\$\{orderMonth\.slice\(0, 4\)\}年/);
  assert.match(source, /setOrderMonth\(`\$\{year\}-\$\{orderMonth\.slice\(5, 7\)\}`\);[\s\S]*setOrderDateFilter\(""\)/);
  assert.match(source, /aria-haspopup="dialog"/);
});

test("reservation management puts the year first and shows all twelve month buttons without a month picker", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf('{activeView === "orders"');
  const end = source.indexOf("{activeView === \"operations\"", start);
  const controls = source.slice(start, end);
  const monthControlsStart = controls.indexOf("calendar-date-controls mb-3 mt-0");
  const monthControlsEnd = controls.indexOf('<div className="overflow-x-auto border bg-white">', monthControlsStart);
  const monthControls = controls.slice(monthControlsStart, monthControlsEnd);
  assert.ok(controls.indexOf('id="order-company-filter"') < controls.indexOf("選択预约年份，当前"));
  assert.ok(controls.indexOf("選択预约年份，当前") < controls.indexOf('aria-label="選択预约月份"'));
  assert.match(monthControls, /aria-label=\{`選択预约年份，当前\$\{orderMonth\.slice\(0, 4\)\}年`\}[\s\S]*setOrderYearPickerStart/);
  assert.match(monthControls, /role="dialog"[\s\S]*aria-labelledby="order-year-dialog-title"/);
  assert.match(monthControls, /選択预约年份/);
  assert.match(monthControls, /aria-label="上一组预约年份"[\s\S]*Math\.max\(2020, \(start \?\? 2020\) - 12\)/);
  assert.match(monthControls, /aria-label="下一组预约年份"[\s\S]*Math\.min\(2089, \(start \?\? 2020\) \+ 12\)/);
  assert.match(monthControls, /Array\.from\(\{ length: 12 \}, \(_, index\) => orderYearPickerStart \+ index\)/);
  assert.match(monthControls, /setOrderMonth\(`\$\{year\}-\$\{orderMonth\.slice\(5, 7\)\}`\);[\s\S]*setOrderDateFilter\(""\);[\s\S]*setOrderYearPickerStart\(null\)/);
  assert.match(monthControls, /role="group" aria-label="選択预约月份"[\s\S]*Array\.from\(\{ length: 12 \}/);
  assert.match(monthControls, /aria-pressed=\{selected\}/);
  assert.match(monthControls, /setOrderMonth\(`\$\{orderMonth\.slice\(0, 4\)\}-\$\{month\}`\)/);
  assert.match(monthControls, /calendar-date-controls mb-3 mt-0[^"]*rounded-2xl[^"]*bg-slate-50/);
  assert.match(monthControls, /calendar-year-button[^"]*rounded-full border border-slate-200[^"]*px-3 py-1[^"]*text-xs font-semibold/);
  assert.match(monthControls, /calendar-month-buttons grid[^"]*grid-cols-6[^"]*sm:grid-cols-12/);
  assert.match(monthControls, /min-w-0 rounded-full border py-1 text-center text-xs font-semibold transition-colors sm:flex-1/);
  assert.doesNotMatch(monthControls, /type="month"|id="order-month"|<select/);
});

test("reservation date dialog renders a month calendar instead of a dropdown", () => {
  const { OrderDateFilterDialog } = load("components\\order-date-filter-dialog.tsx");
  const render = (month, selected = "") => renderToStaticMarkup(React.createElement(OrderDateFilterDialog, {
    month, selected, onSelect() {}, onClose() {},
  }));
  const leap = render("2028-02", "2028-02-29");
  assert.match(leap, /<dialog/);
  assert.match(leap, /aria-label="2028-02-29" aria-pressed="true"/);
  assert.equal((leap.match(/aria-label="2028-02-\d{2}"/g) || []).length, 29);
  const february = render("2026-02");
  assert.equal((february.match(/aria-label="2026-02-\d{2}"/g) || []).length, 28);
  assert.doesNotMatch(february, /<select/);
  assert.match(february, /全部日期/);
  assert.doesNotMatch(february, /取消/);
  assert.match(february, /关闭日期筛选/);
});

test("selection dialogs only close from their top-right cross, not backdrop Escape or selection", () => {
  const hooks = { ...React, useEffect() {}, useRef: () => ({ current: null }), useState: (initial) => [initial, () => {}] };
  const elements = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children)];
  };
  for (const [file, symbol, props] of [
    ["source-selection-dialog", "SourceSelectionDialog", {
      sources: [{ id: "s", companyName: "Source", orderCount: 1 }], selected: "",
    }],
    ["driver-selection-dialog", "DriverSelectionDialog", {
      drivers: [{ id: "d", name: "Driver", serviceDays: 1 }], selected: "",
    }],
    ["order-date-filter-dialog", "OrderDateFilterDialog", { month: "2026-10", selected: "" }],
  ]) {
    let closes = 0, selections = 0, prevented = false;
    const Component = load(`components\\${file}.tsx`, { react: hooks })[symbol];
    const tree = Component({ ...props, onClose: () => closes++, onSelect: () => selections++ });
    assert.equal(tree.props.onClick, undefined);
    if (tree.props.onCancel) tree.props.onCancel({ preventDefault: () => { prevented = true; } });
    else tree.props.onKeyDown({
      key: "Escape", preventDefault: () => { prevented = true; }, stopPropagation() {},
    });
    assert.equal(prevented, true);
    assert.equal(closes, 0);
    const buttons = elements(tree).filter((node) => node.type === "button");
    assert.equal(buttons.filter((node) => node.props.children === "取消").length, 0);
    const cross = buttons.find((node) => node.props.children === "×");
    assert.ok(cross);
    for (const button of buttons.filter((node) => node !== cross && !node.props.disabled)) {
      button.props.onClick();
    }
    assert.ok(selections > 0);
    assert.equal(closes, 0);
    cross.props.onClick();
    assert.equal(closes, 1);
  }
  let opened = false, selected = "";
  const { FinanceDriverSelect } = load("components\\finance-driver-select.tsx", {
    react: { ...hooks, useState: () => [opened, (value) => { opened = value; }] },
    "@/lib/driver-selection": { rankDriversByRecentService: () => [] },
    "@/components/driver-selection-dialog": { DriverSelectionDialog() {} },
  });
  const render = () => FinanceDriverSelect({
    drivers: [], orders: [], value: selected, onChange: (name) => { selected = name; },
  });
  elements(render()).find((node) => node.type === "button").props.onClick();
  const dialog = render().props.children[1];
  dialog.props.onSelect("Driver");
  assert.equal(opened, true);
  assert.equal(selected, "Driver");
  dialog.props.onClose();
  assert.equal(opened, false);
});

test("all dashboard modal backdrops are inert and cancel buttons are removed", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const overlays = [];
  const visit = (node) => {
    if (ts.isJsxElement(node)) {
      const attrs = node.openingElement.attributes.properties;
      const style = attrs.find((attr) => attr.name?.getText(ast) === "className");
      if (style?.initializer && /fixed inset-0/.test(style.initializer.getText(ast))) {
        if (attrs.some((attr) => attr.name?.getText(ast) === "role" && attr.initializer?.getText(ast) === '"status"')) {
          assert.match(node.getText(ast), /aria-busy="true"/);
          ts.forEachChild(node, visit);
          return;
        }
        overlays.push(node);
        assert.equal(attrs.some((attr) => attr.name?.getText(ast) === "onClick"), false);
        const markup = node.getText(ast);
        assert.match(markup, /×/);
        if (!markup.includes("invoice-status-dialog-title")) {
          assert.doesNotMatch(markup, />\s*取消\s*</);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(overlays.length, 15);
  for (const [start, end, closing] of [
    ["function importBatchOrders()", "function openNewDriver()", "setShowBatchOrderForm(false)"],
    ["function saveDriver()", "function deleteDriver(", "setShowDriverForm(false)"],
    ["function saveSource()", "function updateSourceColor(", "setShowSourceForm(false)"],
    ["function saveCompany()", "function deleteCompany(", "setShowCompanyForm(false)"],
    ["function saveVehicle()", "function deleteVehicle(", "setShowVehicleForm(false)"],
    ["function saveBatchAdd()", "function openEditOrder(", "setBatchAddType(null)"],
    ["function saveAccounting()", "function closeForm()", "setAccountingPreviewOrder(null)"],
    ["function addOrder(", "function requestOrderDeletion(", "closeForm"],
  ]) {
    const first = source.indexOf(start), last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first, start);
    assert.ok(source.slice(first, last).includes(closing), start);
    assert.match(source.slice(first, last), /finishDialogSave\(/, start);
  }
  const selection = source.slice(source.indexOf("{sourceSelectionOpen &&"), source.indexOf("{batchAddType &&"));
  assert.equal((selection.match(/setSourceSelectionOpen\(null\)/g) || []).length, 1);
  assert.equal((selection.match(/setDriverSelectionTarget\(null\)/g) || []).length, 1);
  assert.match(source, /setDeleteCompleted\(true\)/);
  assert.match(source, /disabled=\{isDeleting \|\| deleteCompleted \|\| !deletePassword\}/);
});

test("single-record save dialogs close on confirmation, retain failures and avoid duplicate records", async () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const helperStart = source.indexOf("  async function finishDialogSave(");
  const helper = source.slice(helperStart, source.indexOf("  const [accountError", helperStart));
  for (const [kind, start, end, initial, recordKey, formKey, idKey, nameKey, savedName] of [
    ["Driver", "function saveDriver()", "function deleteDriver(", {
      name: "Driver", phone: "", wechat: "", whatsapp: "", licenseExpiry: "", personalSlogan: "",
    }, "driverRecords", "driverForm", "editingDriverId", "editingDriverName", "Driver"],
    ["Source", "function saveSource()", "function updateSourceColor(", {
      companyName: "Source", shortName: "", contactName: "", contactInfo: "", address: "", color: "",
    }, "orderSourceRecords", "sourceForm", "editingSourceId", "editingSourceName", "Source"],
    ["Company", "function saveCompany()", "function deleteCompany(", {
      name: "Company", operationsManager: "", maintenanceManager: "", phone: "",
      rollCallAddress: "", garageAddress: "", bankAccount: "", taxRegistrationNumber: "", sealImage: "",
    }, "companyRecords", "companyForm", "editingCompanyId", "editingCompanyName", "Company"],
    ["Vehicle", "function saveVehicle()", "function deleteVehicle(", {
      name: "Alphard", plate: "1234", defaultParkingFee: 0, defaultInsuranceFee: 0,
      ownerCompany: "", seats: "7", fuelType: "汽油", inspectionExpiry: "", liabilityExpiry: "",
      notes: "", status: "运营中",
    }, "vehicleRecords", "vehicleForm", "editingVehicleId", "editingVehicleName", "Alphard"],
  ]) {
    let created = 0;
    let confirmed = true;
    const alerts = [];
    const context = {
      [recordKey]: [], [formKey]: initial, [idKey]: null, [nameKey]: null,
      allDriverRecords: [], allOrderSourceRecords: [], allCompanyRecords: [], allVehicleRecords: [],
      companySealBusy: false,
      dialogSavingRef: { current: false },
      setDialogSaving() {}, setPersistenceError() {},
      waitForOrders: () => Promise.resolve(confirmed), waitForDrivers: () => Promise.resolve(confirmed),
      waitForSources: () => Promise.resolve(confirmed), waitForCompanies: () => Promise.resolve(confirmed),
      waitForVehicles: () => Promise.resolve(confirmed),
      isCompanySealDataUrl: () => true,
      requireSpecificRegionForNewData: () => true, getRegionForNewRecords: () => region,
      createId: () => `${kind}-${++created}`, isOutsourcedVehicle: () => false,
      alert: (message) => alerts.push(message),
      setOrders: (update) => update([]), setVehicleRecords: (update) => update([]),
    };
    context[`set${recordKey[0].toUpperCase()}${recordKey.slice(1)}`] = (update) => {
      context[recordKey] = update(context[recordKey]).map((record) => ({ ...record, regionId: region }));
      const allKey = kind === "Source" ? "allOrderSourceRecords" : `all${kind}Records`;
      context[allKey] = context[recordKey];
    };
    context[`setEditing${kind}Id`] = (value) => { context[idKey] = value; };
    context[`setEditing${kind}Name`] = (value) => { context[nameKey] = value; };
    let closed = 0;
    context[`setShow${kind}Form`] = (value) => { assert.equal(value, false); closed++; };
    vm.createContext(context);
    const first = source.indexOf(start), last = source.indexOf(end, first);
    vm.runInContext(ts.transpileModule(`${helper}\n${source.slice(first, last)}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
    await context[`save${kind}`]();
    assert.equal(context[recordKey].length, 1, kind);
    assert.equal(context[nameKey], savedName);
    await context[`save${kind}`]();
    assert.equal(context[recordKey].length, 1, kind);
    assert.equal(created, 1, kind);
    assert.equal(closed, 2, kind);
    assert.equal(alerts.length, 0, kind);
    confirmed = false;
    await context[`save${kind}`]();
    assert.equal(closed, 2, `${kind} stays open on a rejected write`);
    assert.equal(alerts.length, 1, kind);
    assert.equal(context[recordKey].length, 1, kind);
    context.dialogSavingRef.current = true;
    await context[`save${kind}`]();
    assert.equal(created, 1, `${kind} blocks repeated saves while pending`);
  }
});

test("company seal entry opens dedicated uploader and saves only seal without overwriting company details", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const first = source.indexOf("function openCompanySeal(");
  const original = {
    id: "company", name: "Company", regionId: region, phone: "updated",
    bankAccount: "Bank", sealImage: "", taxRegistrationNumber: "T1234567890123",
  };
  const context = {
    dialogSavingRef: { current: false }, waitForCompanies: () => Promise.resolve(true),
    finishDialogSave: (_saves, close) => close(),
    sealCompany: null, sealDraft: "", sealUploadBusy: false, companyRecords: [original],
    isCompanySealDataUrl: (value) => value === "" || value === "valid-seal",
    requireSpecificRegionForNewData: () => true, createId: () => "new-company",
    alert: (message) => assert.fail(message),
  };
  context.setSealCompany = (value) => { context.sealCompany = value; };
  context.setSealDraft = (value) => { context.sealDraft = value; };
  context.setCompanyRecords = (update) => { context.companyRecords = update(context.companyRecords); };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source.slice(first, source.indexOf("function openEditCompany(", first)), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  context.openCompanySeal({ ...original, phone: "stale" });
  context.sealDraft = "valid-seal";
  context.saveCompanySeal();
  assert.equal(context.companyRecords[0].sealImage, "valid-seal");
  assert.equal(context.companyRecords[0].phone, "updated");
  assert.equal(context.companyRecords[0].bankAccount, "Bank");
  assert.equal(context.sealCompany, null);
  context.openCompanySeal(context.companyRecords[0]);
  context.sealDraft = "";
  context.saveCompanySeal();
  assert.equal(context.companyRecords[0].sealImage, "");
  context.openCompanySeal({ ...original, id: "unregistered-company-0" });
  context.saveCompanySeal();
  assert.equal(context.sealCompany, null);
  context.openCompanySeal(context.companyRecords.find((company) => company.id === "new-company"));
  context.saveCompanySeal();
  assert.equal(context.companyRecords.length, 2);
  assert.equal(context.sealCompany, null);
  assert.match(source, /onClick=\{\(\) => openCompanySeal\(company\)\}/);
  assert.match(source, /<CompanySealUpload standalone value=\{sealDraft\}/);
});

test("delete confirmation remains open after success and blocks repeated deletion", async () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const first = source.indexOf("async function confirmPendingDelete()");
  let deletes = 0;
  const context = {
    pendingDelete: { action: async () => { deletes++; } }, isDeleting: false,
    deleteCompleted: false, deletePassword: "test", setDeleteError() {},
    console: { error: () => assert.fail("Unexpected deletion error") },
  };
  context.setDeleteCompleted = (value) => { context.deleteCompleted = value; };
  context.setIsDeleting = (value) => { context.isDeleting = value; };
  context.setDeletePassword = (value) => { context.deletePassword = value; };
  vm.createContext(context);
  vm.runInContext(source.slice(first, source.indexOf("function addBalanceExpenseItem(", first)), context);
  await context.confirmPendingDelete();
  assert.equal(context.deleteCompleted, true);
  assert.ok(context.pendingDelete);
  context.deletePassword = "test";
  await context.confirmPendingDelete();
  assert.equal(deletes, 1);
});

test("dated statistics sort oldest first and use departure time to break date ties", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  for (const [start, end, dateKey] of [
    ["  const sortedFinanceOrders =", "  const filteredFinanceTotals =", "date"],
    ["  const companyDriverFinanceDetails =", "  const driverFinanceDrivers =", "serviceDate"],
    ["  const filteredVehicleFinanceDetails =", "  const vehicleSummaryResult:", "serviceDate"],
  ]) {
    const section = source.slice(source.indexOf(start), source.indexOf(end));
    const comparator = section.match(/\.sort\((\(first, second\) =>[\s\S]*?),\s*\);/);
    assert.ok(comparator, `Missing comparator in ${start}`);
    const compare = vm.runInNewContext(`(${comparator[1]})`);
    const rows = [
      { [dateKey]: "2026-10-20", time: "09:00", id: "late" },
      { [dateKey]: "2026-10-01", time: "14:00", id: "afternoon" },
      { [dateKey]: "2026-10-01", time: "08:00", id: "morning" },
      { [dateKey]: "2026-09-30", time: "18:00", id: "previous" },
    ];
    assert.deepEqual(rows.sort(compare).map((row) => row.id),
      ["previous", "morning", "afternoon", "late"]);
  }
  assert.match(source, /rows: sortedFinanceOrders\.map/);
  assert.match(source, /rows: filteredDriverFinanceDetails,/);
  assert.match(source, /rows: filteredVehicleFinanceDetails,/);
});

test("wage driver dropdown follows monthly wages and includes drivers with manual wage items", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const monthly = source.slice(
    source.indexOf("  const monthlyFinanceOrders ="),
    source.indexOf("  const filteredOrderFinanceOrders ="),
  );
  const wages = source.slice(
    source.indexOf("  const [driverFinanceYear] ="),
    source.indexOf("  const driverFinanceCompanyLabel ="),
  );
  const script = ts.transpileModule(
    `${monthly}\n${wages}\nresult = {
      drivers: driverFinanceDrivers,
      selected: selectedDriverFinanceDriver,
      rows: filteredDriverFinanceDetails.map((row) => row.driver),
    };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const order = (id, company, financeByDate) => ({
    id, regionId: region, company, date: "2026-09-30", endDate: "2026-11-01",
    orderPrice: 0, time: "09:00", financeByDate,
  });
  const orders = [
    order(1, "A", {
      "2026-09-30": { driver: "Previous month", driverWage: 100 },
      "2026-10-01": { driver: "Driver A", driverWage: 100 },
      "2026-10-02": { driver: "Driver A", driverWage: 200 },
      "2026-10-03": { driver: "" },
      "2026-11-01": { driver: "Next month", driverWage: 300 },
    }),
    order(2, "B", { "2026-10-01": { driver: "Driver B", driverWage: 100 } }),
    order(3, "", { "2026-10-04": { driver: "Historical driver", driverBonusWage: 100 } }),
    order(4, "A", {}),
    order(5, "C", {
      "2026-10-01": { driver: "Zero wage driver", driverWage: 0 },
      "2026-10-02": { driver: "Advance only driver", driverAdvanceCompanyReport: 1000 },
    }),
    order(6, "A", { "2026-10-04": { driver: "External excluded", driverPaymentType: "company_advance",
      driverWage: 100, companyAdvanceCompanyReport: 1000 } }),
  ];
  const evaluate = (company, selected = "", month = "2026-10", records = orders, wageItems = []) => {
    const context = {
      orders: records, financeMonth: month, driverFinanceCompanyFilter: company,
      driverFinanceDriverFilter: selected, companyRecords: [],
      driverRecords: [], driverWageItems: wageItems, activeRegionId: region,
      ALL_REGIONS_ID: "__all_regions__",
      regionNameById: new Map(), accountingAccounts: [],
      getJapaneseHolidays: () => new Set(),
      calculateOrderFinance: (finance) => ({
        driverWages: (finance.driverWage || 0) + (finance.driverBonusWage || 0),
        driverAdvances: finance.driverAdvanceCompanyReport || 0,
        requestAmount: 0, companyExpenses: 0, profit: 0,
      }),
      getDriverOvertimeFee: () => 0,
      getOrderFinanceAmount: () => 0,
      getOrderVehicleNumber: () => "-",
      getFinanceDayOrder: (order) => order,
      getServiceVehicle: load("lib\\order-vehicles.ts").getServiceVehicle,
      getAccountingAssigneeName: () => "",
      isDriverWageEntry: load("lib\\reservation-driver-payment.ts").isDriverWageEntry,
    };
    vm.runInNewContext(script, context);
    return plain(context.result);
  };
  assert.deepEqual(evaluate("A"), {
    drivers: ["Driver A"], selected: "", rows: ["Driver A", "Driver A"],
  });
  assert.deepEqual(evaluate("B").drivers, ["Driver B"]);
  assert.deepEqual(evaluate("__unassigned_company__").drivers, ["Historical driver"]);
  assert.deepEqual(evaluate("").drivers, ["Driver A", "Driver B", "Historical driver"]);
  assert.deepEqual(evaluate("C"), {
    drivers: [], selected: "", rows: ["Zero wage driver", "Advance only driver"],
  });
  assert.deepEqual(evaluate("C", "Zero wage driver"), evaluate("C"));
  assert.deepEqual(evaluate("A", "Driver A").rows, ["Driver A", "Driver A"]);
  assert.deepEqual(evaluate("A", "Driver B"), evaluate("A"));
  assert.deepEqual(evaluate("A", "Driver A", "2026-11"), {
    drivers: ["Next month"], selected: "", rows: ["Next month"],
  });
  assert.deepEqual(evaluate("A", "Driver A", "2026-12"), {
    drivers: [], selected: "", rows: [],
  });
  assert.deepEqual(evaluate("A", "Driver A", "2026-10", []), {
    drivers: [], selected: "", rows: [],
  });
  assert.deepEqual(evaluate("A", "", "2026-10", orders, [{
    id: "manual", regionId: region, month: "2026-10", driver: "Manual Driver",
    companyName: "A", name: "月度津贴", amount: 500,
  }]), {
    drivers: ["Driver A", "Manual Driver"], selected: "", rows: ["Driver A", "Driver A"],
  });

  const start = source.indexOf('title="給料統計"');
  const panel = source.slice(start, source.indexOf("</FinanceSummaryPanel>", start));
  assert.match(panel, /onMonthChange=\{\(month\) => \{\s*setFinanceMonth\(month\);\s*setDriverFinanceDriverFilter\(""\);/);
  assert.match(panel, /selectedDriverFinanceDriver \|\| "全部運転士"/);
  assert.match(source, /driverFinanceDrivers\.map\(\(name\) => \(\{ id: name, name, serviceDays: 0 \}\)\)/);
  assert.match(panel, /activeRegionId === ALL_REGIONS_ID \|\| !selectedDriverFinanceDriver/);
});

test("driver wage print totals include manually entered wage items", () => {
  const { buildDriverWagePrintHtml } = load("lib\\driver-wage-print.ts", {
    "@/lib/print-a4": { printA4Html() {} },
  });
  const html = buildDriverWagePrintHtml({
    driver: "Test Driver",
    month: "2026-10",
    region: "東京",
    rows: [{
      serviceDate: "2026-10-01", time: "09:00", customer: "Test Order",
      vehicleNumber: "品川 100", driverAdvances: 100, overtimeHours: 0,
      overtimeFee: 0, percentageWage: 0, fixedWage: 1000, bonusWage: 0,
      totalWage: 1000, accountingAssignee: "",
    }],
    manualItems: [{ name: "月度津贴", amount: 500 }],
  });
  assert.match(html, /工資総额<strong>¥1,500<\/strong>/);
  assert.match(html, /支付総额<strong>¥1,600<\/strong>/);
  assert.match(html, /月度津贴/);
});

test("A4 report exports omit signature fields and preserve report content", () => {
  const printMock = { "@/lib/print-a4": { printA4Html() {} } };
  const wages = load("lib\\driver-wage-print.ts", printMock);
  const vehicles = load("lib\\vehicle-finance-print.ts", {
    ...printMock,
    "@/lib/vehicle-finance-summary": load("lib\\vehicle-finance-summary.ts", {
      "@/lib/vehicle-order": load("lib\\vehicle-order.ts"),
    }),
  });
  const accounting = load("lib\\order-finance-print.ts", {
    ...printMock,
    "@/lib/request-amount-summary": load("lib\\request-amount-summary.ts"),
  });
  const expenses = load("lib\\order-expense-print.ts", printMock);
  const balance = load("lib\\balance-print.ts", printMock);
  const { summarizeBalance } = load("lib\\balance-summary.ts");
  const base = { month: "2026-10", region: "Tokyo", company: "Company A", rows: [] };
  const reports = [
    [wages.buildDriverWagePrintHtml({
      ...base, driver: "Test Driver", manualItems: [{ name: "Allowance", amount: 500 }],
    }), "運転士月度工資表", "工資月份：2026-10"],
    [wages.buildCompanyWagePrintHtml({ ...base, manualItems: [] }), "所属会社全员工資総表", "月份：2026-10"],
    [vehicles.buildVehicleFinancePrintHtml({
      ...base, vehicleNumber: "100", monthly: null,
    }), "車両統計月度财务表", "2026-10"],
    [vehicles.buildVehicleSummaryPrintHtml({
      ...base, regionNames: {},
    }), "全車両月度统计表", "2026-10"],
    [accounting.buildOrderFinancePrintHtml({
      ...base, source: "All", depositStatus: "All", invoiceStatus: "All",
    }), "経理統計月度财务表", "月份：2026-10"],
    [expenses.buildOrderExpensePrintHtml({
      name: "Test Order", period: "2026-10-01", note: "Keep this note", rows: [],
    }), "团务費用明細", "行程日期：2026-10-01"],
    [balance.buildBalancePrintHtml({
      ...base, summary: summarizeBalance("", [], [], []),
    }), "收支平衡月度報表", "服务月份：2026-10"],
  ];
  for (const [html, title, metadata] of reports) {
    assert.doesNotMatch(html, /制表|運転士签收|审核|签收日期|填報：|核对：|signatures|_{4,}/, title);
    assert.ok(html.includes(`<h1>${title}</h1>`), title);
    assert.ok(html.includes(metadata), title);
    assert.match(html, /<table/);
  }
  assert.match(reports[0][0], /工資総额<strong>¥500<\/strong>/);
  assert.match(reports[5][0], /Keep this note/);
});

test("mobile viewport permits native page zoom", () => {
  const source = fs.readFileSync(path.join(root, "app\\layout.tsx"), "utf8");
  const declaration = source.match(/export const viewport: Viewport = (\{[\s\S]*?\});/);
  assert.ok(declaration);
  const viewport = vm.runInNewContext(`(${declaration[1]})`);
  assert.equal(viewport.width, "device-width");
  assert.equal(viewport.initialScale, 1);
  assert.equal(viewport.minimumScale, 0.5);
  assert.equal(viewport.maximumScale, 5);
  assert.equal(viewport.userScalable, true);
});

test("mobile calendar pinch anchors the midpoint and preserves single-touch scrolling", () => {
  const handlers = new Map();
  const styles = new Map();
  const element = {
    style: { setProperty(name, value) { styles.set(name, value); } },
    scrollLeft: 1000, scrollTop: 400,
    scrollTo({ left, top }) { this.scrollLeft = left; this.scrollTop = top; },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    addEventListener(name, handler, options) { handlers.set(name, { handler, options }); },
    removeEventListener(name) { handlers.delete(name); },
  };
  let cleanup;
  let scale = 1;
  let stateIndex = 0;
  let layout;
  const { useCalendarZoom } = load("lib\\use-calendar-zoom.ts", {
    react: {
      useState(initial) {
        if (stateIndex++ === 0) return [element, () => {}];
        if (stateIndex === 3) return [initial, () => {}];
        return [initial, (next) => { scale = next; }];
      },
      useRef: (current) => ({ current }),
      useLayoutEffect(callback) { layout = callback; },
      useEffect(callback) { cleanup = callback(); },
    },
  });
  useCalendarZoom(true);
  const touch = (name, separation, count = 2) => {
    let prevented = false;
    const touches = [{ clientX: 0, clientY: 0 }];
    if (count === 2) touches.push({ clientX: separation, clientY: 0 });
    handlers.get(name).handler({ touches, preventDefault() { prevented = true; } });
    return prevented;
  };
  assert.equal(handlers.get("touchmove").options.passive, false);
  assert.equal(touch("touchstart", 0, 1), false);
  assert.equal(touch("touchmove", 0, 1), false);
  assert.equal(touch("touchstart", 200), true);
  assert.equal(touch("touchmove", 100), true);
  assert.equal(scale, 0.5);
  layout();
  assert.equal(element.scrollLeft, 500);
  assert.equal(element.scrollTop, 200);
  assert.equal(handlers.has("scroll"), false, "frozen positioning must not wait for scroll events");
  touch("touchmove", 20);
  assert.equal(scale, 0.25);
  touch("touchend", 0, 1);
  touch("touchstart", 100);
  touch("touchmove", 200);
  assert.equal(scale, 0.5);
  touch("touchmove", 1000);
  assert.equal(scale, 2.5);
  touch("touchmove", 10000);
  assert.equal(scale, 5);
  let blockedClick = false;
  handlers.get("click").handler({
    preventDefault() { blockedClick = true; },
    stopPropagation() {},
  });
  assert.equal(blockedClick, true, "a pinch must not open or create a reservation");
  touch("touchend", 0, 1);
  touch("touchstart", 0, 1);
  blockedClick = false;
  handlers.get("click").handler({
    preventDefault() { blockedClick = true; },
    stopPropagation() {},
  });
  assert.equal(blockedClick, false, "the next intentional tap remains available");
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(source, /"--calendar-scale": calendarScale/);
  assert.doesNotMatch(source, /mobilePageScale|mobilePageZoomRef/);
  cleanup();
  assert.equal(handlers.size, 0);
});

test("mobile calendar freezes vehicle columns in portrait and touch landscape", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.equal((source.match(/className="calendar-vehicle-column /g) || []).length, 2);
  assert.match(css, /@media \(max-width: 639px\), \(hover: none\) and \(pointer: coarse\) \{\s*\.calendar-vehicle-column \{\s*position: sticky;\s*left: 0;\s*z-index: 10;/);
  assert.doesNotMatch(css, /calendar-frozen-offset/);
  assert.match(css, /\.mobile-calendar-view \.calendar-scroll \{\s*--calendar-vehicle-width: 100px;/);
  assert.match(css, /\.mobile-calendar-view \.calendar-reorder-handle \{\s*display: none;/);
  assert.equal((source.match(/gridTemplateColumns: `calc\(var\(--calendar-vehicle-width, 135px\)/g) || []).length, 2);
  assert.match(source, /minWidth: Math\.max\(1320, 135 \+ dates\.length \* 130\)/);
});

test("calendar text scales with the grid without mobile font inflation", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.match(source, /className="calendar-grid min-w-\[1320px\]/);
  assert.match(source, /"--calendar-scale": calendarScale/);
  assert.match(css, /\.calendar-vehicle-row > :not\(\.calendar-vehicle-column\) \{\s*zoom: var\(--calendar-scale, 1\);/);
  assert.match(css, /\.calendar-grid \{\s*-webkit-text-size-adjust: none;\s*text-size-adjust: none;\s*\}/);
  assert.match(css, /\.calendar-date-header,\s*\.calendar-vehicle-content \{\s*font-size: calc\(16px \* var\(--calendar-scale, 1\)\);/);
  assert.match(source, /<div className="calendar-vehicle-content">車両<\/div>/);
  assert.match(source, /className="calendar-vehicle-content flex w-full/);
});

test("mobile vehicle column keeps only plate and notes while desktop retains all fields", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "app\\globals.css"), "utf8");
  const start = source.indexOf('const plate = vehicleRecord.plate ||');
  const fields = source.slice(start, source.indexOf("\n                  })()}", start));
  const buttons = [...fields.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(([button]) => button);
  assert.equal(buttons.length, 4);
  assert.doesNotMatch(buttons[0], /calendar-vehicle-desktop-field/);
  assert.match(buttons[0], /copyCalendarVehicleField\(plate/);
  assert.match(buttons[1], /calendar-vehicle-desktop-field/);
  assert.doesNotMatch(buttons[2], /calendar-vehicle-desktop-field/);
  assert.match(buttons[2], /copyCalendarVehicleField\(notes/);
  assert.match(buttons[3], /calendar-vehicle-desktop-field/);
  assert.match(css, /\.mobile-calendar-view \.calendar-vehicle-desktop-field \{\s*display: none;/);
});

test("calendar cards show saved invoice completion on desktop only", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const first = source.indexOf("function CalendarInvoiceStatus(");
  const context = { require: nodeRequire, exports: {} };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(
    source.slice(first, source.indexOf("const statusStyles:", first)),
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText, context);
  for (const [status, label, color] of [
    ["已完成", "請求書已完成", "emerald"],
  ]) {
    const tree = context.CalendarInvoiceStatus({ status });
    const html = renderToStaticMarkup(tree);
    assert.ok(html.includes(label));
    assert.equal(tree.props.title, label);
    assert.ok(tree.props.className.includes(`border-${color}-600`));
  }
  for (const status of ["未完成", undefined, ""]) {
    assert.equal(context.CalendarInvoiceStatus({ status }), null);
    assert.equal(renderToStaticMarkup(context.CalendarInvoiceStatus({ status })), "");
  }
  const compactStart = source.indexOf("{isCompactCalendar && driverSegments.map(");
  const compact = source.slice(compactStart, source.indexOf("{isMobileCalendar && !isCompactCalendar && (", compactStart));
  assert.doesNotMatch(compact, /CalendarInvoiceStatus|invoiceStatus/);
  assert.match(compact, /<DriverExecutionBadge row=\{execution\} date=\{day\.date\}/);
  const desktopStart = source.indexOf("{!isMobileCalendar && driverSegments.map(");
  const desktop = source.slice(desktopStart, source.indexOf("{!isMobileCalendar && showTripSummaries", desktopStart));
  assert.equal((desktop.match(/<CalendarInvoiceStatus status=\{order.invoiceStatus\}/g) || []).length, 1);
  assert.equal((source.match(/<CalendarInvoiceStatus status=\{order.invoiceStatus\}/g) || []).length, 1);
});

test("mobile calendar centers one order name and daily driver group per continuous assignment at every scale", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const condition = source.match(/const isCompactCalendar = ([^;]+);/);
  assert.ok(condition);
  for (const isMobileCalendar of [true, false]) {
    for (const calendarScale of [0.25, 0.5, 0.749, 0.75, 0.751, 1, 5]) {
      assert.equal(
        vm.runInNewContext(condition[1], { isMobileCalendar, calendarScale }),
        isMobileCalendar,
      );
    }
  }
  const compactStart = source.indexOf("{isCompactCalendar && driverSegments.map(");
  const compact = source.slice(compactStart, source.indexOf("{isMobileCalendar && !isCompactCalendar && (", compactStart));
  assert.match(compact, /segment\.label \|\| "未安排"/);
  assert.equal((compact.match(/segment\.label \|\| "未安排"/g) || []).length, 1);
  assert.equal((compact.match(/order\.customer/g) || []).length, 1);
  assert.match(compact, /flex-col items-center justify-center break-all px-1 text-center text-xs leading-4/);
  assert.ok(compact.indexOf("order.customer") < compact.indexOf("segment.label"));
  assert.match(compact, /items-center justify-center break-all px-1 text-center/);
  assert.match(compact, /top: \(orderCardHeight \/ 2 - 4\) \* calendarScale, transform: "translateY\(-50%\)"/);
  assert.match(source, /paddingTop: executionPadding \+ \(isSplittable \? 24 : 0\)/);
  assert.doesNotMatch(compact, /barDates\.map|order\.time|order\.status|order\.orderSource|取消拆分/);
  assert.match(compact, /getTripSummary\(order, day\.date\)/);
  assert.match(compact, /barDates\.slice\(segment\.start, segment\.end\)/);
  assert.match(source, /!isCompactCalendar && isSplittable && splitSelection/);
  assert.match(source, /if \(splitSelection && !isCompactCalendar\)/);
});

test("mobile calendar card measurements expand lanes for wrapped content", () => {
  let current = {};
  let resize;
  let cleanup;
  let disconnected = false;
  const contents = [
    { dataset: { calendarCardVehicle: "a" }, offsetHeight: 140 },
    { dataset: { calendarCardVehicle: "a" }, offsetHeight: 220 },
    { dataset: { calendarCardVehicle: "b" }, offsetHeight: 30 },
  ];
  const { useCalendarCardHeights } = load("lib\\use-calendar-card-heights.ts", {
    react: {
      useState: () => [current, (update) => { current = update(current); }],
      useLayoutEffect(callback) { cleanup = callback(); },
    },
  }, {
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
  });
  useCalendarCardHeights({ current: { querySelectorAll: () => contents } }, true);
  assert.deepEqual(plain(current), { a: 230, b: 56 });
  const previous = current;
  resize();
  assert.equal(current, previous, "unchanged dimensions do not cause another render");
  contents[1].offsetHeight = 300;
  resize();
  assert.equal(current.a, 310);
  useCalendarCardHeights({ current: { querySelectorAll: () => contents } }, true, 0.5);
  assert.equal(current.a, 610, "screen-pixel heights convert back into unscaled lane heights");
  assert.equal(disconnected, false);
  cleanup();
  assert.equal(disconnected, true);
});

test("mobile calendar dates contain whole contiguous months across year and leap boundaries", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const functions = source.slice(
    source.indexOf("function createCalendarDates("),
    source.indexOf("function formatOrderDate("),
  );
  const context = {
    Date, Intl,
    getJapaneseHolidays: () => new Set(),
    toDateKey: (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(functions, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  for (const first of [new Date(2026, 10, 1), new Date(2024, 0, 1), new Date(2026, 0, 1)]) {
    const dates = context.createMobileCalendarDates(first);
    assert.equal(dates[0].date, context.toDateKey(first));
    assert.equal(dates.at(-1).date, context.toDateKey(new Date(first.getFullYear(), first.getMonth() + 5, 0)));
    for (let i = 1; i < dates.length; i++) {
      const next = new Date(`${dates[i - 1].date}T12:00:00`);
      next.setDate(next.getDate() + 1);
      assert.equal(dates[i].date, context.toDateKey(next));
    }
    const shifted = context.createMobileCalendarDates(new Date(first.getFullYear(), first.getMonth() + 1, 1));
    const overlap = dates.filter((day) => day.date >= shifted[0].date).map((day) => day.date);
    assert.deepEqual(plain(shifted.slice(0, overlap.length).map((day) => day.date)), plain(overlap));
  }
  assert.equal(context.createMobileCalendarDates(new Date(2024, 0, 1)).some((day) => day.date === "2024-02-29"), true);
  assert.equal(context.createSlidingDates(new Date(2026, 9, 23)).length, 11);
  assert.doesNotMatch(source, /calendarSwipeRef|onTouchEnd=/);
});

test("mobile timeline starts with today at the left and preserves visible dates while extending", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const dateFunctions = source.slice(source.indexOf("function createCalendarDates("), source.indexOf("function formatOrderDate("));
  const now = new Date();
  let month = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  let days = [];
  const context = {
    Date, Intl,
    isMobileCalendar: true, calendarScale: 1, isCalendarPinching: false, activeView: "calendar", isDataReady: true, currentProfile: {},
    getJapaneseHolidays: () => new Set(),
    toDateKey: (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    mobileCalendarFirstMonth: month,
    calendarAnchorRef: { current: null },
    calendarCenteredRef: { current: false },
    calendarTodayRequestedRef: { current: false },
    calendarQueryDateRef: { current: null },
    calendarTodayRequest: 0,
    setMobileCalendarVisibleRange(update) {
      context.mobileCalendarVisibleRange =
        typeof update === "function"
          ? update(context.mobileCalendarVisibleRange)
          : update;
    },
    useCallback(callback) { return callback; },
    useLayoutEffect(callback) { context.layout = callback; },
    setMobileCalendarFirstMonth(update) {
      month = typeof update === "function" ? update(month) : update;
      days = context.createMobileCalendarDates(month);
    },
  };
  const scroller = {
    scrollLeft: 0, clientWidth: 390,
    get scrollWidth() { return (100 + days.length * 130) * context.calendarScale; },
    getBoundingClientRect: () => ({ left: 0, right: scroller.clientWidth }),
    querySelector(selector) {
      if (selector === ".calendar-vehicle-column") return {
        offsetWidth: 100 * context.calendarScale,
        getBoundingClientRect: () => ({ width: 100 }),
      };
      const date = selector.match(/"([^"]+)"/)[1];
      return this.querySelectorAll().find((cell) => cell.dataset.calendarDate === date);
    },
    querySelectorAll() {
      return days.map((day, index) => ({
        dataset: { calendarDate: day.date }, offsetWidth: 130 * context.calendarScale,
        offsetLeft: (100 + index * 130) * context.calendarScale,
        getBoundingClientRect: () => ({
          left: (100 + index * 130) * context.calendarScale - scroller.scrollLeft,
          right: (100 + (index + 1) * 130) * context.calendarScale - scroller.scrollLeft,
        }),
      }));
    },
  };
  context.calendarScrollRef = { current: scroller };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(dateFunctions, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  days = context.createMobileCalendarDates(month);
  const updaterStart = source.indexOf("  const updateMobileCalendarVisibleRange = useCallback(");
  const updater = source.slice(updaterStart, source.indexOf("\n  useEffect(() => {", updaterStart));
  vm.runInContext(ts.transpileModule(updater, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const effectStart = source.indexOf("  useLayoutEffect(() => {", source.indexOf('const [activeView, setActiveView]'));
  const effect = source.slice(effectStart, source.indexOf("\n  }, [", effectStart)) + "\n  });";
  vm.runInContext(ts.transpileModule(effect, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const scrollStart = source.indexOf("        onScroll={(event) => {", source.indexOf('className="calendar-scroll'));
  const scrollHandler = source.slice(scrollStart + "        onScroll={".length, source.indexOf("\n        }}", scrollStart) + "\n        }".length);
  vm.runInContext(ts.transpileModule(`onScroll = ${scrollHandler};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  context.layout();
  assert.equal(context.mobileCalendarVisibleRange.startDate, context.toDateKey(now));
  const todayCell = scroller.querySelector(`[data-calendar-date="${context.toDateKey(now)}"]`);
  assert.equal(todayCell.getBoundingClientRect().left, 100);
  context.isCalendarPinching = true;
  scroller.scrollLeft = 0;
  const beforePinchMonth = month;
  const beforePinchRange = context.mobileCalendarVisibleRange;
  context.onScroll({ currentTarget: scroller });
  assert.equal(month, beforePinchMonth);
  assert.equal(context.mobileCalendarVisibleRange, beforePinchRange);
  context.isCalendarPinching = false;
  for (const width of [390, 932]) {
    scroller.clientWidth = width;
    for (const scale of [0.5, 1, 2]) {
      context.calendarScale = scale;
      for (const direction of [1, -1]) {
        for (let i = 0; i < 24; i++) {
          scroller.scrollLeft = direction === 1 ? scroller.scrollWidth - width - 100 : 100;
          context.onScroll({ currentTarget: scroller });
          const anchor = { ...context.calendarAnchorRef.current };
          assert.ok(anchor.date);
          context.layout();
          assert.equal(scroller.querySelector(`[data-calendar-date="${anchor.date}"]`).getBoundingClientRect().left, anchor.left);
          assert.equal(context.calendarAnchorRef.current, null);
          assert.ok(days.length >= 150 && days.length <= 153, "rendered range remains bounded");
        }
      }
    }
  }
  for (const width of [390, 932]) {
    for (const scale of [0.25, 0.5, 1, 5]) {
      scroller.clientWidth = width;
      context.calendarScale = scale;
      context.setMobileCalendarFirstMonth(new Date(now.getFullYear(), now.getMonth() - 2, 1));
      context.calendarTodayRequestedRef.current = true;
      context.layout();
      const today = scroller.querySelector(`[data-calendar-date="${context.toDateKey(now)}"]`);
      const todayCenter = today.offsetLeft + today.offsetWidth / 2 - scroller.scrollLeft;
      const dateViewportCenter = 100 * scale + (width - 100 * scale) / 2;
      assert.equal(todayCenter, dateViewportCenter);
      assert.equal(context.calendarTodayRequestedRef.current, false);
    }
  }
  const queryDate = "2028-02-29";
  context.calendarQueryDateRef.current = queryDate;
  context.setMobileCalendarFirstMonth(new Date(2027, 11, 1));
  context.calendarTodayRequestedRef.current = true;
  context.layout();
  const queriedCell = scroller.querySelector(`[data-calendar-date="${queryDate}"]`);
  assert.ok(queriedCell, "quick query loads a date outside the original month range");
  assert.equal(
    queriedCell.offsetLeft + queriedCell.offsetWidth / 2 - scroller.scrollLeft,
    100 * context.calendarScale + (scroller.clientWidth - 100 * context.calendarScale) / 2,
  );
  assert.equal(context.calendarTodayRequestedRef.current, false);
  context.isMobileCalendar = false;
  const previousMonth = month;
  context.onScroll({ currentTarget: scroller });
  assert.equal(month, previousMonth, "desktop scroll must not extend the timeline");
});

test("mobile calendar shows only the region control and calendar without changing other views", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.match(source, /<header className="dashboard-header [^"]*bg-slate-900 px-4 py-2 text-white sm:px-6 sm:py-2">/);
  const header = source.slice(source.indexOf('<header className="dashboard-header'), source.indexOf("</header>"));
  assert.doesNotMatch(header, />\s*当日\s*</);
  assert.match(header, /type="date"\s+aria-label="日历快速查询日期"[\s\S]*setCalendarCenterDate\(selectedDate\)/);
  assert.match(source, /activeView === "calendar" \? " mobile-calendar-view" : ""/);
  for (const name of ["calendar-region-selector", "calendar-toolbar", "calendar-vehicle-filters", "calendar-scroll"]) {
    assert.ok(source.includes(`className="${name} `), name);
  }
  assert.match(css, /\.mobile-calendar-view \.dashboard-actions > :not\(\.calendar-region-selector\)/);
  assert.match(css, /\.mobile-calendar-view \.dashboard-sidebar,/);
  assert.match(css, /\.mobile-calendar-view \.calendar-toolbar \{\s*display: none;/);
  assert.match(css, /\.mobile-calendar-view \.calendar-scroll \{\s*--calendar-vehicle-width: 100px;\s*flex: 1;\s*min-height: 0;\s*max-height: none;\s*padding: 0;/);
  assert.match(css, /\.mobile-calendar-view \{\s*display: flex;\s*flex-direction: column;\s*height: 100dvh;\s*min-height: 0;\s*overflow: hidden;/);
  assert.match(css, /\.mobile-calendar-view \.workspace-content \{\s*display: flex;\s*flex-direction: column;\s*min-height: 0;/);
  assert.match(css, /\.mobile-calendar-view \.calendar-vehicle-column \{\s*padding: calc\(12px \* var\(--calendar-scale, 1\)\) calc\(3px \* var\(--calendar-scale, 1\)\);/);
  assert.match(css, /\.mobile-calendar-view \.calendar-vehicle-content \{\s*width: calc\(93px \* var\(--calendar-scale, 1\)\);\s*flex-shrink: 0;/);
});

test("calendar orders vehicles by generation and puts out-of-service vehicles last", () => {
  const { compareCalendarVehicles } = load("lib\\vehicle-order.ts");
  const vehicles = [
    { id: "a", name: "Tesla" },
    { id: "b", name: "Alphard 二代" },
    { id: "c", name: "Hiace" },
    { id: "d", name: "Alphard" },
    { id: "e", name: "外注 Alphard 四代" },
    { id: "f", name: "Alphard 三代" },
    { id: "g", name: "Alphard 四代" },
    { id: "h", name: "Alphard 四代", outOfService: true },
    { id: "i", name: "Hiace", outOfService: true },
  ];
  assert.deepEqual(
    vehicles.slice().sort(compareCalendarVehicles).map((vehicle) => vehicle.id),
    ["g", "f", "d", "c", "b", "a", "e", "h", "i"],
  );
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(source, /outOfService: getVehicleDisplayStatus\(vehicle\) !== "运营中"/);
  assert.match(source, /\.sort\(compareCalendarVehicles\)/);
});

test("calendar vehicle order can be dragged and is shared through the database", () => {
  const { compareCalendarVehicles, moveCalendarVehicle } = load("lib\\vehicle-order.ts");
  const sorted = [
    { id: "t", name: "Tesla", calendarOrder: 0 },
    { id: "a4", name: "Alphard 四代", calendarOrder: 1 },
    { id: "h", name: "Hiace", calendarOrder: null },
    { id: "a3", name: "Alphard 三代" },
    { id: "x", name: "Alphard 四代", calendarOrder: 0, outOfService: true },
  ].sort(compareCalendarVehicles).map((vehicle) => vehicle.id);
  assert.deepEqual(sorted, ["t", "a4", "a3", "h", "x"]);
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(plain(moveCalendarVehicle(ids, "d", "a", false)), ["d", "a", "b", "c"]);
  assert.deepEqual(plain(moveCalendarVehicle(ids, "a", "c", true)), ["b", "c", "a", "d"]);
  assert.equal(moveCalendarVehicle(ids, "a", "a", false), ids);

  const migration = fs.readFileSync(path.join(root, "supabase\\migrations\\20261031000000_vehicle_calendar_order.sql"), "utf8");
  assert.match(migration, /add column if not exists calendar_order integer/);
  const route = fs.readFileSync(path.join(root, "app\\api\\data\\route.ts"), "utf8");
  assert.match(route, /calendarOrder: z\.number\(\)\.int\(\)\.min\(0\)\.max\(1_000_000\)\.nullable\(\)\.default\(null\)/);
  assert.match(route, /calendar_order: vehicle\.calendarOrder \?\? null/);
  assert.match(route, /calendarOrder: row\.calendar_order \?\? null/);
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(source, /setData\("application\/x-calendar-vehicle", vehicleRecord\.id\)/);
  assert.match(source, /break-all text-center text-\[13px\] font-bold/);
  assert.match(source, /reorderCalendarVehicle\(\s*draggingCalendarVehicleId,/);
  assert.match(source, /\{ id: vehicle\.id, \.\.\.savedVehicle, calendarOrder: vehicle\.calendarOrder \?\? null \}/);
});

test("company filter dropdowns no longer offer an 未填写 option", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.doesNotMatch(source, /<option value="__unassigned_company__">未填写<\/option>/);
  assert.equal((source.match(/<option value="">全部会社<\/option>/g) ?? []).length, 3);
});

test("vehicle list can be filtered by owner company", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(source, /aria-label="車両所属筛选"/);
  assert.match(source, /vehicleRows\.filter\(\(vehicle\) => \(vehicle\.ownerCompany \|\| ""\) === vehicleOwnerFilter\)/);
  assert.match(source, /\{filteredVehicleRows\.map\(\(vehicle\) =>/);
  assert.match(source, /共 \{filteredVehicleRows\.length\} 両/);
});

test("vehicle form selects start empty so the first fuel type, seat count, and company can be saved", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(source, /<option value="">请選択燃油类型<\/option>\s*\{fuelTypes\.map/);
  assert.match(source, /<option value="">请選択座位数<\/option>/);
  assert.match(source, /<option value="">请選択所属会社<\/option>/);
});

test("orders link vehicles by plate so vehicle names may repeat, while plates stay unique", () => {
  const { orderUsesVehicle, resolveOrderVehicle } = load("lib\\vehicle-order.ts");
  const vehicles = [
    { id: "a", regionId: "r1", name: "Alphard", plate: "4543" },
    { id: "b", regionId: "r1", name: "Alphard", plate: "5678" },
    { id: "c", regionId: "r1", name: "Hiace", plate: "1111" },
    { id: "d", regionId: "r2", name: "Alphard", plate: "4543" },
  ];
  assert.equal(orderUsesVehicle({ regionId: "r1", vehicle: "Alphard", vehiclePlate: "5678" }, vehicles[0]), false);
  assert.equal(orderUsesVehicle({ regionId: "r1", vehicle: "Alphard", vehiclePlate: "5678" }, vehicles[1]), true);
  assert.equal(orderUsesVehicle({ regionId: "r2", vehicle: "Alphard", vehiclePlate: "4543" }, vehicles[0]), false);
  assert.equal(orderUsesVehicle({ regionId: "r1", vehicle: "Hiace", vehiclePlate: "" }, vehicles[2]), true);
  assert.equal(resolveOrderVehicle(vehicles, { regionId: "r1", vehicle: "Alphard", vehiclePlate: "4543" })?.id, "a");
  assert.equal(resolveOrderVehicle(vehicles, { regionId: "r1", vehicle: "Alphard", vehiclePlate: "" }), undefined);
  assert.equal(resolveOrderVehicle(vehicles, { regionId: "r1", vehicle: "Hiace", vehiclePlate: "" })?.id, "c");

  const { findOrderConflicts } = load("lib\\order-conflicts.ts");
  const base = { regionId: "r1", vehicle: "Alphard", status: "予約確定", offDates: [], date: "2026-12-01", endDate: "2026-12-01", time: "09:00" };
  const existing = [
    { ...base, id: 1, vehiclePlate: "4543" },
    { ...base, id: 2, vehiclePlate: "5678", financeByDate: { "2026-12-01": { vehicle: "Hiace", vehiclePlate: "1111" } } },
  ];
  const conflictIds = (draft) => plain(findOrderConflicts({ ...base, ...draft }, existing)).map(({ order }) => order.id);
  assert.deepEqual(conflictIds({ vehiclePlate: "4543" }), [1]);
  assert.deepEqual(conflictIds({ vehiclePlate: "9999" }), []);
  assert.deepEqual(conflictIds({ vehicle: "Hiace", vehiclePlate: "1111" }), [2]);
  assert.deepEqual(conflictIds({ vehiclePlate: "" }), [1]);

  const { summarizeVehicles } = load("lib\\vehicle-finance-summary.ts", {
    "@/lib/vehicle-order": load("lib\\vehicle-order.ts"),
  });
  const fleet = vehicles.slice(0, 2).map((vehicle) => ({ ...vehicle, defaultParkingFee: 0, defaultInsuranceFee: 0 }));
  const totals = { requestAmount: 100, driverAdvances: 0, companyExpenses: 0, driverWages: 0 };
  const rows = plain(summarizeVehicles("2026-12", fleet, [], [
    { ...totals, regionId: "r1", vehicleName: "Alphard", vehicleId: "b" },
    { ...totals, regionId: "r1", vehicleName: "Alphard" },
  ]));
  assert.equal(rows.find((row) => row.key === "b").requestAmount, 100);
  assert.equal(rows.find((row) => row.key === "a").requestAmount, 0);
  assert.ok(rows.some((row) => row.vehicleNumber.includes("番号未指定") && row.requestAmount === 100));

  const migration = fs.readFileSync(path.join(root, "supabase\\migrations\\20261030000000_order_vehicle_plate.sql"), "utf8");
  assert.ok(migration.includes("add column if not exists vehicle_plate text not null default ''"));
  const route = fs.readFileSync(path.join(root, "app\\api\\data\\route.ts"), "utf8");
  assert.ok(route.includes("vehicle_plate: order.vehiclePlate"));
  assert.ok(route.includes('vehiclePlate: row.vehicle_plate ?? ""'));

  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("getVehicleSegments(order, dates.filter"));
  assert.ok(source.includes("車両番号不能重复"));
  assert.ok(source.includes("車両番号不能重复："));
  assert.ok(!source.includes("車名重复"));
  assert.ok(!source.includes("同一地域已有車名"));
  assert.ok(!source.includes("同一地域内車名不能重复"));
});

test("order conflicts cover editing, multi-day ranges, and close departure times", () => {
  const { findOrderConflicts } = load("lib\\order-conflicts.ts");
  const base = { regionId: "r1", vehicle: "Alphard", status: "確定", offDates: [] };
  const orders = [
    { ...base, id: 1, date: "2026-10-01", endDate: "2026-10-01", time: "09:00" },
    { ...base, id: 2, date: "2026-10-03", endDate: "2026-10-05", time: "08:00", offDates: ["2026-10-04"] },
    { ...base, id: 3, date: "2026-10-01", endDate: "2026-10-01", time: "09:30", status: "キャンセル" },
    { ...base, id: 4, date: "2026-10-01", endDate: "2026-10-01", time: "09:30", vehicle: "Other" },
  ];
  const ids = (draft, excludeId) =>
    [...findOrderConflicts({ ...base, ...draft }, orders, excludeId)].map(({ order }) => order.id);

  assert.deepEqual(ids({ date: "2026-10-01", endDate: "2026-10-01", time: "10:30" }), [1]);
  assert.deepEqual(ids({ date: "2026-10-01", endDate: "2026-10-01", time: "11:00" }), []);
  assert.deepEqual(ids({ date: "2026-10-01", endDate: "2026-10-01", time: "09:10" }, 1), []);
  assert.deepEqual(ids({ date: "2026-10-05", endDate: "2026-10-05", time: "20:00" }), [2]);
  assert.deepEqual(ids({ date: "2026-10-04", endDate: "2026-10-04", time: "08:00" }), []);
  assert.deepEqual(ids({ date: "2026-09-30", endDate: "2026-10-03", time: "07:00" }), [1, 2]);
  assert.deepEqual(ids({ date: "2026-10-01", endDate: "2026-10-01", time: "10:00", regionId: "r2" }), []);
  assert.deepEqual(ids({ date: "2026-10-01", endDate: "2026-10-01", time: "" }), []);
  assert.deepEqual(ids({ date: "2026-09-30", endDate: "2026-10-03", time: "" }), []);
  const timeless = [...orders, { ...base, id: 5, date: "2026-10-01", endDate: "2026-10-01", time: "" },
    { ...base, id: 6, date: "2026-10-01", endDate: "2026-10-02", time: "" }];
  assert.deepEqual([...findOrderConflicts({ ...base, date: "2026-10-01", endDate: "2026-10-01", time: "09:00" }, timeless)].map(({ order }) => order.id), [1]);

  const driverOrders = [
    { ...base, id: 10, vehicle: "Car A", driver: "Tanaka", date: "2026-11-01", endDate: "2026-11-01", time: "09:00" },
    { ...base, id: 11, vehicle: "Car B", driver: "Sato", date: "2026-11-02", endDate: "2026-11-03", time: "08:00",
      financeByDate: { "2026-11-03": { driver: "Tanaka", vehicle: "Car B" } } },
  ];
  const driverConflicts = (draft, excludeId) =>
    JSON.parse(JSON.stringify(findOrderConflicts({ ...base, vehicle: "Car C", ...draft }, driverOrders, excludeId)));
  const sameDriver = driverConflicts({ driver: " Tanaka ", date: "2026-11-01", endDate: "2026-11-01", time: "10:00" });
  assert.deepEqual(sameDriver.map(({ order, reasons, drivers }) => [order.id, reasons, drivers]), [[10, ["driver"], ["Tanaka"]]]);
  assert.deepEqual(driverConflicts({ driver: "Tanaka", date: "2026-11-01", endDate: "2026-11-01", time: "12:00" }), []);
  assert.deepEqual(driverConflicts({ driver: "Tanaka", date: "2026-11-01", endDate: "2026-11-01", time: "09:30" }, 10), []);
  assert.deepEqual(driverConflicts({ driver: "", date: "2026-11-01", endDate: "2026-11-01", time: "09:00" }), []);
  assert.deepEqual(driverConflicts({ driver: "Tanaka", date: "2026-11-03", endDate: "2026-11-03", time: "20:00" }).map(({ order }) => order.id), [11]);
  assert.deepEqual(driverConflicts({ driver: "Sato", date: "2026-11-03", endDate: "2026-11-03", time: "20:00" }), []);
  const both = findOrderConflicts({ ...base, vehicle: "Car A", driver: "Tanaka", date: "2026-11-01", endDate: "2026-11-01", time: "09:00" }, driverOrders);
  assert.deepEqual([...both[0].reasons], ["vehicle", "driver"]);

  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("if (!skipConflictCheck) {"));
  assert.ok(source.includes("運転士重复："));
  assert.ok(source.indexOf("{ ...savedForm, regionId: targetRegionId }") > source.indexOf("const savedForm: OrderDraft"));
  assert.ok(!source.includes("if (editingOrderId === null && !skipConflictCheck)"));
});

test("overlapping multi-day orders stack inside the same calendar cell row", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(!source.includes("gridRow: isSingleDayOrder ? 1 : orderLane + 1"));
  assert.ok(source.includes("const laneOffset = orderLane * (orderCardHeight + orderCardGap) + orderCardGap;"));
  assert.ok(source.includes("const baseOrderCardHeight = 56;"));
  assert.doesNotMatch(source, /maxDailyOrderCount|orderCardHeights/);
  const layout = source.slice(source.indexOf("            const orderLanes ="), source.indexOf("\n            return (", source.indexOf("            const orderLanes =")));
  const evaluate = (
    visibleOrders,
    isMobileCalendar = false,
    mobileCalendarVisibleRange = isMobileCalendar
      ? { startDate: "2026-10-01", endDate: "2026-10-02" }
      : null,
    driverExecutionByOrder = new Map(),
  ) => {
    const context = {
      visibleOrders,
      dates: [{ date: "2026-10-01" }, { date: "2026-10-02" }],
      isMobileCalendar,
      mobileCalendarVisibleRange,
      vehicleRecord: { id: "vehicle" },
      mobileCalendarCardHeights: {},
      driverExecutionByOrder,
    };
    const script = ts.transpileModule(`${layout}\nresult = {
      heights: [...singleDayCellHeights.values()],
      offsets: visibleOrders.map((order) => (orderLanes.get(order.id) || 0) * (orderCardHeight + orderCardGap) + orderCardGap),
      cardHeight: orderCardHeight,
    };`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(script, context);
    return plain(context.result);
  };
  for (const count of [1, 2, 3, 5, 10]) {
    const orders = Array.from({ length: count }, (_, index) => ({
      id: String(index), date: "2026-10-01", endDate: "2026-10-02",
    }));
    const { heights, offsets, cardHeight } = evaluate(orders);
    assert.equal(cardHeight, 56);
    assert.deepEqual(heights, Array(2).fill(`${Math.max(96, count * 60 + 44)}px`));
    for (let index = 1; index < offsets.length; index++) {
      assert.ok(offsets[index] >= offsets[index - 1] + cardHeight + 4);
    }
    assert.ok(parseFloat(heights[0]) - (offsets.at(-1) + cardHeight) >= 44);

    const mobileHeights = evaluate(orders, true).heights;
    assert.deepEqual(mobileHeights, Array(2).fill(`${count * 60 + 12}px`));
    assert.ok(parseFloat(mobileHeights[0]) - (offsets.at(-1) + cardHeight) >= 12);
  }
  assert.deepEqual(evaluate([], true).heights, ["72px", "72px"]);
  const crowdedEarlierDate = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `early-${index}`,
      date: "2026-10-01",
      endDate: "2026-10-01",
    })),
    { id: "later", date: "2026-10-02", endDate: "2026-10-02" },
  ];
  assert.deepEqual(
    evaluate(crowdedEarlierDate, true, {
      startDate: "2026-10-02",
      endDate: "2026-10-02",
    }).heights,
    ["72px", "72px"],
  );
  assert.deepEqual(
    evaluate(crowdedEarlierDate, true, {
      startDate: "2026-10-01",
      endDate: "2026-10-01",
    }).heights,
    ["252px", "252px"],
  );
  assert.deepEqual(evaluate([
    { id: "first", date: "2026-10-01", endDate: "2026-10-01" },
    { id: "second", date: "2026-10-02", endDate: "2026-10-02" },
  ]).offsets, [4, 4]);
  assert.deepEqual(evaluate([]).heights, ["96px", "96px"]);
  const activeOrders = [
    { id: "active", date: "2026-10-01", endDate: "2026-10-02" },
    { id: "other", date: "2026-10-01", endDate: "2026-10-02" },
  ];
  const status = new Map([["active", { date: "2026-10-01", status: "en_route" }]]);
  const activeLayout = evaluate(activeOrders, false, null, status);
  assert.equal(activeLayout.cardHeight, 74);
  assert.deepEqual(activeLayout.offsets, [4, 82]);
  assert.deepEqual(activeLayout.heights, ["200px", "200px"]);
  assert.equal(evaluate(activeOrders, true, undefined, status).cardHeight, 74);
  assert.equal(evaluate(activeOrders).cardHeight, 56, "completion hides only the header, never the booking");
  const withSummary = evaluate([
    { id: "trip", date: "2026-10-01", endDate: "2026-10-02", offDates: [],
      financeByDate: { "2026-10-02": { tripSummary: "成田 → 東京" } } },
  ]);
  assert.equal(withSummary.cardHeight, 72);
  assert.deepEqual(withSummary.heights, ["120px", "120px"]);
  assert.equal(evaluate([
    { id: "single", date: "2026-10-01", endDate: "2026-10-01", offDates: [],
      financeByDate: { "2026-10-01": { tripSummary: "09:00 成田 → 東京" } } },
  ]).cardHeight, 56);
  assert.equal(evaluate([
    { id: "off", date: "2026-10-01", endDate: "2026-10-02", offDates: ["2026-10-02"],
      financeByDate: { "2026-10-02": { tripSummary: "休運" } } },
  ]).cardHeight, 56);
  const sortSource = source.slice(source.indexOf("const visibleOrders = orders"), source.indexOf("            const orderLanes ="));
  const sorted = vm.runInNewContext(`(${ts.transpileModule(
    `(list) => list${sortSource.slice(sortSource.indexOf(".sort("))}`.replace(/;\s*$/, ""),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
  ).outputText.trim().replace(/;$/, "")})`)([
    { id: "late", date: "2026-10-01", time: "18:00" },
    { id: "none", date: "2026-10-01", time: "" },
    { id: "early", date: "2026-10-01", time: "06:30" },
    { id: "prev", date: "2026-09-30", time: "23:00" },
  ]).map((order) => order.id);
  assert.deepEqual(sorted, ["prev", "early", "late", "none"]);
  assert.ok(source.includes("openNewOrder(vehicleRecord, d.date);"));
});

test("calendar rows use each vehicle record's own plate shown above the name", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("filteredCalendarVehicleRecords.map((vehicleRecord) =>"));
  assert.ok(!source.includes("filteredCalendarVehicles"));
  assert.ok(source.includes("key={vehicleRecord.id}"));
  const label = source.slice(source.indexOf('const plate = vehicleRecord.plate || "未登记番号"'));
  assert.ok(label.indexOf('copyCalendarVehicleField(plate, "車両番号")') < label.indexOf('copyCalendarVehicleField(vehicle, "車名")'));
  assert.ok(source.includes("moveOrderToCell(dragData, vehicleTarget, dates[dateIndex].date)"));
  assert.ok(source.includes("openNewOrder(vehicleRecord, d.date)"));
});

test("accounting assignees display names without falling back to emails", () => {
  const { getAccountingAssigneeName } = load("lib\\accounting-assignee.ts");
  const accounts = [
    { email: "named@example.com", fullName: "Named User" },
    { email: "unnamed@example.com", fullName: "  " },
  ];
  assert.equal(getAccountingAssigneeName("NAMED@example.com", accounts), "Named User");
  assert.equal(getAccountingAssigneeName("unnamed@example.com", accounts), "未填写姓名");
  assert.equal(getAccountingAssigneeName("deleted@example.com", accounts), "历史账号（姓名不可用）");
  assert.equal(getAccountingAssigneeName("Historical Name", accounts), "Historical Name");
  assert.equal(getAccountingAssigneeName("", accounts), "");
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("getAccountingAssigneeName(order.accountingAssignee"));
  assert.ok(!source.includes("`${account.fullName}（${account.email}）`"));
});

test("finance driver dialog includes new drivers regardless of current name and scopes to order region", () => {
  const { FinanceDriverSelect } = load("components\\finance-driver-select.tsx", {
    react: { ...React, useState: () => [true, () => {}] },
    "@/lib/driver-selection": load("lib\\driver-selection.ts"),
    "@/components/driver-selection-dialog": { DriverSelectionDialog() {} },
  });
  const drivers = [
    { id: "a", name: "Existing Driver", regionId: region },
    { id: "b", name: "Other Region", regionId: "other" },
  ];
  const changes = [];
  const render = (value, regionId = region) => FinanceDriverSelect({
    drivers, orders: [], today: "2026-10-26", regionId, value, onChange: (name) => changes.push(name),
  });
  assert.ok(!render("Existing Driver").props.children[1].props.drivers.some((driver) => driver.name === "New Driver"));
  drivers.push({ id: "new", name: "New Driver", regionId: region });
  const tree = render("Existing Driver");
  const dialog = tree.props.children[1];
  assert.ok(dialog.props.drivers.some((driver) => driver.name === "New Driver"));
  assert.ok(!dialog.props.drivers.some((driver) => driver.name === "Other Region"));
  dialog.props.onSelect("New Driver");
  dialog.props.onSelect("");
  dialog.props.onSelect("Manual");
  assert.deepEqual(changes, ["New Driver", "", "Manual"]);
  assert.equal(render("Historical").props.children[1].props.selected, "Historical");
  assert.equal(render("", null).props.children[1].props.drivers.length, 0);
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("drivers={allDriverRecords}"));
  assert.ok(source.includes("regionId={accountingPreviewOrder.regionId}"));
  assert.ok(!source.includes("finance-drivers-"));
});

test("reservation plate selector links vehicles by plate, retains unavailable selections and supports shared names", () => {
  const { OrderVehiclePlateSelect } = load("components\\order-vehicle-plate-select.tsx", {
    "@/lib/vehicle-order": load("lib\\vehicle-order.ts"),
  });
  const vehicles = [
    { id: "a", name: "Alphard 01", plate: "品川 100", status: "运营中" },
    { id: "b", name: "Hiace 01", plate: "品川 200", status: "运营中" },
    { id: "c", name: "外注其他", plate: "", status: "运营中" },
    { id: "d", name: "Tesla 01", plate: "品川 300", status: "停运中" },
  ];
  const changes = [];
  function render(name, records = vehicles, financeMode = false, plate = "") {
    const tree = OrderVehiclePlateSelect({
      vehicles: records, vehicleName: name, vehiclePlate: plate, getStatus: (vehicle) => vehicle.status,
      onSelect: (value) => changes.push(plain(value)),
      financeMode,
    });
    const nodes = [];
    function walk(node) {
      if (!node || typeof node !== "object") return;
      nodes.push(node);
      React.Children.toArray(node.props?.children).forEach(walk);
    }
    walk(tree);
    return {
      select: nodes.find((node) => node.type === "select"),
      options: nodes.filter((node) => node.type === "option"),
      html: renderToStaticMarkup(tree),
    };
  }
  let view = render("Alphard 01", vehicles, false, "品川 100");
  assert.equal(view.select.props.value, "a");
  assert.equal(renderToStaticMarkup(view.options.find((option) => option.props.value === "a")),
    '<option value="a">品川 100</option>');
  view.select.props.onChange({ target: { value: "b" } });
  assert.deepEqual(changes, [{ name: "Hiace 01", plate: "品川 200" }]);
  assert.equal(render("Hiace 01", vehicles, false, "品川 200").select.props.value, "b");
  assert.equal(render("Hiace 01").select.props.value, "", "a model alone must not select a plate");
  assert.equal(render("外注其他").select.props.value, "");
  assert.ok(render("外注其他").html.includes("当前車両未登记或未指定番号"));
  assert.ok(render("Deleted").html.includes("当前車両未登记或未指定番号"));
  view = render("Tesla 01", vehicles, false, "品川 300");
  assert.equal(view.select.props.value, "d");
  assert.equal(view.options.find((option) => option.props.value === "d").props.disabled, true);
  view.select.props.onChange({ target: { value: "d" } });
  view.select.props.onChange({ target: { value: "invalid" } });
  assert.equal(changes.length, 1);
  const shared = [...vehicles, { ...vehicles[0], id: "duplicate", plate: "品川 400" }];
  view = render("Alphard 01", shared);
  assert.equal(view.select.props.value, "");
  assert.ok(view.html.includes("请選択具体的車両番号"));
  assert.equal(render("Alphard 01", shared, false, "品川 400").select.props.value, "duplicate");
  view.select.props.onChange({ target: { value: "duplicate" } });
  assert.deepEqual(changes.at(-1), { name: "Alphard 01", plate: "品川 400" });
  assert.equal(render("", []).options.length, 1);
  view = render("Tesla 01", vehicles, true);
  assert.ok(view.html.includes("当日車両番号"));
  assert.ok(!view.html.includes("Tesla 01"));
  assert.equal(view.options.find((option) => option.props.value === "d").props.disabled, false);
  view.select.props.onChange({ target: { value: "d" } });
  assert.deepEqual(changes.at(-1), { name: "Tesla 01", plate: "品川 300" });
  view.select.props.onChange({ target: { value: "" } });
  assert.deepEqual(changes.at(-1), { name: "", plate: "" });
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes('editingOrderId === null ? getRegionForNewRecords() : form.regionId'));
  assert.ok(source.includes("vehicle.regionId === orderFormRegionId"));
  assert.ok(source.indexOf("<OrderVehiclePlateSelect") > source.indexOf("value={form.vehicle}"));
  assert.ok(source.includes("vehicle: vehicle.name, vehiclePlate: vehicle.plate"));
  assert.ok(source.includes("{getOrderVehicleNumber({ ...accountingPreviewOrder, financeByDate: primaryAccountingForm })}"));
  assert.ok(source.includes("vehicle.regionId === accountingPreviewOrder.regionId"));
  assert.ok(!source.includes("finance-vehicles-"));
});

test("administrator password creation and reset enforce roles, validation and explicit failures", async () => {
  let driverFeatureEnabled = false;
  let profile = { id, role: "admin" };
  let target = { role: "user" };
  let targetError = null;
  let profileError = null;
  let profileExists = true;
  let authError = null;
  const calls = [];
  const logged = [];
  const password = "Test-only-pass-42";
  const admin = {
    auth: { admin: {
      createUser: async (input) => {
        calls.push(["create", input]);
        return { data: { user: authError ? null : { id } }, error: authError };
      },
      inviteUserByEmail: async (...input) => {
        calls.push(["invite", input]);
        return { data: { user: { id } }, error: null };
      },
      updateUserById: async (...input) => {
        calls.push(["password", input]);
        return { error: authError };
      },
    } },
    from(name) {
      assert.equal(name, "profiles");
      let updating = false;
      return {
        update(input) { updating = true; calls.push(["profile", input]); return this; },
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return updating
            ? { data: profileExists ? { id } : null, error: profileError }
            : { data: target, error: targetError };
        },
      };
    },
  };
  const route = load("app\\api\\admin\\accounts\\route.ts", {
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => driverFeatureEnabled },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ profile }) },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/api-response": { jsonResponse: (body, init) => Response.json(body, init) },
    "@/lib/supabase/pagination": {},
    "@/lib/delete-password": {},
  }, { Response, Request, console: { error: (...args) => logged.push(args) } });
  const request = (method, data) => new Request("http://localhost:3000/api/admin/accounts", {
    method, body: JSON.stringify(data),
  });
  const account = {
    email: "NEW@example.com", fullName: "New", company: "Company", position: "操作",
    regionId: region, role: "user", password,
  };
  for (const method of ["POST", "PUT"]) {
    for (const [identity, status] of [[null, 401], [{ role: "user" }, 403]]) {
      profile = identity;
      assert.equal((await route[method](request(method, method === "POST" ? account : { userId: id, password }))).status, status);
      assert.equal(calls.length, 0);
    }
  }
  profile = { id, role: "admin" };
  for (const invalid of ["short", "x".repeat(129)]) {
    assert.equal((await route.POST(request("POST", { ...account, password: invalid }))).status, 400);
    assert.equal((await route.PUT(request("PUT", { userId: id, password: invalid }))).status, 400);
  }
  const { password: omitted, ...withoutPassword } = account;
  assert.equal((await route.POST(request("POST", withoutPassword))).status, 400);
  assert.equal(calls.length, 0);
  let response = await route.POST(request("POST", account));
  assert.equal(response.status, 201);
  assert.ok(!(await response.text()).includes(password));
  const created = calls.find(([type]) => type === "create")[1];
  assert.equal(created.email, "new@example.com");
  assert.equal(created.email_confirm, true);
  assert.equal(created.password, password);
  assert.ok(!JSON.stringify(created.user_metadata).includes(password));
  assert.ok(!calls.some(([type]) => type === "invite"));
  assert.ok(!JSON.stringify(calls.find(([type]) => type === "profile")).includes(password));
  calls.length = 0;
  assert.equal((await route.POST(request("POST", { ...account, role: "admin" }))).status, 201);
  assert.ok(!calls.some(([type]) => type === "invite"));
  assert.ok(calls.some(([type]) => type === "create"));
  assert.equal(calls.find(([type]) => type === "profile")[1].role, "admin");
  calls.length = 0;
  driverFeatureEnabled = true;
  assert.equal((await route.POST(request("POST", account))).status, 201);
  assert.equal(calls.find(([type]) => type === "profile")[1].account_type, "staff");
  driverFeatureEnabled = false;
  calls.length = 0;
  target = { role: "admin" };
  for (const userId of [id, "70000000-0000-4000-8000-000000000002"]) {
    response = await route.PUT(request("PUT", { userId, password }));
    assert.equal(response.status, 200);
    assert.deepEqual(plain(calls[0]), ["password", [userId, { password, email_confirm: true }]]);
    assert.ok(!(await response.text()).includes(password));
    calls.length = 0;
  }
  target = null;
  assert.equal((await route.PUT(request("PUT", { userId: id, password }))).status, 404);
  assert.equal(calls.length, 0);
  target = { role: "user" };
  targetError = { code: "42501" };
  response = await route.PUT(request("PUT", { userId: id, password }));
  assert.equal(response.status, 500);
  assert.ok((await response.json()).error.includes("42501"));
  assert.equal(calls.length, 0);
  targetError = null;
  response = await route.PUT(request("PUT", { userId: id, password }));
  assert.equal(response.status, 200);
  assert.deepEqual(plain(calls[0]), ["password", [id, { password, email_confirm: true }]]);
  assert.ok(!(await response.text()).includes(password));
  authError = { code: "weak_password", status: 422, message: password };
  assert.equal((await route.PUT(request("PUT", { userId: id, password }))).status, 400);
  assert.equal((await route.POST(request("POST", account))).status, 400);
  authError = null;
  profileError = { code: "42501", message: password };
  response = await route.POST(request("POST", account));
  assert.equal(response.status, 500);
  assert.ok((await response.json()).error.includes("账号已创建"));
  profileError = null;
  profileExists = false;
  assert.equal((await route.POST(request("POST", account))).status, 500);
  assert.ok(!JSON.stringify(logged).includes(password));
  const page = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(page.includes('method: "PUT"'));
  assert.ok(page.includes('type="password" autoComplete="new-password"'));
  assert.ok(page.includes("accountPassword !== accountPasswordConfirmation"));
  const passwordFields = page.slice(page.indexOf('<option value="admin">管理员</option>'), page.indexOf("设置新密码\n"));
  assert.ok(passwordFields.includes('autoComplete="new-password"'));
  assert.doesNotMatch(passwordFields, /loginAccountForm\.role === "user"|loginAccounts\.find/);
  assert.ok(!fs.readFileSync(path.join(root, "app\\api\\admin\\accounts\\route.ts"), "utf8").includes("inviteUserByEmail"));
});

test("account creation distinguishes rate limits, existing users and database failures", async () => {
  let creationError;
  const { POST } = load("app\\api\\admin\\accounts\\route.ts", {
    "@/lib/driver/test-runtime": { isDriverPwaEnabled: () => false },
    "@/lib/supabase/authorization": {
      getAuthenticatedProfile: async () => ({ profile: { role: "admin" } }),
    },
    "@/lib/supabase/admin": {
      createAdminClient: () => ({
        auth: { admin: { createUser: async () => ({ data: { user: null }, error: creationError }) } },
      }),
    },
    "@/lib/api-response": { jsonResponse: (body, init) => Response.json(body, init) },
    "@/lib/supabase/pagination": {},
    "@/lib/delete-password": {},
  }, { Response, Request });
  for (const [error, status, text] of [
    [{ status: 429, code: "over_request_rate_limit" }, 429, "请勿连续重试"],
    [{ status: 422, code: "email_exists" }, 409, "该邮箱已注册"],
    [{ status: 500, message: "Database error saving new user" }, 500, "数据库错误"],
    [{ status: 500, code: "unexpected_failure", message: "Service unavailable" }, 502, "认证日志"],
  ]) {
    creationError = error;
    const response = await POST(new Request("http://localhost:3000/api/admin/accounts", {
      method: "POST",
      body: JSON.stringify({
        email: "new@example.com", fullName: "New User", company: "Company",
        position: "操作", regionId: region, role: "user", password: "Test-only-password",
      }),
    }));
    assert.equal(response.status, status);
    assert.ok((await response.json()).error.includes(text));
  }
});

test("vehicle-name options persist deletions, preserve selected names and restore defaults", () => {
  let saved = null;
  let failWrite = false;
  let confirmed = true;
  let selectedDeleted = 0;
  let stateIndex = 0;
  const states = [];
  const { VehicleNameSelect, DEFAULT_VEHICLE_NAME_OPTIONS, MANUAL_VEHICLE_NAME } = load(
    "components\\vehicle-name-select.tsx",
    {
      react: {
        useState(initial) {
          const index = stateIndex++;
          if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
          return [states[index], (next) => {
            states[index] = typeof next === "function" ? next(states[index]) : next;
          }];
        },
      },
    },
    { window: {
      localStorage: {
        getItem: () => saved,
        setItem(key, value) {
          assert.equal(key, "hire-car-system:vehicle-name-options");
          if (failWrite) throw new Error("Storage unavailable");
          saved = value;
        },
      },
      confirm: () => confirmed,
    } },
  );
  const props = {
    value: "Alphard", manualName: "Alphard", onChange() {}, onManualNameChange() {},
    onDeleteSelected: () => selectedDeleted++,
  };
  function render() {
    stateIndex = 0;
    return VehicleNameSelect(props);
  }
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    return [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
  }
  function button(label) {
    const found = nodes(render()).find((node) =>
      node.type === "button" && (node.props["aria-label"] === label || node.props.children === label));
    assert.ok(found, label);
    found.props.onClick();
  }
  button("管理車名");
  confirmed = false;
  button("删除車名 Alphard");
  assert.equal(saved, null);
  confirmed = true;
  failWrite = true;
  button("删除車名 Alphard");
  assert.equal(selectedDeleted, 0);
  assert.equal(saved, null);
  assert.ok(nodes(render()).some((node) => node.props?.role === "alert"));
  failWrite = false;
  button("删除車名 Alphard");
  assert.equal(selectedDeleted, 1);
  assert.ok(!JSON.parse(saved).includes("Alphard"));
  states.length = 0; // Reopening the dialog reads the persisted list.
  let tree = nodes(render());
  assert.equal(tree.find((node) => node.type === "select").props.value, MANUAL_VEHICLE_NAME);
  assert.equal(tree.find((node) => node.type === "input").props.value, "Alphard");
  assert.ok(!tree.some((node) => node.type === "option" && node.props.value === "Alphard"));
  button("管理車名");
  for (const name of JSON.parse(saved)) button(`删除車名 ${name}`);
  assert.deepEqual(JSON.parse(saved), []);
  assert.ok(nodes(render()).some((node) => node.type === "option" && node.props.value === MANUAL_VEHICLE_NAME));
  button("恢复默认");
  assert.deepEqual(JSON.parse(saved), plain(DEFAULT_VEHICLE_NAME_OPTIONS));
  saved = "{broken";
  states.length = 0;
  tree = nodes(render());
  assert.ok(tree.some((node) => node.props?.role === "alert"));
  props.value = "Custom model";
  assert.ok(nodes(render()).some((node) => node.type === "option" && node.props.value === "Custom model"));
});

test("reservation daily summary and fares share accounting data and preserve legacy totals", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const defaults = source.match(/const emptyOrderFinance: OrderFinance = \{[\s\S]*?\n\};/)[0];
  const amounts = source.slice(source.indexOf("function getOrderFinanceAmount("), source.indexOf("function getDriverOvertimeFee("));
  const helpers = source.slice(source.indexOf("function getOrderDateKeys("), source.indexOf("function getOrderFinanceForOrder("));
  const context = {
    shiftDateKey: (date, offset) => new Date(new Date(`${date}T00:00:00Z`).getTime() + offset * 86400000).toISOString().slice(0, 10),
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(defaults + amounts + helpers, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  const old = { date: "2026-10-26", endDate: "2026-10-28", orderPrice: 30000, financeByDate: {} };
  assert.equal(context.getReservationFinance(old)["2026-10-26"].dailyFare, 30000);
  assert.deepEqual(old.financeByDate, {});
  let draft = context.updateReservationFinance(old, "2026-10-27", { tripSummary: "Airport → Hotel" });
  assert.equal(draft.orderPrice, 30000);
  draft = context.updateReservationFinance(draft, "2026-10-27", { dailyFare: 10000 });
  assert.equal(draft.orderPrice, 40000);
  assert.equal(draft.financeByDate["2026-10-27"].tripSummary, "Airport → Hotel");
  draft.financeByDate["2026-10-27"].fuelCost = 1500;
  draft = context.updateReservationFinance(draft, "2026-10-27", { dailyFare: 0 });
  assert.equal(draft.orderPrice, 30000);
  assert.equal(draft.financeByDate["2026-10-27"].fuelCost, 1500);
  draft = context.updateReservationFinance(draft, "2026-10-26", { dailyFare: 0 });
  assert.equal(draft.orderPrice, 0);
  assert.equal(context.getReservationFinance(draft)["2026-10-26"].dailyFare, 0);
  const shifted = context.shiftFinanceDates(draft.financeByDate, 2);
  assert.equal(shifted["2026-10-29"].tripSummary, "Airport → Hotel");
  assert.equal(shifted["2026-10-29"].fuelCost, 1500);
  assert.deepEqual(plain(context.getOrderDateKeys(old)), ["2026-10-26", "2026-10-27", "2026-10-28"]);
  const legend = source.indexOf(">每日行程与車費</legend>");
  const start = source.lastIndexOf("<fieldset", legend);
  const form = source.slice(start, source.indexOf("</fieldset>", legend));
  assert.ok(form.includes("每日行程与車費") && form.includes("行程簡概") && form.includes("当日車費（JPY）"));
  assert.match(form, /getOrderDateKeys\(form\)\.map/);
  assert.match(source, /financeByDate: getReservationFinance\(order\)/);
  assert.match(source, /financeByDate: shiftFinanceDates\(form\.financeByDate, dateOffset\)/);
});

test("daily itinerary includes independent drivers and payment shortcuts while default driver fills service days", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const payment = load("lib\\reservation-driver-payment.ts");
  const defaults = source.match(/const emptyOrderFinance: OrderFinance = \{[\s\S]*?\n\};/)[0];
  const amounts = source.slice(source.indexOf("function getOrderFinanceAmount("), source.indexOf("function getDriverOvertimeFee("));
  const helpers = source.slice(source.indexOf("function getOrderDateKeys("), source.indexOf("function getOrderFinanceForOrder("));
  const legend = source.indexOf(">每日行程与車費</legend>");
  const first = source.lastIndexOf("<fieldset", legend), last = source.indexOf("</fieldset>", legend) + "</fieldset>".length;
  const sourceField = source.indexOf("{/* 来源 */}");
  const statusField = source.indexOf("{/* 予約状態 */}", sourceField);
  const vehicleField = source.indexOf("{/* 車両 */}", statusField);
  const plateField = source.indexOf("<OrderVehiclePlateSelect", vehicleField);
  const driverField = source.indexOf("{/* 運転士 */}", plateField);
  const startDate = source.indexOf("{/* 开始日期 */}");
  const endDate = source.indexOf("{/* 終了日期 */}", startDate);
  const offDate = source.indexOf('htmlFor="order-off-date"', endDate);
  const customerField = source.indexOf("{/* 訂単名称 */}");
  const departureTime = source.indexOf("value={form.time}", driverField);
  assert.ok(customerField < startDate && startDate < endDate && endDate < offDate &&
    offDate < sourceField && sourceField < statusField && statusField < vehicleField &&
    vehicleField < plateField && plateField < driverField && driverField < first &&
    last < departureTime && departureTime < source.indexOf("{/* 上車地点 */}", departureTime));
  assert.equal((source.match(/htmlFor="order-off-date"/g) || []).length, 1);
  assert.ok(last < source.indexOf("{/* 上車地点 */}", last));
  assert.doesNotMatch(source, /每日運転士費用快捷输入/);
  const markup = source.slice(first, last);
  const context = {
    ...payment, ...load("lib\\order-drivers.ts"), require: nodeRequire, exports: {},
    FinanceDriverSelect: "driver-select", OrderVehiclePlateSelect: "vehicle-select",
    orderFormVehicles: [], editingOrderId: null, getVehicleDisplayStatus: () => "运营中",
    getFinanceDayOrder: (order, finance) => ({ ...order, ...load("lib\\order-vehicles.ts").getServiceVehicle(
      { ...order, financeByDate: { day: finance } }, "day") }), allDriverRecords: [], allOrders: [],
    todayDateKey: "2026-10-27", getRegionForNewRecords: () => region,
    form: { date: "2026-10-26", endDate: "2026-10-28", offDates: ["2026-10-28"], driver: "External A",
      orderPrice: 30000, financeByDate: {} },
    setForm: update => { context.form = update(context.form); },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(defaults + amounts + helpers +
    `\nglobalThis.render = () => (${markup});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  const elements = node => !React.isValidElement(node) ? [] :
    [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
  const input = label => elements(context.render()).find(node => node.props["aria-label"] === label);
  const driver = index => elements(context.render()).filter(node => node.type === "driver-select")[index];
  assert.equal(driver(0).props.value, "External A");
  assert.equal(driver(1).props.value, "External A");
  assert.equal(driver(2), undefined, "off day has no driver selector");
  assert.equal(input("2026-10-28 運転士費用类型"), undefined);
  assert.equal(input("2026-10-26 運転士工資").props.disabled, true);
  input("2026-10-26 運転士費用类型").props.onChange({ target: { value: "company_advance" } });
  input("2026-10-26 外注運転士費用").props.onChange({ target: { value: "15000" } });
  assert.equal(context.form.orderPrice, 30000, "legacy first-day fare survives choosing a payment type");
  const external = context.form.financeByDate["2026-10-26"];
  assert.equal(external.driver, "");
  assert.equal(external.driverWage, 0);
  assert.equal(external.externalDriverFee, 15000);
  assert.equal(external.companyAdvancePaymentNote, "外注司机：External A");
  assert.equal(payment.isDriverWageEntry(external), false);
  assert.equal(input("2026-10-26 運転士工資").props.disabled, true);
  assert.equal(input("2026-10-26 外注運転士費用").props.disabled, false);
  input("2026-10-27 運転士費用类型").props.onChange({ target: { value: "wage" } });
  input("2026-10-27 運転士工資").props.onChange({ target: { value: "8000" } });
  assert.equal(context.form.financeByDate["2026-10-27"].driverWage, 8000);
  assert.equal(context.form.financeByDate["2026-10-27"].driver, "External A");
  assert.equal(payment.isDriverWageEntry(context.form.financeByDate["2026-10-27"]), true);
  assert.equal(external.companyAdvanceCompanyReport, 0);
  assert.equal(external.externalDriverFee, 15000);
  input("2026-10-26 外注運転士备注").props.onChange({ target: { value: "外注司机：External A\n停車費已含" } });
  context.form = context.updateReservationDriver(context.form, "External B");
  assert.equal(context.form.financeByDate["2026-10-26"].companyAdvancePaymentNote, "外注司机：External A\n停車費已含");
  assert.equal(context.form.financeByDate["2026-10-27"].driver, "External B");
  context.form = context.updateReservationDriver(context.form, "External B");
  assert.equal((context.form.financeByDate["2026-10-26"].companyAdvancePaymentNote.match(/External A/g) || []).length, 1);
  input("2026-10-26 運転士費用类型").props.onChange({ target: { value: "wage" } });
  assert.equal(context.form.financeByDate["2026-10-26"].externalDriverFee, 0);
  assert.equal(context.form.financeByDate["2026-10-26"].driver, "");
  driver(1).props.onChange("Daily C");
  assert.equal(context.form.driver, "External B", "daily assignment does not change default");
  assert.equal(driver(0).props.value, "");
  assert.equal(driver(1).props.value, "Daily C");
  assert.equal(context.form.financeByDate["2026-10-27"].driverWage, 8000);
  driver(1).props.onChange("");
  assert.equal(driver(1).props.value, "", "clearing a daily wage driver stays unassigned");
  driver(1).props.onChange("Daily C");
  input("2026-10-27 運転士費用类型").props.onChange({ target: { value: "company_advance" } });
  assert.equal(context.form.financeByDate["2026-10-27"].companyAdvancePaymentNote, "外注司机：Daily C");
  driver(1).props.onChange("Daily D");
  assert.equal(driver(1).props.value, "");
  assert.equal(context.form.financeByDate["2026-10-27"].companyAdvancePaymentNote, "外注司机：Daily D");
  assert.equal(context.form.financeByDate["2026-10-27"].driver, "");
  driver(1).props.onChange("");
  assert.equal(driver(1).props.value, "", "external name remains outside the daily driver assignment");
  context.form = context.updateReservationDriver(context.form, "All Days");
  assert.equal(driver(0).props.value, "All Days");
  assert.equal(driver(1).props.value, "");
  assert.equal(context.form.financeByDate["2026-10-27"].driver, "");
  assert.equal(context.form.financeByDate["2026-10-28"], undefined);
  const fresh = context.updateReservationDriver({ ...context.form, financeByDate: {}, orderPrice: 30000 }, "Default");
  assert.equal(fresh.financeByDate["2026-10-26"].dailyFare, 30000);
  assert.equal(fresh.financeByDate["2026-10-26"].driver, "Default");
  assert.equal(fresh.financeByDate["2026-10-27"].driver, "Default");
  assert.equal(fresh.financeByDate["2026-10-28"], undefined);
  const extended = context.updateReservationFinance({ ...fresh, endDate: "2026-10-29" },
    "2026-10-29", { dailyFare: 9000 });
  assert.equal(extended.financeByDate["2026-10-29"].driver, "Default",
    "editing fares on a newly added service day inherits the common driver");
  assert.equal(extended.orderPrice, 39000);
  const offFinance = { ...fresh.financeByDate["2026-10-27"], driver: "Off", driverWage: 123 };
  const reassigned = context.updateReservationDriver({ ...fresh,
    financeByDate: { ...fresh.financeByDate, "2026-10-28": offFinance } }, "Replacement");
  assert.deepEqual(plain(reassigned.financeByDate["2026-10-28"]), plain(offFinance));
  assert.equal(reassigned.financeByDate["2026-10-26"].dailyFare, 30000);
});

test("payment type conversions preserve unrelated finances and prevent duplicate wage costs", () => {
  const payment = load("lib\\reservation-driver-payment.ts");
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const defaults = source.match(/const emptyOrderFinance: OrderFinance = \{[\s\S]*?\n\};/)[0];
  const context = {};
  const calculations = source.slice(source.indexOf("function getOrderFinanceAmount("), source.indexOf("function isRentalOrderSource("));
  vm.runInNewContext(ts.transpileModule(defaults + calculations + "\nglobalThis.finance = emptyOrderFinance;", {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  const old = { ...context.finance, driver: "Registered", driverWageMode: "percentage",
    driverWage: 5000, driverBonusWage: 2000, driverOvertimeHours: 2, driverOvertimeRate: 4000,
    driverOvertimeFee: 8000, overtimeRequestAmount: undefined, overtimeRequestRate: undefined,
    dailyFare: 50000, fuelCost: 1500, companyAdvancePaymentNote: "Existing note" };
  const external = payment.setReservationDriverPayment(old, "company_advance", "External");
  assert.equal(external.driver, "");
  assert.equal(external.driverWageMode, "fixed");
  assert.equal(external.driverWage, 0);
  assert.equal(external.driverBonusWage, 0);
  assert.equal(external.driverOvertimeRate, 0);
  assert.equal(external.driverOvertimeFee, 0);
  assert.equal(external.overtimeRequestAmount, 8000, "customer overtime is independent of wage removal");
  assert.equal(payment.setReservationDriverPayment({ ...old, overtimeRequestAmount: 0 },
    "company_advance", "External").overtimeRequestAmount, 0, "explicit zero customer overtime stays zero");
  assert.equal(payment.setReservationDriverPayment({ ...old, overtimeRequestRate: 5000 },
    "company_advance", "External").overtimeRequestAmount, 10000, "independent customer rate survives conversion");
  assert.equal(external.fuelCost, 1500);
  assert.equal(external.dailyFare, 50000);
  assert.equal(external.companyAdvancePaymentNote, "外注司机：External\nExisting note");
  assert.equal(payment.hasValidDriverPayment(external), true);
  const normalized = context.initializeAccountingFinance(external);
  assert.equal(normalized.driverPaymentType, "company_advance");
  assert.equal(normalized.driver, "");
  const zeroHourExternal = context.initializeAccountingFinance({ ...external, driverOvertimeHours: 0, overtimeRequestAmount: 0 });
  assert.equal(zeroHourExternal.driverOvertimeRate, 0, "accounting never restores a default wage rate for external payments");
  const totals = context.calculateOrderFinance({ ...external, externalDriverFee: 15000 });
  assert.equal(totals.driverWages, 0);
  assert.equal(totals.companyExpenses, 16500);
  assert.equal(totals.requestAmount, 58000);
  assert.equal(totals.profit, 41500);
  const bothCosts = context.calculateOrderFinance({
    ...external, companyAdvanceCompanyReport: 3000, externalDriverFee: 15000,
  });
  assert.equal(bothCosts.companyExpenses, 19500,
    "company advances and external driver fees remain separate expense categories");
  assert.equal(payment.isDriverWageEntry({ ...external, driver: "External" }), false);
  assert.equal(payment.hasValidDriverPayment({ ...external, driverWage: 1 }), false);
  assert.equal(payment.hasValidDriverPayment({ ...external, driverOvertimeRate: 4000 }), false);
  assert.equal(payment.hasValidDriverPayment({ ...external, driverWageMode: "percentage" }), false);
  const wage = payment.setReservationDriverPayment({ ...external, companyAdvanceCompanyReport: 15000,
    externalDriverFee: 15000 }, "wage", "Internal");
  assert.equal(wage.companyAdvanceCompanyReport, 15000);
  assert.equal(wage.externalDriverFee, 0);
  assert.equal(wage.driver, "Internal");
  assert.equal(payment.hasValidDriverPayment({ ...wage, externalDriverFee: 1 }), false);
  assert.equal(old.driverWage, 5000, "conversion never mutates the original report");
});

test("balance payment reconciliation filters methods without changing expenses or profits and exports A4", () => {
  const { summarizeBalance } = load("lib\\balance-summary.ts");
  const { buildBalancePrintHtml, buildCompanyAdvancePrintHtml } = load("lib\\balance-print.ts", { "@/lib/print-a4": {} });
  const orders = [{ companyName: "A", requestAmount: 10000, depositMethod: "" }];
  const expenses = [{ companyName: "A", name: "Manual", amount: 2000 }];
  const payments = ["paypay", "微信", "支付宝", "口座", ""].map((method, index) => ({
    companyName: "A", customer: "<Order>", date: `2026-10-${20 - index}`,
    method, amount: (index + 1) * 100, status: index === 0 ? "已完成" : "未完成", note: "<Note>\n对账",
  }));
  payments.push({ companyName: "B", customer: "Other", date: "2026-10-21", method: "paypay", amount: 600 });
  payments.push({ companyName: "", customer: "Unset company", date: "2026-10-22", method: "", amount: 700 });
  const summary = summarizeBalance("A", [], orders, expenses, [], payments);
  assert.deepEqual(plain(summary.totals), plain(summarizeBalance("A", [], orders, expenses).totals));
  assert.deepEqual(plain(summary.paymentAmounts), { paypay: 100, 微信: 200, 支付宝: 300, 口座: 400, "": 500 });
  assert.equal(summary.paymentTotal, 1500);
  assert.equal(summary.totals.expenseTotal, 2000);
  assert.equal(summary.totals.net, 8000);
  assert.equal(summary.payments[0].date, "2026-10-16");
  assert.equal(summarizeBalance("", [], [], [], [], payments).paymentTotal, 2800);
  assert.equal(summarizeBalance("__unassigned_company__", [], [], [], [], payments).paymentTotal, 700);
  assert.equal(summarizeBalance("", [], [], []).paymentTotal, 0);
  for (const bad of [{ method: "bad", amount: 1 }, { method: "paypay", amount: -1 }, { method: "微信", amount: 0.5 }]) {
    assert.throws(() => summarizeBalance("", [], [], [], [], [{ ...payments[0], ...bad }]));
  }
  assert.throws(() => summarizeBalance("", [], [], [], [], [
    { ...payments[0], amount: Number.MAX_SAFE_INTEGER }, { ...payments[1], amount: 1 },
  ]), /超出金額范围/);
  const data = { month: "2026-10", region: "東京", company: "A", summary };
  const balanceHtml = buildBalancePrintHtml(data);
  assert.doesNotMatch(balanceHtml, /会社立替（社報）|paypay|微信|支付宝|出金方式/);
  assert.doesNotMatch(balanceHtml, /fit-page-width/);
  assert.ok(balanceHtml.includes("¥2,000") && balanceHtml.includes("¥8,000"));
  const html = buildCompanyAdvancePrintHtml(data);
  assert.match(html, /size: A4 portrait/);
  assert.match(html, /class="content fit-page-width"/);
  assert.match(html, /\.content\.fit-page-width\s*\{[^}]*width:\s*190mm/);
  assert.match(fs.readFileSync(path.join(root, "lib\\print-a4.ts"), "utf8"), /fitsPageAspect/);
  for (const [method, amount] of [["paypay", "100"], ["微信", "200"], ["支付宝", "300"], ["口座", "400"]]) {
    assert.ok(html.includes(`<td>${method}</td><td class="number">¥${amount}</td>`));
    assert.ok(html.includes(`<h2>${method}明細</h2>`));
    assert.ok(html.includes(`${method}合计</td><td class="number">¥${amount}`));
  }
  assert.ok(html.includes("&lt;Order&gt;"));
  assert.ok(!html.includes(">Other<"));
  assert.ok(html.includes("外注運転士出金方式"));
  assert.ok(html.includes("<th>外注運転士出金状態</th><th>外注運転士备注</th>"));
  assert.ok(html.includes("已完成") && html.includes("未完成"));
  assert.ok(html.includes("&lt;Note&gt;\n对账"));
  assert.ok(html.includes("¥1,500"));
  assert.ok(html.includes("仅供对账，不重复计入收支平衡"));
  const emptyHtml = buildCompanyAdvancePrintHtml({ ...data, summary: summarizeBalance("", [], [], []) });
  assert.equal((emptyHtml.match(/暂无出金记录/g) || []).length, 5);
  assert.ok(emptyHtml.includes("未设置出金方式合计"));
  assert.throws(() => buildCompanyAdvancePrintHtml({
    ...data, summary: { ...summary, paymentTotal: NaN },
  }), /外注運転士出金合计无效/);
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(source, /getBalanceServiceMonth\(order, getOrderDateKeys\(order\)\) === balanceMonth/);
  assert.match(source, /balanceResult\.summary\.paymentAmounts\[method\]/);
  assert.match(source, /onClick=\{\(\) => exportBalance\("companyAdvances"\)\}/);
});

test("tall external-driver reports expand to use the printable page width without clipping", async () => {
  const sheet = { clientWidth: 190, clientHeight: 276 };
  const content = {
    style: { width: "", transform: "" },
    classList: { contains: name => name === "fit-page-width" },
    get scrollWidth() { return Number.parseFloat(this.style.width) || sheet.clientWidth; },
    get scrollHeight() { return 76000 / this.scrollWidth; },
  };
  const printDocument = {
    fonts: { ready: Promise.resolve() }, images: [],
    open() {}, write() {}, close() {},
    querySelector: selector => selector === ".content" ? content : selector === ".sheet" ? sheet : null,
  };
  const printWindow = { addEventListener() {}, focus() {}, print() {} };
  const frame = {
    style: { cssText: "" }, contentDocument: printDocument, contentWindow: printWindow,
    remove() {},
  };
  const printA4Html = load("lib\\print-a4.ts", {}, {
    document: { createElement: () => frame, body: { appendChild() {} } },
  }).printA4Html;
  await printA4Html("<html></html>", "external driver report");
  const scale = Number(content.style.transform.match(/scale\(([^)]+)\)/)[1]);
  assert.ok(content.scrollWidth > sheet.clientWidth, "long tables expand instead of being narrowed");
  assert.ok(Math.abs(content.scrollWidth * scale - sheet.clientWidth) < 0.5,
    "expanded report uses the full printable width");
  assert.ok(Math.abs(content.scrollHeight * scale - sheet.clientHeight) < 0.5,
    "expanded report fits the full printable height without clipping");
});

test("overtime requests are independent from wages and preserve historical requests", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const helpers = source.slice(source.indexOf("function getOrderFinanceAmount("), source.indexOf("/** The order as seen"));
  const calculation = source.slice(source.indexOf("function calculateOrderFinance("), source.indexOf("function isRentalOrderSource("));
  const context = {};
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(helpers + calculation, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  const legacy = {
    dailyFare: 10000, driverOvertimeHours: 2, driverOvertimeRate: 1500,
    driverOvertimeFee: 3000, driverWage: 1000, driverBonusWage: 200,
    etcTripReport: 100, driverAdvanceTripReport: 200, companyAdvanceTripReport: 300,
    fuelCost: 500,
  };
  const calculate = (entry) => plain(context.calculateOrderFinance(entry));
  assert.equal(calculate(legacy).requestAmount, 13600);
  assert.equal(calculate(legacy).driverWages, 4200);
  assert.equal(context.normalizeOrderFinance(legacy).overtimeRequestAmount, 3000);
  const independent = { ...legacy, overtimeRequestAmount: 5000 };
  assert.equal(calculate(independent).requestAmount, 15600);
  assert.equal(calculate(independent).driverWages, 4200);
  assert.equal(calculate(independent).profit, 10700);
  assert.equal(calculate({ ...independent, overtimeRequestAmount: 0 }).requestAmount, 10600);
  assert.equal(context.normalizeOrderFinance({ ...independent, overtimeRequestAmount: 0 }).overtimeRequestAmount, 0);
  assert.equal(context.getOvertimeRequestAmount({ driverOvertimeFee: 2100 }), 2100);
  assert.equal(context.getOvertimeRequestAmount({}), 0);
  const defaults = source.match(/const emptyOrderFinance: OrderFinance = \{[\s\S]*?\n\};/)[0];
  vm.runInContext(ts.transpileModule(defaults + "\nglobalThis.newEntry = emptyOrderFinance;", {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  assert.equal(context.getOvertimeRequestAmount({
    ...context.newEntry, driverOvertimeHours: 2, driverOvertimeRate: 1500,
  }), 10000);
  assert.equal(context.getDriverOvertimeFee({ ...context.newEntry, driverOvertimeHours: 2 }), 8000);
  assert.equal(context.getOvertimeRequestAmount(context.newEntry), 0);
  assert.equal(context.getDriverOvertimeFee(context.newEntry), 0);
  const savedLegacy = JSON.parse(JSON.stringify(context.normalizeOrderFinance(legacy)));
  assert.equal(calculate(savedLegacy).requestAmount, calculate(legacy).requestAmount);
  assert.equal(
    calculate({ ...independent, driverWageMode: "percentage", driverWagePercentage: 50 }).driverWages,
    10650,
  );
  const rated = { ...legacy, overtimeRequestRate: 2500 };
  assert.equal(calculate(rated).requestAmount, 15600);
  assert.equal(calculate(rated).driverWages, 4200);
  assert.equal(context.getOvertimeRequestAmount({ ...rated, overtimeRequestRate: 0 }), 0);
  assert.equal(context.getOvertimeRequestAmount({ ...rated, driverOvertimeHours: 1.25 }), 3125);
  assert.equal(context.getOvertimeRequestAmount({ ...rated, driverOvertimeHours: 0.5, overtimeRequestRate: 101 }), 51);
  assert.equal(context.getOvertimeRequestAmount({ ...rated, driverOvertimeHours: 0 }), 0);
  assert.equal(context.normalizeOrderFinance(rated).overtimeRequestRate, 2500);
  assert.equal(Object.hasOwn(context.normalizeOrderFinance(legacy), "overtimeRequestRate"), false);
  assert.match(source, /key: "overtimeRequestAmount", label: "超時請求（旅報）", unit: "JPY", readOnly: true/);
  assert.match(source, /key: "driverOvertimeFee", label: "超時工資"/);
  assert.match(source, /overtimeRequest: Object\.values\(primaryAccountingForm\)\.reduce/);
});

test("accounting save action stays pinned inside the scrollable dialog", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf('{accountingPreviewOrder && accountingTotals && (');
  const dialog = source.slice(start, source.indexOf("{selectedOrderDetails &&", start));
  assert.match(dialog, /max-h-\[92vh\].*overflow-y-auto/);
  assert.match(dialog, /className="pointer-events-none sticky bottom-3 z-10 mt-6 flex justify-end"/);
  assert.match(dialog, /pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-xl/);
  assert.match(dialog, /shadow-lg shadow-emerald-950\/20 ring-4 ring-white\/90/);
  assert.match(dialog, /onClick=\{saveAccounting\}/);
  assert.equal((dialog.match(/保存财务数据/g) || []).length, 1);
});

test("new and edit reservation saves float with the same style as accounting while deletion stays separate", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const end = source.indexOf("{pendingOrderConflicts.length > 0 && (");
  const start = source.lastIndexOf('{/* 按钮 */}', end);
  const actions = source.slice(start, end);
  const floating = actions.slice(actions.indexOf('className="pointer-events-none sticky'));
  assert.match(actions, /onClick=\{deleteOrder\}/);
  assert.doesNotMatch(floating, /onClick=\{deleteOrder\}/);
  assert.match(floating, /sticky bottom-3 z-10 mt-6 flex justify-end/);
  assert.match(floating, /onClick=\{\(\) => addOrder\(\)\}/);
  assert.match(floating, /disabled=\{dialogSaving\}/);
  assert.match(floating, /editingOrderId === null \? "保存予約" : "保存修改"/);
  const accountingStart = source.indexOf('onClick={saveAccounting}');
  const accountingClass = source.slice(accountingStart).match(/className="([^"]+)"/)[1];
  assert.ok(floating.includes(`className="${accountingClass}"`));
  assert.match(floating, /<svg aria-hidden="true"/);
});

test("reservation table centers fields and shows order and request status in their requested columns", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf('<table className="w-full min-w-[1400px] table-fixed text-center text-sm">');
  const table = source.slice(start, source.indexOf("</table>", start));
  const headers = [...table.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, [
    "用車日期", "配車時間", "手配状態", "予約情報", "訂単状態",
    "車両", "運転士", "来源", "請求書状態", "操作",
  ]);
  const columnWidths = [...table.matchAll(/<col className="w-\[(\d+)%\]" \/>/g)].map((match) => Number(match[1]));
  assert.deepEqual(columnWidths, [15, 7, 7, 21, 7, 8, 8, 9, 8, 10]);
  assert.match(table, /statusStyles\[order\.status\]/);
  assert.match(table, /点击選択請求書状態和变更范围/);
  assert.match(table, /onClick=\{\(\) => openOrderStatusDialog\(order, "invoice", "reservation"\)\}/);
  assert.doesNotMatch(table, /同来源批量/);
  assert.match(table, /flex flex-nowrap items-center justify-center gap-2/);
  const actionButtons = table.slice(table.lastIndexOf('<td className="px-2 py-3">'), table.indexOf("</tr>", table.lastIndexOf('<td className="px-2 py-3">')));
  assert.equal((actionButtons.match(/inline-flex w-14 items-center justify-center whitespace-nowrap rounded border py-1/g) || []).length, 2);
  assert.doesNotMatch(actionButtons, /编辑/);
  assert.doesNotMatch(actionButtons, /hover:underline/);
  assert.doesNotMatch(table, /text-left/);
  const dialogStart = source.indexOf('aria-labelledby="invoice-status-dialog-title"');
  const dialog = source.slice(dialogStart, source.indexOf("</section>", dialogStart));
  assert.match(dialog, /同来源訂単/);
  assert.match(dialog, /仅此訂単/);
  assert.match(dialog, /确认变更/);
  assert.match(dialog, /invoiceStatusDialogChangedCount/);
});

test("monthly invoice batches include only same-region, same-source orders overlapping the selected month", () => {
  const { getMonthlySameSourceOrders } = load("lib\\order-invoice-status.ts");
  const selected = {
    id: "selected", regionId: region, date: "2026-10-10", endDate: "2026-10-10", orderSource: "Source A",
  };
  const orders = [
    selected,
    { ...selected, id: "same-source" },
    { ...selected, id: "spanning", date: "2026-09-30", endDate: "2026-10-02" },
    { ...selected, id: "different-source", orderSource: "Source B" },
    { ...selected, id: "different-region", regionId: `${region.slice(0, -1)}2` },
    { ...selected, id: "outside-month", date: "2026-11-01", endDate: "2026-11-01" },
  ];
  assert.deepEqual(
    getMonthlySameSourceOrders(orders, selected, "2026-10").map((order) => order.id),
    ["selected", "same-source", "spanning"],
  );
  assert.deepEqual(
    Array.from(getMonthlySameSourceOrders(orders, { ...selected, orderSource: " " }, "2026-10")),
    [],
  );
});

test("dialog close controls float with their sticky headers", () => {
  const page = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const componentSources = [
    "components\\driver-selection-dialog.tsx",
    "components\\order-date-filter-dialog.tsx",
    "components\\source-selection-dialog.tsx",
  ].map((file) => fs.readFileSync(path.join(root, file), "utf8"));
  const dialogSources = [page, ...componentSources];
  for (const source of dialogSources) {
    const closeButtons = source.match(/>\s*×\s*<\/button>/g) || [];
    const stickyHeaders = source.match(/className="dialog-floating-header/g) || [];
    assert.equal(stickyHeaders.length, closeButtons.length);
  }
  const styles = fs.readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.match(styles, /\.dialog-floating-header\s*\{[^}]*position:\s*sticky/);
  assert.match(styles, /\.dialog-floating-header > button:last-child\s*\{[^}]*box-shadow:/);
});

test("overtime editor has five fields and recalculates both read-only totals on edits", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const declarations = source.slice(source.indexOf("const orderFinanceSections:"), source.indexOf("function createEmptyDraft("));
  const helpers = source.slice(source.indexOf("function getOrderFinanceAmount("), source.indexOf("/** The order as seen"));
  const sectionStart = source.indexOf("{orderFinanceSections.map((section)");
  const markup = source.slice(sectionStart, source.indexOf('<fieldset disabled={finance.driverPaymentType === "company_advance"}', sectionStart)).trim();
  const context = {
    require: nodeRequire, exports: {}, financeKey: "day",
    OrderReceipts: "order-receipts", financeOrder: { id: "fixture-order" }, date: "2026-10-27",
    setAccountingForm: (update) => { context.finance = update({ day: context.finance }).day; },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(
    declarations + helpers +
    `\nglobalThis.finance = { ...emptyOrderFinance };
     globalThis.render = () => (${markup.slice(1, -1)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } },
  ).outputText, context);
  const grid = () => context.render()[2].props.children[1];
  const labels = () => grid().props.children[0];
  const input = (index) => labels()[index].props.children.props.children[1].props.children[0];
  const edit = (index, value) => input(index).props.onChange({ target: { value } });
  assert.match(context.render()[0].props.className, /md:col-start-1 md:row-start-1/);
  assert.match(context.render()[1].props.className, /md:col-start-2 md:row-start-1/);
  assert.match(context.render()[1].props.className, /md:row-span-2/);
  assert.match(context.render()[2].props.className, /md:col-start-1 md:row-start-2/);
  assert.match(source, /grid items-start gap-3 md:col-span-2 md:grid-cols-2/);
  assert.match(source, /<fieldset disabled=\{finance.driverPaymentType === "company_advance"\} className="min-w-0 rounded border p-3 md:col-span-2 md:row-start-3/);
  assert.match(source, /lg:grid-cols-4" : "lg:grid-cols-3"/);
  assert.deepEqual(plain(labels().map((label) => label.props.children.props.children[0])), [
    "超時時間", "超時費用（旅報）", "超時請求（旅報）", "超時費用（工資）", "超時工資",
  ]);
  assert.match(grid().props.className, /grid-cols-2/);
  assert.match(labels()[0].props.className, /col-span-2 mx-auto/);
  assert.equal(input(2).props.readOnly, true);
  assert.equal(input(4).props.readOnly, true);
  assert.equal(input(1).props.value, 5000);
  assert.equal(input(3).props.value, 4000);
  assert.notEqual(input(1).props.readOnly, true);
  assert.notEqual(input(3).props.readOnly, true);
  edit(0, "2");
  assert.equal(input(2).props.value, 10000);
  assert.equal(input(4).props.value, 8000);
  edit(1, "3000");
  edit(3, "1500");
  assert.equal(input(2).props.value, 6000);
  assert.equal(input(4).props.value, 3000);
  edit(0, "1.25");
  assert.equal(input(2).props.value, 3750);
  assert.equal(input(4).props.value, 1875);
  edit(3, "");
  assert.equal(context.finance.driverOvertimeFee, 0);
  assert.equal(input(2).props.value, 3750);
  edit(1, "");
  assert.equal(context.finance.overtimeRequestAmount, 0);
  edit(0, "0");
  assert.equal(context.finance.driverOvertimeFee, 0);
  assert.equal(context.finance.overtimeRequestAmount, 0);
  for (const oldFinance of [
    { driverOvertimeHours: 0, driverOvertimeRate: 0, driverOvertimeFee: 0 },
    { driverOvertimeHours: 0, driverOvertimeRate: 0, driverOvertimeFee: 0, overtimeRequestRate: 0, overtimeRequestAmount: 0 },
  ]) {
    context.finance = context.initializeAccountingFinance(oldFinance);
    assert.equal(input(1).props.value, 5000);
    assert.equal(input(3).props.value, 4000);
    edit(0, "2");
    assert.equal(input(2).props.value, 10000);
    assert.equal(input(4).props.value, 8000);
  }
  context.finance = context.initializeAccountingFinance({
    driverOvertimeRate: 3500, overtimeRequestRate: 6000,
  });
  assert.equal(input(1).props.value, 6000);
  assert.equal(input(3).props.value, 3500);
  context.finance = context.initializeAccountingFinance({
    driverOvertimeHours: 2, driverOvertimeRate: 0, driverOvertimeFee: 3000,
    overtimeRequestAmount: 7000,
  });
  assert.equal(input(2).props.value, 7000);
  assert.equal(input(4).props.value, 3000);
  assert.match(source, /initializeAccountingFinance\(\s*batchOrder\.financeByDate/);
  const paymentGrid = () => context.render()[1].props.children[1].props.children[1];
  const paymentLabel = () => paymentGrid().props.children[0];
  const paymentSelect = () => paymentLabel().props.children[1];
  assert.equal(paymentLabel().props.children[0], "外注運転士出金方式");
  context.finance.driverPaymentType = "company_advance";
  assert.deepEqual(plain(paymentSelect().props.children.map((option) => option.props.value)), [
    "", "paypay", "微信", "支付宝", "口座",
  ]);
  for (const method of ["paypay", "微信", "支付宝", "口座", ""]) {
    context.finance.companyAdvancePaymentMethod = method;
    assert.equal(paymentSelect().props.value, method);
    assert.equal(paymentSelect().props.disabled, true);
  }
  const statusSelect = () => paymentGrid().props.children[1].props.children[1];
  const noteInput = () => paymentGrid().props.children[2].props.children[1];
  assert.match(paymentGrid().props.className, /grid-cols-2/);
  assert.match(paymentGrid().props.className, /sm:col-span-2/);
  assert.match(paymentGrid().props.className, /sm:grid-cols-2/);
  assert.match(paymentSelect().props.className, /h-10/);
  assert.match(statusSelect().props.className, /h-10/);
  assert.match(input(1).props.className, /h-10/);
  assert.match(paymentGrid().props.children[2].props.className, /col-span-2/);
  assert.deepEqual(plain(statusSelect().props.children.map((option) => option.props.children)), [
    "未選択", "已完成", "未完成",
  ]);
  for (const status of ["已完成", "未完成", ""]) {
    context.finance.companyAdvancePaymentStatus = status;
    context.finance.companyAdvancePaymentNote = "支付确认\n备注";
    assert.equal(statusSelect().props.value, status);
    assert.equal(noteInput().props.value, "支付确认\n备注");
    assert.equal(statusSelect().props.disabled, true);
    assert.equal(noteInput().props.readOnly, true);
  }
  assert.equal(noteInput().props.maxLength, 1000);
  assert.equal(noteInput().props.rows, 2);
  assert.match(noteInput().props.className, /h-12/);
  assert.doesNotMatch(noteInput().props.className, /md:flex-1/);
  assert.match(context.render()[1].props.className, /md:self-stretch/);
  assert.match(context.render()[1].props.children[1].props.className, /md:grid-rows-\[auto_auto_minmax\(0,1fr\)\]/);
  assert.match(noteInput().props.className, /resize-none/);
  assert.match(source, /key !== "companyAdvancePaymentStatus"/);
  assert.match(source, /key !== "companyAdvancePaymentNote"/);
});

test("overtime request API validates independent values and round-trips legacy omission", () => {
  const source = fs.readFileSync(path.join(root, "app\\api\\data\\route.ts"), "utf8");
  const schema = source.slice(source.indexOf("const orderFinanceSchema ="), source.indexOf("const financeByDateSchema"));
  const conversions = source.slice(source.indexOf("function toFinanceAmount("), source.indexOf("function toFinanceByDate("));
  const context = { z: nodeRequire("zod").z, hasValidDriverPayment: load("lib\\reservation-driver-payment.ts").hasValidDriverPayment };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(schema + conversions + "\nglobalThis.schema = orderFinanceSchema;", {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  for (const overtimeRequestAmount of [0, 5000, 99_999_999_999_999]) {
    const parsed = context.schema.parse({ overtimeRequestAmount });
    assert.equal(context.toOrderFinance(parsed).overtimeRequestAmount, overtimeRequestAmount);
  }
  for (const overtimeRequestAmount of [-1, 0.5, NaN, Infinity, null, "5000", 100_000_000_000_000]) {
    assert.equal(context.schema.safeParse({ overtimeRequestAmount }).success, false);
  }
  const legacy = context.schema.parse({ driverOvertimeFee: 3000 });
  assert.equal(Object.hasOwn(legacy, "overtimeRequestAmount"), false);
  assert.equal(Object.hasOwn(context.toOrderFinance(legacy), "overtimeRequestAmount"), false);
  const restored = context.toOrderFinance(JSON.parse(JSON.stringify({ overtimeRequestAmount: 0 })));
  assert.equal(restored.overtimeRequestAmount, 0);
  assert.equal(Object.hasOwn(context.toOrderFinance(legacy), "overtimeRequestRate"), false);
  const rated = { driverOvertimeHours: 1.25, overtimeRequestRate: 2500, overtimeRequestAmount: 3125 };
  assert.equal(context.toOrderFinance(context.schema.parse(rated)).overtimeRequestRate, 2500);
  assert.equal(context.schema.safeParse({ ...rated, overtimeRequestAmount: 3000 }).success, false);
  assert.equal(context.schema.safeParse({ ...rated, overtimeRequestRate: 0, overtimeRequestAmount: 0 }).success, true);
  for (const overtimeRequestRate of [-1, 0.5, NaN, Infinity, null, "5000", 100_000_000_000_000]) {
    assert.equal(context.schema.safeParse({ ...rated, overtimeRequestRate }).success, false);
  }
  assert.equal(context.schema.safeParse({
    driverOvertimeHours: 2, overtimeRequestRate: 99_999_999_999_999,
    overtimeRequestAmount: 99_999_999_999_999,
  }).success, false);
  assert.equal(context.schema.parse({}).companyAdvancePaymentMethod, "");
  assert.equal(context.toOrderFinance({}).companyAdvancePaymentMethod, "");
  for (const companyAdvancePaymentMethod of ["", "paypay", "微信", "支付宝", "口座"]) {
    const parsed = context.schema.parse({ companyAdvanceCompanyReport: 1200, companyAdvancePaymentMethod });
    const restored = context.toOrderFinance(JSON.parse(JSON.stringify(parsed)));
    assert.equal(restored.companyAdvancePaymentMethod, companyAdvancePaymentMethod);
    assert.equal(restored.companyAdvanceCompanyReport, 1200);
  }
  for (const companyAdvancePaymentMethod of ["現金", "bank", null, 123]) {
    assert.equal(context.schema.safeParse({ companyAdvancePaymentMethod }).success, false);
  }
  assert.equal(context.toOrderFinance({}).companyAdvancePaymentStatus, "");
  assert.equal(context.toOrderFinance({}).companyAdvancePaymentNote, "");
  for (const companyAdvancePaymentStatus of ["", "已完成", "未完成"]) {
    const value = { companyAdvancePaymentStatus, companyAdvancePaymentNote: "备注\n<确认>" };
    const restored = context.toOrderFinance(JSON.parse(JSON.stringify(context.schema.parse(value))));
    assert.equal(restored.companyAdvancePaymentStatus, companyAdvancePaymentStatus);
    assert.equal(restored.companyAdvancePaymentNote, value.companyAdvancePaymentNote);
  }
  for (const companyAdvancePaymentStatus of ["未選択", "invalid", null, 1]) {
    assert.equal(context.schema.safeParse({ companyAdvancePaymentStatus }).success, false);
  }
  assert.equal(context.schema.safeParse({ companyAdvancePaymentNote: "a".repeat(1000) }).success, true);
  for (const companyAdvancePaymentNote of ["a".repeat(1001), null, 1]) {
    assert.equal(context.schema.safeParse({ companyAdvancePaymentNote }).success, false);
  }
});

test("invoice always keeps order line and prints exactly the nonzero trip charges", () => {
  const { buildInvoicePrintHtml } = load("lib\\invoice-print.ts", {
    "@/lib/print-a4": { printA4Html() {} },
    "@/lib/company-seal": { isCompanySealDataUrl: (value) => value === "" },
  });
  const base = {
    number: "INV-000001", issuedDate: "2026-10-16", startDate: "2026-10-16", endDate: "2026-10-16",
    customer: "<Order>", recipient: "Recipient", contact: "", recipientAddress: "",
    company: "Company", phone: "", address: "", bankAccount: "", taxRegistrationNumber: "",
    orderPrice: 11000, etcTrip: 0, driverAdvanceTrip: 0, companyAdvanceTrip: 0,
  };
  const fees = ["etcTrip", "driverAdvanceTrip", "companyAdvanceTrip"];
  const labels = ["ETC料金", "運転士立替金", "会社立替金"];
  for (let mask = 0; mask < 8; mask++) {
    const data = { ...base };
    fees.forEach((fee, index) => { data[fee] = mask & (1 << index) ? 110 * (index + 1) : 0; });
    const html = buildInvoicePrintHtml(data);
    const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
    const hasTripReport = fees.some((fee) => data[fee] > 0);
    assert.equal((body.match(/<tr[ >]/g) ?? []).length, 1 + (hasTripReport ? 1 : 0));
    assert.equal(body.includes("旅報費用（全日程合計）"), hasTripReport);
    assert.ok(body.includes("&lt;Order&gt;"));
    labels.forEach((label, index) => assert.equal(body.includes(label), data[fees[index]] > 0));
    const total = data.orderPrice + fees.reduce((sum, fee) => sum + data[fee], 0);
    const tax = Math.floor(total * 10 / 110);
    assert.ok(html.includes(`<strong>¥${total.toLocaleString("ja-JP")}</strong>`));
    assert.ok(html.includes(`うち消費税額（10%）</td><td class="number">¥${tax.toLocaleString("ja-JP")}`));
  }
  const zero = buildInvoicePrintHtml({ ...base, orderPrice: 0 });
  assert.ok(zero.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].includes('class="number">¥0'));
  assert.throws(() => buildInvoicePrintHtml({ ...base, etcTrip: -1 }));
  const overtime = buildInvoicePrintHtml({ ...base, overtimeRequest: 5500 });
  assert.ok(overtime.includes('class="overtime-request"'));
  assert.ok(overtime.includes("超時料金（全日程合計）"));
  assert.ok(overtime.includes("<strong>¥16,500</strong>"));
  assert.ok(overtime.includes('うち消費税額（10%）</td><td class="number">¥1,500'));
  assert.doesNotMatch(buildInvoicePrintHtml({ ...base, overtimeRequest: 0 }), /class="overtime-request"/);
  for (const overtimeRequest of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => buildInvoicePrintHtml({ ...base, overtimeRequest }));
  }
});

test("invoice lists each day's trip summary and fare before trip-report charges", () => {
  const { buildInvoicePrintHtml } = load("lib\\invoice-print.ts", {
    "@/lib/print-a4": { printA4Html() {} },
    "@/lib/company-seal": { isCompanySealDataUrl: (value) => value === "" },
  });
  const base = {
    number: "INV-000002", issuedDate: "2026-10-21", startDate: "2026-10-20", endDate: "2026-10-21",
    customer: "Tour <A>", recipient: "Recipient", contact: "", recipientAddress: "",
    company: "Company", phone: "", address: "", bankAccount: "", taxRegistrationNumber: "",
    orderPrice: 50000, etcTrip: 1100, driverAdvanceTrip: 2200, companyAdvanceTrip: 0,
    days: [
      { date: "2026-10-20", summary: "成田空港 → <Hotel>", fare: 30000 },
      { date: "2026-10-21", summary: "", fare: 20000 },
    ],
  };
  const html = buildInvoicePrintHtml(base);
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = body.match(/<tr[^>]*>[\s\S]*?<\/tr>/g);
  assert.equal(rows.length, 3);
  assert.ok(rows[0].includes("10/20（火）") && rows[0].includes("成田空港 → &lt;Hotel&gt;") && rows[0].includes("¥30,000"));
  assert.ok(rows[1].includes("10/21（水）") && rows[1].includes("運行料金") && rows[1].includes("¥20,000"));
  assert.ok(rows[2].includes("旅報費用（全日程合計）") && rows[2].includes("ETC料金 ¥1,100／運転士立替金 ¥2,200") && rows[2].includes("¥3,300"));
  assert.ok(!rows[2].includes("会社立替金"));
  assert.ok(html.includes("件名：Tour &lt;A&gt;"));
  assert.ok(html.includes("<strong>¥53,300</strong>"));
  const withOvertime = buildInvoicePrintHtml({ ...base, overtimeRequest: 5500 });
  const overtimeRows = withOvertime.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/g);
  assert.equal(overtimeRows.length, 4);
  assert.ok(overtimeRows[3].includes("超時料金（全日程合計）") && overtimeRows[3].includes("¥5,500"));
  assert.ok(withOvertime.includes("<strong>¥58,800</strong>"));
  assert.throws(() => buildInvoicePrintHtml({ ...base, orderPrice: 49999 }), /不一致/);
  assert.throws(() => buildInvoicePrintHtml({ ...base, days: [{ date: "2026-10-20", summary: "", fare: -1 }] }));
});

test("inline operation markers remain in reservation editor and details but not the list", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const markers = [...source.matchAll(/<LastOperation record=\{([^\n]+?)\} \/>/g)];
  assert.equal(markers.length, 2);
  assert.ok(!source.includes("<LastOperation record={order} />"));
  assert.ok(markers[0][1].includes("editingOrderId"));
  assert.ok(markers[1][1].includes("selectedOrderDetails.id"));
  assert.ok(source.includes('activeView === "audit" && currentProfile.role === "admin"'));
});

test("accounting total requests split by deposit method in the page and A4 report", () => {
  const helper = load("lib\\request-amount-summary.ts");
  const { buildOrderFinancePrintHtml } = load("lib\\order-finance-print.ts", {
    "@/lib/print-a4": {},
    "@/lib/request-amount-summary": helper,
  });
  assert.deepEqual(plain(helper.summarizeRequestAmounts([
    { depositMethod: "現金入金", requestAmount: 5 },
  ])), { bank: 0, cash: 5, unassigned: 0 });
  const rows = [
    { depositMethod: "口座入金", requestAmount: 1000, paid: false },
    { depositMethod: "现金入金", requestAmount: 2000, paid: true },
    { depositMethod: "", requestAmount: 300, paid: false },
    { depositMethod: "口座入金", requestAmount: 50, paid: true },
  ].map((row) => ({
    date: "2026-10-01", customer: "Order", source: "Source", driver: "Driver",
    vehicleNumber: "1234", invoiceStatus: "未完成", driverAdvances: 0,
    companyExpenses: 0, driverWages: 0, profit: 100, ...row,
  }));
  assert.deepEqual(plain(helper.summarizeRequestAmounts(rows)), { bank: 1050, cash: 2000, unassigned: 300 });
  assert.deepEqual(plain(helper.summarizeRequestAmounts([])), { bank: 0, cash: 0, unassigned: 0 });
  assert.deepEqual(plain(helper.summarizeRequestAmounts(rows.filter((row) => row.paid))), { bank: 50, cash: 2000, unassigned: 0 });
  assert.throws(() => helper.summarizeRequestAmounts([{ depositMethod: "invalid", requestAmount: 1 }]), /入金方式无效/);
  const html = buildOrderFinancePrintHtml({
    month: "2026-10", region: "Tokyo", source: "All", company: "All",
    depositStatus: "All", invoiceStatus: "All", rows,
  });
  assert.match(html, /総請求金額<strong>¥3,350/);
  assert.match(html, /口座入金：¥1,050/);
  assert.match(html, /現金入金：¥2,000/);
  assert.match(html, /未设置入金方式：¥300/);
  assert.doesNotMatch(html, /総卖上/);
  const page = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(page, /<option value="现金入金">現金入金<\/option>/);
  const dataRoute = fs.readFileSync(path.join(root, "app\\api\\data\\route.ts"), "utf8");
  assert.match(dataRoute, /z\.enum\(\["", "口座入金", "现金入金", "現金入金"\]\)/);
  assert.match(page, /summarizeRequestAmounts\(\s*filteredOrderFinanceOrders\.map/);
  assert.match(page, /requestAmount: getOrderFinanceForOrder\(order\)\.requestAmount/);
  assert.match(page, /総請求金額<\/p>/);
  for (const key of ["bank", "cash", "unassigned"]) {
    assert.ok(page.includes(`filteredFinanceRequestAmounts.${key}`));
  }
  assert.match(page, /paid: Boolean\(order\.depositDate\),\s*depositMethod: order\.depositMethod/);
});

test("balance adds manual income, subtracts only manual expense and prints matching A4 totals", () => {
  const balance = load("lib\\balance-summary.ts");
  const { buildBalancePrintHtml } = load("lib\\balance-print.ts", {
    "@/lib/print-a4": { printA4Html() {} },
  });
  const orders = [{ companyName: "A", requestAmount: 1000, depositMethod: "口座入金" }, { companyName: "B", requestAmount: 50, depositMethod: "现金入金" }];
  const expenses = [{ companyName: "A", name: "Costs", amount: 400 }, { companyName: "B", name: "Cost", amount: 200 }];
  const incomes = [{ companyName: "A", name: "<Income>", amount: 200 }, { companyName: "B", name: "Other", amount: 50 }];
  const summary = balance.summarizeBalance("", ["A", "B"], orders, expenses, incomes);
  assert.deepEqual(plain(summary.totals), { requestAmount: 1050, bankRequestAmount: 1000, cashRequestAmount: 50, unassignedRequestAmount: 0, incomeTotal: 250, expenseTotal: 600, net: 700 });
  assert.equal(summary.rows.find((row) => row.companyName === "B").net, -100);
  assert.equal(balance.summarizeBalance("A", [], orders, expenses, incomes).totals.net, 800);
  assert.equal(balance.summarizeBalance("", [], [], [], incomes).totals.net, 250);
  assert.equal(balance.summarizeBalance("", [], orders, expenses).totals.net, 450);
  assert.throws(() => balance.summarizeBalance("", [], [], [], [{ companyName: "", name: "Bad", amount: -1 }]));
  assert.throws(() => balance.summarizeBalance("", [], [{ companyName: "A", requestAmount: Number.MAX_SAFE_INTEGER, depositMethod: "" }], [],
    [{ companyName: "A", name: "Overflow", amount: 1 }]));
  assert.equal(balance.getBalanceServiceMonth({ offDates: ["2026-09-30"] }, ["2026-09-30", "2026-10-01"]), "2026-10");
  const html = buildBalancePrintHtml({ month: "2026-10", region: "Tokyo", company: "All", summary });
  assert.ok(html.includes("其他收入総和"));
  assert.ok(html.includes("&lt;Income&gt;"));
  assert.ok(html.includes("¥700"));
  assert.ok(html.includes('class="number loss">¥-100'));
  assert.ok(html.includes("＋手動其他收入総和－手動支出総和"));
  assert.ok(html.includes("口座入金：¥1,000"));
  assert.ok(html.includes("現金入金：¥50"));
  assert.ok(html.includes("未设置入金方式：¥0"));
});

test("balance request breakdown reconciles across companies without treating methods as received payments", () => {
  const { summarizeBalance } = load("lib\\balance-summary.ts");
  const orders = [
    { companyName: "A", requestAmount: 100, depositMethod: "口座入金", depositDate: "" },
    { companyName: "A", requestAmount: 200, depositMethod: "现金入金", depositDate: "2026-11-01" },
    { companyName: "A", requestAmount: 50, depositMethod: "" },
    { companyName: "B", requestAmount: 300, depositMethod: "口座入金" },
    { companyName: "", requestAmount: 25, depositMethod: "" },
    { companyName: "B", requestAmount: 0, depositMethod: "现金入金" },
  ];
  const summary = summarizeBalance("", ["A", "B"], orders, []);
  assert.equal(summary.totals.bankRequestAmount, 400);
  assert.equal(summary.totals.cashRequestAmount, 200);
  assert.equal(summary.totals.unassignedRequestAmount, 75);
  assert.equal(summary.totals.net, 675);
  for (const row of [...summary.rows, summary.totals]) {
    assert.equal(row.requestAmount, row.bankRequestAmount + row.cashRequestAmount + row.unassignedRequestAmount);
  }
  const filtered = summarizeBalance("A", [], orders, []).totals;
  assert.equal(filtered.bankRequestAmount, 100);
  assert.equal(filtered.cashRequestAmount, 200);
  assert.equal(filtered.unassignedRequestAmount, 50);
  assert.equal(summarizeBalance("__unassigned_company__", [], orders, []).totals.unassignedRequestAmount, 25);
  assert.throws(() => summarizeBalance("", [], [{ companyName: "A", requestAmount: 1, depositMethod: "invalid" }], []), /入金方式无效/);
  const { buildBalancePrintHtml } = load("lib\\balance-print.ts", { "@/lib/print-a4": {} });
  const html = buildBalancePrintHtml({ month: "2026-10", region: "Tokyo", company: "All", summary });
  assert.match(html, /<th>請求総和<\/th><th>口座入金<\/th><th>現金入金<\/th><th>未设置入金方式<\/th>/);
  assert.match(html, /口座入金：¥400/);
  assert.match(html, /現金入金：¥200/);
  assert.match(html, /未设置入金方式：¥75/);
});

test("actual balance page pipeline uses selected-month income drafts and saves income separately", () => {
  const source = ts.createSourceFile("page.tsx", fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["balanceVisibleExpenseItems", "getBalanceExpenseAmount", "balanceResult"]);
  const pieces = [], functions = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && names.has(node.name.getText(source))) {
      pieces.push(`const ${node.getText(source)};`);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === "saveBalanceExpenseAmounts") {
      functions.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(pieces.length, 3);
  const balance = load("lib\\balance-summary.ts");
  const expenses = [
    { id: "expense", companyName: "A", kind: "expense", name: "Costs", monthlyAmounts: { "2026-10": 400 } },
    { id: "income", companyName: "A", kind: "income", name: "Other", monthlyAmounts: { "2026-10": 200, "2026-11": 900 } },
    { id: "foreign", companyName: "B", kind: "income", name: "Foreign", monthlyAmounts: { "2026-10": 5000 } },
  ];
  const context = {
    balanceCompanyFilter: "A", balanceMonth: "2026-10", balanceExpenseItems: expenses,
    balanceExpenseAmountDrafts: { "income:2026-10": "350", "expense:2026-10": "450" },
    balanceExpensesMigrationPending: false, companyRows: [{ name: "A" }],
    orders: [{ company: "A", orderPrice: 1000, depositMethod: "口座入金", offDates: [], dateKeys: ["2026-10-31", "2026-11-01"],
      financeByDate: { "2026-10-31": { requestAmount: 20 }, "2026-11-01": { requestAmount: 30 } } }],
    getOrderDateKeys: (order) => order.dateKeys,
    calculateOrderFinance: (entry) => entry, ...balance,
  };
  const script = ts.transpileModule(pieces.join("\n") + "\nglobalThis.result = balanceResult;",
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  function calculate(overrides = {}) {
    const run = { ...context, ...overrides };
    vm.runInNewContext(script, run);
    return run.result;
  }
  assert.deepEqual(plain(calculate().summary.totals), {
    requestAmount: 1050, bankRequestAmount: 1050, cashRequestAmount: 0, unassignedRequestAmount: 0, incomeTotal: 350, expenseTotal: 450, net: 950,
  });
  assert.equal(calculate({ balanceMonth: "2026-11" }).summary.totals.net, 900);
  assert.equal(calculate({ balanceExpenseAmountDrafts: { "income:2026-10": "" } }).summary.totals.net, 650);
  assert.equal(calculate({ balanceExpenseAmountDrafts: { "income:2026-10": "bad" } }).summary, null);
  let saved = expenses, drafts = { ...context.balanceExpenseAmountDrafts }, error = "";
  const saveContext = { ...context,
    setBalanceExpenseItems: (update) => { saved = update(saved); },
    setBalanceExpenseAmountDrafts: (update) => { drafts = update(drafts); },
    setBalanceExpenseError: (message) => { error = message; },
  };
  vm.runInNewContext(ts.transpileModule(functions.join("\n") + '\nsaveBalanceExpenseAmounts("income");',
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, saveContext);
  assert.equal(error, "");
  assert.equal(saved.find((item) => item.id === "income").monthlyAmounts["2026-10"], 350);
  assert.equal(saved.find((item) => item.id === "income").monthlyAmounts["2026-11"], 900);
  assert.equal(saved.find((item) => item.id === "expense").monthlyAmounts["2026-10"], 400);
  assert.equal(drafts["expense:2026-10"], "450");
  assert.equal(drafts["income:2026-10"], undefined);
});

test("manual driver wage items can be entered with all-company filtering", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const add = source.slice(
    source.indexOf("  function addDriverWageItemDraft()"),
    source.indexOf("  function saveDriverWageItems()"),
  );
  const save = source.slice(
    source.indexOf("  function saveDriverWageItems()"),
    source.indexOf("  function deleteDriverWageItem("),
  );
  const panelStart = source.indexOf('title="給料統計"');
  const panel = source.slice(panelStart, source.indexOf("</FinanceSummaryPanel>", panelStart));

  assert.doesNotMatch(add, /driverFinanceCompanyFilter === ""\)\s*\{/);
  assert.match(add, /driverFinanceCompanyFilter === "" \? undefined : driverWageItemCompanyName/);
  assert.match(save, /draft\.companyName === undefined/);
  assert.match(save, /companyName: draft\.companyName \?\? ""/);
  assert.match(panel, /driverFinanceCompanyFilter === "" && \(/);
  assert.match(panel, /请選択所属会社/);
  assert.match(panel, /未设置所属会社/);
});

test("metadata validation, nested financial changes and Japan-local time", () => {
  assert.equal(audit.toLastOperation(null), null);
  assert.deepEqual(plain(audit.toLastOperation(operation)), operation);
  assert.throws(() => audit.toLastOperation({ ...operation, at: "invalid" }));
  assert.throws(() => audit.toLastOperation({ ...operation, actorName: 1 }));
  assert.match(audit.formatAuditTime(operation.at), /2026\/10\/16 03:00:00/);
  const changes = audit.auditChanges(
    { finance_by_date: { "2026-10-16": { fuelCost: 100, driver: "A" } } },
    { finance_by_date: { "2026-10-16": { fuelCost: 200, driver: "A" } } },
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].before, 100);
  assert.equal(changes[0].after, 200);
  assert.match(changes[0].field, /2026-10-16/);
  assert.equal(audit.auditChanges({ phone: "123" }, null)[0].after, undefined);
});

test("history endpoint rejects unauthenticated/non-admin users and validates filters", async () => {
  let profile = null;
  const calls = [];
  const query = {};
  for (const method of ["select", "order", "eq", "ilike", "gte", "lte"]) {
    query[method] = (...args) => { calls.push([method, ...args]); return query; };
  }
  query.range = async (...args) => {
    calls.push(["range", ...args]);
    return { data: Array.from({ length: 51 }, (_, index) => ({ id: index })), error: null };
  };
  const route = load("app\\api\\admin\\audit\\route.ts", {
    "@/lib/supabase/authorization": {
      getAuthenticatedProfile: async () => ({ profile, supabase: { from: () => query } }),
    },
    "@/lib/api-response": { jsonResponse: (data, init) => ({ data, status: init?.status ?? 200 }) },
    "@/lib/audit": audit,
  });
  const get = (search = "") => route.GET(new Request(`http://localhost/api/admin/audit${search}`));
  assert.equal((await get()).status, 401);
  profile = { role: "user", position: "役员" };
  assert.equal((await get()).status, 403);
  assert.equal(calls.length, 0);
  profile = { role: "admin" };
  for (const search of ["?page=0", "?table=profiles", "?region=bad", "?record=bad",
    "?start=2026-10-17&end=2026-10-16", "?start=2026-02-30", "?action=UPSERT"]) {
    assert.equal((await get(search)).status, 400, search);
  }
  const response = await get(`?page=2&table=drivers&actor=A%25_&region=${region}&start=2026-10-15&end=2026-10-16&record=${id}`);
  assert.equal(response.status, 200);
  assert.equal(response.data.logs.length, 50);
  assert.equal(response.data.hasNext, true);
  assert.deepEqual(plain(calls.find((call) => call[0] === "range")), ["range", 50, 100]);
  assert.ok(calls.some((call) => call[0] === "ilike" && call[2] === "%A\\%\\_%"));
  assert.ok(calls.some((call) => call[0] === "gte" && call[2] === "2026-10-15T00:00:00+09:00"));
  assert.ok(calls.some((call) => call[0] === "lte" && call[2] === "2026-10-16T23:59:59.999999+09:00"));
});

test("business POST returns trusted metadata and rejects client-supplied audit fields", async () => {
  let writes = 0;
  let savedDriverRow;
  let metadataReads = 0;
  const query = {
    upsert: (rows) => {
      assert.ok(!Object.hasOwn(rows[0], "last_operation"));
      savedDriverRow = rows[0];
      writes += rows.length;
      return { select: async (columns) => {
        assert.equal(columns, "id, last_operation");
        return { data: [{ id, last_operation: operation }], error: null };
      } };
    },
    select: () => query,
    in: async () => {
      metadataReads++;
      return { data: [{ id, last_operation: operation }], error: null };
    },
  };
  const route = load("app\\api\\data\\route.ts", {
    "@/lib/supabase/authorization": {
      getAuthenticatedProfile: async () => ({ profile: { role: "user", regionId: region }, supabase: { from: () => query } }),
    },
    "@/lib/api-response": { jsonResponse: (data, init) => ({ data, status: init?.status ?? 200 }) },
    "@/lib/supabase/pagination": {},
    "@/lib/delete-password": { verifyDeletePassword: () => ({ configured: true, valid: true }) },
    "@/lib/company-seal": { isCompanySealDataUrl: () => true, MAX_SEAL_DATA_LENGTH: 350000 },
    "@/lib/audit": audit,
  });
  const driver = { id, regionId: region, name: "Driver", phone: "", wechat: "", whatsapp: "", licenseExpiry: "", personalSlogan: "一路平安" };
  const post = (entry) => route.POST({ json: async () => ({
    collection: "drivers", upsert: [entry], deleteIds: [], deletePassword: "",
  }) });
  assert.equal((await post({ ...driver, lastOperation: operation })).status, 400);
  assert.equal(writes, 0);
  const response = await post(driver);
  assert.equal(response.status, 200);
  assert.deepEqual(plain(response.data.saved), [{ id, lastOperation: operation }]);
  assert.equal(writes, 1);
  assert.equal(metadataReads, 0);
  assert.equal(savedDriverRow.personal_slogan, "一路平安");
});

test("persistence strips audit metadata, merges saved stamp without losing queued edits", async () => {
  let state = [];
  const requests = [], errors = [], pending = [];
  const client = load("lib\\api-client.ts");
  const fetchMock = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, saved: [{ id, lastOperation: operation }] }) };
  };
  const hook = load("lib\\use-persisted-collection.ts", {
    react: { useState: () => [state, (next) => { state = next; }],
      useRef: (value) => ({ current: value }), useCallback: (callback) => callback },
    "@/lib/api-client": client, "@/lib/audit": audit,
  }, { fetch: fetchMock });
  const collection = hook.usePersistedCollection("drivers",
    (message) => errors.push(message), (value) => pending.push(value), () => "", () => region);
  collection.replaceItems([{ id, regionId: region, name: "Old", lastOperation: operation }]);
  collection.updateItems((items) => items.map((item) => ({ ...item, name: "First" })));
  collection.updateItems((items) => items.map((item) => ({ ...item, name: "Second" })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => !Object.hasOwn(request.upsert[0], "lastOperation")));
  assert.equal(state[0].name, "Second");
  assert.deepEqual(plain(state[0].lastOperation), operation);
  collection.updateItems((items) => items.map((item) => ({ ...item, lastOperation: { ...operation, actorName: "Changed metadata only" } })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(errors.length, 0);
  assert.equal(pending.reduce((sum, value) => sum + value, 0), 0);
});

test("dialog completion waits for every write, retains failures and releases the saving lock", async () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const first = source.indexOf("  async function finishDialogSave(");
  const helper = source.slice(first, source.indexOf("  const [accountError", first));
  for (const outcome of [true, false, "throw"]) {
    let release, closed = 0;
    const alerts = [], busy = [], errors = [];
    const context = {
      dialogSavingRef: { current: false },
      setDialogSaving: value => busy.push(value), setPersistenceError: value => errors.push(value),
      alert: value => alerts.push(value), console: { error() {} },
    };
    vm.createContext(context);
    vm.runInContext(ts.transpileModule(helper, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
    const pending = new Promise((resolve, reject) => {
      release = () => outcome === "throw" ? reject(new Error("Offline")) : resolve(outcome);
    });
    const saving = context.finishDialogSave([Promise.resolve(true), pending], () => closed++);
    assert.equal(context.dialogSavingRef.current, true);
    assert.equal(closed, 0);
    release();
    await saving;
    assert.equal(closed, outcome === true ? 1 : 0);
    assert.deepEqual(busy, [true, false]);
    assert.equal(context.dialogSavingRef.current, false);
    assert.equal(alerts.length, outcome === true ? 0 : 1);
    assert.equal(errors.length, outcome === "throw" ? 1 : 0);
  }
  assert.match(source, /inert=\{dialogSaving\}/);
  assert.doesNotMatch(source, /预约已保存，请点右上角/);
});

test("save confirmation reflects queued failures even after no-op or later successful writes", async () => {
  let state = [], complete;
  const errors = [];
  const hook = load("lib\\use-persisted-collection.ts", {
    react: { useState: () => [state, next => { state = next; }],
      useRef: value => ({ current: value }), useCallback: callback => callback },
    "@/lib/api-client": load("lib\\api-client.ts"), "@/lib/audit": audit,
  }, { fetch: () => new Promise(resolve => { complete = resolve; }) });
  const collection = hook.usePersistedCollection("drivers", message => errors.push(message), () => {}, () => "", () => region);
  collection.replaceItems([{ id, regionId: region, name: "Old" }]);
  collection.updateItems(items => items.map(item => ({ ...item, name: "New" })));
  let settled = false;
  const confirmation = collection.waitForSave().then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  complete({ ok: false, status: 503, statusText: "Unavailable", json: async () => ({ error: "Synthetic save failure" }) });
  assert.equal(await confirmation, false);
  assert.equal(errors.length, 1);
  collection.updateItems(items => items);
  assert.equal(await collection.waitForSave(), false);
  collection.updateItems(items => items.map(item => ({ ...item, name: "Retry" })));
  await new Promise(resolve => setImmediate(resolve));
  complete({ ok: true, json: async () => ({ saved: [{ id, lastOperation: operation }] }) });
  assert.equal(await collection.waitForSave(), false, "a later write cannot confirm earlier failed records");
  collection.replaceItems([{ id, regionId: region, name: "Verified" }]);
  assert.equal(await collection.waitForSave(), true);
});

test("background sync applies server data only when no local edits are pending or newer", async () => {
  let state = [];
  let releaseSave;
  const client = load("lib\\api-client.ts");
  const fetchMock = () => new Promise((resolve) => {
    releaseSave = () => resolve({ ok: true, json: async () => ({ ok: true, saved: [{ id, lastOperation: operation }] }) });
  });
  const hook = load("lib\\use-persisted-collection.ts", {
    react: { useState: () => [state, (next) => { state = next; }],
      useRef: (value) => ({ current: value }), useCallback: (callback) => callback },
    "@/lib/api-client": client, "@/lib/audit": audit,
  }, { fetch: fetchMock });
  const collection = hook.usePersistedCollection("drivers", () => {}, () => {}, () => "", () => region);
  collection.replaceItems([{ id, regionId: region, name: "Old" }]);

  const remote = [{ id, regionId: region, name: "Remote" }];
  let version = collection.getChangeVersion();
  assert.equal(collection.syncItems(remote, version), true);
  assert.equal(state[0].name, "Remote");
  assert.equal(collection.syncItems(remote, version), false, "unchanged data is not re-applied");

  version = collection.getChangeVersion();
  collection.updateItems((items) => items.map((item) => ({ ...item, name: "Local" })));
  assert.equal(collection.syncItems([{ id, regionId: region, name: "Stale" }], collection.getChangeVersion()), false,
    "pending save blocks sync");
  await new Promise((resolve) => setImmediate(resolve));
  releaseSave();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(collection.syncItems([{ id, regionId: region, name: "Stale" }], version), false,
    "fetch started before a local edit is discarded");
  assert.equal(state[0].name, "Local");
  assert.equal(collection.syncItems([{ id, regionId: region, name: "Newer remote" }], collection.getChangeVersion()), true);
  assert.equal(state[0].name, "Newer remote");

  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("DATA_SYNC_INTERVAL_MS = 10_000"));
  assert.ok(source.includes('document.visibilityState !== "visible"'));
});

test("last-operation labels escape operator names and render historical rows", () => {
  const { LastOperation } = load("components\\last-operation.tsx", { "@/lib/audit": audit });
  const html = renderToStaticMarkup(React.createElement(LastOperation, {
    record: { id, lastOperation: { ...operation, actorName: "<script>alert(1)</script>" } },
  }));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  const historical = renderToStaticMarkup(React.createElement(LastOperation, { record: { id } }));
  assert.ok(historical.includes("历史记录"));
});

test("history UI renders filters, operator, Japan time and escaped before/after details", () => {
  let stateIndex = 0;
  const result = {
    logs: [{
      id, occurred_at: operation.at, actor_id: id, actor_name: operation.actorName,
      region_id: region, table_name: "drivers", record_id: id, record_label: "Driver",
      action: "UPDATE", before_data: { phone: "123" },
      after_data: { phone: "<script>alert(1)</script>" },
    }], hasNext: false,
  };
  const { AuditHistory } = load("components\\audit-history.tsx", {
    react: {
      useEffect() {},
      useState: (initial) => {
        const overrides = { 2: result, 4: false };
        return [Object.hasOwn(overrides, stateIndex) ? overrides[stateIndex++] : (stateIndex++, initial), () => {}];
      },
    },
    "@/lib/audit": audit,
    "@/lib/api-client": load("lib\\api-client.ts"),
  });
  const html = renderToStaticMarkup(React.createElement(AuditHistory, {
    regionId: region,
    regions: [{ id: region, name: "東京" },
      { id: "60000000-0000-4000-8000-000000000002", name: "大阪" },
      { id: "60000000-0000-4000-8000-000000000003", name: "北海道" }],
  }));
  for (const value of ["操作记录", "業務类型", "开始日期", "结束日期", "操作前", "操作后", "Test Operator", "2026/10/16 03:00:00"]) {
    assert.ok(html.includes(value), value);
  }
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.indexOf("東京") < html.indexOf("大阪"));
  assert.ok(html.indexOf("大阪") < html.indexOf("北海道"));
});

test("order source dialog ranks sources by non-cancelled order count within region", () => {
  const { rankSourcesByUsage } = load("lib\\source-selection.ts");
  const other = "60000000-0000-4000-8000-000000000002";
  const sources = [
    { id: "a", regionId: region, companyName: "Alpha Travel Co", shortName: "AT", color: "#000000" },
    { id: "b", regionId: region, companyName: "Beta", shortName: "", color: "#000000" },
    { id: "c", regionId: region, companyName: "Cherry", shortName: "", color: "#000000" },
  ];
  const orders = [
    { regionId: region, orderSource: "Beta", status: "予約確定" },
    { regionId: region, orderSource: "Beta", status: "仮予約" },
    { regionId: region, orderSource: "Alpha Travel Co", status: "予約確定" },
    { regionId: region, orderSource: "Alpha Travel Co", status: "キャンセル" },
    { regionId: other, orderSource: "Cherry", status: "予約確定" },
    { regionId: other, orderSource: "Cherry", status: "予約確定" },
  ];
  const ranked = rankSourcesByUsage(sources, orders);
  assert.deepEqual(ranked.map((source) => [source.id, source.orderCount]), [["b", 2], ["a", 1], ["c", 0]]);
  const page = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(page.includes("<SourceSelectionDialog"));
  assert.ok(!page.includes("customSourceMode"));
});

test("calendar uses a year dialog, tiles month buttons on desktop and keeps the phone dropdown", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf('<div className="calendar-date-controls');
  const controls = source.slice(start, source.indexOf('<div className="calendar-day-slider', start));
  assert.doesNotMatch(controls, /type="number"/);
  assert.match(controls, /aria-haspopup="dialog"/);
  assert.match(controls, /role="dialog"[\s\S]*aria-labelledby="calendar-year-dialog-title"/);
  assert.match(controls, /選択年份/);
  assert.match(controls, /event\.key === "Escape"/);
  assert.match(controls, /\.filter\(\(year\) => year <= 2100\)/);
  assert.match(controls, /<label className="calendar-month-select [^"]*sm:hidden">/);
  assert.match(controls, /<select/);
  assert.match(controls, /className="calendar-month-buttons hidden [^"]*sm:flex" role="group" aria-label="選択月份"/);
  assert.match(controls, /Array\.from\(\{ length: 12 \}/);
  assert.match(controls, /aria-pressed=\{selected\}/);
  assert.match(controls, /calendar-date-controls flex flex-wrap items-center justify-center/);
  assert.match(controls, /calendar-month-buttons hidden min-w-0 flex-\[12_1_44px\] flex-nowrap/);
  assert.match(controls, /calendar-year-button [^"]*py-1 text-center text-xs font-semibold[^"]*sm:flex-\[1_1_0px\] sm:px-0/);
  assert.match(controls, /min-w-0 flex-1 rounded-full border py-1/);
  assert.match(controls, /aria-label="上一月"/); assert.match(controls, /aria-label="下一月"/);
  const slider = source.slice(source.indexOf('<div className="calendar-day-slider'), source.indexOf("</div>", source.indexOf('<div className="calendar-day-slider')));
  assert.match(slider, /className="calendar-day-slider fixed bottom-4 left-1\/2 z-40 w-\[calc\(100%-2rem\)\] max-w-\[640px\] -translate-x-1\/2"/);
  assert.doesNotMatch(slider, /bg-white|border-slate|shadow-lg|rounded-full/);
  const css = fs.readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.match(css, /\.calendar-day-slider,\s*\.calendar-day-slider input \{\s*background: transparent !important;\s*background-color: transparent !important;/);
  assert.match(css, /\.calendar-day-slider input::-webkit-slider-runnable-track \{[\s\S]*transparent var\(--calendar-progress\)/);
  assert.match(css, /\.calendar-day-slider input::-moz-range-track \{\s*height: 4px;\s*border: 0;[\s\S]*background: transparent;/);
  assert.match(source, /"--calendar-progress": `\$\{\(\(calendarCenterDate\.getDate\(\) - 1\) \/ Math\.max\(1, calendarDaysInMonth - 1\)\) \* 100\}%`/);
});

test("calendar vehicle quick filters follow the date controls and hide reservations from other sources", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const filtersStart = source.indexOf('<div className="calendar-vehicle-filters');
  const toolbarStart = source.indexOf('<div className="calendar-toolbar');
  const scrollStart = source.indexOf('className="calendar-scroll');
  const filters = source.slice(filtersStart, scrollStart);
  assert.ok(filtersStart > toolbarStart, "quick filters should be below the date controls");
  assert.ok(source.indexOf("calendar-date-controls", toolbarStart) < filtersStart);
  assert.ok(filters.indexOf('["external", "外注"]') < filters.indexOf('aria-label="筛选预约来源"'));
  assert.ok(filters.indexOf('aria-label="筛选预约来源"') < filters.indexOf('aria-label="回到今天"'));
  assert.match(filters, /calendar-vehicle-filters flex flex-wrap items-center gap-1[^"]*px-3 py-0\.5/);
  assert.match(filters, /rounded-full border px-4 py-1\.5 text-sm font-medium transition-colors/);
  assert.match(filters, /calendar-today-button rounded-full border border-blue-200 bg-blue-50 px-4 py-1\.5 text-sm/);
  assert.match(filters, /setSourceSelectionOpen\("calendar-filter"\)/);
  const toolbar = source.slice(toolbarStart, filtersStart);
  assert.doesNotMatch(toolbar, /拖動車両左侧 ⠿ 可调整顺序/);
  assert.doesNotMatch(filters, /恢复默认顺序/);
  assert.doesNotMatch(toolbar, /formatCalendarDate\(calendarStartDate\)/);
  assert.doesNotMatch(source, /查看前后共 11 天/);
  const rows = source.slice(source.indexOf("{filteredCalendarVehicleRecords.map((vehicleRecord)"));
  const visible = rows.slice(rows.indexOf("const visibleOrders = orders"), rows.indexOf("const orderLanes"));
  assert.match(visible, /calendarSourceFilter === "" \|\|\s*\(calendarSourceFilter === UNSOURCED_ORDER\s*\? !order\.orderSource\s*: order\.orderSource === calendarSourceFilter\)/);
  assert.match(source, /sourceSelectionOpen === "calendar-filter"\) \{\s*setCalendarSourceFilter\(name\);/);
  assert.match(source, /if \(calendarSourceFilter === source\.companyName\) setCalendarSourceFilter\(""\);/);
  assert.match(source, /className="calendar-scroll max-h-\[calc\(100dvh-122px\)\] overflow-auto p-0"/);
  assert.doesNotMatch(source, /className="calendar-scroll[^"]*pb-24/);
  assert.match(source, /className="calendar-grid min-w-\[1320px\] border bg-white"/);
  const css = fs.readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.match(css, /\.calendar-scroll \{\s*scrollbar-width: none;/);
  assert.match(css, /\.calendar-scroll::-webkit-scrollbar \{\s*display: none;/);
});

test("calendar date headers list drivers' submitted rest days in red", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(source, /useDriverRestDays\(Boolean\(currentProfile\) && activeView === "calendar", dates\.map\(day => day\.date\)\)/);
  assert.match(source, /driverRecords\.find\(driver => driver\.id === day\.driverId\)\?\.name/);
  const header = source.slice(source.indexOf('className="calendar-date-header'), source.indexOf("{filteredCalendarVehicleRecords.map((vehicleRecord)"));
  assert.ok(header.indexOf("休日") < header.indexOf("calendar-rest-drivers"));
  assert.match(header, /calendar-rest-drivers[^"]*text-red-600/);
  assert.match(header, /calendar-vehicle-column border-b border-r bg-gray-100 p-2 font-bold/);
  const css = fs.readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.match(css, /\.calendar-date-header \[data-calendar-date\] \{\s*padding: calc\(6px \* var\(--calendar-scale, 1\)\);/);
  assert.doesNotMatch(css, /\.calendar-date-header \[data-calendar-date\] \{[^}]*height:/);
  const hook = fs.readFileSync(path.join(root, "lib\\use-driver-rest-days.ts"), "utf8");
  assert.match(hook, /fetch\("\/api\/driver-shifts\/status"/);
  assert.match(hook, /shiftStatusSchema\.parse/);
  assert.match(hook, /SIGNED_OUT/);
});
