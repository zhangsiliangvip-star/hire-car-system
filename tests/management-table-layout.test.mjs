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
  reservations: 7,
  drivers: 7,
  vehicles: 10,
  sources: 5,
  companies: 10,
};

test("management and reservation views allocate every column explicitly without changing table data", () => {
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
        const classAttribute = node.openingElement.attributes.properties.find(
          attr => attr.name?.getText(ast) === "className",
        );
        assert.ok(classAttribute && ts.isStringLiteral(classAttribute.initializer), name);
        const classes = classAttribute.initializer.text.split(/\s+/);
        for (const required of [
          name === "reservations" ? "reservation-list-table" : "management-table",
          "w-full", "table-fixed", "text-center",
        ]) assert.ok(classes.includes(required), `${name}: ${required}`);
        if (name === "sources") {
          assert.ok(classes.includes("source-management-table"));
          assert.match(css, /\.dashboard \.source-management-table\s*\{[^}]*min-width: 680px;/);
        } else {
          assert.ok(classes.some(value => /^min-w-\[\d+px\]$/.test(value)), `${name}: minimum width`);
        }
        const columns = [...markup.matchAll(/<col (?:style=\{\{ width: "([\d.]+)%" \}\}|className="w-\[([\d.]+)%\]") \/>/g)]
          .map((match) => Number(match[1] ?? match[2]));
        assert.equal(columns.length, expectedColumns[name], name);
        if (name === "reservations") {
          assert.deepEqual(columns, [12, 17, 11, 13, 12, 10, 14]);
          assert.match(markup, /selectedReservationFinanceColumns\.map\(option => \([\s\S]*?<col key=\{option\.key\} className="w-\[11%\]" \/>/);
          assert.equal(columns.reduce((sum, width) => sum + width, 0) + 11, 100);
        } else {
          assert.ok(Math.abs(columns.reduce((sum, width) => sum + width, 0) - 100) < 0.001, name);
        }
        if (name === "drivers") assert.deepEqual(columns, [12, 12, 12, 14, 14, 17, 19]);
        if (name === "sources") assert.deepEqual(columns, [14, 35, 18, 15, 18]);
        assert.match(markup, /<tbody>/);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual(found.sort(), Object.keys(expectedColumns).sort());
});

test("reservation finance columns are selectable and summarize each order batch", () => {
  for (const label of ["運転士支給", "ETC", "燃油費", "訂単价格", "運転士立替", "会社立替"]) {
    assert.ok(page.includes(`label: "${label}"`), label);
  }
  assert.match(page, /useState<ReservationFinanceColumnKey\[\]>\(\["driverPayment"\]\)/);
  assert.match(page, /groupOrdersByImportBatch\(monthlyOrders\)[\s\S]*?getReservationFinanceValues\(order\)/);
  assert.match(page, /selectedReservationFinanceColumns\.map\(option => \([\s\S]*?reservationFinanceValues\.get\(order\.id\)\?\.\[option\.key\]/);
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
  for (const variant of ["edit", "delete", "export", "excel"]) {
    assert.match(css, new RegExp(`\\.dashboard \\.table-action-button--${variant}\\s*\\{`));
  }
  assert.match(css, /\.dashboard \.table-action-button:focus-visible\s*\{/);
  assert.match(css, /\.dashboard \.table-action-button:disabled\s*\{/);
  assert.match(page, /导出财务表（PDF）[\s\S]*?className="table-action-button table-action-button--export"/);
  assert.match(page, /deleteLoginAccount\(account\)[\s\S]*?className="table-action-button table-action-button--delete/);
  const reports = fs.readFileSync(new URL("../components/operations-reports.tsx", import.meta.url), "utf8");
  assert.match(reports, /className="table-action-button table-action-button--edit driver-action-button"[^>]*disabled=\{busy\} onClick=\{\(\) => setEditing\(row\)\}/);
  assert.match(reports, /className="table-action-button table-action-button--delete driver-action-button"[^>]*disabled=\{busy\} onClick=\{\(\) => void remove\(row\)\}/);
  assert.match(reports, /className="table-action-button table-action-button--export driver-action-button"[^>]*disabled=\{busy\} onClick=\{\(\) => void output\(\[row\]/);
  assert.match(page, /onClick=\{deleteOrder\}[\s\S]*?className="table-action-button table-action-button--delete"/);
});

test("export labels use PDF instead of the A4 paper size", () => {
  for (const label of [
    "导出财务表", "导出工資表", "导出車両财务表",
    "导出收支報表", "請求書导出", "一键导出／打印",
  ]) {
    assert.ok(page.includes(`${label}（PDF）`), label);
  }
  assert.doesNotMatch(page, /（A4）|title="A4 PDF 导出"/);
  assert.ok(page.includes("导出工資表（Excel）"));
  assert.ok(page.includes("会社全员工資総表（Excel）"));
  assert.ok(!page.includes("会社全员工資総表（PDF）"));
});

test("PDF exports use pale blue while Excel keeps its green export style", () => {
  assert.match(css, /\.dashboard \.table-action-button--export\s*\{[^}]*border-color: #bfdbfe;[^}]*background: #eff6ff;[^}]*color: #1d4ed8;/);
  assert.match(css, /\.dashboard \.table-action-button--export:not\(:disabled\):hover\s*\{[^}]*background: #dbeafe;/);
  assert.match(css, /\.dashboard \.table-action-button--excel\s*\{[^}]*border-color: #a7f3d0;[^}]*background: #ecfdf5;[^}]*color: #047857;/);
  assert.match(css, /\.dashboard \.table-action-button--excel:not\(:disabled\):hover\s*\{[^}]*background: #d1fae5;/);
  const excelButtons = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "button") {
      const markup = node.getText(ast);
      if (/exportDriverWageExcel|exportCompanyWages/.test(node.openingElement.getText(ast))) {
        excelButtons.push(markup);
        assert.match(markup, /table-action-button--excel/);
        assert.doesNotMatch(markup, /table-action-button--export/);
      } else if (/PDF|printInvoice|printOrderExpenses|exportCompanyAdvances/.test(markup)) {
        assert.match(markup, /table-action-button--export/);
        assert.doesNotMatch(markup, /table-action-button--excel/);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(excelButtons.length, 2);
});

test("driver and company lists fit the viewport and use cards on mobile", () => {
  const companyStart = page.indexOf('data-table="companies"');
  const companyEnd = page.indexOf("</table>", companyStart);
  const companyTable = page.slice(page.lastIndexOf("<table", companyStart), companyEnd);
  assert.match(companyTable, /company-management-table/);
  for (const label of ["会社名称", "会社印章", "運行管理者", "整備管理者", "会社電話",
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
  for (const label of ["用車日期", "予約情報", "来源", "請求書状態",
    "入金状態", "請求金額", "訂単総利润"]) {
    assert.match(table, new RegExp(`data-label="${label}"`));
  }
  assert.doesNotMatch(table, /data-label="運転士"|data-label="車両番号"/);
  assert.doesNotMatch(table, /運転士総立替|会社総支出|運転士総工資/);
  assert.match(page, /groupOrdersByImportBatchStartMonth\(orders,\s*financeMonth\)/);
  assert.match(page, /groupOrdersByImportBatchStartMonth\(orders,\s*financeMonth\)[\s\S]*?groupOrders\.some\(matchesFinanceFilters\)/);
  assert.match(page, /groupOrdersByImportBatch\(monthlyFinanceOrders\)[\s\S]*?group\.some\(matchesFinanceFilters\)/);
  assert.match(page, /group\.totals\.requestAmount/);
  assert.match(page, /group\.orders\.length > 1/);
  assert.match(table, /min-w-\[1400px\]/);
  assert.match(table, /<th className="px-2 py-3 font-semibold">用車日期<\/th>/);
  assert.match(table, /<th className="px-2 py-3 font-semibold">予約情報<\/th>/);
  assert.match(table, /\{group\.customers\[0\] \|\| "未填写"\}/);
  assert.match(table, /title=\{group\.customers\.join\("、"\)\}/);
  assert.match(table, /\{group\.dateRange\}/);
  assert.match(page, /dateRange: startDate === endDate[\s\S]*formatOrderDate\(startDate\)[\s\S]*formatOrderDate\(endDate\)/);
  assert.match(page, /date: group\.dateRange/);
  assert.doesNotMatch(table, /openAccounting\(member\)/);
  assert.doesNotMatch(table, /OrderFinanceReviewButton/);
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

test("driver finance groups open accounting details by driver and use the batch start month", () => {
  const tableStart = page.lastIndexOf("<table", page.indexOf('data-table="driver-finance"'));
  const table = page.slice(tableStart, page.indexOf("</table>", tableStart));
  assert.match(table, /driver-finance-management-table/);
  assert.match(page, /groupDriverFinanceByBatch\([\s\S]*?buildCompanyDriverFinanceDetails\(driverFinanceGroupOrders\),\s*financeMonth/);
  assert.match(page, /const visibleDriverFinanceGroups = driverFinanceDisplayGroups/);
  assert.match(page, /driverGroup\.driver === selectedDriverFinanceDriver/);
  assert.match(table, /driverGroup\.driver/);
  assert.match(table, /group\.drivers\.map\(\(driverGroup\) =>/);
  assert.match(table, /onClick=\{\(\) => openAccounting\(group\.orders\[0\]\)\}/);
  assert.match(table, /formatOrderDate\(group\.startDate\)/);
  assert.match(table, /group\.endDate !== group\.startDate[\s\S]*formatOrderDate\(group\.endDate\)/);
  assert.doesNotMatch(table, /\{index \+ 1\}\/\{group\.drivers\.length\} 司机/);
  assert.doesNotMatch(table, /aria-expanded=|展开|收起|driverGroup\.rows\.map/);
  assert.doesNotMatch(table, /核算担当|row\.accountingAssignee|row\.company/);
  for (const label of ["服务日期", "訂単名称", "車輌番号", "運転士姓名", "運転士立替",
    "超時工資", "奖励工資", "運転士比例工資", "運転士固定工資", "支付総额"]) {
    assert.match(table, new RegExp(`data-label="${label}"`));
  }
  assert.doesNotMatch(table, /超時時間|工資総额/);
  assert.match(page, /rows: filteredDriverFinanceDetails,/);
  assert.doesNotMatch(css, /\.driver-finance-management-table thead\s*\{\s*display: none;/);
  assert.doesNotMatch(css, /\.driver-finance-management-table tbody\s*\{\s*display: grid;/);
  assert.match(css, /\.dashboard \.management-table\.driver-finance-management-table\s*\{[^}]*min-width: 1400px !important;[^}]*font-size: 0\.875rem;/);
  assert.match(css, /\.dashboard \.management-table\.driver-finance-management-table :is\(th, td\)\s*\{[^}]*padding: 0\.6rem 0\.45rem;[^}]*line-height: 1\.5;/);
});
