import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function loadEraEditor(file) {
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: file,
  }).outputText, {
    module: compiled, exports: compiled.exports,
    require: name => name === "@/lib/japanese-era-date" ? loadEraEditor("lib\\japanese-era-date.ts") : require(name),
  });
  return compiled.exports;
}
const root = fileURLToPath(new URL("..", import.meta.url));
const { JapaneseEraDateInput } = loadEraEditor("components\\japanese-era-date-input.tsx");
const source = readFileSync(path.join(root, "app\\page.tsx"), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dialogs = new Map();
function visit(node) {
  if (ts.isJsxElement(node)) {
    const attr = node.openingElement.attributes.properties.find(prop =>
      ts.isJsxAttribute(prop) && prop.name.getText(ast) === "aria-labelledby");
    if (attr?.initializer && ts.isStringLiteral(attr.initializer)) dialogs.set(attr.initializer.text, node);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const editorTitles = ["order-form-title", "batch-order-form-title", "vehicle-form-title", "source-form-title",
  "company-form-title", "company-seal-title", "batch-add-title", "accounting-preview-title",
  "invoice-status-dialog-title", "order-merge-title", "order-details-title"];

test("application deletion wording consistently uses the Japanese label", () => {
  function check(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) check(filename);
      else if (/\.(ts|tsx)$/.test(entry.name))
        assert.ok(!readFileSync(filename, "utf8").includes("\u5220\u9664"), filename);
    }
  }
  for (const directory of ["app", "components", "lib"]) check(path.join(root, directory));
  assert.ok(source.includes("\u524a\u9664"));
});

test("all dashboard edit surfaces use wide, accessible and scrollable editor shells", () => {
  for (const id of editorTitles) {
    const dialog = dialogs.get(id); assert.ok(dialog, id);
    const opening = dialog.openingElement.getText(ast);
    assert.match(opening, /role="dialog"/, id);
    assert.match(opening, /aria-modal="true"/, id);
    assert.match(opening, /editor-dialog/, id);
    assert.match(opening, /overflow-y-auto/, id);
    assert.doesNotMatch(opening, /max-w-(?:md|lg|xl)\b/, id);
    assert.match(dialog.getText(ast), /dialog-floating-header/, id);
  }
  for (const id of ["order-form-title", "batch-order-form-title", "vehicle-form-title", "source-form-title", "company-form-title"])
    assert.match(dialogs.get(id).getText(ast), /className="editor-fields/, id);
  const account = readFileSync(path.join(root, "components\\driver-login-fields.tsx"), "utf8");
  assert.doesNotMatch(account, /driver-mobile-dialog max-h[^"]*max-w-md/);
  const reports = readFileSync(path.join(root, "components\\operations-report-editor.module.css"), "utf8");
  assert.match(reports, /width:min\(1200px,96vw\)/);
});

test("source list hides contact details and address without removing their editor fields", () => {
  const start = source.indexOf('<table className="management-table source-management-table');
  const table = source.slice(start, source.indexOf("</table>", start) + "</table>".length);
  assert.ok(start > 0);
  assert.equal((table.match(/<col className=/g) || []).length, 5);
  assert.doesNotMatch(table, /source\.(contactInfo|address)|連絡先|地址/);
  const editor = dialogs.get("source-form-title").getText(ast);
  assert.match(editor, /value=\{sourceForm.contactInfo\}/);
  assert.match(editor, /value=\{sourceForm.address\}/);
  const context = { require, exports: {}, sourceRows: [{ id: "test-source", companyName: "Example source",
    shortName: "Example", contactName: "Contact", contactInfo: "HIDDEN-CONTACT", address: "HIDDEN-ADDRESS" }],
    SourceColorPicker: () => React.createElement("button", {}, "选颜色"), updateSourceColor() {},
    openEditSource() {}, deleteSource() {} };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`globalThis.render = () => (${table});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  const html = renderToStaticMarkup(context.render());
  assert.equal((html.match(/<th /g) || []).length, 5);
  assert.equal((html.match(/<td /g) || []).length, 5);
  assert.doesNotMatch(html, /HIDDEN-CONTACT|HIDDEN-ADDRESS/);
  assert.match(html, /Example source/);
  context.sourceRows = [];
  assert.match(renderToStaticMarkup(context.render()), /colSpan="5"/i);
});

test("management and finance lists share source panel styling without changing columns", () => {
  const expected = new Set(["drivers", "vehicles", "sources", "companies", "order-finance",
    "driver-finance", "vehicle-summary", "vehicle-finance", "balance", "balance-items", "reservations"]);
  const found = new Set();
  function inspect(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "table") {
      const attr = node.openingElement.attributes.properties.find(prop =>
        ts.isJsxAttribute(prop) && prop.name.getText(ast) === "data-table");
      const id = attr?.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : "";
      if (expected.has(id)) {
        let parent = node.parent;
        let panel = false;
        while (parent) {
          if (ts.isJsxElement(parent) && /className="[^"]*\blist-panel\b/.test(parent.openingElement.getText(ast))) panel = true;
          parent = parent.parent;
        }
        assert.ok(panel, id);
        found.add(id);
      }
    }
    ts.forEachChild(node, inspect);
  }
  inspect(ast);
  assert.deepEqual(found, expected);
  const css = readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.match(css, /\.list-panel\s*\{[^}]*border-radius: 16px/);
  assert.match(css, /tr:not\(\[class\*="bg-"\]\):hover/);
  const reports = readFileSync(path.join(root, "components\\operations-reports.tsx"), "utf8");
  assert.match(reports, /className="list-panel operations-report-table-region/);
  assert.match(css, /:is\(\.reservation-list-table, \.operations-report-table\) tbody tr:hover/);
});

function render(id, overrides = {}) {
  const noop = () => {};
  const vehicle = { id: "vehicle", name: "Alphard", plate: "1234", ownerCompany: "测试会社", seats: "7",
    fuelType: "汽油", inspectionExpiry: "", liabilityExpiry: "", notes: "车辆资料示例", status: "运营中",
    defaultParkingFee: 0, defaultInsuranceFee: 0 };
  const form = { id: "order", date: "2026-11-12", endDate: "2026-11-13", offDates: [], customer: "预约示例",
    vehicle: vehicle.name, vehiclePlate: vehicle.plate, driver: "", financeByDate: {}, status: "仮予約",
    company: "测试会社", orderSource: "", time: "09:30", pickup: "羽田机场", destination: "東京站", notes: "" };
  const context = {
    require, exports: {}, dialogSaving: false, orders: [form],
    editingOrderId: "order", form, customCompanyMode: false, offDateInput: "",
    orderSourceShortNameByRegion: new Map(), orderFormVehicles: [vehicle], orderFormAvailableVehicles: [vehicle.name],
    orderFormVehicleAvailableByName: new Map([[vehicle.name, true]]), companies: ["测试会社"],
    getRegionForNewRecords: () => "region", getOrderDateKeys: () => ["2026-11-12", "2026-11-13"],
    getReservationFinance: () => ({}), emptyOrderFinance: { driverPaymentType: "wage" },
    getServiceDriver: () => "", allDriverRecords: [], allOrders: [], todayDateKey: "2026-11-12",
    getVehicleDisplayStatus: () => "运营中", formatOrderDate: value => value,
    isOutsourcedVehicle: () => false, vehicleNameMode: vehicle.name, MANUAL_VEHICLE_NAME: "__manual__",
    vehicleForm: vehicle, editingVehicleName: vehicle.name, editingVehicleId: "vehicle",
    companyRecords: [{ id: "company", name: "测试会社" }], fuelTypes: ["汽油", "柴油"],
    sourceForm: { companyName: "来源示例", shortName: "", color: "#2563eb", contactName: "担当", contactInfo: "", address: "" },
    editingSourceName: "来源示例",
    companyForm: { name: "测试会社", operationsManager: "", maintenanceManager: "", phone: "",
      rollCallAddress: "", garageAddress: "", bankAccount: "", taxRegistrationNumber: "", sealImage: "" },
    editingCompanyName: "测试会社", companySealBusy: false,
    batchOrderDate: form.date, batchOrderVehicle: "vehicle", availableVehicleRecords: [vehicle],
    batchOrderStatus: "仮予約", batchOrderDriver: "", batchOrderSource: "", batchOrderCustomCompanyMode: false,
    batchOrderCompany: "测试会社", batchOrderInput: "", batchAddType: "drivers", batchInput: "",
    sealCompany: { name: "测试会社" }, sealDraft: "", sealUploadBusy: false,
    mergeTarget: form, mergeCandidates: [{ ...form, id: "merge-order" }], mergeSourceId: "",
    invoiceStatusDialog: { kind: "invoice", status: "未完成", scope: "single", month: "2026-11" },
    invoiceStatusDialogOrder: form, isInvoiceStatusDialogSaving: false, invoiceStatusDialogSingleTargets: [form],
    invoiceStatusDialogSourceTargets: [form], invoiceStatusDialogChangedCount: 1,
    flightTrackingEnabled: true,
    LastOperation: () => null,
    JapaneseEraDateInput,
    VehicleNameSelect: () => React.createElement("label", {}, "車名", React.createElement("input", { defaultValue: "Alphard" })),
    OrderVehiclePlateSelect: () => React.createElement("label", {}, "車両番号", React.createElement("select", {}, React.createElement("option", {}, "1234"))),
    FinanceDriverSelect: () => React.createElement("div", {}, React.createElement("label", {}, "当日運転士",
      React.createElement("button", { type: "button" }, "未安排運転士 · 点击選任"))),
    CompanySealUpload: () => React.createElement("div", { className: "rounded border p-3" },
      React.createElement("label", {}, "会社印章", React.createElement("input", { type: "file" }))),
    ...overrides,
  };
  for (const name of ["closeForm", "addOrder", "deleteOrder", "saveVehicle", "saveSource", "saveCompany",
    "saveCompanySeal", "setSealCompany", "setSealDraft", "setSealUploadBusy", "setShowBatchOrderForm",
    "importBatchOrders", "setBatchAddType", "setBatchInput", "saveBatchAdd", "setMergeOrderId", "setMergeSourceId",
    "requestOrderMerge", "setInvoiceStatusDialog", "saveInvoiceStatusDialog", "setCompanySealBusy"])
    context[name] ??= noop;
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`globalThis.render = () => (${dialogs.get(id).getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return renderToStaticMarkup(context.render());
}

test("expanded forms retain their fields, full-width notes and existing save controls", () => {
  for (const [id, expected] of [
    ["order-form-title", ["每日行程与車費", "2026-11-12", "2026-11-13", "保存修改"]],
    ["batch-order-form-title", ["预约信息", "生成訂単"]],
    ["vehicle-form-title", ["駐車場料金", "保険料", "車両番号", "保存車両"]],
    ["source-form-title", ["来源颜色", "連絡先", "保存来源"]],
    ["company-form-title", ["振込口座", "T番号", "保存会社"]],
    ["company-seal-title", ["会社印章", "保存印章"]],
    ["batch-add-title", ["保存批量内容"]],
    ["invoice-status-dialog-title", ["变更范围", "确认变更"]],
    ["order-merge-title", ["合并拆分订单", "确认合并"]],
  ]) {
    const markup = render(id);
    for (const text of expected) assert.ok(markup.includes(text), `${id}: ${text}`);
  }
});

test("account editing uses a native modal with inline feedback and independent password actions", () => {
  const dialog = dialogs.get("account-editor-title");
  assert.ok(dialog);
  assert.equal(dialog.openingElement.tagName.getText(ast), "dialog");
  const markup = dialog.getText(ast);
  assert.match(markup, /node\.showModal\(\)/);
  assert.match(markup, /onCancel=[\s\S]*?event\.preventDefault\(\);[\s\S]*?closeLoginAccountForm\(\)/);
  for (const editingLoginAccountId of [null, "account"]) {
    const html = render("account-editor-title", {
      editingLoginAccountId, accountBusy: false, accountError: "Test save error", accountMessage: "",
      loginAccountForm: { fullName: "Example", email: "example@example.invalid", company: "Example company",
        position: "役員", regionId: "region", role: "admin" },
      allCompanyRecords: [{ name: "Example company" }], regions: [{ id: "region", name: "東京" }],
      currentProfile: { id: "account" }, LOGIN_ACCOUNT_POSITIONS: ["役員"],
      accountPassword: "", accountPasswordConfirmation: "",
      closeLoginAccountForm() {}, saveLoginAccount() {}, setLoginAccountPassword() {},
    });
    for (const label of ["用户姓名", "登录邮箱", "所属会社", "职位", "管理地域", "角色",
      "登录安全", "确认密码", "关闭账号编辑", "Test save error"]) {
      assert.ok(html.includes(label), label);
    }
    assert.match(html, /role="alert"/);
    assert.match(html, /type="submit"/);
    assert.equal(html.includes("设置新密码"), editingLoginAccountId !== null);
    assert.ok(html.includes(editingLoginAccountId === null ? "创建账号" : "保存資料"));
  }
  const css = readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.match(css, /\.login-management \.account-editor-dialog::backdrop/);
  assert.match(css, /\.login-management \.account-editor-dialog\s*\{[^}]*max-height:[^}]*overflow-y: auto;/);
});

test("closing the account modal clears credentials and is blocked during saving", () => {
  const start = source.indexOf("  function closeLoginAccountForm()");
  const handler = source.slice(start, source.indexOf("  function openLoginAccountForm(", start));
  for (const accountBusy of [false, true]) {
    const updates = {};
    const context = { accountBusy };
    for (const key of ["AccountPassword", "AccountPasswordConfirmation", "AccountError", "AccountMessage",
      "ShowLoginAccountForm", "EditingLoginAccountId"]) {
      context[`set${key}`] = value => { updates[key] = value; };
    }
    vm.runInNewContext(handler + "\ncloseLoginAccountForm();", context);
    assert.deepEqual(updates, accountBusy ? {} : {
      AccountPassword: "", AccountPasswordConfirmation: "", AccountError: "", AccountMessage: "",
      ShowLoginAccountForm: false, EditingLoginAccountId: null,
    });
  }
});

test("new and edited orders keep the requested field order in the rendered form", () => {
  for (const editingOrderId of [null, "order"]) {
    const markup = render("order-form-title", { editingOrderId });
    const fields = ["訂単名称", "来源", "予約状態", "开始日期", "終了日期", "休運日期", "車両", "車両番号"];
    let previous = -1;
    for (const field of fields) {
      const position = markup.indexOf(`>${field}<`);
      assert.ok(position > previous, `${field} must follow the preceding field`);
      previous = position;
    }
  }
  const css = readFileSync(path.join(root, "app\\globals.css"), "utf8");
  assert.match(css, /@media \(min-width: 801px\)\s*\{\s*\.editor-fields--order\s*\{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
});

test("desktop and mobile modal preview uses production CSS and actual editor markup", () => {
  if (!process.env.EDITOR_LAYOUT_FILE) return;
  const cssDir = path.join(root, ".next\\static\\chunks");
  const css = readdirSync(cssDir).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(cssDir, file), "utf8")).join("\n");
  const ids = editorTitles.filter(id => id !== "accounting-preview-title" && id !== "order-details-title");
  const html = ids.map(id => `<main class="dashboard preview-screen" id="${id}"><div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">${render(id)}</div></main>`).join("");
  writeFileSync(process.env.EDITOR_LAYOUT_FILE, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n.preview-screen{display:none}.preview-screen:target{display:block}</style>${html}`);
});
