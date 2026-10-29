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
  "driver-finance": 14,
  "vehicle-summary": 8,
  "vehicle-finance": 8,
  balance: 8,
  "balance-items": 4,
  drivers: 9,
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
        assert.match(markup, /management-table w-full min-w-\[\d+px\] table-fixed text-center/);
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
