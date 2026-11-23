import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("global autofill opt-out covers existing, dynamically inserted and updated fields without touching passwords or values", () => {
  class Element {
    constructor(tag, type = "text", autocomplete = "street-address", children = []) {
      Object.assign(this, { tag, type, autocomplete, children, value: "unchanged", writes: 0 });
    }
    matches() { return ["form", "textarea", "select"].includes(this.tag) || this.tag === "input" && this.type !== "password"; }
    getAttribute() { return this.autocomplete; }
    setAttribute(name, value) { assert.equal(name, "autocomplete"); this.autocomplete = value; this.writes++; }
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
  }
  let callback, cleanup, disconnected = false;
  const inputs = ["input", "textarea", "select", "form"].map(tag => new Element(tag));
  const password = new Element("input", "password", "current-password");
  const body = new Element("body", "", "", [...inputs, password]);
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read("components/disable-personal-autofill.tsx"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: compiled, exports: compiled.exports, Element, document: { body },
    require: name => name === "react" ? { useEffect: effect => { cleanup = effect(); } } : require(name),
    MutationObserver: class {
      constructor(fn) { callback = fn; }
      observe(target, options) { assert.equal(target, body); assert.equal(options.subtree, true); }
      disconnect() { disconnected = true; }
    },
  });
  compiled.exports.DisablePersonalAutofill();
  for (const input of inputs) { assert.equal(input.autocomplete, "off"); assert.equal(input.value, "unchanged"); }
  assert.equal(password.autocomplete, "current-password");
  const postal = new Element("input", "text", "postal-code");
  callback([{ type: "childList", addedNodes: [new Element("div", "", "", [postal])] }]);
  assert.equal(postal.autocomplete, "off");
  postal.autocomplete = "postal-code";
  callback([{ type: "attributes", target: postal, addedNodes: [] }]);
  assert.equal(postal.autocomplete, "off");
  const writes = postal.writes;
  callback([{ type: "attributes", target: postal, addedNodes: [] }]);
  assert.equal(postal.writes, writes);
  cleanup(); assert.equal(disconnected, true);
  assert.match(read("app/layout.tsx"), /<DisablePersonalAutofill \/>/);
});

test("calendar merge/split and execution badges use the same height and top alignment", () => {
  const page = read("app/page.tsx");
  const start = page.indexOf("{!isCompactCalendar && (", page.indexOf('className={`calendar-order-card'));
  const actions = page.slice(start, page.indexOf("{isSelectingSplit && selectedStartDate && selectedEndDate && (", start));
  assert.match(actions, /absolute right-2 top-0/);
  assert.equal((actions.match(/h-\[18px\]/g) || []).length, 2);
  assert.match(read("components/driver-execution-badge.tsx"), /h-\[18px\].*align-top/);
});

test("calendar cards do not offer reservation copying in either layout", () => {
  const page = read("app/page.tsx");
  const start = page.indexOf('className={`calendar-order-card');
  const card = page.slice(start, page.indexOf("{isSelectingSplit && selectedStartDate && selectedEndDate && (", start));
  assert.ok(start >= 0);
  assert.doesNotMatch(card, /复制预约|openCopyOrder/);
  assert.doesNotMatch(page, /function openCopyOrder/);
});
