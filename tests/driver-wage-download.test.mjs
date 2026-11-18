import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function harness({ cancel = false, existing = false, overwrite = true, failAt = -1, supported = true, canvasHeight = 900 } = {}) {
  const writes = [], notices = [], images = [];
  let addedPages = 0;
  let removed = 0, pickers = 0, renders = 0;
  const content = {
    getBoundingClientRect: () => ({ width: 720, top: 0 }),
    querySelectorAll: () => [],
  };
  const doc = {
    open() {}, write(html) { assert.match(html, /daily/); }, close() {},
    fonts: { ready: Promise.resolve() },
    querySelector: (selector) => selector === ".content" ? content : { style: {} },
  };
  const directory = {
    async getFileHandle(name, options) {
      if (!options) {
        if (existing) return {};
        throw new DOMException("Missing", "NotFoundError");
      }
      return { async createWritable() {
        return {
          async write(blob) {
            if (writes.length === failAt) throw new Error("Disk full");
            assert.equal(await blob.text(), "%PDF-test");
            writes.push(name);
          },
          async close() {},
          async abort() {},
        };
      } };
    },
  };
  const compiledModule = { exports: {} };
  const context = {
    module: compiledModule, exports: compiledModule.exports, Blob, DOMException,
    window: supported ? { async showDirectoryPicker() {
      pickers++;
      if (cancel) throw new DOMException("Cancel", "AbortError");
      return directory;
    } } : {},
    document: {
      body: { appendChild() {} },
      createElement: (tag) => tag === "iframe" ?
        { contentDocument: doc, style: {}, remove() { removed++; } } :
        { getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/png;base64,AA==" },
    },
    alert: (message) => notices.push(message), confirm: () => overwrite,
    require: (name) => {
      if (name === "@/lib/driver-wage-print") return { buildDriverWagePrintHtml: () => "daily" };
      if (name === "html2canvas") return { default: async () => { renders++; return { width: 1440, height: canvasHeight }; } };
      if (name === "jspdf") return { jsPDF: class {
        addPage() { addedPages++; }
        addImage(_data, _format, x, y, width, height) { images.push({ x, y, width, height }); }
        output() { return new Blob(["%PDF-test"]); }
      } };
      throw new Error(`Unexpected module ${name}`);
    },
  };
  const source = fs.readFileSync(new URL("../lib/driver-wage-download.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return { ...compiledModule.exports, writes, notices, images, addedPages: () => addedPages,
    metrics: () => ({ removed, pickers, renders }) };
}

const data = Array.from({ length: 10 }, (_, index) => ({
  driver: `司机${index}`, month: "2026-10", region: "Tokyo", rows: [], manualItems: [],
}));

test("ten monthly wage files use one chosen folder, valid PDF blobs and driver/month names", async () => {
  const h = harness();
  await h.downloadDriverWageBatch(data);
  assert.deepEqual(h.writes, data.map((item) => `${item.driver}2026-10.pdf`));
  assert.deepEqual(h.metrics(), { removed: 10, pickers: 1, renders: 10 });
  assert.match(h.notices[0], /10份/);
  assert.equal(h.driverWagePdfFilename("A/B", "2026-10"), "A_B2026-10.pdf");
});

test("cancel and declined replacement write nothing; duplicate names and unsupported browsers report errors", async () => {
  for (const options of [{ cancel: true }, { existing: true, overwrite: false }]) {
    const h = harness(options);
    await h.downloadDriverWageBatch(data);
    assert.equal(h.writes.length, 0);
    assert.equal(h.notices.length, 0);
  }
  await assert.rejects(harness({ supported: false }).downloadDriverWageBatch(data), /Chrome或Edge/);
  await assert.rejects(harness().downloadDriverWageBatch([data[0], data[0]]), /重复/);
});

test("partial download failures report saved count and clean up rendering frames", async () => {
  const h = harness({ failAt: 3 });
  await assert.rejects(h.downloadDriverWageBatch(data), /已保存3份.*Disk full/);
  assert.equal(h.metrics().removed, 4);
  assert.equal(h.notices.length, 0);
});

test("PDF pagination moves whole rows and preserves the full long document", () => {
  const h = harness();
  const breaks = Array.from(h.wagePdfPageBreaks(3100, 1000, [
    { top: 950, bottom: 1050 }, { top: 1900, bottom: 2000 },
  ]));
  assert.deepEqual(breaks, [0, 950, 1900, 2900, 3100]);
});

test("long wage PDFs use multiple A4 pages at fixed readable width, not whole-month shrink-to-fit", async () => {
  const h = harness({ canvasHeight: 6000 });
  await h.renderDriverWagePdf(data[0]);
  assert.equal(h.images.length, 3);
  assert.equal(h.addedPages(), 2);
  for (const image of h.images) {
    assert.equal(image.x, 10); assert.equal(image.y, 10);
    assert.equal(image.width, 190);
    assert.ok(image.height <= 277);
  }
  assert.ok(Math.abs(h.images.reduce((sum, image) => sum + image.height, 0) - 6000 * 190 / 1440) < 0.001);
});
