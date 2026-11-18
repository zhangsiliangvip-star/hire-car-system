import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import ExcelJS from "exceljs";

const require = createRequire(import.meta.url);
function load(relative, globals = {}, mocks = {}) {
  const compiled = { exports: {} };
  const output = ts.transpileModule(readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const resolve = name => mocks[name] || (name === "@/lib/driver-wage-print" ? load("lib/driver-wage-print.ts") :
    name === "@/lib/company-export" ? load("lib/company-export.ts") :
    name === "@/lib/vehicle-compliance" ? load("lib/vehicle-compliance.ts") :
    name === "@/lib/print-a4" ? { printA4Html() {} } : require(name));
  new Function("require", "module", "exports", ...Object.keys(globals), output)(
    resolve, compiled, compiled.exports, ...Object.values(globals));
  return compiled.exports;
}
const excel = load("lib/driver-wage-excel.ts");
const rows = Array.from({ length: 70 }, (_, index) => ({
  serviceDate: `2026-10-${String(index % 28 + 1).padStart(2, "0")}`, time: "09:00",
  customer: `示例订单 ${index + 1}`, vehicleNumber: "足立300あ00-12",
  driverAdvances: 216, overtimeHours: 0, overtimeFee: 0, percentageWage: 0,
  fixedWage: index === 69 ? 39028 : 8000, bonusWage: 0,
  totalWage: index === 69 ? 39028 : 8000, accountingAssignee: "PRIVATE ASSIGNEE",
}));
const data = { driver: "示例司机（虚拟数据） ／ 示例会社", month: "2026-10", region: "Tokyo",
  rows, manualItems: [{ name: "示例扣款", amount: -190000 }] };

test("Excel places the complete office name on the line below the company", async () => {
  const driver = "Test ／ ウィナーリンクス株式会社 本社営業所";
  const workbook = await excel.buildDriverWageWorkbook({ ...data, driver });
  const restored = await new ExcelJS.Workbook().xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = restored.worksheets[0];
  assert.equal(sheet.getCell("A2").value, "Test ／ ウィナーリンクス株式会社\n本社営業所");
  assert.equal(sheet.getCell("A2").alignment.wrapText, true);
  assert.equal(sheet.getRow(2).height, 34);
});

test("styled salary workbook round-trips as real XLSX with four accurate formula summaries and A4 multipage setup", async () => {
  const workbook = await excel.buildDriverWageWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString(), "PK");
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(buffer);
  const sheet = saved.getWorksheet("給与明細");
  assert.equal(sheet.getCell("A1").value, "2026-10月給与明細");
  assert.equal(sheet.getCell("A2").value, data.driver);
  assert.equal(sheet.getCell("H2").value, "有記録日数：28 日");
  assert.deepEqual(["A4", "C4", "F4", "H4"].map(address => sheet.getCell(address).value),
    ["立替", "工資総额", "追加項目", "支付総额"]);
  assert.deepEqual(["A5", "C5", "F5", "H5"].map(address => sheet.getCell(address).result),
    [15120, 591028, -190000, 416148]);
  assert.equal(sheet.getCell("H5").formula, "A5+C5+F5");
  assert.equal(sheet.getCell("A5").font.size, 16);
  assert.equal(sheet.getCell("J8").type, ExcelJS.ValueType.Formula);
  assert.equal(sheet.getCell("I81").value, -190000);
  assert.equal(sheet.getCell("I81").numFmt, '#,##0;[Red]-#,##0;0');
  assert.equal(sheet.getCell("A80").value, "追加項目");
  assert.equal(sheet.views[0].state, "normal");
  assert.equal(sheet.views[0].ySplit, undefined);
  assert.equal(sheet.views[0].xSplit, undefined);
  assert.equal(sheet.pageSetup.paperSize, 9);
  assert.equal(sheet.pageSetup.orientation, "portrait");
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.fitToHeight, 0);
  assert.equal(sheet.pageSetup.printTitlesRow, "7:7");
  assert.equal(sheet.pageSetup.printArea, "A1:J82");
  assert.equal(sheet.getColumn(2).width, 24);
  assert.equal(Boolean(sheet.getCell("B8").alignment.wrapText), false);
  assert.equal(sheet.getCell("B8").font.size, 10);
  if (process.env.WAGE_EXCEL_SAMPLE) writeFileSync(process.env.WAGE_EXCEL_SAMPLE, Buffer.from(buffer));
});

test("Excel details preserve chronological dates, plate zeros and literal user text without exposing assignees", async () => {
  const workbook = await excel.buildDriverWageWorkbook({ ...data, rows: [
    { ...rows[0], serviceDate: "2026-10-02", customer: "=HYPERLINK(\"https://example.invalid\")", isOutsourcedVehicle: true },
    { ...rows[0], serviceDate: "2026-10-01", customer: "A very long order name ".repeat(10) },
  ], manualItems: [{ name: "=1+2", amount: 500 }] });
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = saved.getWorksheet("給与明細");
  assert.equal(sheet.getCell("A8").value.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(sheet.getCell("A8").numFmt, "mm-dd");
  assert.equal(sheet.getCell("C8").value, "0012");
  assert.equal(sheet.getCell("C8").numFmt, "@");
  assert.equal(sheet.getCell("C9").value, "");
  assert.equal(sheet.getCell("B9").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("B9").value, '=HYPERLINK("https://example.invalid")');
  assert.equal(sheet.getCell("A13").value, "=1+2");
  assert.equal(sheet.getCell("A13").type, ExcelJS.ValueType.String);
  const values = [];
  sheet.eachRow(row => row.eachCell(cell => values.push(String(cell.value))));
  assert.ok(!values.some(value => /PRIVATE ASSIGNEE|核算|工資月份|分区|币种/.test(value)));
});

test("manual-only and no-adjustment sheets keep base wages separate and payment correct", async () => {
  for (const [daily, items, expected] of [[[], [{ name: "Addition", amount: 500 }], [0, 0, 500, 500]],
    [[rows[0]], [], [216, 8000, 0, 8216]], [[], [], [0, 0, 0, 0]]]) {
    const workbook = await excel.buildDriverWageWorkbook({ ...data, rows: daily, manualItems: items });
    const sheet = workbook.getWorksheet("給与明細");
    assert.deepEqual(["A5", "C5", "F5", "H5"].map(address => sheet.getCell(address).result), expected);
    assert.equal(sheet.getCell("H5").formula, "A5+C5+F5");
  }
});

test("Excel download uses a genuine workbook blob, safe filename and cleans up the download link", async () => {
  let blob, download, clicked = 0, removed = 0, revoked = 0;
  const exporter = load("lib/driver-wage-excel.ts", {
    URL: { createObjectURL(value) { blob = value; return "blob:excel"; }, revokeObjectURL() { revoked++; } },
    document: { body: { appendChild() {} }, createElement: () => ({
      set download(value) { download = value; }, click() { clicked++; }, remove() { removed++; },
    }) }, setTimeout(fn) { fn(); },
  });
  await exporter.downloadDriverWageExcel({ ...data, driver: "A/B", rows: [] });
  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(download, "2026-10月給与明細-A_B.xlsx");
  assert.equal(Buffer.from(await blob.arrayBuffer()).subarray(0, 2).toString(), "PK");
  assert.deepEqual([clicked, removed, revoked], [1, 1, 1]);
});

test("salary Excel action scopes saved rows/items, blocks duplicate exports and surfaces failures", async () => {
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  async function exportDriverWageExcel()");
  const block = source.slice(start, source.indexOf("  async function exportAllDriverWages()", start));
  const calls = [], alerts = [], busy = [];
  const context = {
    driverWageExcelDownloadingRef: { current: false }, activeRegionId: "tokyo", ALL_REGIONS_ID: "all",
    selectedDriverFinanceDriver: "Selected", driverFinanceCompanyLabel: "Selected company",
    financeMonth: data.month, regionNameById: new Map([["tokyo", "Tokyo"]]),
    filteredDriverFinanceDetails: rows, selectedDriverWageItems: data.manualItems,
    setDriverWageExcelDownloading: value => busy.push(value), alert: value => alerts.push(value),
    downloadDriverWageExcel: async value => calls.push(value),
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(block + "\nglobalThis.run = exportDriverWageExcel;",
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  await context.run();
  assert.equal(calls[0].driver, "Selected ／ Selected company");
  assert.equal(calls[0].rows, rows); assert.equal(calls[0].manualItems, data.manualItems);
  assert.deepEqual(busy, [true, false]);
  context.activeRegionId = "all"; await context.run(); assert.equal(calls.length, 1);
  context.activeRegionId = "tokyo"; context.selectedDriverFinanceDriver = ""; await context.run();
  assert.equal(calls.length, 1);
  context.selectedDriverFinanceDriver = "Selected";
  context.driverWageExcelDownloadingRef.current = true; await context.run(); assert.equal(calls.length, 1);
  context.driverWageExcelDownloadingRef.current = false;
  context.downloadDriverWageExcel = async () => { throw new Error("Write failed"); };
  context.Error = Error;
  await context.run();
  assert.equal(context.driverWageExcelDownloadingRef.current, false);
  assert.ok(alerts.includes("Write failed"));
  assert.match(source, /onClick=\{exportDriverWageExcel\}[\s\S]*?disabled=\{driverWageExcelDownloading\}/);
});

test("company workbook preserves region groups, distinct days, office lines and signed summary totals", async () => {
  const row = { ...rows[0], driver: "Test A", regionId: "tokyo", regionName: "Tokyo",
    driverAdvances: 100, overtimeFee: 200, bonusWage: 300, percentageWage: 400, fixedWage: 500, totalWage: 1400 };
  const companyData = { month: "2026-10", company: "Test Company 本社営業所", region: "ALL",
    rows: [row, { ...row, serviceDate: "2026-10-02" }, { ...row, time: "15:00" },
      { ...row, driver: "=Literal", regionId: "osaka", regionName: "Osaka" }],
    manualItems: [{ driver: "=Literal", companyName: "Test Company 本社営業所", name: "=Not a formula", amount: -1900 }] };
  const workbook = await excel.buildCompanyWageWorkbook(companyData);
  const restored = await new ExcelJS.Workbook().xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = restored.worksheets[0];
  assert.equal(sheet.name, "全员工資総表");
  assert.equal(sheet.getCell("A1").value, "所属会社全员工資総表");
  assert.equal(sheet.getCell("A2").value, "Test Company\n本社営業所");
  assert.equal(sheet.getCell("F2").value, "月份：2026-10　運転士人数：2 人");
  assert.deepEqual(["A5", "C5", "E5", "G5"].map(address => sheet.getCell(address).result), [400, 5600, -1900, 4100]);
  assert.equal(sheet.getCell("G5").formula, "A5+C5+E5");
  assert.equal(sheet.getCell("B8").value, "=Literal");
  assert.equal(sheet.getCell("B8").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("C9").value, 2);
  assert.equal(sheet.getCell("I9").result, 4500);
  assert.equal(sheet.getCell("I9").formula, "SUM(D9:H9)");
  assert.equal(sheet.getCell("E9").numFmt, '#,##0;[Red]-#,##0;0');
  assert.equal(sheet.getCell("C14").value, "Test Company\n本社営業所");
  assert.equal(sheet.getCell("F14").value, "=Not a formula");
  assert.equal(sheet.getCell("F14").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("H15").result, -1900);
  assert.equal(sheet.views[0].state, "normal");
  assert.equal(sheet.pageSetup.printTitlesRow, "7:7");
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.fitToHeight, 0);
  assert.equal(sheet.pageSetup.printArea, "A1:I15");
  assert.equal(sheet.getRow(2).height, 34);
});

test("company Excel includes manual-only and empty records without fabricating driver rows", async () => {
  for (const manualItems of [[], [{ driver: "Test", companyName: "", name: "Deduction", amount: -100 }]]) {
    const workbook = await excel.buildCompanyWageWorkbook({ month: "2026-10", company: "Company", region: "Tokyo", rows: [], manualItems });
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.getCell("F2").value, "月份：2026-10　運転士人数：0 人");
    assert.equal(sheet.getCell("G5").result, manualItems.length ? -100 : 0);
    assert.equal(sheet.getCell("C5").result, 0);
    assert.equal(sheet.getCell("D8").formula, "0");
  }
});

test("company Excel download creates a genuine XLSX with the company filename", async () => {
  let blob, filename, removed = false;
  const exporter = load("lib/driver-wage-excel.ts", {
    URL: { createObjectURL(value) { blob = value; return "blob:company"; }, revokeObjectURL() {} },
    document: { body: { appendChild() {} }, createElement: () => ({
      set download(value) { filename = value; }, click() {}, remove() { removed = true; },
    }) }, setTimeout(fn) { fn(); },
  });
  await exporter.downloadCompanyWageExcel({ month: "2026-10", company: "A/B", region: "Tokyo", rows: [], manualItems: [] });
  assert.equal(filename, "2026-10会社全员工資総表-A_B.xlsx");
  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const workbook = await new ExcelJS.Workbook().xlsx.load(await blob.arrayBuffer());
  assert.equal(workbook.worksheets[0].name, "全员工資総表");
  assert.equal(removed, true);
});

test("company Excel action retains month/company/region scope, prevents duplicates and reports errors", async () => {
  const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  async function exportCompanyWages()");
  const block = source.slice(start, source.indexOf("  const filteredVehicleFinanceDetails", start));
  const calls = [], busy = [], alerts = [];
  const context = {
    companyWageExcelDownloadingRef: { current: false }, companyDriverFinanceDetails: rows,
    monthDriverWageItems: [{ driver: "Test", companyName: "Company", name: "Deduction", amount: -100 }],
    financeMonth: "2026-10", driverFinanceCompanyLabel: "Company", activeRegionId: "all",
    ALL_REGIONS_ID: "all", regionNameById: new Map(),
    setCompanyWageExcelDownloading: value => busy.push(value), alert: value => alerts.push(value),
    downloadCompanyWageExcel: async value => calls.push(value), Error,
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(block + "\nglobalThis.run = exportCompanyWages;",
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  await context.run();
  assert.equal(calls[0].rows, rows);
  assert.equal(calls[0].month, "2026-10");
  assert.equal(calls[0].company, "Company");
  assert.equal(calls[0].region, "全部分区");
  assert.equal(calls[0].manualItems[0].amount, -100);
  assert.deepEqual(busy, [true, false]);
  context.companyWageExcelDownloadingRef.current = true;
  await context.run(); assert.equal(calls.length, 1);
  context.companyWageExcelDownloadingRef.current = false;
  context.downloadCompanyWageExcel = async () => { throw new Error("Company write failed"); };
  await context.run();
  assert.ok(alerts.includes("Company write failed"));
  assert.equal(context.companyWageExcelDownloadingRef.current, false);
  context.companyDriverFinanceDetails = []; context.monthDriverWageItems = [];
  await context.run(); assert.equal(calls.length, 1);
  assert.doesNotMatch(block, /printCompanyWages/);
  assert.match(source, /onClick=\{exportCompanyWages\}\s+disabled=\{companyWageExcelDownloading\}\s+className="table-action-button table-action-button--excel/);
});
