import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function load(file, mocks = {}) {
  const compiled = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    module: compiled, exports: compiled.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    Request, Response, Headers, URL, console: { error() {} },
  });
  return compiled.exports;
}
const { getOrderMergeError, mergeSharedFields } = load("lib/order-merge.ts");
const targetId = "77000000-0000-4000-8000-000000000001";
const sourceId = "77000000-0000-4000-8000-000000000002";
const regionId = "77000000-0000-4000-8000-000000000003";
const first = {
  ...Object.fromEntries(mergeSharedFields.map(field => [field, "same"])),
  id: targetId, regionId, splitGroupId: "77000000-0000-4000-8000-000000000004", date: "2026-11-01", endDate: "2026-11-02",
  vehicle: "First vehicle", driver: "First driver", financeByDate: {},
};
const second = { ...first, id: sourceId, date: "2026-11-03", endDate: "2026-11-05",
  vehicle: "Second vehicle", driver: "Second driver" };

test("calendar merge candidates allow adjacent split segments with different daily drivers and vehicles", () => {
  assert.equal(getOrderMergeError(first, second), null);
  assert.equal(getOrderMergeError(second, first), null);
  assert.ok(getOrderMergeError({ ...first, splitGroupId: null }, { ...second, splitGroupId: null }));
  assert.ok(getOrderMergeError(first, { ...second, splitGroupId: sourceId }));
  assert.ok(getOrderMergeError(first, first));
  assert.ok(getOrderMergeError(first, { ...second, regionId: sourceId }));
  for (const field of mergeSharedFields)
    assert.ok(getOrderMergeError(first, { ...second, [field]: "changed" }), field);
  for (const date of ["2026-11-02", "2026-11-04"])
    assert.ok(getOrderMergeError(first, { ...second, date }));
  assert.ok(getOrderMergeError(first, { ...second, endDate: "2040-11-05" }));
  assert.ok(getOrderMergeError(first, { ...second, importBatchId: "different" }));
  assert.ok(getOrderMergeError(
    { ...first, financeByDate: { "2026-11-03": {} } },
    { ...second, financeByDate: { "2026-11-03": {} } },
  ));
  assert.ok(getOrderMergeError({ ...first, financeByDate: { "2026-11-03": {} } }, second));
  assert.ok(getOrderMergeError(first, { ...second, financeByDate: { "2026-11-02": {} } }));
});

test("calendar only renders merge for orders with matching adjacent candidates and updates when orders change", () => {
  const page = read("app/page.tsx");
  const start = page.indexOf("const mergeableOrderIds =");
  const declaration = page.slice(start, page.indexOf("const mergeTarget =", start));
  const actionStart = page.indexOf("{!isCompactCalendar && (", page.indexOf('className={`calendar-order-card'));
  const actionEnd = page.indexOf("{isSelectingSplit && selectedStartDate && selectedEndDate && (", actionStart);
  const expression = page.slice(actionStart, actionEnd).trim().slice(1, -1);
  const isolated = { ...first, id: "isolated", customer: "different" };
  for (const orders of [[first], [first, second, isolated], [first, { ...second, date: "2026-11-04" }],
    [{ ...first, splitGroupId: null }, { ...second, splitGroupId: null }],
    [first, { ...second, splitGroupId: sourceId }]]) {
    const context = { require, exports: {}, useMemo: fn => fn(), orders, getOrderMergeError };
    vm.runInNewContext(ts.transpileModule(`${declaration}\nglobalThis.ids = mergeableOrderIds;`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    for (const order of orders) {
      const renderContext = { require, exports: {}, order, mergeableOrderIds: context.ids, isCompactCalendar: false,
        isSplittable: false, isSelectingSplit: false };
      vm.runInNewContext(ts.transpileModule(`globalThis.element = (${expression});`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
        fileName: "actions.tsx",
      }).outputText, renderContext);
      assert.equal(renderToStaticMarkup(renderContext.element).includes("合并订单"),
        orders.some(candidate => getOrderMergeError(order, candidate) === null), order.id);
    }
  }
});

test("partial splits assign one persistent lineage to every segment, repeated splits retain it and whole moves do not create it", () => {
  const page = read("app/page.tsx");
  const start = page.indexOf("function moveSplitRangeToVehicle(");
  const handler = page.slice(start, page.indexOf("function selectSplitDate(", start));
  for (const [from, to, count] of [["2026-11-02", "2026-11-02", 2], ["2026-11-01", "2026-11-01", 2],
    ["2026-11-01", "2026-11-02", 1]]) {
    for (const existing of [null, first.splitGroupId]) {
      let output;
      let ids = 0;
      const original = { ...first, splitGroupId: existing, offDates: [], orderPrice: 100 };
      const context = { setOrders: fn => { output = fn([original]); }, orderUsesVehicle: () => false,
        changeOrderVehicle: (order, target) => ({ ...order, vehicle: target.name }),
        createId: () => `new-${++ids}`, hasDailyFares: () => false, sumDailyFares: () => 0,
        shiftFinanceDates: value => value, shiftDateKey: (value, offset) => new Date(Date.parse(value) + offset * 86400000).toISOString().slice(0, 10),
        setSplitSelection() {}, setDraggingOrderId() {}, setDragTargetKey() {} };
      vm.runInNewContext(ts.transpileModule(handler + `\nmoveSplitRangeToVehicle("${targetId}", {name:"New",plate:"123"}, "${from}", "${to}");`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
      assert.equal(output.length, count);
      assert.equal(new Set(output.map(order => order.splitGroupId)).size, 1);
      assert.equal(output[0].splitGroupId, existing || (count > 1 ? "new-1" : null));
    }
  }
  assert.match(page, /splitGroupId: order.splitGroupId/);
  const api = read("app/api/data/route.ts");
  assert.match(api, /splitGroupId: idSchema.nullish\(\)/);
  assert.match(api, /splitGroupId: row.split_group_id \?\? null/);
  assert.match(api, /split_group_id: order.splitGroupId \?\? null/);
  const migration = read("supabase/migrations/20261127000000_order_split_lineage.sql");
  assert.match(migration, /first_order.split_group_id is null or first_order.split_group_id is distinct from second_order.split_group_id/);
  assert.doesNotMatch(migration, /update public.orders set split_group_id/);
  assert.match(migration, /order by id for update/);
});

test("partial splits on the same vehicle create separate date segments", () => {
  const page = read("app/page.tsx");
  const start = page.indexOf("function moveSplitRangeToVehicle(");
  const handler = page.slice(start, page.indexOf("function selectSplitDate(", start));
  let output;
  let ids = 0;
  const original = {
    ...first, splitGroupId: null, offDates: [], date: "2026-11-01", endDate: "2026-11-03",
    orderPrice: 300, financeByDate: {
      "2026-11-01": { dailyFare: 100 }, "2026-11-02": { dailyFare: 100 }, "2026-11-03": { dailyFare: 100 },
    },
  };
  const context = {
    setOrders: fn => { output = fn([original]); },
    orderUsesVehicle: () => true,
    changeOrderVehicle: (order, target) => ({ ...order, vehicle: target.name, vehiclePlate: target.plate }),
    createId: () => `new-${++ids}`,
    hasDailyFares: () => true,
    sumDailyFares: financeByDate => Object.values(financeByDate).reduce((sum, day) => sum + day.dailyFare, 0),
    shiftFinanceDates: (financeByDate, _offset, predicate) =>
      Object.fromEntries(Object.entries(financeByDate).filter(([date]) => !predicate || predicate(date))),
    shiftDateKey: (value, offset) => new Date(Date.parse(`${value}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10),
    setSplitSelection() {}, setDraggingOrderId() {}, setDragTargetKey() {},
  };
  vm.runInNewContext(ts.transpileModule(handler +
    `\nmoveSplitRangeToVehicle("${targetId}", {name:"${original.vehicle}",plate:"123"}, "2026-11-02", "2026-11-02");`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);

  assert.equal(output.length, 3);
  assert.deepEqual(output.map(order => [order.date, order.endDate, order.orderPrice]).sort(),
    [["2026-11-01", "2026-11-01", 100], ["2026-11-02", "2026-11-02", 100], ["2026-11-03", "2026-11-03", 100]]);
  assert.ok(output.every(order => order.vehicle === original.vehicle));
  assert.equal(new Set(output.map(order => order.splitGroupId)).size, 1);
});

function api({ profile = { role: "user", regionId }, error = null, data = targetId } = {}) {
  const calls = [];
  const route = load("app/api/orders/merge/route.ts", {
    "@/lib/api-response": load("lib/api-response.ts"),
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({
      profile, supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { error, data }; } },
    }) },
    "@/lib/driver/assignment-action": { isDriverActionOrigin: req => req.headers.get("origin") === new URL(req.url).origin },
  });
  return { ...route, calls };
}
const command = { targetId, sourceId, targetVersion: null, sourceVersion: null };
const request = (body = command, origin = "https://example.invalid", type = "application/json") =>
  new Request("https://example.invalid/api/orders/merge", {
    method: "POST", headers: { origin, "content-type": type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("order merge requires staff, same-origin JSON and valid IDs without a deletion password", async () => {
  for (const [options, req, status] of [
    [{ profile: null }, request(), 401],
    [{}, request(command, "https://other.invalid"), 403],
    [{}, request(command, undefined, "text/plain"), 415],
    [{}, request("{"), 400],
    [{}, request("x".repeat(8193)), 413],
    [{}, request({ ...command, sourceId: targetId }), 400],
    [{}, request({ ...command, injected: true }), 400],
  ]) {
    const h = api(options);
    assert.equal((await h.POST(req)).status, status);
    assert.equal(h.calls.length, 0);
  }
});

test("merge uses one atomic version-checked RPC and returns explicit conflict and migration errors", async () => {
  const h = api();
  const response = await h.POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{
    name: "merge_split_orders", args: { target_order: targetId, source_order: sourceId,
      target_version: null, source_version: null },
  }]);
  for (const [code, status] of [["42501", 403], ["40001", 409], ["P0002", 409],
    ["22023", 409], ["23505", 409], ["PGRST202", 503], ["XX000", 503]]) {
    const failure = await api({ error: { code } }).POST(request());
    assert.equal(failure.status, status);
    assert.ok((await failure.json()).error);
  }
  assert.equal((await api({ data: null }).POST(request())).status, 503);
});

test("calendar merge entry preserves daily records and blocks silent overwrite at the database boundary", () => {
  const page = read("app/page.tsx");
  assert.match(page, /aria-label=\{`合并订单：\$\{order.customer\}`\}/);
  assert.match(page, /getOrderMergeError\(mergeTarget, order\) === null/);
  assert.match(page, /onClick=\{requestOrderMerge\}/);
  assert.match(page, /targetVersion: mergeTarget.lastOperation \?\? null/);
  assert.match(page, /if \(!\(await waitForOrders\(\)\)\)/);
  const sql = read("supabase/migrations/20261123000000_merge_split_orders.sql");
  assert.match(sql, /order by id for update/);
  assert.match(sql, /first_order.last_operation is distinct from target_version/);
  assert.match(sql, /account_type = 'staff'/);
  assert.match(sql, /public.invoice_numbers where order_id in/);
  assert.match(sql, /update public.driver_assignments set order_id = target_order/);
  assert.match(sql, /update public.driver_historical_finance_links set order_id = target_order/);
  assert.match(sql, /'vehicleOverride', true/);
  assert.doesNotMatch(sql, /delete from public.driver_|delete_orders_with_related_data/);
});

test("calendar merge confirms before sending, waits for saves and refreshes only after success", async () => {
  const page = read("app/page.tsx");
  const start = page.indexOf("function requestOrderMerge()");
  const handler = page.slice(start, page.indexOf("\n  function deleteOrder()", start));
  for (const [saved, ok] of [[true, true], [false, true], [true, false]]) {
    const calls = [];
    let confirm;
    const context = {
      mergeTarget: first, mergeCandidates: [second], mergeSourceId: sourceId,
      formatOrderDate: value => value,
      requestDelete: (message, action, kind) => { confirm = action; calls.push(kind); },
      waitForOrders: async () => saved,
      fetch: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok };
      },
      readJsonSafely: async () => ({ error: "conflict" }),
      buildApiErrorMessage: () => "conflict",
      setMergeOrderId: value => calls.push(["target", value]),
      setMergeSourceId: value => calls.push(["source", value]),
      setSplitSelection: value => calls.push(["split", value]),
      refreshApprovedOrderFinance: async () => calls.push("refresh"),
      AbortController,
    };
    vm.runInNewContext(ts.transpileModule(handler + "\nrequestOrderMerge();", {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    assert.deepEqual(calls, ["merge"]);
    assert.equal(typeof confirm, "function");
    if (!saved || !ok) {
      await assert.rejects(confirm("test-only"));
      assert.equal(calls.includes("refresh"), false);
      assert.equal(calls.some(call => Array.isArray(call) && call[0] === "target"), false);
    } else {
      await confirm("test-only");
      assert.equal(calls[1].url, "/api/orders/merge");
      assert.equal(calls[1].body.targetId, targetId);
      assert.equal(calls[1].body.sourceId, sourceId);
      assert.equal(Object.hasOwn(calls[1].body, "deletePassword"), false);
      assert.equal(calls.at(-1), "refresh");
    }
  }
});

test("merge confirmation works without a password while deletion still requires one", async () => {
  const page = read("app/page.tsx");
  const start = page.indexOf("async function confirmPendingDelete()");
  const handler = page.slice(start, page.indexOf("\n  function addBalanceExpenseItem", start));
  for (const kind of ["merge", undefined]) {
    let runs = 0, completed = false;
    const context = {
      pendingDelete: { kind, action: async () => { runs++; } },
      isDeleting: false, deleteCompleted: false, deletePassword: "",
      setDeleteError() {}, setIsDeleting() {}, setDeletePassword() {},
      setDeleteCompleted: value => { completed = value; },
      setPendingDelete() {},
    };
    vm.runInNewContext(ts.transpileModule(handler + "\nglobalThis.confirm = confirmPendingDelete;", {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    await context.confirm();
    assert.equal(runs, kind === "merge" ? 1 : 0);
    assert.equal(completed, kind === "merge");
  }
  assert.match(page, /pendingDelete.kind !== "merge" && <label[^>]*>\s*削除密码/);
  assert.doesNotMatch(read("app/api/orders/merge/route.ts"), /verifyDeletePassword|deletePassword/);
});
