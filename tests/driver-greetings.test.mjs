import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const jsonResponse = (data, init) => ({ data, status: init?.status ?? 200 });
const plain = value => JSON.parse(JSON.stringify(value));
function load(relative, mocks = {}) {
  const filename = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, {
    module: compiled, exports: compiled.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    console: { error() {} }, Request, Response,
  });
  return compiled.exports;
}

function greetingsRoute({ profile = { role: "admin" }, rpcError = null } = {}) {
  const calls = [];
  const route = load("app/api/admin/driver-greetings/route.ts", {
    "@/lib/api-response": { jsonResponse },
    "@/lib/supabase/authorization": { getAuthenticatedProfile: async () => ({
      profile, supabase: { rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "driver_portal_greetings") return { data: { globalSlogan: "平安出行，美好的一天", personalSlogan: "" }, error: rpcError };
        return { data: args.target_slogan, error: rpcError };
      } },
    }) },
  });
  return { ...route, calls };
}

test("staff can read the global driver slogan, while unauthenticated callers are denied", async () => {
  const denied = greetingsRoute({ profile: null });
  assert.equal((await denied.GET()).status, 403);
  assert.equal(denied.calls.length, 0);
  const route = greetingsRoute();
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(plain(response.data), { slogan: "平安出行，美好的一天" });
  assert.equal(route.calls[0].name, "driver_portal_greetings");
});

test("only administrators can update a bounded global slogan", async () => {
  const staff = greetingsRoute({ profile: { role: "user" } });
  assert.equal((await staff.POST(new Request("https://staff.example/api/admin/driver-greetings", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slogan: "你好" }),
  }))).status, 403);
  assert.equal(staff.calls.length, 0);

  const route = greetingsRoute();
  const post = (body, headers = { "Content-Type": "application/json" }) => route.POST(new Request(
    "https://staff.example/api/admin/driver-greetings", { method: "POST", headers, body: JSON.stringify(body) },
  ));
  assert.equal((await post({ slogan: "  一路平安  " })).data.slogan, "一路平安");
  assert.deepEqual(plain(route.calls.at(-1)), {
    name: "admin_update_driver_global_slogan", args: { target_slogan: "一路平安" },
  });
  assert.equal((await post({ slogan: "x".repeat(101) })).status, 400);
  assert.equal((await post({ slogan: "未提交" }, { "Content-Type": "text/plain" })).status, 415);
});

test("driver mobile identity includes validated portal slogans", async () => {
  const calls = [];
  const route = load("app/api/driver/me/route.ts", {
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/authorization": { requireDriver: async () => ({
      response: null,
      identity: { driver_id: "driver-id", region_id: "region-id", driver_name: "運転士", version: 2 },
      supabase: { rpc: async name => {
        calls.push(name);
        return { data: { globalSlogan: "全体标语", personalSlogan: "个人标语" }, error: null };
      } },
    }) },
  });
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.deepEqual(plain(response.data), {
    driverId: "driver-id", regionId: "region-id", name: "運転士", version: 2,
    globalSlogan: "全体标语", personalSlogan: "个人标语",
  });
  assert.deepEqual(calls, ["driver_portal_greetings"]);
});

test("database migration limits slogan access and supports optional personalized greetings", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20261113000000_driver_portal_slogans.sql", import.meta.url), "utf8");
  assert.match(migration, /personal_slogan text not null default ''/);
  assert.match(migration, /char_length\(personal_slogan\)<=100/);
  assert.match(migration, /default '平安出行，美好的一天'/);
  assert.match(migration, /if not public\.is_admin\(\) then raise exception 'Administrator required'/);
  assert.match(migration, /grant execute on function public\.driver_portal_greetings\(\),public\.admin_update_driver_global_slogan\(text\)\s+to authenticated/);
});

test("driver management places both slogan editors at their requested locations", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const driverView = page.slice(page.indexOf('{activeView === "drivers"'), page.indexOf('{activeView === "vehicles"'));
  assert.ok(driverView.indexOf("全体标语") < driverView.indexOf("<DriverLoginProvider>"));
  assert.ok(driverView.indexOf(">運転士</th>") < driverView.indexOf(">个人标语</th>"));
  assert.match(driverView, /onBlur=\{\(event\) => \{[\s\S]*?setDriverRecords/);
  assert.match(page, /fetch\("\/api\/admin\/driver-greetings"/);
});
