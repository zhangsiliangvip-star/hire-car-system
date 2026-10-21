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
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : nodeRequire(name),
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

test("vehicle statistics filter displays plates instead of vehicle names", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("value={vehicleFinanceVehicleFilter}", source.indexOf("导出车辆财务表（A4）"));
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
  assert.match(source, /orderDriverExpired \? "rounded bg-white px-1 font-semibold text-red-600"/);
});

test("reservation date filter includes service ranges, excludes off days and preserves other filters", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const script = source.slice(source.indexOf("  const monthlyOrders ="), source.indexOf("  const monthlyFinanceOrders ="));
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
      orders, orderMonth: "2026-10", orderDateFilter: day,
      orderCompanyFilter: company, orderSourceFilter: sourceFilter, UNSOURCED_ORDER: "__unsourced__",
    };
    vm.runInNewContext(`${script}\nresult = monthlyOrders.map((order) => order.id);`, context);
    return plain(context.result);
  };
  assert.deepEqual(evaluate("2026-10-02", "A", "S"), ["multi", "single", "cross-month"]);
  assert.deepEqual(evaluate("", "A", "S"), ["multi", "off", "single", "later", "cross-month"]);
  assert.deepEqual(evaluate("2026-10-31"), []);
  assert.deepEqual(evaluate("2026-10-02", "B"), ["other-company"]);
  assert.match(source, /setOrderMonth\(event\.target\.value\);\s*setOrderDateFilter\(""\);/);
  assert.match(source, /aria-haspopup="dialog"/);
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
  assert.match(february, /取消/);
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

test("wage driver dropdown follows positive monthly company wages, not the driver directory", () => {
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
  ];
  const evaluate = (company, selected = "", month = "2026-10", records = orders) => {
    const context = {
      orders: records, financeMonth: month, driverFinanceCompanyFilter: company,
      driverFinanceDriverFilter: selected, companyRecords: [],
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
      getAccountingAssigneeName: () => "",
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

  const start = source.indexOf('title="給料統計"');
  const panel = source.slice(start, source.indexOf("</FinanceSummaryPanel>", start));
  assert.match(panel, /onMonthChange=\{\(month\) => \{\s*setFinanceMonth\(month\);\s*setDriverFinanceDriverFilter\(""\);/);
  assert.match(panel, /value=\{selectedDriverFinanceDriver\}/);
  assert.match(panel, /driverFinanceDrivers\.map\(\(driver\) =>/);
  assert.doesNotMatch(panel, /driverRecords\.map/);
  assert.match(panel, /activeRegionId === ALL_REGIONS_ID \|\| !selectedDriverFinanceDriver/);
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
  assert.match(source, /<option value="">请选择燃油类型<\/option>\s*\{fuelTypes\.map/);
  assert.match(source, /<option value="">请选择座位数<\/option>/);
  assert.match(source, /<option value="">请选择所属会社<\/option>/);
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
  assert.ok(source.includes("orderUsesVehicle(order, vehicleRecord) &&"));
  assert.ok(source.includes("車両番号不能重复"));
  assert.ok(source.includes("車両番号不能重复："));
  assert.ok(!source.includes("车名重复"));
  assert.ok(!source.includes("同一地域已有车名"));
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
  assert.ok(source.includes("司机重复："));
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
  const evaluate = (visibleOrders) => {
    const context = { visibleOrders, dates: [{ date: "2026-10-01" }, { date: "2026-10-02" }] };
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
  }
  assert.deepEqual(evaluate([
    { id: "first", date: "2026-10-01", endDate: "2026-10-01" },
    { id: "second", date: "2026-10-02", endDate: "2026-10-02" },
  ]).offsets, [4, 4]);
  assert.deepEqual(evaluate([]).heights, ["96px", "96px"]);
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

test("finance driver dropdown includes new drivers regardless of current name and scopes to order region", () => {
  const { FinanceDriverSelect } = load("components\\finance-driver-select.tsx");
  const drivers = [
    { id: "a", name: "Existing Driver", regionId: region },
    { id: "b", name: "Other Region", regionId: "other" },
  ];
  const changes = [];
  const render = (value, regionId = region) => FinanceDriverSelect({
    drivers, regionId, value, onChange: (name) => changes.push(name),
  });
  let html = renderToStaticMarkup(render("Existing Driver"));
  assert.ok(!html.includes("New Driver"));
  drivers.push({ id: "new", name: "New Driver", regionId: region });
  const tree = render("Existing Driver");
  html = renderToStaticMarkup(tree);
  assert.ok(html.includes('<option value="New Driver">New Driver</option>'));
  assert.ok(!html.includes("Other Region"));
  assert.ok(!html.includes("datalist"));
  const [selectLabel, inputLabel] = React.Children.toArray(tree.props.children);
  const select = React.Children.toArray(selectLabel.props.children).find((node) => node.type === "select");
  select.props.onChange({ target: { value: "New Driver" } });
  select.props.onChange({ target: { value: "" } });
  const input = React.Children.toArray(inputLabel.props.children).find((node) => node.type === "input");
  input.props.onChange({ target: { value: "Manual" } });
  assert.deepEqual(changes, ["New Driver", "", "Manual"]);
  assert.ok(renderToStaticMarkup(render("Historical")).includes("Historical（现有记录）"));
  assert.ok(!renderToStaticMarkup(render("", null)).includes('value="New Driver"'));
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
  let view = render("Alphard 01");
  assert.equal(view.select.props.value, "a");
  assert.equal(renderToStaticMarkup(view.options.find((option) => option.props.value === "a")),
    '<option value="a">品川 100</option>');
  view.select.props.onChange({ target: { value: "b" } });
  assert.deepEqual(changes, [{ name: "Hiace 01", plate: "品川 200" }]);
  assert.equal(render("Hiace 01").select.props.value, "b");
  assert.equal(render("外注其他").select.props.value, "");
  assert.ok(render("外注其他").html.includes("当前车辆未登记番号"));
  assert.ok(render("Deleted").html.includes("当前车辆未登记或已删除"));
  view = render("Tesla 01");
  assert.equal(view.select.props.value, "d");
  assert.equal(view.options.find((option) => option.props.value === "d").props.disabled, true);
  view.select.props.onChange({ target: { value: "d" } });
  view.select.props.onChange({ target: { value: "invalid" } });
  assert.equal(changes.length, 1);
  const shared = [...vehicles, { ...vehicles[0], id: "duplicate", plate: "品川 400" }];
  view = render("Alphard 01", shared);
  assert.equal(view.select.props.value, "");
  assert.ok(view.html.includes("请选择具体的車両番号"));
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
  assert.ok(source.includes("{getOrderVehicleNumber(accountingPreviewOrder)}"));
  assert.ok(source.includes("vehicle.regionId === accountingPreviewOrder.regionId"));
  assert.ok(!source.includes("finance-vehicles-"));
});

test("administrator password creation and reset enforce roles, validation and explicit failures", async () => {
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
  button("管理车名");
  confirmed = false;
  button("删除车名 Alphard");
  assert.equal(saved, null);
  confirmed = true;
  failWrite = true;
  button("删除车名 Alphard");
  assert.equal(selectedDeleted, 0);
  assert.equal(saved, null);
  assert.ok(nodes(render()).some((node) => node.props?.role === "alert"));
  failWrite = false;
  button("删除车名 Alphard");
  assert.equal(selectedDeleted, 1);
  assert.ok(!JSON.parse(saved).includes("Alphard"));
  states.length = 0; // Reopening the dialog reads the persisted list.
  let tree = nodes(render());
  assert.equal(tree.find((node) => node.type === "select").props.value, MANUAL_VEHICLE_NAME);
  assert.equal(tree.find((node) => node.type === "input").props.value, "Alphard");
  assert.ok(!tree.some((node) => node.type === "option" && node.props.value === "Alphard"));
  button("管理车名");
  for (const name of JSON.parse(saved)) button(`删除车名 ${name}`);
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
  assert.match(html, /总请求金额<strong>¥3,350/);
  assert.match(html, /口座入金：¥1,050/);
  assert.match(html, /现金入金：¥2,000/);
  assert.match(html, /未设置入金方式：¥300/);
  assert.doesNotMatch(html, /总卖上/);
  const page = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(page, /summarizeRequestAmounts\(\s*filteredOrderFinanceOrders\.map/);
  assert.match(page, /requestAmount: getOrderFinanceForOrder\(order\)\.requestAmount/);
  assert.match(page, /总请求金额<\/p>/);
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
  assert.ok(html.includes("其他收入总和"));
  assert.ok(html.includes("&lt;Income&gt;"));
  assert.ok(html.includes("¥700"));
  assert.ok(html.includes('class="number loss">¥-100'));
  assert.ok(html.includes("＋手动其他收入总和－手动支出总和"));
  assert.ok(html.includes("口座入金：¥1,000"));
  assert.ok(html.includes("现金入金：¥50"));
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
  assert.match(html, /<th>请求总和<\/th><th>口座入金<\/th><th>现金入金<\/th><th>未设置入金方式<\/th>/);
  assert.match(html, /口座入金：¥400/);
  assert.match(html, /现金入金：¥200/);
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
  const query = {
    upsert: async (rows) => {
      assert.ok(!Object.hasOwn(rows[0], "last_operation"));
      writes += rows.length;
      return { error: null };
    },
    select: () => query,
    in: async () => ({ data: [{ id, last_operation: operation }], error: null }),
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
  const driver = { id, regionId: region, name: "Driver", phone: "", wechat: "", whatsapp: "", licenseExpiry: "" };
  const post = (entry) => route.POST({ json: async () => ({
    collection: "drivers", upsert: [entry], deleteIds: [], deletePassword: "",
  }) });
  assert.equal((await post({ ...driver, lastOperation: operation })).status, 400);
  assert.equal(writes, 0);
  const response = await post(driver);
  assert.equal(response.status, 200);
  assert.deepEqual(plain(response.data.saved), [{ id, lastOperation: operation }]);
  assert.equal(writes, 1);
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
  for (const value of ["操作记录", "业务类型", "开始日期", "结束日期", "操作前", "操作后", "Test Operator", "2026/10/16 03:00:00"]) {
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
