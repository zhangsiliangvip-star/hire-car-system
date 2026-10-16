import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const nodeRequire = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function load(relative, mocks = {}, globals = {}) {
  const filename = path.join(root, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(output, {
    exports: compiledModule.exports, module: compiledModule,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : nodeRequire(name),
    console: { error() {}, warn() {} }, URL, URLSearchParams, Date, Intl, AbortController,
    ...globals,
  }, { filename });
  return compiledModule.exports;
}
const audit = load("lib\\audit.ts");
const id = "70000000-0000-4000-8000-000000000001";
const region = "60000000-0000-4000-8000-000000000001";
const operation = { actorId: id, actorName: "Test Operator", at: "2026-10-15T18:00:00Z" };
const plain = (value) => JSON.parse(JSON.stringify(value));

test("vehicle statistics filter displays plates instead of vehicle names", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const start = source.indexOf("value={vehicleFinanceVehicleFilter}", source.indexOf("导出车辆财务表（A4）"));
  assert.ok(start !== -1);
  const filter = source.slice(start, source.indexOf("</select>", start));
  assert.ok(filter.includes("全部車両番号"));
  assert.ok(filter.includes('{vehicle.plate || "未登记番号"}'));
  assert.ok(!/>\s*\{vehicle\.name\}\s*<\/option>/.test(filter));
  assert.ok(filter.includes("value={vehicle.name}"));
});

test("order conflicts cover editing, multi-day ranges, and close departure times", () => {
  const { findOrderConflicts } = load("lib\\order-conflicts.ts");
  const base = { regionId: "r1", vehicle: "Alphard", status: "確定", offDates: [] };
  const orders = [
    { ...base, id: 1, date: "2026-10-01", endDate: "2026-10-01", time: "09:00" },
    { ...base, id: 2, date: "2026-10-03", endDate: "2026-10-05", time: "08:00", offDates: ["2026-10-04"] },
    { ...base, id: 3, date: "2026-10-01", endDate: "2026-10-01", time: "09:30", status: "キャンセル" },
    { ...base, id: 4, date: "2026-10-01", endDate: "2026-10-01", time: "09:30", vehicle: "Other" },
  ];
  const ids = (draft, excludeId) =>
    [...findOrderConflicts({ ...base, ...draft }, orders, excludeId)].map(({ order }) => order.id);

  assert.deepEqual(ids({ date: "2026-10-01", endDate: "2026-10-01", time: "10:30" }), [1]);
  assert.deepEqual(ids({ date: "2026-10-01", endDate: "2026-10-01", time: "11:00" }), []);
  assert.deepEqual(ids({ date: "2026-10-01", endDate: "2026-10-01", time: "09:10" }, 1), []);
  assert.deepEqual(ids({ date: "2026-10-05", endDate: "2026-10-05", time: "20:00" }), [2]);
  assert.deepEqual(ids({ date: "2026-10-04", endDate: "2026-10-04", time: "08:00" }), []);
  assert.deepEqual(ids({ date: "2026-09-30", endDate: "2026-10-03", time: "07:00" }), [1, 2]);
  assert.deepEqual(ids({ date: "2026-10-01", endDate: "2026-10-01", time: "10:00", regionId: "r2" }), []);

  const driverOrders = [
    { ...base, id: 10, vehicle: "Car A", driver: "Tanaka", date: "2026-11-01", endDate: "2026-11-01", time: "09:00" },
    { ...base, id: 11, vehicle: "Car B", driver: "Sato", date: "2026-11-02", endDate: "2026-11-03", time: "08:00",
      financeByDate: { "2026-11-03": { driver: "Tanaka", vehicle: "Car B" } } },
  ];
  const driverConflicts = (draft, excludeId) =>
    JSON.parse(JSON.stringify(findOrderConflicts({ ...base, vehicle: "Car C", ...draft }, driverOrders, excludeId)));
  const sameDriver = driverConflicts({ driver: " Tanaka ", date: "2026-11-01", endDate: "2026-11-01", time: "10:00" });
  assert.deepEqual(sameDriver.map(({ order, reasons, drivers }) => [order.id, reasons, drivers]), [[10, ["driver"], ["Tanaka"]]]);
  assert.deepEqual(driverConflicts({ driver: "Tanaka", date: "2026-11-01", endDate: "2026-11-01", time: "12:00" }), []);
  assert.deepEqual(driverConflicts({ driver: "Tanaka", date: "2026-11-01", endDate: "2026-11-01", time: "09:30" }, 10), []);
  assert.deepEqual(driverConflicts({ driver: "", date: "2026-11-01", endDate: "2026-11-01", time: "09:00" }), []);
  assert.deepEqual(driverConflicts({ driver: "Tanaka", date: "2026-11-03", endDate: "2026-11-03", time: "20:00" }).map(({ order }) => order.id), [11]);
  assert.deepEqual(driverConflicts({ driver: "Sato", date: "2026-11-03", endDate: "2026-11-03", time: "20:00" }), []);
  const both = findOrderConflicts({ ...base, vehicle: "Car A", driver: "Tanaka", date: "2026-11-01", endDate: "2026-11-01", time: "09:00" }, driverOrders);
  assert.deepEqual([...both[0].reasons], ["vehicle", "driver"]);

  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("if (!skipConflictCheck) {"));
  assert.ok(source.includes("司机重复："));
  assert.ok(source.indexOf("{ ...savedForm, regionId: targetRegionId }") > source.indexOf("const savedForm: OrderDraft"));
  assert.ok(!source.includes("if (editingOrderId === null && !skipConflictCheck)"));
});

test("calendar rows use each vehicle record's own plate and flag duplicate names", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("filteredCalendarVehicleRecords.map((vehicleRecord) =>"));
  assert.ok(!source.includes("filteredCalendarVehicles"));
  assert.ok(source.includes("key={vehicleRecord.id}"));
  assert.ok(source.includes("order.regionId === vehicleRecord.regionId"));
  const label = source.slice(source.indexOf('const plate = vehicleRecord.plate || "未登记番号"'));
  assert.ok(label.indexOf('copyCalendarVehicleField(plate, "車両番号")') < label.indexOf('copyCalendarVehicleField(vehicle, "車名")'));
  assert.ok(!source.includes("vehicleRecords.find(\n                      (record) => record.name === vehicle"));
  assert.ok(source.includes("⚠ 车名重复"));
  assert.ok(source.includes("同一地域已有车名"));
  assert.ok(source.includes("同一地域内車名不能重复"));
  assert.ok(source.includes("!oldNameStillUsed"));
});

test("accounting assignees display names without falling back to emails", () => {
  const { getAccountingAssigneeName } = load("lib\\accounting-assignee.ts");
  const accounts = [
    { email: "named@example.com", fullName: "Named User" },
    { email: "unnamed@example.com", fullName: "  " },
  ];
  assert.equal(getAccountingAssigneeName("NAMED@example.com", accounts), "Named User");
  assert.equal(getAccountingAssigneeName("unnamed@example.com", accounts), "未填写姓名");
  assert.equal(getAccountingAssigneeName("deleted@example.com", accounts), "历史账号（姓名不可用）");
  assert.equal(getAccountingAssigneeName("Historical Name", accounts), "Historical Name");
  assert.equal(getAccountingAssigneeName("", accounts), "");
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("getAccountingAssigneeName(order.accountingAssignee"));
  assert.ok(!source.includes("`${account.fullName}（${account.email}）`"));
});

test("finance driver dropdown includes new drivers regardless of current name and scopes to order region", () => {
  const { FinanceDriverSelect } = load("components\\finance-driver-select.tsx");
  const drivers = [
    { id: "a", name: "Existing Driver", regionId: region },
    { id: "b", name: "Other Region", regionId: "other" },
  ];
  const changes = [];
  const render = (value, regionId = region) => FinanceDriverSelect({
    drivers, regionId, value, onChange: (name) => changes.push(name),
  });
  let html = renderToStaticMarkup(render("Existing Driver"));
  assert.ok(!html.includes("New Driver"));
  drivers.push({ id: "new", name: "New Driver", regionId: region });
  const tree = render("Existing Driver");
  html = renderToStaticMarkup(tree);
  assert.ok(html.includes('<option value="New Driver">New Driver</option>'));
  assert.ok(!html.includes("Other Region"));
  assert.ok(!html.includes("datalist"));
  const [selectLabel, inputLabel] = React.Children.toArray(tree.props.children);
  const select = React.Children.toArray(selectLabel.props.children).find((node) => node.type === "select");
  select.props.onChange({ target: { value: "New Driver" } });
  select.props.onChange({ target: { value: "" } });
  const input = React.Children.toArray(inputLabel.props.children).find((node) => node.type === "input");
  input.props.onChange({ target: { value: "Manual" } });
  assert.deepEqual(changes, ["New Driver", "", "Manual"]);
  assert.ok(renderToStaticMarkup(render("Historical")).includes("Historical（现有记录）"));
  assert.ok(!renderToStaticMarkup(render("", null)).includes('value="New Driver"'));
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("drivers={allDriverRecords}"));
  assert.ok(source.includes("regionId={accountingPreviewOrder.regionId}"));
  assert.ok(!source.includes("finance-drivers-"));
});

test("reservation plate selector links vehicles, retains unavailable selections and rejects ambiguous names", () => {
  const { OrderVehiclePlateSelect } = load("components\\order-vehicle-plate-select.tsx");
  const vehicles = [
    { id: "a", name: "Alphard 01", plate: "品川 100", status: "运营中" },
    { id: "b", name: "Hiace 01", plate: "品川 200", status: "运营中" },
    { id: "c", name: "外注其他", plate: "", status: "运营中" },
    { id: "d", name: "Tesla 01", plate: "品川 300", status: "停运中" },
  ];
  const changes = [];
  function render(name, records = vehicles, financeMode = false) {
    const tree = OrderVehiclePlateSelect({
      vehicles: records, vehicleName: name, getStatus: (vehicle) => vehicle.status,
      onSelect: (value) => changes.push(value),
      financeMode,
    });
    const nodes = [];
    function walk(node) {
      if (!node || typeof node !== "object") return;
      nodes.push(node);
      React.Children.toArray(node.props?.children).forEach(walk);
    }
    walk(tree);
    return {
      select: nodes.find((node) => node.type === "select"),
      options: nodes.filter((node) => node.type === "option"),
      html: renderToStaticMarkup(tree),
    };
  }
  let view = render("Alphard 01");
  assert.equal(view.select.props.value, "a");
  assert.equal(renderToStaticMarkup(view.options.find((option) => option.props.value === "a")),
    '<option value="a">品川 100</option>');
  view.select.props.onChange({ target: { value: "b" } });
  assert.deepEqual(changes, ["Hiace 01"]);
  assert.equal(render("Hiace 01").select.props.value, "b");
  assert.equal(render("外注其他").select.props.value, "");
  assert.ok(render("外注其他").html.includes("当前车辆未登记番号"));
  assert.ok(render("Deleted").html.includes("当前车辆未登记或已删除"));
  view = render("Tesla 01");
  assert.equal(view.select.props.value, "d");
  assert.equal(view.options.find((option) => option.props.value === "d").props.disabled, true);
  view.select.props.onChange({ target: { value: "d" } });
  view.select.props.onChange({ target: { value: "invalid" } });
  assert.equal(changes.length, 1);
  view = render("Alphard 01", [...vehicles, { ...vehicles[0], id: "duplicate", plate: "品川 400" }]);
  assert.equal(view.select.props.value, "");
  assert.ok(view.html.includes("车名重复"));
  view.select.props.onChange({ target: { value: "duplicate" } });
  assert.equal(changes.length, 1);
  assert.equal(render("", []).options.length, 1);
  view = render("Tesla 01", vehicles, true);
  assert.ok(view.html.includes("当日車両番号"));
  assert.ok(!view.html.includes("Tesla 01"));
  assert.equal(view.options.find((option) => option.props.value === "d").props.disabled, false);
  view.select.props.onChange({ target: { value: "d" } });
  assert.equal(changes.at(-1), "Tesla 01");
  view.select.props.onChange({ target: { value: "" } });
  assert.equal(changes.at(-1), "");
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes('editingOrderId === null ? getRegionForNewRecords() : form.regionId'));
  assert.ok(source.includes("vehicle.regionId === orderFormRegionId"));
  assert.ok(source.indexOf("<OrderVehiclePlateSelect") > source.indexOf("value={form.vehicle}"));
  assert.ok(source.includes("onSelect={(vehicle) => setForm((current) => ({ ...current, vehicle }))}"));
  assert.ok(source.includes("{getOrderVehicleNumber(accountingPreviewOrder)}"));
  assert.ok(source.includes("vehicle.regionId === accountingPreviewOrder.regionId"));
  assert.ok(!source.includes("finance-vehicles-"));
});

test("administrator password creation and reset enforce roles, validation and explicit failures", async () => {
  let profile = { id, role: "admin" };
  let target = { role: "user" };
  let targetError = null;
  let profileError = null;
  let profileExists = true;
  let authError = null;
  const calls = [];
  const logged = [];
  const password = "Test-only-pass-42";
  const admin = {
    auth: { admin: {
      createUser: async (input) => {
        calls.push(["create", input]);
        return { data: { user: authError ? null : { id } }, error: authError };
      },
      inviteUserByEmail: async (...input) => {
        calls.push(["invite", input]);
        return { data: { user: { id } }, error: null };
      },
      updateUserById: async (...input) => {
        calls.push(["password", input]);
        return { error: authError };
      },
    } },
    from(name) {
      assert.equal(name, "profiles");
      let updating = false;
      return {
        update(input) { updating = true; calls.push(["profile", input]); return this; },
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return updating
            ? { data: profileExists ? { id } : null, error: profileError }
            : { data: target, error: targetError };
        },
      };
    },
  };
  const route = load("app\\api\\admin\\accounts\\route.ts", {
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({ profile }) },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/api-response": { jsonResponse: (body, init) => Response.json(body, init) },
    "@/lib/supabase/pagination": {},
    "@/lib/delete-password": {},
  }, { Response, Request, console: { error: (...args) => logged.push(args) } });
  const request = (method, data) => new Request("http://localhost:3000/api/admin/accounts", {
    method, body: JSON.stringify(data),
  });
  const account = {
    email: "NEW@example.com", fullName: "New", company: "Company", position: "操作",
    regionId: region, role: "user", password,
  };
  for (const method of ["POST", "PUT"]) {
    for (const [identity, status] of [[null, 401], [{ role: "user" }, 403]]) {
      profile = identity;
      assert.equal((await route[method](request(method, method === "POST" ? account : { userId: id, password }))).status, status);
      assert.equal(calls.length, 0);
    }
  }
  profile = { id, role: "admin" };
  for (const invalid of ["short", "x".repeat(129)]) {
    assert.equal((await route.POST(request("POST", { ...account, password: invalid }))).status, 400);
    assert.equal((await route.PUT(request("PUT", { userId: id, password: invalid }))).status, 400);
  }
  const { password: omitted, ...withoutPassword } = account;
  assert.equal((await route.POST(request("POST", withoutPassword))).status, 400);
  assert.equal(calls.length, 0);
  let response = await route.POST(request("POST", account));
  assert.equal(response.status, 201);
  assert.ok(!(await response.text()).includes(password));
  const created = calls.find(([type]) => type === "create")[1];
  assert.equal(created.email, "new@example.com");
  assert.equal(created.email_confirm, true);
  assert.equal(created.password, password);
  assert.ok(!JSON.stringify(created.user_metadata).includes(password));
  assert.ok(!calls.some(([type]) => type === "invite"));
  assert.ok(!JSON.stringify(calls.find(([type]) => type === "profile")).includes(password));
  calls.length = 0;
  assert.equal((await route.POST(request("POST", { ...account, role: "admin" }))).status, 201);
  assert.ok(!calls.some(([type]) => type === "invite"));
  assert.ok(calls.some(([type]) => type === "create"));
  assert.equal(calls.find(([type]) => type === "profile")[1].role, "admin");
  calls.length = 0;
  for (const [record, status] of [[{ role: "admin" }, 403], [null, 404]]) {
    target = record;
    assert.equal((await route.PUT(request("PUT", { userId: id, password }))).status, status);
    assert.equal(calls.length, 0);
  }
  target = { role: "user" };
  targetError = { code: "42501" };
  response = await route.PUT(request("PUT", { userId: id, password }));
  assert.equal(response.status, 500);
  assert.ok((await response.json()).error.includes("42501"));
  assert.equal(calls.length, 0);
  targetError = null;
  response = await route.PUT(request("PUT", { userId: id, password }));
  assert.equal(response.status, 200);
  assert.deepEqual(plain(calls[0]), ["password", [id, { password, email_confirm: true }]]);
  assert.ok(!(await response.text()).includes(password));
  authError = { code: "weak_password", status: 422, message: password };
  assert.equal((await route.PUT(request("PUT", { userId: id, password }))).status, 400);
  assert.equal((await route.POST(request("POST", account))).status, 400);
  authError = null;
  profileError = { code: "42501", message: password };
  response = await route.POST(request("POST", account));
  assert.equal(response.status, 500);
  assert.ok((await response.json()).error.includes("账号已创建"));
  profileError = null;
  profileExists = false;
  assert.equal((await route.POST(request("POST", account))).status, 500);
  assert.ok(!JSON.stringify(logged).includes(password));
  const page = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(page.includes('method: "PUT"'));
  assert.ok(page.includes('type="password" autoComplete="new-password"'));
  assert.ok(page.includes("accountPassword !== accountPasswordConfirmation"));
  assert.ok(!fs.readFileSync(path.join(root, "app\\api\\admin\\accounts\\route.ts"), "utf8").includes("inviteUserByEmail"));
});

test("account creation distinguishes rate limits, existing users and database failures", async () => {
  let creationError;
  const { POST } = load("app\\api\\admin\\accounts\\route.ts", {
    "@/lib/supabase/authorization": {
      getAuthenticatedProfile: async () => ({ profile: { role: "admin" } }),
    },
    "@/lib/supabase/admin": {
      createAdminClient: () => ({
        auth: { admin: { createUser: async () => ({ data: { user: null }, error: creationError }) } },
      }),
    },
    "@/lib/api-response": { jsonResponse: (body, init) => Response.json(body, init) },
    "@/lib/supabase/pagination": {},
    "@/lib/delete-password": {},
  }, { Response, Request });
  for (const [error, status, text] of [
    [{ status: 429, code: "over_request_rate_limit" }, 429, "请勿连续重试"],
    [{ status: 422, code: "email_exists" }, 409, "该邮箱已注册"],
    [{ status: 500, message: "Database error saving new user" }, 500, "数据库错误"],
    [{ status: 500, code: "unexpected_failure", message: "Service unavailable" }, 502, "认证日志"],
  ]) {
    creationError = error;
    const response = await POST(new Request("http://localhost:3000/api/admin/accounts", {
      method: "POST",
      body: JSON.stringify({
        email: "new@example.com", fullName: "New User", company: "Company",
        position: "操作", regionId: region, role: "user", password: "Test-only-password",
      }),
    }));
    assert.equal(response.status, status);
    assert.ok((await response.json()).error.includes(text));
  }
});

test("vehicle-name options persist deletions, preserve selected names and restore defaults", () => {
  let saved = null;
  let failWrite = false;
  let confirmed = true;
  let selectedDeleted = 0;
  let stateIndex = 0;
  const states = [];
  const { VehicleNameSelect, DEFAULT_VEHICLE_NAME_OPTIONS, MANUAL_VEHICLE_NAME } = load(
    "components\\vehicle-name-select.tsx",
    {
      react: {
        useState(initial) {
          const index = stateIndex++;
          if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
          return [states[index], (next) => {
            states[index] = typeof next === "function" ? next(states[index]) : next;
          }];
        },
      },
    },
    { window: {
      localStorage: {
        getItem: () => saved,
        setItem(key, value) {
          assert.equal(key, "hire-car-system:vehicle-name-options");
          if (failWrite) throw new Error("Storage unavailable");
          saved = value;
        },
      },
      confirm: () => confirmed,
    } },
  );
  const props = {
    value: "Alphard", manualName: "Alphard", onChange() {}, onManualNameChange() {},
    onDeleteSelected: () => selectedDeleted++,
  };
  function render() {
    stateIndex = 0;
    return VehicleNameSelect(props);
  }
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    return [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
  }
  function button(label) {
    const found = nodes(render()).find((node) =>
      node.type === "button" && (node.props["aria-label"] === label || node.props.children === label));
    assert.ok(found, label);
    found.props.onClick();
  }
  button("管理车名");
  confirmed = false;
  button("删除车名 Alphard");
  assert.equal(saved, null);
  confirmed = true;
  failWrite = true;
  button("删除车名 Alphard");
  assert.equal(selectedDeleted, 0);
  assert.equal(saved, null);
  assert.ok(nodes(render()).some((node) => node.props?.role === "alert"));
  failWrite = false;
  button("删除车名 Alphard");
  assert.equal(selectedDeleted, 1);
  assert.ok(!JSON.parse(saved).includes("Alphard"));
  states.length = 0; // Reopening the dialog reads the persisted list.
  let tree = nodes(render());
  assert.equal(tree.find((node) => node.type === "select").props.value, MANUAL_VEHICLE_NAME);
  assert.equal(tree.find((node) => node.type === "input").props.value, "Alphard");
  assert.ok(!tree.some((node) => node.type === "option" && node.props.value === "Alphard"));
  button("管理车名");
  for (const name of JSON.parse(saved)) button(`删除车名 ${name}`);
  assert.deepEqual(JSON.parse(saved), []);
  assert.ok(nodes(render()).some((node) => node.type === "option" && node.props.value === MANUAL_VEHICLE_NAME));
  button("恢复默认");
  assert.deepEqual(JSON.parse(saved), plain(DEFAULT_VEHICLE_NAME_OPTIONS));
  saved = "{broken";
  states.length = 0;
  tree = nodes(render());
  assert.ok(tree.some((node) => node.props?.role === "alert"));
  props.value = "Custom model";
  assert.ok(nodes(render()).some((node) => node.type === "option" && node.props.value === "Custom model"));
});

test("invoice always keeps order line and prints exactly the nonzero trip charges", () => {
  const { buildInvoicePrintHtml } = load("lib\\invoice-print.ts", {
    "@/lib/print-a4": { printA4Html() {} },
    "@/lib/company-seal": { isCompanySealDataUrl: (value) => value === "" },
  });
  const base = {
    number: "INV-000001", issuedDate: "2026-10-16", startDate: "2026-10-16", endDate: "2026-10-16",
    customer: "<Order>", recipient: "Recipient", contact: "", recipientAddress: "",
    company: "Company", phone: "", address: "", bankAccount: "", taxRegistrationNumber: "",
    orderPrice: 11000, etcTrip: 0, driverAdvanceTrip: 0, companyAdvanceTrip: 0,
  };
  const fees = ["etcTrip", "driverAdvanceTrip", "companyAdvanceTrip"];
  const labels = ["ETC料金", "運転士立替金", "会社立替金"];
  for (let mask = 0; mask < 8; mask++) {
    const data = { ...base };
    fees.forEach((fee, index) => { data[fee] = mask & (1 << index) ? 110 * (index + 1) : 0; });
    const html = buildInvoicePrintHtml(data);
    const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
    assert.equal((body.match(/<tr>/g) ?? []).length, 1 + fees.filter((fee) => data[fee] > 0).length);
    assert.ok(body.includes("&lt;Order&gt;"));
    labels.forEach((label, index) => assert.equal(body.includes(label), data[fees[index]] > 0));
    const total = data.orderPrice + fees.reduce((sum, fee) => sum + data[fee], 0);
    const tax = Math.floor(total * 10 / 110);
    assert.ok(html.includes(`<strong>¥${total.toLocaleString("ja-JP")}</strong>`));
    assert.ok(html.includes(`うち消費税額（10%）</td><td class="number">¥${tax.toLocaleString("ja-JP")}`));
  }
  const zero = buildInvoicePrintHtml({ ...base, orderPrice: 0 });
  assert.ok(zero.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].includes('class="number">¥0'));
  assert.throws(() => buildInvoicePrintHtml({ ...base, etcTrip: -1 }));
});

test("inline operation markers remain in reservation editor and details but not the list", () => {
  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  const markers = [...source.matchAll(/<LastOperation record=\{([^\n]+?)\} \/>/g)];
  assert.equal(markers.length, 2);
  assert.ok(!source.includes("<LastOperation record={order} />"));
  assert.ok(markers[0][1].includes("editingOrderId"));
  assert.ok(markers[1][1].includes("selectedOrderDetails.id"));
  assert.ok(source.includes('activeView === "audit" && currentProfile.role === "admin"'));
});

test("balance adds manual income, subtracts only manual expense and prints matching A4 totals", () => {
  const balance = load("lib\\balance-summary.ts");
  const { buildBalancePrintHtml } = load("lib\\balance-print.ts", {
    "@/lib/print-a4": { printA4Html() {} },
  });
  const orders = [{ companyName: "A", requestAmount: 1000 }, { companyName: "B", requestAmount: 50 }];
  const expenses = [{ companyName: "A", name: "Costs", amount: 400 }, { companyName: "B", name: "Cost", amount: 200 }];
  const incomes = [{ companyName: "A", name: "<Income>", amount: 200 }, { companyName: "B", name: "Other", amount: 50 }];
  const summary = balance.summarizeBalance("", ["A", "B"], orders, expenses, incomes);
  assert.deepEqual(plain(summary.totals), { requestAmount: 1050, incomeTotal: 250, expenseTotal: 600, net: 700 });
  assert.equal(summary.rows.find((row) => row.companyName === "B").net, -100);
  assert.equal(balance.summarizeBalance("A", [], orders, expenses, incomes).totals.net, 800);
  assert.equal(balance.summarizeBalance("", [], [], [], incomes).totals.net, 250);
  assert.equal(balance.summarizeBalance("", [], orders, expenses).totals.net, 450);
  assert.throws(() => balance.summarizeBalance("", [], [], [], [{ companyName: "", name: "Bad", amount: -1 }]));
  assert.throws(() => balance.summarizeBalance("", [], [{ companyName: "A", requestAmount: Number.MAX_SAFE_INTEGER }], [],
    [{ companyName: "A", name: "Overflow", amount: 1 }]));
  assert.equal(balance.getBalanceServiceMonth({ offDates: ["2026-09-30"] }, ["2026-09-30", "2026-10-01"]), "2026-10");
  const html = buildBalancePrintHtml({ month: "2026-10", region: "Tokyo", company: "All", summary });
  assert.ok(html.includes("其他收入总和"));
  assert.ok(html.includes("&lt;Income&gt;"));
  assert.ok(html.includes("¥700"));
  assert.ok(html.includes('class="number loss">¥-100'));
  assert.ok(html.includes("＋手动其他收入总和－手动支出总和"));
});

test("actual balance page pipeline uses selected-month income drafts and saves income separately", () => {
  const source = ts.createSourceFile("page.tsx", fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["balanceVisibleExpenseItems", "getBalanceExpenseAmount", "balanceResult"]);
  const pieces = [], functions = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && names.has(node.name.getText(source))) {
      pieces.push(`const ${node.getText(source)};`);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === "saveBalanceExpenseAmounts") {
      functions.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(pieces.length, 3);
  const balance = load("lib\\balance-summary.ts");
  const expenses = [
    { id: "expense", companyName: "A", kind: "expense", name: "Costs", monthlyAmounts: { "2026-10": 400 } },
    { id: "income", companyName: "A", kind: "income", name: "Other", monthlyAmounts: { "2026-10": 200, "2026-11": 900 } },
    { id: "foreign", companyName: "B", kind: "income", name: "Foreign", monthlyAmounts: { "2026-10": 5000 } },
  ];
  const context = {
    balanceCompanyFilter: "A", balanceMonth: "2026-10", balanceExpenseItems: expenses,
    balanceExpenseAmountDrafts: { "income:2026-10": "350", "expense:2026-10": "450" },
    balanceExpensesMigrationPending: false, companyRows: [{ name: "A" }],
    orders: [{ company: "A", orderPrice: 1000, offDates: [], dateKeys: ["2026-10-31", "2026-11-01"],
      financeByDate: { "2026-10-31": { requestAmount: 20 }, "2026-11-01": { requestAmount: 30 } } }],
    getOrderDateKeys: (order) => order.dateKeys,
    calculateOrderFinance: (entry) => entry, ...balance,
  };
  const script = ts.transpileModule(pieces.join("\n") + "\nglobalThis.result = balanceResult;",
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  function calculate(overrides = {}) {
    const run = { ...context, ...overrides };
    vm.runInNewContext(script, run);
    return run.result;
  }
  assert.deepEqual(plain(calculate().summary.totals), {
    requestAmount: 1050, incomeTotal: 350, expenseTotal: 450, net: 950,
  });
  assert.equal(calculate({ balanceMonth: "2026-11" }).summary.totals.net, 900);
  assert.equal(calculate({ balanceExpenseAmountDrafts: { "income:2026-10": "" } }).summary.totals.net, 650);
  assert.equal(calculate({ balanceExpenseAmountDrafts: { "income:2026-10": "bad" } }).summary, null);
  let saved = expenses, drafts = { ...context.balanceExpenseAmountDrafts }, error = "";
  const saveContext = { ...context,
    setBalanceExpenseItems: (update) => { saved = update(saved); },
    setBalanceExpenseAmountDrafts: (update) => { drafts = update(drafts); },
    setBalanceExpenseError: (message) => { error = message; },
  };
  vm.runInNewContext(ts.transpileModule(functions.join("\n") + '\nsaveBalanceExpenseAmounts("income");',
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, saveContext);
  assert.equal(error, "");
  assert.equal(saved.find((item) => item.id === "income").monthlyAmounts["2026-10"], 350);
  assert.equal(saved.find((item) => item.id === "income").monthlyAmounts["2026-11"], 900);
  assert.equal(saved.find((item) => item.id === "expense").monthlyAmounts["2026-10"], 400);
  assert.equal(drafts["expense:2026-10"], "450");
  assert.equal(drafts["income:2026-10"], undefined);
});

test("metadata validation, nested financial changes and Japan-local time", () => {
  assert.equal(audit.toLastOperation(null), null);
  assert.deepEqual(plain(audit.toLastOperation(operation)), operation);
  assert.throws(() => audit.toLastOperation({ ...operation, at: "invalid" }));
  assert.throws(() => audit.toLastOperation({ ...operation, actorName: 1 }));
  assert.match(audit.formatAuditTime(operation.at), /2026\/10\/16 03:00:00/);
  const changes = audit.auditChanges(
    { finance_by_date: { "2026-10-16": { fuelCost: 100, driver: "A" } } },
    { finance_by_date: { "2026-10-16": { fuelCost: 200, driver: "A" } } },
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].before, 100);
  assert.equal(changes[0].after, 200);
  assert.match(changes[0].field, /2026-10-16/);
  assert.equal(audit.auditChanges({ phone: "123" }, null)[0].after, undefined);
});

test("history endpoint rejects unauthenticated/non-admin users and validates filters", async () => {
  let profile = null;
  const calls = [];
  const query = {};
  for (const method of ["select", "order", "eq", "ilike", "gte", "lte"]) {
    query[method] = (...args) => { calls.push([method, ...args]); return query; };
  }
  query.range = async (...args) => {
    calls.push(["range", ...args]);
    return { data: Array.from({ length: 51 }, (_, index) => ({ id: index })), error: null };
  };
  const route = load("app\\api\\admin\\audit\\route.ts", {
    "@/lib/supabase/authorization": {
      getAuthenticatedProfile: async () => ({ profile, supabase: { from: () => query } }),
    },
    "@/lib/api-response": { jsonResponse: (data, init) => ({ data, status: init?.status ?? 200 }) },
    "@/lib/audit": audit,
  });
  const get = (search = "") => route.GET(new Request(`http://localhost/api/admin/audit${search}`));
  assert.equal((await get()).status, 401);
  profile = { role: "user", position: "役员" };
  assert.equal((await get()).status, 403);
  assert.equal(calls.length, 0);
  profile = { role: "admin" };
  for (const search of ["?page=0", "?table=profiles", "?region=bad", "?record=bad",
    "?start=2026-10-17&end=2026-10-16", "?start=2026-02-30", "?action=UPSERT"]) {
    assert.equal((await get(search)).status, 400, search);
  }
  const response = await get(`?page=2&table=drivers&actor=A%25_&region=${region}&start=2026-10-15&end=2026-10-16&record=${id}`);
  assert.equal(response.status, 200);
  assert.equal(response.data.logs.length, 50);
  assert.equal(response.data.hasNext, true);
  assert.deepEqual(plain(calls.find((call) => call[0] === "range")), ["range", 50, 100]);
  assert.ok(calls.some((call) => call[0] === "ilike" && call[2] === "%A\\%\\_%"));
  assert.ok(calls.some((call) => call[0] === "gte" && call[2] === "2026-10-15T00:00:00+09:00"));
  assert.ok(calls.some((call) => call[0] === "lte" && call[2] === "2026-10-16T23:59:59.999999+09:00"));
});

test("business POST returns trusted metadata and rejects client-supplied audit fields", async () => {
  let writes = 0;
  const query = {
    upsert: async (rows) => {
      assert.ok(!Object.hasOwn(rows[0], "last_operation"));
      writes += rows.length;
      return { error: null };
    },
    select: () => query,
    in: async () => ({ data: [{ id, last_operation: operation }], error: null }),
  };
  const route = load("app\\api\\data\\route.ts", {
    "@/lib/supabase/authorization": {
      getAuthenticatedProfile: async () => ({ profile: { role: "user", regionId: region }, supabase: { from: () => query } }),
    },
    "@/lib/api-response": { jsonResponse: (data, init) => ({ data, status: init?.status ?? 200 }) },
    "@/lib/supabase/pagination": {},
    "@/lib/delete-password": { verifyDeletePassword: () => ({ configured: true, valid: true }) },
    "@/lib/company-seal": { isCompanySealDataUrl: () => true, MAX_SEAL_DATA_LENGTH: 350000 },
    "@/lib/audit": audit,
  });
  const driver = { id, regionId: region, name: "Driver", phone: "", wechat: "", whatsapp: "", licenseExpiry: "" };
  const post = (entry) => route.POST({ json: async () => ({
    collection: "drivers", upsert: [entry], deleteIds: [], deletePassword: "",
  }) });
  assert.equal((await post({ ...driver, lastOperation: operation })).status, 400);
  assert.equal(writes, 0);
  const response = await post(driver);
  assert.equal(response.status, 200);
  assert.deepEqual(plain(response.data.saved), [{ id, lastOperation: operation }]);
  assert.equal(writes, 1);
});

test("persistence strips audit metadata, merges saved stamp without losing queued edits", async () => {
  let state = [];
  const requests = [], errors = [], pending = [];
  const client = load("lib\\api-client.ts");
  const fetchMock = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true, saved: [{ id, lastOperation: operation }] }) };
  };
  const hook = load("lib\\use-persisted-collection.ts", {
    react: { useState: () => [state, (next) => { state = next; }],
      useRef: (value) => ({ current: value }), useCallback: (callback) => callback },
    "@/lib/api-client": client, "@/lib/audit": audit,
  }, { fetch: fetchMock });
  const collection = hook.usePersistedCollection("drivers",
    (message) => errors.push(message), (value) => pending.push(value), () => "", () => region);
  collection.replaceItems([{ id, regionId: region, name: "Old", lastOperation: operation }]);
  collection.updateItems((items) => items.map((item) => ({ ...item, name: "First" })));
  collection.updateItems((items) => items.map((item) => ({ ...item, name: "Second" })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => !Object.hasOwn(request.upsert[0], "lastOperation")));
  assert.equal(state[0].name, "Second");
  assert.deepEqual(plain(state[0].lastOperation), operation);
  collection.updateItems((items) => items.map((item) => ({ ...item, lastOperation: { ...operation, actorName: "Changed metadata only" } })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(errors.length, 0);
  assert.equal(pending.reduce((sum, value) => sum + value, 0), 0);
});

test("background sync applies server data only when no local edits are pending or newer", async () => {
  let state = [];
  let releaseSave;
  const client = load("lib\\api-client.ts");
  const fetchMock = () => new Promise((resolve) => {
    releaseSave = () => resolve({ ok: true, json: async () => ({ ok: true, saved: [{ id, lastOperation: operation }] }) });
  });
  const hook = load("lib\\use-persisted-collection.ts", {
    react: { useState: () => [state, (next) => { state = next; }],
      useRef: (value) => ({ current: value }), useCallback: (callback) => callback },
    "@/lib/api-client": client, "@/lib/audit": audit,
  }, { fetch: fetchMock });
  const collection = hook.usePersistedCollection("drivers", () => {}, () => {}, () => "", () => region);
  collection.replaceItems([{ id, regionId: region, name: "Old" }]);

  const remote = [{ id, regionId: region, name: "Remote" }];
  let version = collection.getChangeVersion();
  assert.equal(collection.syncItems(remote, version), true);
  assert.equal(state[0].name, "Remote");
  assert.equal(collection.syncItems(remote, version), false, "unchanged data is not re-applied");

  version = collection.getChangeVersion();
  collection.updateItems((items) => items.map((item) => ({ ...item, name: "Local" })));
  assert.equal(collection.syncItems([{ id, regionId: region, name: "Stale" }], collection.getChangeVersion()), false,
    "pending save blocks sync");
  await new Promise((resolve) => setImmediate(resolve));
  releaseSave();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(collection.syncItems([{ id, regionId: region, name: "Stale" }], version), false,
    "fetch started before a local edit is discarded");
  assert.equal(state[0].name, "Local");
  assert.equal(collection.syncItems([{ id, regionId: region, name: "Newer remote" }], collection.getChangeVersion()), true);
  assert.equal(state[0].name, "Newer remote");

  const source = fs.readFileSync(path.join(root, "app\\page.tsx"), "utf8");
  assert.ok(source.includes("DATA_SYNC_INTERVAL_MS = 10_000"));
  assert.ok(source.includes('document.visibilityState !== "visible"'));
});

test("last-operation labels escape operator names and render historical rows", () => {
  const { LastOperation } = load("components\\last-operation.tsx", { "@/lib/audit": audit });
  const html = renderToStaticMarkup(React.createElement(LastOperation, {
    record: { id, lastOperation: { ...operation, actorName: "<script>alert(1)</script>" } },
  }));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  const historical = renderToStaticMarkup(React.createElement(LastOperation, { record: { id } }));
  assert.ok(historical.includes("历史记录"));
});

test("history UI renders filters, operator, Japan time and escaped before/after details", () => {
  let stateIndex = 0;
  const result = {
    logs: [{
      id, occurred_at: operation.at, actor_id: id, actor_name: operation.actorName,
      region_id: region, table_name: "drivers", record_id: id, record_label: "Driver",
      action: "UPDATE", before_data: { phone: "123" },
      after_data: { phone: "<script>alert(1)</script>" },
    }], hasNext: false,
  };
  const { AuditHistory } = load("components\\audit-history.tsx", {
    react: {
      useEffect() {},
      useState: (initial) => {
        const overrides = { 2: result, 4: false };
        return [Object.hasOwn(overrides, stateIndex) ? overrides[stateIndex++] : (stateIndex++, initial), () => {}];
      },
    },
    "@/lib/audit": audit,
    "@/lib/api-client": load("lib\\api-client.ts"),
  });
  const html = renderToStaticMarkup(React.createElement(AuditHistory, {
    regionId: region,
    regions: [{ id: region, name: "東京" },
      { id: "60000000-0000-4000-8000-000000000002", name: "大阪" },
      { id: "60000000-0000-4000-8000-000000000003", name: "北海道" }],
  }));
  for (const value of ["操作记录", "业务类型", "开始日期", "结束日期", "操作前", "操作后", "Test Operator", "2026/10/16 03:00:00"]) {
    assert.ok(html.includes(value), value);
  }
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.indexOf("東京") < html.indexOf("大阪"));
  assert.ok(html.indexOf("大阪") < html.indexOf("北海道"));
});
