import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expectedColumns = {
  accounts: 8,
  "order-finance": 12,
  "driver-finance": 12,
  "vehicle-summary": 8,
  "vehicle-finance": 8,
  balance: 8,
  "balance-items": 4,
  drivers: 10,
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

test("management cells and controls center and wrap without affecting other tables", () => {
  assert.match(css, /\.dashboard table td button\s*\{[^}]*display: inline-flex;[^}]*border-radius: 0\.5rem;[^}]*font-weight: 600;/);
  assert.match(css, /\.dashboard table td button\[class~="text-blue-700"\],[\s\S]*?background: #eff6ff;[^}]*color: #1d4ed8;/);
  assert.match(css, /\.dashboard table td button\[class~="text-rose-700"\],[\s\S]*?background: #fff1f2;[^}]*color: #be123c;/);
  assert.match(css, /\.dashboard table td button\[class~="bg-blue-700"\],[\s\S]*?color: #fff;/);
  assert.match(css, /\.dashboard button\s*\{[^}]*transition-property: color, background-color, border-color, box-shadow, transform, filter;[^}]*transition-duration: 150ms;/);
  assert.match(css, /\.dashboard button:not\(:disabled\):hover\s*\{[^}]*box-shadow:/);
  assert.match(css, /\.dashboard button:not\(:disabled\):active\s*\{[^}]*transform: translateY\(1px\) scale\(0\.99\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.dashboard button:not\(:disabled\):active\s*\{\s*transform: none;/);
  assert.match(css, /\.dashboard \.management-table :is\(th, td\)\s*\{[^}]*text-align: center;[^}]*vertical-align: middle;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.dashboard \.management-table :is\(button, input, select\)\s*\{[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*text-align: center;/);
  assert.match(css, /\.dashboard \.management-table td > \.flex,[^{]*\{[^}]*justify-content: center;[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.dashboard \.management-table \.truncate\s*\{[^}]*overflow: visible;[^}]*text-overflow: clip;/);
});

test("driver edit and delete controls use the reservation action button style", () => {
  const driverViewStart = page.indexOf('{activeView === "drivers"');
  const driverViewEnd = page.indexOf('{activeView === "vehicles"', driverViewStart);
  const driverView = page.slice(driverViewStart, driverViewEnd);
  assert.match(driverView, /openEditDriver\(driver\)[\s\S]*?inline-flex w-14 items-center justify-center whitespace-nowrap rounded border border-blue-200 bg-blue-50 py-1 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100/);
  assert.match(driverView, /deleteDriver\(driver\)[\s\S]*?inline-flex w-14 items-center justify-center whitespace-nowrap rounded border border-rose-200 bg-rose-50 py-1 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100/);
  assert.doesNotMatch(driverView, /className="font-medium text-(?:blue|rose)-700 hover:underline"/);
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
  assert.match(css, /@media \(min-width: 640px\) and \(max-width: 2399px\)\s*\{[\s\S]*?\.dashboard \.management-table\.driver-management-table,\s*\.dashboard \.management-table\.company-management-table\s*\{[^}]*min-width: 0 !important;[^}]*table-layout: fixed;/);
  assert.match(css, /@media \(max-width: 639px\)\s*\{[\s\S]*?\.company-management-table thead\s*\{\s*display: none;/);
  assert.match(css, /\.company-management-table td::before\s*\{\s*content: attr\(data-label\);/);
});

test("order finance rows stay in a compact table without horizontal scrolling", () => {
  const tableStart = page.lastIndexOf("<table", page.indexOf('data-table="order-finance"'));
  const table = page.slice(tableStart, page.indexOf("</table>", tableStart));
  assert.match(table, /order-finance-management-table/);
  for (const label of ["訂単日期", "訂単名称", "来源", "運転士", "車両番号", "請求書状態",
    "入金状態", "請求金額", "運転士総立替", "会社総支出", "運転士総工資", "訂単総利润"]) {
    assert.match(table, new RegExp(`data-label="${label}"`));
  }
  assert.match(css, /\.dashboard \.management-table\.order-finance-management-table,\s*\.dashboard \.management-table\.driver-finance-management-table\s*\{[^}]*table-layout: fixed;[^}]*font-size: 0\.5625rem;/);
  assert.match(css, /\.dashboard \.management-table\.order-finance-management-table :is\(th, td\),\s*\.dashboard \.management-table\.driver-finance-management-table :is\(th, td\)\s*\{[^}]*padding: 0\.125rem 0\.1rem;/);
  assert.doesNotMatch(css, /\.order-finance-management-table thead\s*\{\s*display: none;/);
  assert.doesNotMatch(css, /\.order-finance-management-table tbody\s*\{\s*display: grid;/);
});

test("driver wage rows stay in a compact table without company or accounting fields", () => {
  const tableStart = page.lastIndexOf("<table", page.indexOf('data-table="driver-finance"'));
  const table = page.slice(tableStart, page.indexOf("</table>", tableStart));
  assert.match(table, /driver-finance-management-table/);
  assert.doesNotMatch(table, /核算担当|row\.accountingAssignee|row\.company/);
  for (const label of ["服务日期", "訂単名称", "車輌番号", "運転士姓名", "運転士立替",
    "超時時間", "超時工資", "奖励工資", "運転士比例工資", "運転士固定工資", "工資総额", "支付総额"]) {
    assert.match(table, new RegExp(`data-label="${label}"`));
  }
  assert.doesNotMatch(css, /\.driver-finance-management-table thead\s*\{\s*display: none;/);
  assert.doesNotMatch(css, /\.driver-finance-management-table tbody\s*\{\s*display: grid;/);
});
