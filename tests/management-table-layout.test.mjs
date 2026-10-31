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
  assert.match(css, /\.dashboard \.management-table :is\(th, td\)\s*\{[^}]*text-align: center;[^}]*vertical-align: middle;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.dashboard \.management-table :is\(button, input, select\)\s*\{[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*text-align: center;/);
  assert.match(css, /\.dashboard \.management-table td > \.flex,[^{]*\{[^}]*justify-content: center;[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.dashboard \.management-table \.truncate\s*\{[^}]*overflow: visible;[^}]*text-overflow: clip;/);
});

test("order finance rows switch to labeled cards without horizontal scrolling", () => {
  const tableStart = page.lastIndexOf("<table", page.indexOf('data-table="order-finance"'));
  const table = page.slice(tableStart, page.indexOf("</table>", tableStart));
  assert.match(table, /order-finance-management-table/);
  for (const label of ["訂単日期", "訂単名称", "来源", "運転士", "車両番号", "請求書状態",
    "入金状態", "請求金額", "運転士総立替", "会社総支出", "運転士総工資", "訂単総利润"]) {
    assert.match(table, new RegExp(`data-label="${label}"`));
  }
  assert.match(css, /@media \(max-width: 2399px\)\s*\{[\s\S]*?\.order-finance-management-table thead\s*\{\s*display: none;/);
  assert.match(css, /\.order-finance-management-table tbody\s*\{\s*display: grid;/);
});

test("driver wage rows hide company and accounting fields and fit as labeled cards", () => {
  const tableStart = page.lastIndexOf("<table", page.indexOf('data-table="driver-finance"'));
  const table = page.slice(tableStart, page.indexOf("</table>", tableStart));
  assert.match(table, /driver-finance-management-table/);
  assert.doesNotMatch(table, /核算担当|row\.accountingAssignee|row\.company/);
  for (const label of ["服务日期", "訂単名称", "車輌番号", "運転士姓名", "運転士立替",
    "超時時間", "超時工資", "奖励工資", "運転士比例工資", "運転士固定工資", "工資総额", "支付総额"]) {
    assert.match(table, new RegExp(`data-label="${label}"`));
  }
  assert.match(css, /@media \(max-width: 2399px\)\s*\{[\s\S]*?\.driver-finance-management-table thead\s*\{\s*display: none;/);
  assert.match(css, /\.driver-finance-management-table tbody\s*\{\s*display: grid;/);
  assert.match(css, /@media \(max-width: 639px\)\s*\{[\s\S]*?\.driver-finance-management-table tbody,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
});
