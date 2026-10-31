import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expectedColumns = {
  accounts: 8,
  "order-finance": 7,
  "driver-finance": 10,
  "vehicle-summary": 8,
  "vehicle-finance": 8,
  balance: 8,
  "balance-items": 4,
  drivers: 7,
  vehicles: 10,
  sources: 7,
  companies: 10,
};

test("management views allocate every column explicitly without changing table data", () => {
  const found = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "table") {
      const attribute = node.openingElement.attributes.properties.find(
        (attr) => attr.name?.getText(ast) === "data-table",
      );
      if (attribute && ts.isStringLiteral(attribute.initializer)) {
        const name = attribute.initializer.text;
        found.push(name);
        const markup = node.getText(ast);
        assert.match(markup, /management-table .*w-full min-w-\[\d+px\] table-fixed text-center/);
        const columns = [...markup.matchAll(/<col (?:style=\{\{ width: "([\d.]+)%" \}\}|className="w-\[([\d.]+)%\]") \/>/g)]
          .map((match) => Number(match[1] ?? match[2]));
        assert.equal(columns.length, expectedColumns[name], name);
        assert.ok(Math.abs(columns.reduce((sum, width) => sum + width, 0) - 100) < 0.001, name);
        assert.match(markup, /<tbody>/);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual(found.sort(), Object.keys(expectedColumns).sort());
});

test("vehicle summary displays the vehicle number without a region subtitle", () => {
  const tableStart = page.indexOf('data-table="vehicle-summary"');
  const tableEnd = page.indexOf("</table>", tableStart);
  const table = page.slice(page.lastIndexOf("<table", tableStart), tableEnd);
  assert.match(table, /<td className="px-4 py-3 font-medium">\s*\{row\.vehicleNumber\}\s*<\/td>/);
  assert.doesNotMatch(table, /regionNameById\.get\(row\.regionId/);
});

test("management cells and controls center and wrap without affecting other tables", () => {
  assert.doesNotMatch(css, /\.dashboard table td button\s*\{/);
  assert.doesNotMatch(css, /\.dashboard button:not\(:disabled\):active/);
  assert.match(css, /\.dashboard \.management-table :is\(th, td\)\s*\{[^}]*text-align: center;[^}]*vertical-align: middle;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.dashboard \.management-table :is\(button, input, select\)\s*\{[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*text-align: center;/);
  assert.match(css, /\.dashboard \.management-table td > \.flex,[^{]*\{[^}]*justify-content: center;[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.dashboard \.management-table \.truncate\s*\{[^}]*overflow: visible;[^}]*text-overflow: clip;/);
});

test("driver edit and delete controls use distinct semantic action styles", () => {
  const driverViewStart = page.indexOf('{activeView === "drivers"');
  const driverViewEnd = page.indexOf('{activeView === "vehicles"', driverViewStart);
  const driverView = page.slice(driverViewStart, driverViewEnd);
  assert.match(driverView, /openEditDriver\(driver\)[\s\S]*?className="table-action-button table-action-button--edit driver-action-button"/);
  assert.match(driverView, /deleteDriver\(driver\)[\s\S]*?className="table-action-button table-action-button--delete driver-action-button"/);
  assert.match(css, /\.driver-action-buttons\s*\{[^}]*display: grid !important;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.driver-action-button\s*\{[^}]*width: 100%;[^}]*min-width: 0;[^}]*white-space: normal;/);
});

test("all management list edit and delete buttons use compact aligned action slots", () => {
  for (const tableName of ["accounts", "vehicles", "sources", "companies"]) {
    const tableStart = page.lastIndexOf("<table", page.indexOf(`data-table="${tableName}"`));
    const tableEnd = page.indexOf("</table>", tableStart);
    const table = page.slice(tableStart, tableEnd);
    assert.match(table, /className="list-action-buttons"/, tableName);
    assert.match(table, /table-action-button--edit driver-action-button/, tableName);
    assert.match(table, /table-action-button--delete driver-action-button/, tableName);
    assert.equal((table.match(/className="driver-action-slot"/g) || []).length, 2, tableName);
  }
  assert.match(css, /\.list-action-buttons\s*\{[^}]*width: min\(100%, 8rem\);[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test("edit, delete and PDF export actions use scoped semantic button styles", () => {
  for (const variant of ["edit", "delete", "export"]) {
    assert.match(css, new RegExp(`\\.dashboard \\.table-action-button--${variant}\\s*\\{`));
  }
  assert.match(css, /\.dashboard \.table-action-button:focus-visible\s*\{/);
  assert.match(css, /\.dashboard \.table-action-button:disabled\s*\{/);
  assert.match(page, /导出财务表（A4）[\s\S]*?className="table-action-button table-action-button--export"/);
  assert.match(page, /deleteLoginAccount\(account\)[\s\S]*?className="table-action-button table-action-button--delete/);
  const reports = fs.readFileSync(new URL("../components/operations-reports.tsx", import.meta.url), "utf8");
  assert.match(reports, /className="table-action-button table-action-button--edit driver-action-button"[^>]*disabled=\{busy\} onClick=\{\(\) => setEditing\(row\)\}/);
  assert.match(reports, /className="table-action-button table-action-button--delete driver-action-button"[^>]*disabled=\{busy\} onClick=\{\(\) => void remove\(row\)\}/);
  assert.match(reports, /className="table-action-button table-action-button--export driver-action-button"[^>]*disabled=\{busy\} onClick=\{\(\) => void output\(\[row\]/);
  assert.match(page, /onClick=\{deleteOrder\}[\s\S]*?className="table-action-button table-action-button--delete"/);
});

test("driver and company lists fit the viewport and use cards on mobile", () => {
  const companyStart = page.indexOf('data-table="companies"');
  const companyEnd = page.indexOf("</table>", companyStart);
  const companyTable = page.slice(page.lastIndexOf("<table", companyStart), companyEnd);
  assert.match(companyTable, /company-management-table/);
  for (const label of ["会社名称", "会社印章", "運行管理者", "整備管理者", "会社电话",
    "営業所地址", "車庫位置", "振込口座", "T番号", "操作"]) {
    assert.match(companyTable, new RegExp(`data-label="${label}"`));
  }
  assert.match(css, /@media \(min-width: 640px\) and \(max-width: 2399px\)\s*\{[\s\S]*?\.dashboard \.management-table\.driver-management-table\s*\{[^}]*min-width: 0 !important;[^}]*table-layout: fixed;[^}]*font-size: 0\.875rem;/);
  assert.match(css, /\.dashboard \.management-table\.company-management-table\s*\{[^}]*font-size: 0\.625rem;/);
  assert.match(css, /@media \(max-width: 639px\)\s*\{[\s\S]*?\.company-management-table thead\s*\{\s*display: none;/);
  assert.match(css, /\.company-management-table td::before\s*\{\s*content: attr\(data-label\);/);
});

test("order finance statistics display one summarized row per import group without driver or vehicle details", () => {
  const tableStart = page.lastIndexOf("<table", page.indexOf('data-table="order-finance"'));
  const table = page.slice(tableStart, page.indexOf("</table>", tableStart));
  assert.match(table, /order-finance-management-table/);
  for (const label of ["訂単日期", "团／訂単名称", "来源", "請求書状態",
    "入金状態", "請求金額", "訂単総利润"]) {
    assert.match(table, new RegExp(`data-label="${label}"`));
  }
  assert.doesNotMatch(table, /data-label="運転士"|data-label="車両番号"/);
  assert.doesNotMatch(table, /運転士総立替|会社総支出|運転士総工資/);
  assert.match(page, /groupOrdersByImportBatch\(sortedFinanceOrders\)/);
  assert.match(page, /groupOrdersByImportBatch\(monthlyFinanceOrders\)[\s\S]*?group\.some\(matchesFinanceFilters\)/);
  assert.match(page, /group\.totals\.requestAmount/);
  assert.match(page, /group\.orders\.length > 1/);
  assert.match(page, /isBatch \? "finance-batch" : "finance"/);
  assert.match(page, /invoiceStatusDialog\.origin === "finance-batch"/);
  assert.match(css, /\.dashboard \.management-table\.order-finance-management-table\s*\{[^}]*table-layout: fixed;[^}]*font-size: 0\.8125rem;/);
  assert.match(css, /\.dashboard \.management-table\.order-finance-management-table :is\(th, td\)\s*\{[^}]*padding: 0\.45rem 0\.3rem;[^}]*line-height: 1\.4;/);
  assert.match(css, /\.dashboard \.management-table\.driver-finance-management-table :is\(th, td\)\s*\{[^}]*padding: 0\.6rem 0\.45rem;[^}]*line-height: 1\.5;/);
  assert.match(css, /\.dashboard \.management-table\.driver-finance-management-table\s*\{[^}]*font-size: 0\.875rem;/);
  assert.match(css, /\.dashboard \.management-table\.driver-finance-management-table td :is\(button\)\s*\{[^}]*line-height: 1\.4;/);
  assert.doesNotMatch(css, /\.order-finance-management-table thead\s*\{\s*display: none;/);
  assert.doesNotMatch(css, /\.order-finance-management-table tbody\s*\{\s*display: grid;/);
});

test("driver wage rows display individually in a readable table without time or wage-total columns", () => {
  const tableStart = page.lastIndexOf("<table", page.indexOf('data-table="driver-finance"'));
  const table = page.slice(tableStart, page.indexOf("</table>", tableStart));
  assert.match(table, /driver-finance-management-table/);
  assert.match(table, /filteredDriverFinanceDetails\.map\(\(row\) => \(/);
  assert.doesNotMatch(table, /aria-expanded|展开|收起|團／訂単名称/);
  assert.doesNotMatch(table, /核算担当|row\.accountingAssignee|row\.company/);
  for (const label of ["服务日期", "訂単名称", "車輌番号", "運転士姓名", "運転士立替",
    "超時工資", "奖励工資", "運転士比例工資", "運転士固定工資", "支付総额"]) {
    assert.match(table, new RegExp(`data-label="${label}"`));
  }
  assert.doesNotMatch(table, /超時時間|工資総额/);
  assert.doesNotMatch(css, /\.driver-finance-management-table thead\s*\{\s*display: none;/);
  assert.doesNotMatch(css, /\.driver-finance-management-table tbody\s*\{\s*display: grid;/);
  assert.match(css, /\.dashboard \.management-table\.driver-finance-management-table\s*\{[^}]*min-width: 1400px !important;[^}]*font-size: 0\.875rem;/);
  assert.match(css, /\.dashboard \.management-table\.driver-finance-management-table :is\(th, td\)\s*\{[^}]*padding: 0\.6rem 0\.45rem;[^}]*line-height: 1\.5;/);
});
