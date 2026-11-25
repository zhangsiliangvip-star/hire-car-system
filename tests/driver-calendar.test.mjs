import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(relative) {
  const filename = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, { module: compiled, exports: compiled.exports,
    require: name => name === "@/lib/driver/shifts" ? { shiftMonthSchema: { parse: value => value } } : require(name),
  });
  return compiled.exports;
}

const { buildDriverCalendarFinance } = load("lib/driver/calendar.ts");
const id = "c6000000-0000-4000-8000-000000000001";

test("calendar combines wage, reimbursement, fuel and reports on their service dates", () => {
  const dates = ["2026-11-02", "2026-11-03"];
  const finance = {
    wages: [{ date: dates[0], base: 10000, bonus: 500, overtime: 3000, advances: 1500 }],
    trips: [
      { date: dates[0], claims: [{ expenses: [{ type: "company", amount: 1200 }, { type: "trip", amount: 800 }] }] },
      { date: dates[0], claims: [{ expenses: [{ type: "company", amount: 300 }] }] },
      { date: "2026-10-31", claims: [{ expenses: [{ type: "company", amount: 9000 }] }] },
    ],
    fuelClaims: [{ date: dates[1], amount: 2500 }],
  };
  const reports = [{ id, serviceDate: dates[0], returnedAt: null },
    { id: id.replace(/1$/, "2"), serviceDate: "2026-10-31", returnedAt: null }];

  assert.deepEqual(JSON.parse(JSON.stringify(buildDriverCalendarFinance(dates, finance, reports))), [
    { wage: 13500, advances: 1500, company: 1500, trip: 800, fuel: 0, reports: [reports[0]] },
    { wage: null, advances: 0, company: 0, trip: 0, fuel: 2500, reports: [] },
  ]);
});
