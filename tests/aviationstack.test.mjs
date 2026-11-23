import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(relative, mocks = {}, env = process.env) {
  const filename = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: compiledModule.exports,
    module: compiledModule,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    process: { env },
    Request,
    Response,
    Headers,
    URL,
    AbortSignal,
    Date,
    Intl,
    RangeError,
    crypto: webcrypto,
    console: { error() {} },
  }, { filename });
  return compiledModule.exports;
}

const aviationstack = load("lib/aviationstack.ts");

function loadFlightRoute(mocks, env = {}) {
  return load("app/api/driver/flights/route.ts", {
    ...mocks,
    "@/lib/flight-tracking": load("lib/flight-tracking.ts", {}, env),
  }, env);
}

function japanToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function addDays(date, count) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}

test("Aviationstack current-flight query uses the server key, flight and arrival airport", async () => {
  const serviceDate = japanToday();
  let requestUrl;
  let requestOptions;
  const status = await aviationstack.getAviationstackFlightStatus("nh123", serviceDate, "HND", "test-key", async (url, options) => {
    requestUrl = new URL(url);
    requestOptions = options;
    return Response.json({ data: [{
      flight_date: serviceDate,
      flight_status: "landed",
      flight: { iata: "NH123", number: "123" },
      arrival: {
        iata: "HND",
        actual: `${serviceDate}T19:02:00.000`,
        estimated: `${serviceDate}T19:09:00.000`,
        scheduled: `${serviceDate}T18:45:00.000`,
        terminal: "T3",
        timezone: "Asia/Tokyo",
      },
    }] });
  });

  assert.equal(requestUrl.origin + requestUrl.pathname, "https://api.apilayer.net/aviationstack/v1/flights");
  assert.equal(requestUrl.searchParams.get("access_key"), "test-key");
  assert.equal(requestUrl.searchParams.get("flight_iata"), "NH123");
  assert.equal(requestUrl.searchParams.get("arr_iata"), "HND");
  assert.equal(requestUrl.searchParams.get("arr_scheduled_time_arr"), serviceDate);
  assert.equal(requestUrl.searchParams.has("flight_date"), false);
  assert.equal(requestOptions.headers.Accept, "application/json");
  assert.equal(requestOptions.cache, "no-store");
  assert.deepEqual(JSON.parse(JSON.stringify(status)), {
    flightNumber: "NH123",
    status: "landed",
    terminal: "T3",
    arrivalTime: new Date(`${serviceDate}T19:02:00+09:00`).toISOString(),
    updatedAt: status.updatedAt,
  });
});

test("Aviationstack free-tier mode defers future service dates without provider requests", async () => {
  const serviceDate = addDays(japanToday(), 5);
  const status = await aviationstack.getAviationstackFlightStatus("NH123", serviceDate, "NRT", "", async () => {
    throw new Error("Future flights are not available on the free plan.");
  });

  assert.equal(status.flightNumber, "NH123");
  assert.equal(status.status, "tracking_pending");
  assert.equal(status.terminal, null);
  assert.equal(status.arrivalTime, null);
});

test("pickup airport inference recognizes Japanese and English airport names without guessing", () => {
  const infer = aviationstack.inferArrivalAirportFromPickup;
  for (const [pickup, airport] of [
    ["羽田空港 第3ターミナル", "HND"],
    ["Narita International Airport (NRT)", "NRT"],
    ["関西国際空港", "KIX"],
    ["New Chitose Airport", "CTS"],
    ["大阪国際空港（伊丹）", "ITM"],
    ["Terminal 1, ＨＮＤ", "HND"],
  ]) {
    assert.equal(infer(pickup), airport);
  }
  assert.equal(infer("羽田空港 / 成田空港"), null);
  assert.equal(infer("Airport pickup"), null);
});

test("Aviationstack normalizes flight statuses and unmatched records", async () => {
  const serviceDate = japanToday();
  for (const [flightNumber, flight, expected] of [
    ["NH201", { flight_status: "active", flight: { iata: "NH201" } }, "en_route"],
    ["NH202", { flight_status: "cancelled", flight: { iata: "NH202" } }, "cancelled"],
    ["NH203", { flight_status: "diverted", flight: { iata: "NH203" } }, "diverted"],
    ["NH204", { flight_status: "scheduled", flight: { iata: "NH204" }, arrival: { delay: 30 } }, "delayed"],
    ["NH205", { flight_status: "scheduled", flight: { iata: "NH205" } }, "scheduled"],
    ["NH206", null, "not_found"],
  ]) {
    const result = await aviationstack.getAviationstackFlightStatus(flightNumber, serviceDate, "HND", "test-key", async () =>
      Response.json({ data: flight ? [{ flight_date: serviceDate, ...flight }] : [] }));
    assert.equal(result.status, expected);
  }
});

test("Aviationstack rejects missing credentials, malformed responses, and provider errors", async () => {
  await assert.rejects(
    aviationstack.getAviationstackFlightStatus("NH300", japanToday(), "HND", "", async () => {
      throw new Error("must not make a request");
    }),
    (error) => error.code === "not_configured",
  );
  await assert.rejects(
    aviationstack.getAviationstackFlightStatus("NH301", japanToday(), "HND", "test-key", async () =>
      Response.json({ unexpected: "payload" })),
    (error) => error.code === "bad_response",
  );
  await assert.rejects(
    aviationstack.getAviationstackFlightStatus("NH302", japanToday(), "HND", "test-key", async () =>
      Response.json({ error: { code: "invalid_access_key", message: "invalid key" } })),
    (error) => error.code === "request_failed",
  );
});

test("disabled driver flight endpoint returns 404 without invoking authorization", async () => {
  const { jsonResponse } = load("lib/api-response.ts");
  let authorizationCalls = 0;
  const handler = loadFlightRoute({
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/authorization": {
      requireDriver: async () => {
        authorizationCalls++;
        return { response: jsonResponse({ error: "Denied" }, { status: 401 }) };
      },
    },
    "@/lib/driver/orders": load("lib/driver/orders.ts"),
    "@/lib/aviationstack": aviationstack,
  }, { NEXT_PUBLIC_FLIGHT_TRACKING_ENABLED: "false" });

  const response = await handler.GET(new Request(
    "https://driver.example/api/driver/flights?assignmentId=e6000000-0000-4000-8000-000000000001",
  ));
  assert.equal(authorizationCalls, 0);
  assert.equal(response.status, 404);
});

test("driver flight endpoint verifies the assigned trip before looking up its flight", async () => {
  const { jsonResponse } = load("lib/api-response.ts");
  const lookup = async (flightNumber, serviceDate, arrivalAirport) => ({
    flightNumber, serviceDate, arrivalAirport, status: "en_route", terminal: "1",
  });
  const data = [{
    assignment_id: "e6000000-0000-4000-8000-000000000001",
    order_id: "order-a",
    service_date: "2026-10-27",
    departure_time: "09:30",
    pickup: "羽田空港",
    destination: "Hotel",
    vehicle: "Test car",
    status: "assigned",
    version: 1,
    order_name: "Order",
    trip_summary: "Airport to hotel",
    notes: "",
    flight_number: "NH123",
  }];
  const calls = [];
  const handler = loadFlightRoute({
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/authorization": {
      requireDriver: async () => ({
        response: null,
        supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data, error: null }; } },
      }),
    },
    "@/lib/driver/orders": load("lib/driver/orders.ts"),
    "@/lib/aviationstack": {
      AviationstackError: aviationstack.AviationstackError,
      getAviationstackFlightStatus: lookup,
      inferArrivalAirportFromPickup: aviationstack.inferArrivalAirportFromPickup,
    },
  });
  const response = await handler.GET(new Request(
    "https://driver.example/api/driver/flights?assignmentId=e6000000-0000-4000-8000-000000000001",
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    name: "driver_trip_detail",
    args: { target_assignment: data[0].assignment_id },
  }]);
  assert.deepEqual(await response.json(), {
    flight: { flightNumber: "NH123", serviceDate: "2026-10-27", arrivalAirport: "HND", status: "en_route", terminal: "1" },
  });
});

test("flight endpoint rejects invalid selectors and unauthenticated drivers", async () => {
  const { jsonResponse } = load("lib/api-response.ts");
  const calls = [];
  const handler = loadFlightRoute({
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/authorization": {
      requireDriver: async () => ({
        response: null,
        supabase: { rpc: async (...args) => { calls.push(args); return { data: [], error: null }; } },
      }),
    },
    "@/lib/driver/orders": load("lib/driver/orders.ts"),
    "@/lib/aviationstack": aviationstack,
  });
  for (const query of ["", "?assignmentId=invalid", "?assignmentId=a&assignmentId=b", "?assignmentId=a&date=2026-10-27"]) {
    assert.equal((await handler.GET(new Request(`https://driver.example/api/driver/flights${query}`))).status, 400);
  }
  assert.equal(calls.length, 0);

  const denied = loadFlightRoute({
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/authorization": {
      requireDriver: async () => ({ response: jsonResponse({ error: "Denied" }, { status: 401 }) }),
    },
    "@/lib/driver/orders": load("lib/driver/orders.ts"),
    "@/lib/aviationstack": aviationstack,
  });
  assert.equal((await denied.GET(new Request(
    "https://driver.example/api/driver/flights?assignmentId=e6000000-0000-4000-8000-000000000001",
  ))).status, 401);
});

test("flight endpoint asks dispatch to correct an unrecognized pickup airport", async () => {
  const { jsonResponse } = load("lib/api-response.ts");
  let lookedUp = false;
  const handler = loadFlightRoute({
    "@/lib/api-response": { jsonResponse },
    "@/lib/driver/authorization": {
      requireDriver: async () => ({
        response: null,
        supabase: { rpc: async () => ({ data: [{
          assignment_id: "e6000000-0000-4000-8000-000000000001",
          order_id: "order-a",
          service_date: "2026-10-27",
          departure_time: "09:30",
          pickup: "机场接机",
          destination: "Hotel",
          vehicle: "Test car",
          status: "assigned",
          version: 1,
          order_name: "Order",
          trip_summary: "Airport to hotel",
          notes: "",
          flight_number: "NH123",
        }], error: null }) },
      }),
    },
    "@/lib/driver/orders": load("lib/driver/orders.ts"),
    "@/lib/aviationstack": {
      AviationstackError: aviationstack.AviationstackError,
      getAviationstackFlightStatus: async () => { lookedUp = true; },
      inferArrivalAirportFromPickup: aviationstack.inferArrivalAirportFromPickup,
    },
  });
  const response = await handler.GET(new Request(
    "https://driver.example/api/driver/flights?assignmentId=e6000000-0000-4000-8000-000000000001",
  ));

  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /无法从上车地点识别到达机场/);
  assert.equal(lookedUp, false);
});

test("flight tracking migration keeps its RPC scoped to assigned drivers", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261209000000_order_flight_tracking.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists flight_number text not null default ''/);
  assert.match(sql, /public\.driver_orders\(null,target_assignment\)/);
  assert.match(sql, /coalesce\(o\.flight_number,''\)/);
  assert.match(sql, /revoke all .* from public,anon/);
  assert.match(sql, /grant execute .* to authenticated/);
});
