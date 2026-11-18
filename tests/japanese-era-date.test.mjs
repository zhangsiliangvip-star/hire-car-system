import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function load(file, mocks = {}) {
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: file,
  }).outputText, {
    module: compiled, exports: compiled.exports, RangeError,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
  });
  return compiled.exports;
}
const dates = load("lib/japanese-era-date.ts");
const { toGregorianDate, toJapaneseEraDate } = dates;

test("era dates convert in both directions, including leap days and era boundaries", () => {
  for (const [era, year, month, day, expected] of [
    ["令和", "8", "11", "13", "2026-11-13"],
    ["令和", "1", "5", "1", "2019-05-01"],
    ["平成", "31", "4", "30", "2019-04-30"],
    ["平成", "1", "1", "8", "1989-01-08"],
    ["昭和", "64", "1", "7", "1989-01-07"],
    ["昭和", "1", "12", "25", "1926-12-25"],
    ["令和", "6", "2", "29", "2024-02-29"],
    ["大正", "1", "7", "30", "1912-07-30"],
    ["明治", "45", "7", "29", "1912-07-29"],
  ]) {
    const fields = { era, year, month, day };
    assert.equal(toGregorianDate(fields), expected);
    assert.deepEqual(JSON.parse(JSON.stringify(toJapaneseEraDate(expected))), fields);
  }
  assert.equal(toGregorianDate(toJapaneseEraDate("")), "");
});

test("invalid, incomplete and out-of-era dates are explicitly rejected", () => {
  for (const fields of [
    { year: "8", month: "", day: "13" },
    { year: "8", month: "2", day: "29" },
    { year: "8", month: "4", day: "31" },
    { year: "0", month: "1", day: "1" },
    { year: "8.5", month: "1", day: "1" },
    { year: "1", month: "4", day: "30" },
    { year: "9999", month: "1", day: "1" },
  ]) assert.throws(() => toGregorianDate({ era: "令和", ...fields }), RangeError);
  assert.throws(() => toGregorianDate({ era: "平成", year: "31", month: "5", day: "1" }), RangeError);
  assert.throws(() => toJapaneseEraDate("2026-02-30"), RangeError);
});

test("both expiry inputs preview Gregorian values, reject partial edits and support clearing", () => {
  for (const label of ["車検有効期限", "自賠責有効期限"]) {
    const state = [];
    let cursor = 0, value = "2026-11-13", valid = true, writes = 0;
    const { JapaneseEraDateInput } = load("components/japanese-era-date-input.tsx", {
      "@/lib/japanese-era-date": dates,
      react: {
        ...React, useId: () => "expiry",
        useState: initial => {
          const index = cursor++;
          if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
          return [state[index], next => { state[index] = next; }];
        },
      },
    });
    const render = () => {
      cursor = 0;
      return JapaneseEraDateInput({
        label, value, onChange: next => { value = next; writes++; },
        onValidationChange: next => { valid = next; },
      });
    };
    const nodes = node => !node || typeof node !== "object" ? [] :
      Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
    const change = (unit, next) => nodes(render()).find(node => node.props?.["aria-label"] === `${label}${unit}`)
      .props.onChange({ target: { value: next } });
    const html = () => renderToStaticMarkup(render());
    assert.match(html(), /西历：2026-11-13/);
    assert.match(html(), /value="8"/);
    change("年", "9");
    assert.equal(value, "2027-11-13");
    change("月", "");
    assert.equal(valid, false);
    assert.equal(value, "2027-11-13", "partial edits must not clear the stored date");
    assert.match(html(), /role="alert"/);
    assert.equal(writes, 1);
    change("月", "2");
    change("日", "30");
    assert.equal(valid, false);
    change("日", "28");
    assert.equal(value, "2027-02-28");
    assert.equal(valid, true);
    nodes(render()).find(node => node.type === "button").props.onClick();
    assert.equal(value, "");
    assert.equal(valid, true);
    assert.match(html(), /未设置/);
  }
});

test("invalid expiry drafts block vehicle saving before any persistence work", () => {
  const source = read("app/page.tsx");
  const start = source.indexOf("  function saveVehicle()");
  const handler = source.slice(start, source.indexOf("  function deleteVehicle(", start));
  for (const vehicleExpiryValidity of [
    { inspection: false, liability: true }, { inspection: true, liability: false },
  ]) {
    const alerts = [];
    const context = {
      dialogSavingRef: { current: false }, vehicleExpiryValidity,
      alert: message => alerts.push(message),
    };
    vm.runInNewContext(ts.transpileModule(handler + "\nsaveVehicle();", {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /和历日期/);
  }
  assert.match(source, /<JapaneseEraDateInput label="車検有効期限" value=\{vehicleForm\.inspectionExpiry\}/);
  assert.match(source, /<JapaneseEraDateInput label="自賠責有効期限" value=\{vehicleForm\.liabilityExpiry\}/);
});
