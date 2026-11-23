import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
function load(relative, mocks = {}, globals = {}) {
  const filename = path.join(root, relative);
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText, { module: compiled, exports: compiled.exports, Date, Intl, Blob, Uint8Array, Error, DOMException,
    console: { error() {} },
    require: name => Object.hasOwn(mocks, name) ? mocks[name] :
      name.startsWith("@/") ? load(name.slice(2).replaceAll("/", "\\") +
        (name.startsWith("@/components/") ? ".tsx" : ".ts"), mocks, globals) : require(name),
    ...globals,
  });
  return compiled.exports;
}
const payments = load("lib\\driver-payment.ts");
const month = "2026-11";
const driver = { id: "driver", regionId: "tokyo", name: "Synthetic Driver", phone: "000",
  companyName: "Synthetic Company",
  bankName: "Synthetic Bank", bankBranch: "Branch", bankAccountType: "普通",
  bankAccountNumber: "0012345", bankAccountHolder: "TEST HOLDER" };
const company = { id: "company", regionId: "tokyo", name: "Synthetic Company" };
const row = { driver: driver.name, company: company.name, regionId: "tokyo", serviceDate: "2026-11-12",
  time: "09:00", customer: "PRIVATE CUSTOMER MUST NOT LEAK", vehicleNumber: "PRIVATE PLATE",
  driverAdvances: 1000, overtimeHours: 1, overtimeFee: 2000, percentageWage: 3000,
  fixedWage: 4000, bonusWage: 500, totalWage: 9500, accountingAssignee: "PRIVATE STAFF" };
const manual = { id: "item", regionId: "tokyo", month, companyName: company.name, driver: driver.name,
  name: "Adjustment", amount: -500 };
const makeInvoice = (summary = payments.summarizeDriverPayments([row], [manual], month)[0]) =>
  payments.createDriverPaymentInvoice(summary, month, [driver], [company], "2026-11-30");
const walk = node => !React.isValidElement(node) ? [] :
  [node, ...React.Children.toArray(node.props.children).flatMap(walk)];

test("monthly payment summary shares manual items once and isolates driver, company, month and region", () => {
  const groups = payments.summarizeDriverPayments([
    row, { ...row, serviceDate: "2026-10-12" }, { ...row, company: "Other payer" },
    { ...row, regionId: "osaka" },
  ], [manual, { ...manual, id: "next", month: "2026-12", amount: 9999 },
    { ...manual, id: "only", driver: "Manual only", amount: 300 }], month);
  assert.equal(groups.length, 4);
  const selected = groups.find(item => item.driver === driver.name && item.regionId === "tokyo" && item.company === company.name);
  assert.deepEqual(JSON.parse(JSON.stringify({
    advances: selected.advances, overtime: selected.overtime, bonus: selected.bonus,
    percentage: selected.percentage, fixed: selected.fixed, manual: selected.manual,
    remuneration: selected.remuneration, total: selected.total,
  })), { advances: 1000, overtime: 2000, bonus: 500, percentage: 3000, fixed: 4000,
    manual: -500, remuneration: 9000, total: 10000 });
  assert.equal(selected.manualItems.length, 1);
  assert.equal(groups.find(item => item.driver === "Manual only").total, 300);
  assert.equal(groups.find(item => item.regionId === "osaka").total, 10500);
  assert.equal(payments.summarizeDriverPayments([], [], month).length, 0);
  assert.throws(() => payments.summarizeDriverPayments([{ ...row, totalWage: 1.5 }], [], month), /日元整数/);
  assert.throws(() => payments.summarizeDriverPayments([row, { ...row, totalWage: Number.MAX_SAFE_INTEGER }], [], month), /安全范围/);
  assert.throws(() => payments.summarizeDriverPayments([{ ...row, totalWage: 9999 }], [], month), /分项/);
});

test("departed drivers retain historical wages, payment summaries and downloadable invoices", () => {
  const departed = { ...driver, employmentStatus: "離職" };
  const summaries = payments.summarizeDriverPayments([row], [manual], month, [departed]);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].total, 10000);
  const invoice = payments.createDriverPaymentInvoice(summaries[0], month, [departed], [company], "2026-11-30");
  assert.equal(invoice.driver.employmentStatus, "離職");
  assert.doesNotThrow(() => payments.validatePaymentInvoiceDownload(invoice));
  assert.match(payments.buildDriverPaymentInvoiceHtml(invoice), /10,000 円/);
});

test("invoice separates remuneration and advances, escapes all entered text and preserves bank zeros", () => {
  const invoice = makeInvoice();
  const html = payments.buildDriverPaymentInvoiceHtml({
    ...invoice, driver: { ...driver, name: '<img src=x onerror="alert(1)">', bankName: "Bank <script>bad</script>",
      address: "<b>住所</b>\nSynthetic second line", postalCode: "001-2345", companyName: "Issuer <Company>" },
    company: { ...company, name: "Payer & Co" },
    summary: { ...invoice.summary, manualItems: [{ ...manual, name: "<b>扣款</b>" }] },
  });
  assert.match(html, /請求書/);
  assert.match(html, /10,000 円/);
  assert.match(html, /<td>業務委託<\/td>[\s\S]*?<td class="amount">9,500<\/td>/);
  assert.match(html, /<td>立替金<\/td>[\s\S]*?<td class="amount">1,000<\/td>/);
  assert.doesNotMatch(html, /運転士比例報酬|運転士固定報酬|超時報酬|奖励報酬|税込/);
  assert.match(html, /&lt;b&gt;住所&lt;\/b&gt;<br>Synthetic second line/);
  assert.match(html, /<div>〒001-2345<\/div><div>&lt;b&gt;住所/);
  assert.doesNotMatch(html, /Issuer &lt;Company&gt;/);
  assert.match(html, /<div class="details-value">11月分業務委託<\/div>/);
  assert.match(html, /2026\/11\/30/);
  for (const label of ["摘要", "数量", "単位", "単価", "金額", "備考"]) assert.ok(html.includes(label));
  assert.match(html, /background:#eaf3ff/);
  assert.doesNotMatch(html, /background:#333|background:#000/);
  assert.match(html, /0012345/);
  assert.match(html, /&lt;img/);
  assert.match(html, /Payer &amp; Co/);
  assert.match(html, /&lt;b&gt;扣款&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>|<img|PRIVATE CUSTOMER|PRIVATE PLATE|PRIVATE STAFF/);
  assert.match(html, /<section class="notes"><h2>備考<\/h2><\/section>\s*<\/article>/);
  assert.doesNotMatch(html, /消費税・源泉徴収|適格請求書|支払済み|本人の承認|番号・支払期限|<footer>/);
  assert.doesNotThrow(() => payments.validatePaymentInvoiceDownload(invoice));
});

test("invoice deadlines add one calendar month to the issue date with month-end clamping", () => {
  for (const [issuedDate, expected] of [["2026-11-30", "2026/12/30"], ["2026-12-31", "2027/1/31"],
    ["2026-01-31", "2026/2/28"], ["2028-01-31", "2028/2/29"], ["2026-03-31", "2026/4/30"],
    ["2026-11-13", "2026/12/13"]]) {
    const html = payments.buildDriverPaymentInvoiceHtml({ ...makeInvoice(), issuedDate });
    assert.ok(html.includes(`<div class="details-label">支払期限</div><div class="details-value">${expected}</div>`), issuedDate);
  }
  assert.match(payments.buildDriverPaymentInvoiceHtml({ ...makeInvoice(), month: "2027-01" }),
    /<div class="details-value">1月分業務委託<\/div>/);
  assert.throws(() => payments.buildDriverPaymentInvoiceHtml({ ...makeInvoice(), issuedDate: "9999-12-31" }), /有效日期范围/);
});

test("invoice combines all wages, keeps each signed manual item and advances separate, with no total change", () => {
  const items = [manual, { ...manual, id: "extra", name: "追加経費", amount: 700 }];
  const summary = payments.summarizeDriverPayments([row], items, month)[0];
  const html = payments.buildDriverPaymentInvoiceHtml(makeInvoice(summary));
  const lines = [...html.matchAll(/<tr class="invoice-line"><td>(.*?)<\/td>[\s\S]*?<td class="amount">(.*?)<\/td><td class="amount">(.*?)<\/td><\/tr>/g)];
  assert.deepEqual(lines.map(match => [match[1], match[3]]), [
    ["業務委託", "9,500"], ["立替金", "1,000"], ["Adjustment", "-500"], ["追加経費", "700"],
  ]);
  assert.equal(lines.reduce((total, match) => total + Number(match[3].replaceAll(",", "")), 0), summary.total);
  assert.equal(summary.total, 10700);
  assert.equal((html.match(/class="blank"/g) || []).length, 10);
  const manualOnly = payments.summarizeDriverPayments([], [manual, items[1]], month)[0];
  assert.match(payments.buildDriverPaymentInvoiceHtml(makeInvoice(manualOnly)), /200 円/);
  assert.throws(() => payments.buildDriverPaymentInvoiceHtml(makeInvoice({ ...summary, total: 999 })), /明细与支付总额/);
});

test("invoice hides zero remuneration and advance lines while preserving manual items", () => {
  const zeroWageRow = { ...row, overtimeHours: 0, overtimeFee: 0, bonusWage: 0,
    percentageWage: 0, fixedWage: 0, totalWage: 0 };
  const advanceOnly = payments.summarizeDriverPayments([{ ...zeroWageRow, driverAdvances: 1000 }], [], month)[0];
  const advanceHtml = payments.buildDriverPaymentInvoiceHtml(makeInvoice(advanceOnly));
  assert.doesNotMatch(advanceHtml, /<td>業務委託<\/td>/);
  assert.match(advanceHtml, /<td>立替金<\/td>/);

  const remunerationOnly = payments.summarizeDriverPayments([{ ...row, driverAdvances: 0 }], [], month)[0];
  const remunerationHtml = payments.buildDriverPaymentInvoiceHtml(makeInvoice(remunerationOnly));
  assert.match(remunerationHtml, /<td>業務委託<\/td>/);
  assert.doesNotMatch(remunerationHtml, /<td>立替金<\/td>/);

  const manualOnly = payments.summarizeDriverPayments([{ ...zeroWageRow, driverAdvances: 0 }],
    [{ ...manual, amount: 500 }], month)[0];
  const manualHtml = payments.buildDriverPaymentInvoiceHtml(makeInvoice(manualOnly));
  assert.doesNotMatch(manualHtml, /<td>業務委託<\/td>|<td>立替金<\/td>/);
  assert.match(manualHtml, /<td>Adjustment<\/td>/);
});

test("driver affiliation determines payer and merges order companies without changing shared manual records", () => {
  const payer = { ...company, name: "Affiliated Company" };
  const affiliated = { ...driver, companyName: payer.name };
  const rows = [row, { ...row, company: "Another order company" }, { ...row, regionId: "osaka" }];
  const items = [manual, { ...manual, id: "other", companyName: "Another order company", amount: 100 }];
  const snapshot = JSON.stringify(items);
  const summaries = payments.summarizeDriverPayments(rows, items, month, [affiliated]);
  const summary = summaries.find(item => item.regionId === "tokyo");
  assert.equal(summary.company, payer.name);
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.manualItems.length, 2);
  assert.equal(summary.total, 20600);
  assert.equal(JSON.stringify(items), snapshot);
  const invoice = payments.createDriverPaymentInvoice(summary, month, [affiliated], [company, payer]);
  assert.equal(invoice.company.name, payer.name);
  assert.match(payments.buildDriverPaymentInvoiceHtml(invoice), /Affiliated Company 御中/);
  assert.equal(summaries.find(item => item.regionId === "osaka").company, "");
  assert.throws(() => payments.createDriverPaymentInvoice(summary, month, [affiliated], [company]), /会社资料/);
});

test("invoice download requires unique scoped identities, complete bank fields and positive totals", () => {
  const invoice = makeInvoice();
  for (const key of ["bankName", "bankBranch", "bankAccountType", "bankAccountNumber", "bankAccountHolder"])
    assert.throws(() => payments.validatePaymentInvoiceDownload({ ...invoice, driver: { ...driver, [key]: "" } }), /银行口座/);
  for (const total of [0, -1])
    assert.throws(() => payments.validatePaymentInvoiceDownload({ ...invoice, summary: { ...invoice.summary, total } }), /大于零/);
  assert.throws(() => payments.createDriverPaymentInvoice(invoice.summary, month, [], [company]), /司机资料/);
  assert.throws(() => payments.createDriverPaymentInvoice(invoice.summary, month, [driver, driver], [company]), /唯一/);
  assert.throws(() => payments.createDriverPaymentInvoice(invoice.summary, month, [driver], [{ ...company, regionId: "osaka" }]), /会社资料/);
  assert.throws(() => payments.createDriverPaymentInvoice(invoice.summary, month, [{ ...driver, companyName: "" }], [company]), /所属会社/);
  for (const date of ["2026-02-30", "2026-13-01", "invalid", ""]) {
    assert.throws(() => payments.createDriverPaymentInvoice(invoice.summary, month, [driver], [company], date), /発行日/);
  }
  assert.throws(() => payments.summarizeDriverPayments([], [], "2026-13"), /月份/);
});

function downloadHarness({ failAt = -1, cancel = false, existing = false, overwrite = true, supported = true, diskFull = false } = {}) {
  const downloads = [], blobs = [], removed = [], revoked = [], writes = [];
  let renders = 0, pickers = 0, aborts = 0;
  const directory = { getFileHandle: async (name, options) => {
    if (!options) {
      if (existing) return {};
      throw new DOMException("Missing", "NotFoundError");
    }
    return { createWritable: async () => ({
      write: async blob => { if (diskFull) throw new Error("Disk full"); writes.push({ name, blob }); },
      close: async () => {}, abort: async () => { aborts++; },
    }) };
  } };
  const globals = { window: supported ? { showDirectoryPicker: async () => {
    pickers++;
    if (cancel) throw new DOMException("Cancelled", "AbortError");
    return directory;
  } } : {}, confirm: () => overwrite };
  const wage = load("lib\\driver-wage-download.ts", {}, globals);
  const lib = load("lib\\driver-payment-download.ts", {
    "@/lib/driver-wage-download": {
      ...wage,
      renderPaymentDocumentPdf: async html => {
        assert.match(html, /請求書/);
        if (renders++ === failAt) throw new Error("Synthetic PDF failure");
        return new Blob(["%PDF-1.3\nSynthetic PDF"]);
      },
    },
  }, {
    ...globals,
    URL: { createObjectURL: blob => { blobs.push(blob); return `blob:${blobs.length}`; }, revokeObjectURL: url => revoked.push(url) },
    document: { body: { appendChild() {} }, createElement: () => ({
      click() { downloads.push(this.download); }, remove() { removed.push(true); },
    }) }, setTimeout: callback => callback(),
  });
  return { ...lib, downloads, blobs, removed, revoked, writes, renders: () => renders, pickers: () => pickers, aborts: () => aborts };
}

test("batch PDFs use one selected directory and month-first Unicode names; single PDF uses the same name", async () => {
  const invoice = makeInvoice();
  const second = { ...invoice, driver: { ...driver, name: "運転士二" } };
  const h = downloadHarness();
  const progress = [];
  await h.downloadDriverPaymentInvoices([invoice, second], true, (done, total) => progress.push([done, total]));
  assert.equal(h.downloads.length, 0);
  assert.equal(h.pickers(), 1);
  assert.deepEqual(h.writes.map(file => file.name), ["2026-11Synthetic Driver.pdf", "2026-11運転士二.pdf"]);
  for (const file of h.writes) assert.match(await file.blob.text(), /^%PDF-1.3/);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
  await h.downloadDriverPaymentInvoices([invoice], false);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0], "2026-11Synthetic Driver.pdf");
  assert.equal(h.revoked.length, 1);
  assert.equal(h.removed.length, 1);
});

test("batch validation runs before picking; partial failures report saved count without success", async () => {
  const invoice = makeInvoice();
  const h = downloadHarness({ failAt: 1 });
  const other = { ...invoice, driver: { ...driver, name: "Other" } };
  await assert.rejects(h.downloadDriverPaymentInvoices([invoice, other], true), /已保存1份.*Synthetic PDF failure/);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.writes.length, 1);
  const valid = downloadHarness();
  await assert.rejects(valid.downloadDriverPaymentInvoices([invoice, invoice], true), /重复/);
  await assert.rejects(valid.downloadDriverPaymentInvoices([], true), /暂无/);
  await assert.rejects(valid.downloadDriverPaymentInvoices([invoice, other], false), /只能/);
  await assert.rejects(valid.downloadDriverPaymentInvoices([invoice, { ...other, driver: { ...driver, bankName: "" } }], true), /银行口座/);
  assert.equal(valid.renders(), 0);
  assert.equal(valid.pickers(), 0);
});

test("directory cancellation, overwrite rejection, unsupported browsers and write failures remain explicit", async () => {
  const invoice = makeInvoice();
  for (const options of [{ cancel: true }, { existing: true, overwrite: false }]) {
    const h = downloadHarness(options);
    assert.equal(await h.downloadDriverPaymentInvoices([invoice], true), "cancelled");
    assert.equal(h.renders(), 0); assert.equal(h.writes.length, 0);
  }
  await assert.rejects(downloadHarness({ supported: false }).downloadDriverPaymentInvoices([invoice], true), /Chrome或Edge/);
  const disk = downloadHarness({ diskFull: true });
  await assert.rejects(disk.downloadDriverPaymentInvoices([invoice], true), /已保存0份.*Disk full/);
  assert.equal(disk.aborts(), 1);
  const same = { ...invoice, driver: { ...driver, name: driver.name.toUpperCase() } };
  await assert.rejects(downloadHarness().downloadDriverPaymentInvoices([invoice, same], true), /重复/);
});

function uiHarness({ canEdit = true, confirmed = true } = {}) {
  const states = [], refs = [], saves = [], downloads = [];
  let cursor = 0, refCursor = 0;
  const props = { month, onMonthChange() {}, regionId: "tokyo", rows: [row], manualItems: [manual],
    drivers: [driver], companies: [company], canEdit, pendingSave: false,
    onDeleteItem() {},
    onSaveItem: async item => { saves.push(item); return confirmed; } };
  const { DriverPayments } = load("components\\driver-payments.tsx", {
    react: { ...React, useEffect() {}, useState: initial => {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = value; }];
    }, useRef: initial => { const index = refCursor++; return refs[index] ??= { current: initial }; } },
    "@/lib/driver-payment-download": { downloadDriverPaymentInvoices: async (invoices, batch) => {
      downloads.push({ invoices, batch }); return "saved";
    } },
  });
  const render = () => { cursor = 0; refCursor = 0; return DriverPayments(props); };
  const label = name => walk(render()).find(node => node.props["aria-label"] === name);
  const button = name => walk(render()).find(node => node.type === "button" && node.props.children === name);
  return { props, saves, downloads, render, label, button };
}

test("payment list places the affiliation office on its own final line without changing the saved company", () => {
  const h = uiHarness();
  h.props.drivers = [{ ...driver, companyName: "Synthetic Company 本社営業所" }];
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /Synthetic Driver<span[^>]*>Synthetic Company<\/span><span[^>]*>本社営業所<\/span>/);
  assert.equal(h.props.drivers[0].companyName, "Synthetic Company 本社営業所");
});

test("payment driver cards hide zero-only drivers and support live fuzzy name, reading and affiliation searches", async () => {
  const h = uiHarness();
  h.props.drivers = [driver, { ...driver, id: "inactive", name: "No wages" },
    { ...driver, id: "zero", name: "Zero" }, { ...driver, id: "advance", name: "立替のみ", reading: "TATEKAE" },
    { ...driver, id: "manual", name: "Adjustment only" }];
  h.props.rows.push({ ...row, driver: "Zero", totalWage: 0, percentageWage: 0, fixedWage: 0, overtimeFee: 0, bonusWage: 0, driverAdvances: 0 },
    { ...row, driver: "立替のみ", totalWage: 0, percentageWage: 0, fixedWage: 0, overtimeFee: 0, bonusWage: 0, driverAdvances: 100 });
  h.props.manualItems.push({ ...manual, id: "manual-only", driver: "Adjustment only", amount: -200 });
  assert.equal(h.label("支払運転士選択"), undefined);
  h.label("筛选司机").props.onClick();
  assert.equal(h.label("支払運転士選択").props.role, "dialog");
  assert.equal(h.label("支払運転士選択").props["aria-modal"], "true");
  const picker = renderToStaticMarkup(h.label("支払運転士選択"));
  assert.doesNotMatch(picker, /¥|Synthetic Company|未设置会社|名 ·/);
  for (const name of [driver.name, "立替のみ", "Adjustment only"]) {
    const text = walk(h.label(`支払運転士：${name}`)).filter(node => node.type === "span").map(node => node.props.children);
    assert.deepEqual(text, [name]);
  }
  assert.equal(h.label("支払運転士：No wages"), undefined);
  assert.equal(h.label("支払運転士：Zero"), undefined);
  assert.ok(h.label("支払運転士：立替のみ"));
  assert.ok(h.label("支払運転士：Adjustment only"));
  if (process.env.PAYMENT_CARDS_LAYOUT_FILE) {
    const cssDir = path.join(root, ".next\\static\\chunks");
    const css = readdirSync(cssDir).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(cssDir, file), "utf8")).join("\n");
    writeFileSync(process.env.PAYMENT_CARDS_LAYOUT_FILE, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><main class="dashboard">${renderToStaticMarkup(h.render())}</main>`);
  }
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /<select[^>]*aria-label="支払運転士"/);
  h.label("搜索支払運転士").props.onChange({ target: { value: "ＴＡＴＥ synthetic" } });
  assert.ok(h.label("支払運転士：立替のみ"));
  assert.equal(h.label(`支払運転士：${driver.name}`), undefined);
  h.label("支払運転士：立替のみ").props.onClick();
  assert.equal(h.label("支払運転士選択"), undefined);
  h.label("筛选司机").props.onClick();
  assert.equal(h.label("支払運転士：立替のみ").props["aria-pressed"], true);
  h.label("关闭司机筛选").props.onClick();
  await h.button("批量下载請求書（选择文件夹）").props.onClick();
  await new Promise(done => setImmediate(done));
  assert.equal(h.downloads[0].invoices.length, 1);
  assert.equal(h.downloads[0].invoices[0].driver.name, "立替のみ");
  h.label("筛选司机").props.onClick();
  h.label("搜索支払運転士").props.onChange({ target: { value: "no match" } });
  assert.match(renderToStaticMarkup(h.render()), /没有匹配的運転士/);
  h.label("关闭司机筛选").props.onClick();
  await h.button("批量下载請求書（选择文件夹）").props.onClick();
  await new Promise(done => setImmediate(done));
  assert.equal(h.downloads[1].invoices[0].driver.name, "立替のみ");
  h.label("筛选司机").props.onClick();
  h.label("搜索支払運転士").props.onChange({ target: { value: "" } });
  assert.ok(h.label(`支払運転士：${driver.name}`));
  h.label(`支払運転士：${driver.name}`).props.onClick();
  h.label("支払月份").props.onChange({ target: { value: "12" } });
  h.label("筛选司机").props.onClick();
  assert.equal(h.label(`支払運転士：${driver.name}`).props["aria-pressed"], false);
});

test("payment year and month selectors retain the other component and use the shared month-change flow", () => {
  const h = uiHarness(), changes = [];
  h.props.onMonthChange = value => changes.push(value);
  assert.equal(h.label("支払年份").props.value, "2026");
  assert.equal(h.label("支払月份").props.value, "11");
  h.label("支払年份").props.onChange({ target: { value: "2027" } });
  assert.deepEqual(changes, ["2027-11"]);
  h.props.month = "2027-11";
  h.label("支払月份").props.onChange({ target: { value: "01" } });
  assert.deepEqual(changes, ["2027-11", "2027-01"]);
  h.props.month = "2019-12";
  assert.match(renderToStaticMarkup(h.label("支払年份")), /value="2019" selected/);
  assert.equal(React.Children.toArray(h.label("支払月份").props.children).length, 12);
});

test("staff payment view adds signed shared items, waits for confirmation and exports selected payer", async () => {
  const h = uiHarness();
  assert.match(renderToStaticMarkup(h.render()), /支付総額/);
  h.label("支払付款会社").props.onChange({ target: { value: company.name } });
  h.label("筛选司机").props.onClick();
  h.label(`支払運転士：${driver.name}`).props.onClick();
  h.button("＋ 手動项目").props.onClick();
  h.label("支払项目名称").props.onChange({ target: { value: "  Deduction  " } });
  h.label("支払项目金额").props.onChange({ target: { value: "-1000" } });
  await walk(h.render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  await new Promise(done => setImmediate(done));
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].amount, -1000);
  assert.equal(h.saves[0].name, "Deduction");
  assert.equal(h.saves[0].companyName, company.name);
  assert.equal(h.saves[0].regionId, "tokyo");
  assert.equal(h.label("支払项目名称").props.value, "");
  const pdf = h.button("PDF");
  await pdf.props.onClick();
  await new Promise(done => setImmediate(done));
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].invoices[0].summary.total, 10000);
});

test("payment view rejects empty amounts, preserves failed edits and gates unscoped/pending exports", async () => {
  const h = uiHarness({ confirmed: false });
  h.label("支払付款会社").props.onChange({ target: { value: company.name } });
  h.label("筛选司机").props.onClick();
  h.label(`支払運転士：${driver.name}`).props.onClick();
  h.button("＋ 手動项目").props.onClick();
  h.label("支払项目名称").props.onChange({ target: { value: "Keep on failure" } });
  walk(h.render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  await new Promise(done => setImmediate(done));
  assert.equal(h.saves.length, 0);
  h.label("支払项目金额").props.onChange({ target: { value: "-123" } });
  walk(h.render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  await new Promise(done => setImmediate(done));
  assert.equal(h.label("支払项目金额").props.value, "-123");
  assert.match(renderToStaticMarkup(h.render()), /项目保存未获确认/);
  h.props.regionId = null;
  await h.button("PDF").props.onClick();
  await new Promise(done => setImmediate(done));
  assert.equal(h.downloads.length, 0);
  assert.match(renderToStaticMarkup(h.render()), /具体地域/);
  h.props.pendingSave = true;
  assert.equal(h.button("PDF").props.disabled, true);
  const readonly = uiHarness({ canEdit: false });
  assert.equal(readonly.button("＋ 手動项目").props.disabled, true);
});

test("payment arithmetic errors are visible rather than an empty success-shaped table", () => {
  const h = uiHarness();
  h.props.rows = [{ ...row, totalWage: 9999 }];
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /role="alert"/);
  assert.match(html, /报酬分项与支付数据不一致/);
  assert.doesNotMatch(html, /本月暂无支付记录/);
});

test("salary detail button opens scoped daily wages and signed manual items, including for read-only staff", () => {
  const h = uiHarness({ canEdit: false });
  assert.equal(h.button("项目"), undefined);
  assert.equal(h.button("給料明細").props.disabled, false);
  h.button("給料明細").props.onClick();
  h.props.rows = [...h.props.rows, { ...row, regionId: "osaka", company: "Other payer", customer: "Other payer order" }];
  const detail = walk(h.render()).find(node => node.props["aria-labelledby"] === "payment-wage-title");
  assert.ok(detail);
  const html = renderToStaticMarkup(detail);
  for (const text of ["給料明細", driver.name, company.name, "每日給料明細", row.serviceDate, row.customer,
    manual.name, "¥-500", "¥10,000", "¥9,000", "¥1,000"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Other payer order/);
  assert.equal(h.button("手動项目").props.disabled, true);
  h.props.manualItems = [{ ...manual, amount: -200 }];
  assert.match(renderToStaticMarkup(h.render()), /¥10,300/);
  h.label("关闭給料明細").props.onClick();
  assert.equal(walk(h.render()).some(node => node.props["aria-labelledby"] === "payment-wage-title"), false);
});

test("salary details retain a row-specific manual editor and handle manual-only drivers", () => {
  const h = uiHarness();
  h.props.rows = [];
  h.button("給料明細").props.onClick();
  assert.match(renderToStaticMarkup(h.render()), /本月暂无每日工資记录/);
  assert.match(renderToStaticMarkup(h.render()), /¥-500/);
  h.button("手動项目").props.onClick();
  assert.ok(h.label("支払项目名称"));
  const editor = walk(h.render()).find(node => node.props["aria-labelledby"] === "payment-items-title");
  assert.match(renderToStaticMarkup(editor), /Synthetic Driver/);
  h.label("关闭手動项目").props.onClick();
  assert.ok(h.label("关闭給料明細"));
  h.label("支払月份").props.onChange({ target: { value: "2026-12" } });
  assert.equal(h.label("关闭給料明細"), undefined);
});

test("manual editing preserves the original salary company while new items use driver affiliation", async () => {
  const h = uiHarness();
  h.props.manualItems = [{ ...manual, companyName: "Historical payer" }];
  h.button("給料明細").props.onClick();
  h.button("手動项目").props.onClick();
  h.button("编辑").props.onClick();
  h.label("支払项目金额").props.onChange({ target: { value: "-123" } });
  walk(h.render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  await new Promise(done => setImmediate(done));
  assert.equal(h.saves[0].companyName, "Historical payer");
  assert.equal(h.saves[0].id, manual.id);
  assert.match(renderToStaticMarkup(h.render()), /Synthetic Company/);
});

test("parent shared-item saves reject stale edits and synchronize salary drafts only after persistence succeeds", async () => {
  const source = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler, monthHandler;
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "DriverPayments") {
      handler = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "onSaveItem")
        .initializer.expression.getText(ast);
      monthHandler = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "onMonthChange")
        .initializer.expression.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(handler);
  const context = {
    currentProfile: { role: "admin" }, activeRegionId: "tokyo", driverWageItemsMigrationPending: false,
    requireSpecificRegionForNewData: () => true,
    allDriverWageItems: [{ ...manual }], driverWageItemDrafts: [{ id: manual.id, editing: false, name: manual.name, amount: String(manual.amount) }],
    selectedDriverFinanceDriver: driver.name, financeMonth: month, driverFinanceCompanyFilter: "",
    driverWageItemCompanyName: "", createId: () => "generated", waitForDriverWageItems: async () => true,
    setDriverWageItems: update => { context.allDriverWageItems = update(context.allDriverWageItems); },
    setDriverWageItemDrafts: update => { context.driverWageItemDrafts = typeof update === "function" ? update(context.driverWageItemDrafts) : update; },
    window: { confirm: () => false },
    setFinanceMonth: value => { context.financeMonth = value; },
    setDriverFinanceDriverFilter: value => { context.selectedDriverFinanceDriver = value; },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`globalThis.saveItem = ${handler}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  assert.equal(await context.saveItem({ ...manual, name: "Updated", amount: -200 }), true);
  assert.equal(context.allDriverWageItems[0].amount, -200);
  assert.equal(context.driverWageItemDrafts[0].amount, "-200");
  await assert.rejects(context.saveItem({ ...manual, id: "missing" }), /不存在/);
  context.driverWageItemDrafts[0].editing = true;
  await assert.rejects(context.saveItem(manual), /未保存/);
  assert.equal(context.allDriverWageItems[0].amount, -200);
  assert.equal(await context.saveItem({ ...manual, id: undefined, amount: 100 }), true);
  assert.equal(context.driverWageItemDrafts.find(item => item.id === manual.id).editing, true);
  assert.equal(context.driverWageItemDrafts.find(item => item.id === "generated").amount, "100");
  context.waitForDriverWageItems = async () => false;
  const draftsBefore = JSON.stringify(context.driverWageItemDrafts);
  assert.equal(await context.saveItem({ ...manual, id: "generated", amount: 400 }), false);
  assert.equal(JSON.stringify(context.driverWageItemDrafts), draftsBefore);
  context.currentProfile.role = "user";
  await assert.rejects(context.saveItem(manual), /无权/);
  vm.runInContext(ts.transpileModule(`globalThis.changeMonth = ${monthHandler}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  context.changeMonth("2026-12");
  assert.equal(context.financeMonth, month);
  assert.equal(JSON.stringify(context.driverWageItemDrafts), draftsBefore);
  context.window.confirm = () => true;
  context.changeMonth("2026-12");
  assert.equal(context.financeMonth, "2026-12");
  assert.equal(context.selectedDriverFinanceDriver, "");
  assert.equal(context.driverWageItemDrafts.length, 0);
});

test("preview is sandboxed and payment management is directly after salary statistics with shared persistence", () => {
  const h = uiHarness();
  h.button("预览").props.onClick();
  const frame = walk(h.render()).find(node => node.type === "iframe");
  assert.equal(frame.props.sandbox, "");
  assert.match(frame.props.srcDoc, /請求書/);
  const source = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.match(source, /id: "driverFinance", label: "給料統計"[\s\S]*?id: "driverPayments", label: "支払管理"/);
  const start = source.indexOf('{activeView === "driverPayments"');
  const end = source.indexOf('{activeView === "vehicleFinance"', start);
  const panel = source.slice(start, end);
  assert.match(panel, /buildCompanyDriverFinanceDetails\(monthlyFinanceOrders, ""\)/);
  assert.match(panel, /manualItems=\{driverWageItems\}/);
  assert.match(panel, /setDriverWageItems/);
  assert.match(panel, /await waitForDriverWageItems/);
  assert.match(panel, /deleteDriverWageItem\(item\)/);
  assert.match(panel, /onMonthChange=\{month => \{[\s\S]*?window.confirm[\s\S]*?setDriverFinanceDriverFilter\(""\);[\s\S]*?setDriverWageItemDrafts\(\[\]\);/);
});
