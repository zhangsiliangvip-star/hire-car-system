import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file) {
  const commonJsModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: commonJsModule, exports: commonJsModule.exports, require: name =>
    name.startsWith("@/") ? load(`${name.slice(2)}.ts`) : require(name), Date });
  return commonJsModule.exports;
}
const lib = load("lib/order-vehicles.ts");
const plain = value => JSON.parse(JSON.stringify(value));
const order = {
  regionId: "region", vehicle: "Base", vehiclePlate: "BASE", date: "2026-10-27", endDate: "2026-10-30",
  offDates: ["2026-10-29"], financeByDate: {
    "2026-10-27": { vehicle: "", vehiclePlate: "", dailyFare: 100 },
    "2026-10-28": { vehicle: "Daily", vehiclePlate: "DAILY", dailyFare: 200 },
    "2026-10-29": { vehicle: "Base", vehiclePlate: "BASE", dailyFare: 0 },
    "2026-10-30": { vehicle: "Daily", vehiclePlate: "", dailyFare: 300 },
  },
};

test("daily selection overrides root everywhere without blank defaults hiding the selected plate", () => {
  assert.deepEqual(plain(lib.getServiceVehicle(order, "2026-10-27")), { vehicle: "Base", vehiclePlate: "BASE" });
  assert.deepEqual(plain(lib.getServiceVehicle(order, "2026-10-28")), { vehicle: "Daily", vehiclePlate: "DAILY" });
  assert.equal(lib.getServiceVehicle(order, "2026-10-30").vehiclePlate, "");
  assert.deepEqual(plain(lib.getOrderVehiclePlates(order)), ["BASE", "DAILY", ""]);
  assert.deepEqual(plain(lib.getOrderVehiclePlates(order, day => day === "2026-10-28")), ["DAILY"]);
  assert.deepEqual(plain(lib.getOrderVehiclePlates(order, day => day === "2026-10-29")), []);
});

test("calendar moves only the selected service days to the matching vehicle row and splits gaps", () => {
  const dates = ["", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", ""];
  assert.deepEqual(plain(lib.getVehicleSegments(order, dates, { regionId: "region", name: "Base", plate: "BASE" })),
    [{ start: 1, end: 2 }, { start: 3, end: 4 }]);
  assert.deepEqual(plain(lib.getVehicleSegments(order, dates, { regionId: "region", name: "Daily", plate: "DAILY" })),
    [{ start: 2, end: 3 }]);
  assert.deepEqual(plain(lib.getVehicleSegments(order, dates, { regionId: "other", name: "Daily", plate: "DAILY" })), []);
});

test("default vehicle change preserves explicit day overrides, while whole/range moves replace selected-day overrides", () => {
  const changed = lib.changeOrderVehicle(order, { name: "New", plate: "NEW" });
  assert.equal(lib.getServiceVehicle(changed, "2026-10-27").vehiclePlate, "NEW");
  assert.equal(lib.getServiceVehicle(changed, "2026-10-28").vehiclePlate, "DAILY");
  assert.equal(lib.getServiceVehicle(changed, "2026-10-29").vehiclePlate, "NEW");
  assert.equal(lib.getServiceVehicle(changed, "2026-10-30").vehiclePlate, "");
  const moved = lib.changeOrderVehicle({ ...order, financeByDate: {
    "2026-10-28": order.financeByDate["2026-10-28"],
  } }, { name: "New", plate: "NEW" }, true);
  assert.deepEqual(plain(moved.financeByDate), {
    "2026-10-28": { vehicle: "New", vehiclePlate: "NEW", vehicleOverride: false, dailyFare: 200 },
  });
  assert.equal(order.financeByDate["2026-10-28"].vehiclePlate, "DAILY");
  const explicit = { ...order, financeByDate: {
    "2026-10-27": { vehicle: "Base", vehiclePlate: "BASE", vehicleOverride: true, dailyFare: 100 },
  } };
  assert.equal(lib.getServiceVehicle(lib.changeOrderVehicle(explicit, { name: "New", plate: "NEW" }),
    "2026-10-27").vehiclePlate, "BASE", "explicitly selecting the old default remains a per-day override");
});

test("calendar retains unregistered and unassigned plates without placing them on a guessed numbered vehicle", () => {
  const rows = lib.getCalendarVehicleRows([
    { regionId: "region", id: "base", name: "Base", plate: "BASE" },
    { regionId: "region", id: "daily", name: "Daily", plate: "DAILY" },
  ], [order], ["2026-10-27", "2026-10-28", "2026-10-30"]);
  const unassigned = rows.find(row => row.calendarOnly);
  assert.equal(unassigned.name, "Daily");
  assert.equal(unassigned.plate, "");
  assert.deepEqual(plain(lib.getVehicleSegments(order, ["2026-10-30"], unassigned)), [{ start: 0, end: 1 }]);
});

test("report commands accept explicit association/baseline but do not expose the baseline as persisted report data", () => {
  const { reportHeaderSchema, reportSchema } = load("lib/driver/reports.ts");
  const header = { serviceDate: "2026-10-27", assignmentId: "a1900900-0000-4000-8000-000000000001",
    vehicleBaseline: "BASE", vehicleNumber: "NEW", driverName: "Driver", passengerCount: 1 };
  assert.equal(reportHeaderSchema.safeParse(header).success, true);
  assert.equal(reportHeaderSchema.safeParse({ ...header, assignmentId: "bad" }).success, false);
  const persistedHeader = { ...header };
  delete persistedHeader.serviceDate;
  assert.equal(reportSchema.shape.header.safeParse(persistedHeader).success, false);
  delete persistedHeader.vehicleBaseline;
  assert.equal(reportSchema.shape.header.safeParse(persistedHeader).success, true);
});
