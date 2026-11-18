import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const pwa = read("20261104000000_driver_pwa");
const historical = read("20261115000000_driver_historical_finance");
function definition(source, name) {
  const starts = [...source.matchAll(new RegExp(`create (?:or replace )?function public\\.${name}\\(`, "g"))];
  const start = starts.at(-1)?.index;
  assert.notEqual(start, undefined, name);
  return source.slice(start, source.indexOf("$$;", source.indexOf("as $$", start)) + 3);
}
const ids = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const [driver, region, order, assignment, link, otherOrder, otherAssignment, expenseId] = ids;
const date = "2026-10-01";

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$select '${driver}'::uuid$$;
    create table storage.objects(bucket_id text,name text);
    create table public.drivers(id uuid,region_id uuid,name text);
    create table public.driver_auth_links(driver_id uuid);
    create table public.orders(id uuid primary key,region_id uuid,status text,date date,end_date date,off_dates date[],driver text,finance_by_date jsonb);
    create table public.driver_assignments(id uuid primary key,order_id uuid,driver_id uuid,region_id uuid,status text,service_date date);
    create table public.driver_historical_finance_links(id uuid primary key,order_id uuid,driver_id uuid,region_id uuid,service_date date);
    create table public.driver_finance_claims(
      claim_id uuid primary key default gen_random_uuid(),assignment_id uuid,historical_link_id uuid,
      driver_id uuid,region_id uuid,category text,status text,version bigint default 1,
      expenses jsonb,overtime_hours numeric,baseline jsonb,request_id uuid,
      submitted_at timestamptz default now(),review_note text default '',reviewed_at timestamptz,reviewed_by uuid);
    create unique index on public.driver_finance_claims(assignment_id,category) where assignment_id is not null;
    create unique index on public.driver_finance_claims(historical_link_id,category) where historical_link_id is not null;
    create table public.driver_daily_fuel(id uuid primary key default gen_random_uuid(),driver_id uuid,region_id uuid,
      service_date date,assignment_id uuid,baseline jsonb,status text,
      amount bigint constraint driver_daily_fuel_amount_check check(amount between 1 and 99999999999999),
      receipts jsonb,request_id uuid,version bigint default 1,submitted_at timestamptz default now(),
      review_note text default '',reviewed_at timestamptz,reviewed_by uuid,unique(driver_id,service_date));
    create table public.driver_finance_events(assignment_id uuid,actor_id uuid,snapshot jsonb);
    create table public.driver_daily_fuel_events(fuel_id uuid,actor_id uuid,snapshot jsonb);
    create function public.driver_identity() returns table(driver_id uuid,region_id uuid,driver_name text)
      language sql as $$select '${driver}'::uuid,'${region}'::uuid,'Test Driver'::text$$;
    create function public.driver_historical_orders(day date) returns table(order_id uuid,service_date date)
      language sql as $$select '${order}'::uuid,day$$;
    create function public.is_admin() returns boolean language sql as $$select false$$;
    create function public.driver_finance_category_baseline(f jsonb,category text) returns jsonb language sql as $$
      select case category when 'company' then jsonb_build_object('driverAdvanceCompanyReport',f->'driverAdvanceCompanyReport')
      when 'trip' then jsonb_build_object('driverAdvanceTripReport',f->'driverAdvanceTripReport')
      else jsonb_build_object('driverOvertimeHours',f->'driverOvertimeHours','driverOvertimeRate',f->'driverOvertimeRate') end$$;
    create function public.driver_finance_claim_json(c public.driver_finance_claims) returns jsonb language sql as $$select to_jsonb(c)$$;
    create function public.driver_daily_fuel_json(c public.driver_daily_fuel) returns jsonb language sql as $$select to_jsonb(c)$$;
    insert into public.drivers values('${driver}','${region}','Test Driver');
    insert into public.driver_auth_links values('${driver}');
    insert into public.orders values('${order}','${region}','予約','${date}','${date}','{}','Test Driver',
      '{"${date}":{"fuelCost":2000,"driverAdvanceCompanyReport":100,"driverAdvanceTripReport":200,"fixedWage":5000,"driverOvertimeRate":1500,"overtimeRequestRate":2000},"2026-10-02":{"fuelCost":99}}'),
      ('${otherOrder}','${region}','予約','${date}','${date}','{}','Test Driver','{"${date}":{"fuelCost":500}}');
    insert into public.driver_assignments values('${assignment}','${order}','${driver}','${region}','assigned','${date}'),
      ('${otherAssignment}','${otherOrder}','${driver}','${region}','assigned','${date}');
    insert into public.driver_historical_finance_links values('${link}','${order}','${driver}','${region}','${date}');
  `);
  await db.exec(definition(pwa, "record_driver_finance_event"));
  await db.exec(definition(pwa, "record_driver_daily_fuel_event"));
  await db.exec(`create trigger driver_finance_event after insert or update on public.driver_finance_claims
    for each row execute function public.record_driver_finance_event();
    create trigger driver_daily_fuel_event after insert or update on public.driver_daily_fuel
    for each row execute function public.record_driver_daily_fuel_event();`);
  await db.exec(definition(pwa, "submit_driver_finance").replace("a.status<>'completed'", "a.status='revoked'")
    .replace("on conflict(assignment_id,category) do update", "on conflict(assignment_id,category) where assignment_id is not null do update"));
  await db.exec(definition(historical, "submit_driver_historical_finance").replace(/\n/g, "\r\n"));
  await db.exec(definition(pwa, "submit_driver_daily_fuel").replace("a.status<>'completed'", "a.status='revoked'"));
  await db.exec(definition(historical, "can_access_driver_receipt"));
  await db.exec(definition(pwa, "has_driver_fuel_day").replace("a.status='completed'", "a.status<>'revoked'"));
  await db.exec(definition(pwa, "can_access_driver_fuel_receipt"));
  await db.exec(read("20261129000000_driver_expenses_direct_posting"));
  await db.exec(read("20261130000000_driver_finance_revisions"));
  await db.exec(read("20261201000000_driver_overtime_direct_posting"));
  await db.exec(`create table public.profiles(id uuid,region_id uuid);
    insert into public.profiles values('${driver}','${region}');
    create function public.is_staff() returns boolean language sql as $$select true$$;`);
  await db.exec(read("20261202000000_staff_advance_category_switch"));
  await db.exec(read("20261203000000_staff_advance_item_switch"));
  await db.exec(read("20261204000000_staff_advance_item_delete"));
  let sequence = 100;
  const request = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
  const day = (target = order) => scalar("select finance_by_date->$2 as value from public.orders where id=$1", [target, date]);
  function advance({ category = "company", amount = 1500, version = 0, key = request(), history = false, hours = 0, receipts = [] } = {}) {
    const expenses = category === "overtime" || amount === 0 ? [] : [{ id: expenseId, type: category, detail: "Test", amount, receipts }];
    return scalar(`select public.${history ? "submit_driver_historical_finance" : "submit_driver_finance"}($1,$2,$3,$4,$5,$6) as value`,
      [history ? link : assignment, category, version, key, JSON.stringify(expenses), hours]);
  }
  function fuel({ amount = 6000, version = 0, key = request(), target = assignment, receipts = [] } = {}) {
    return scalar("select public.submit_driver_daily_fuel($1,$2,$3,$4,$5,$6) as value",
      [date, target, version, key, amount, JSON.stringify(receipts)]);
  }
  return { db, scalar, day, advance, fuel, request };
}

test("staff deletes one expense, reverses only its amount and preserves photos in audit, other details and driver editability", async t => {
  const { db, scalar, day, advance } = await fixture(t);
  const photo = `${driver}/${assignment}/company/${ids[16]}.jpg`;
  await db.query("insert into storage.objects values('driver-finance-receipts',$1)", [photo]);
  const c = await advance({ receipts: [photo] });
  const item = { id: ids[9], type: "company", detail: "Keep", amount: 300, receipts: [] };
  await db.query("update public.driver_finance_claims set expenses=expenses||$2::jsonb where claim_id=$1",
    [c.claim_id, JSON.stringify([item])]);
  await db.exec(`update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverAdvanceCompanyReport}','1900') where id='${order}'`);
  const run = (version = c.version, expense = expenseId) => scalar(
    "select public.staff_delete_advance_item($1,$2,$3,$4,$5) as value", [order, date, c.claim_id, version, expense]);
  await assert.rejects(run(c.version, ids[19]), /Expense changed/);
  await db.exec(`update public.profiles set region_id='${ids[15]}'`);
  await assert.rejects(run(), /access required/);
  await db.exec(`update public.profiles set region_id='${region}'`);
  await db.exec(`update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverAdvanceCompanyReport}','100') where id='${order}'`);
  await assert.rejects(run(), /Booked advance changed/);
  assert.equal(await scalar("select version as value from public.driver_finance_claims where claim_id=$1", [c.claim_id]), c.version);
  await db.exec(`update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverAdvanceCompanyReport}','1900') where id='${order}'`);
  const before = await day();
  await run();
  assert.equal((await day()).driverAdvanceCompanyReport, 400);
  assert.equal((await day()).driverAdvanceTripReport, before.driverAdvanceTripReport);
  assert.equal((await day()).fuelCost, before.fuelCost);
  const updated = await scalar("select to_jsonb(c) as value from public.driver_finance_claims c where claim_id=$1", [c.claim_id]);
  assert.deepEqual(updated.expenses, [item]);
  await assert.rejects(run(), /Claim changed/);
  assert.ok((await scalar("select count(*)::int as value from public.driver_finance_events where snapshot->'expenses' @> '[{\"detail\":\"Test\"}]'")) > 0);
  assert.equal(await scalar("select count(*)::int as value from storage.objects where name=$1", [photo]), 1);
  await scalar("select public.staff_delete_advance_item($1,$2,$3,$4,$5) as value",
    [order, date, c.claim_id, updated.version, ids[9]]);
  assert.equal((await day()).driverAdvanceCompanyReport, 100);
  const empty = await scalar("select to_jsonb(c) as value from public.driver_finance_claims c where claim_id=$1", [c.claim_id]);
  await advance({ version: empty.version, amount: 500 });
  assert.equal((await day()).driverAdvanceCompanyReport, 600);
});

test("single expense switch transfers only its amount and all photos and keeps other source details in order", async t => {
  const { db, scalar, day, request } = await fixture(t);
  const photos = [ids[12], ids[13]].map(id => `${driver}/${assignment}/company/${id}.jpg`);
  for (const path of photos) await db.query("insert into storage.objects values('driver-finance-receipts',$1)", [path]);
  const expenses = [
    { id: ids[8], type: "company", detail: "Parking", amount: 1000, receipts: [] },
    { id: ids[9], type: "company", detail: "Toll", amount: 2000, receipts: photos },
    { id: ids[10], type: "company", detail: "Other", amount: 3000, receipts: [] },
  ];
  const c = await scalar("select public.submit_driver_finance($1,'company',0,$2,$3,0) as value",
    [assignment, request(), JSON.stringify(expenses)]);
  const run = (expense = ids[9], version = c.version) => scalar(
    "select public.staff_switch_advance_item($1,$2,$3,$4,'trip',$5) as value",
    [order, date, c.claim_id, version, expense]);
  await assert.rejects(run(ids[19]), /Expense changed/);
  assert.equal((await day()).driverAdvanceCompanyReport, 6100);
  await run();
  const source = await scalar("select to_jsonb(c) as value from public.driver_finance_claims c where claim_id=$1", [c.claim_id]);
  const dest = await scalar("select to_jsonb(c) as value from public.driver_finance_claims c where assignment_id=$1 and category='trip'", [assignment]);
  assert.deepEqual(source.expenses, [expenses[0], expenses[2]]);
  assert.deepEqual(dest.expenses, [{ ...expenses[1], type: "trip" }]);
  assert.equal((await day()).driverAdvanceCompanyReport, 4100);
  assert.equal((await day()).driverAdvanceTripReport, 2200);
  await assert.rejects(run(), /Claim changed/);
  const listing = await scalar("select public.staff_order_advances($1,$2) as value", [order, date]);
  assert.equal(listing.find(item => item.claimId === c.claim_id).expenses.length, 2);
  await scalar("select public.staff_switch_advance_item($1,$2,$3,$4,'company',$5) as value",
    [order, date, dest.claim_id, dest.version, ids[9]]);
  assert.equal((await day()).driverAdvanceCompanyReport, 6100);
  assert.equal((await day()).driverAdvanceTripReport, 200);
});

test("staff advance switch moves receipts and money both directions, merges historical claims, audits and rejects stale versions", async t => {
  const { db, scalar, day, advance, request } = await fixture(t);
  const receipts = [`${driver}/${assignment}/company/${ids[11]}.jpg`];
  await db.query("insert into storage.objects values('driver-finance-receipts',$1)", [receipts[0]]);
  const source = await advance({ receipts });
  const switchClaim = (c, category) => scalar(
    "select public.staff_switch_advance_category($1,$2,$3,$4,$5) as value",
    [order, date, c.claim_id, c.version, category]);
  const before = await day();
  await switchClaim(source, "trip");
  let f = await day();
  assert.equal(f.driverAdvanceCompanyReport, 100);
  assert.equal(f.driverAdvanceTripReport, 1700);
  assert.equal(f.fuelCost, before.fuelCost);
  assert.equal(f.fixedWage, before.fixedWage);
  const target = await scalar("select to_jsonb(c) as value from public.driver_finance_claims c where assignment_id=$1 and category='trip'", [assignment]);
  assert.deepEqual(target.expenses[0].receipts, receipts);
  assert.equal(target.expenses[0].type, "trip");
  await assert.rejects(switchClaim(source, "trip"), /Claim changed/);
  const targetEdited = await advance({ category: "trip", version: target.version, receipts });
  await switchClaim(targetEdited, "company");
  f = await day(); assert.equal(f.driverAdvanceCompanyReport, 1600); assert.equal(f.driverAdvanceTripReport, 200);
  const current = await scalar("select to_jsonb(c) as value from public.driver_finance_claims c where claim_id=$1", [source.claim_id]);
  assert.equal(current.expenses[0].amount, 1500);
  assert.ok(current.version > source.version);
  await assert.rejects(advance({ version: source.version, key: request() }), /version|changed/i);
  const edited = await advance({ version: current.version, amount: 1200 });
  assert.equal((await day()).driverAdvanceCompanyReport, 1300);
  const historicalSource = await advance({ history: true, amount: 300 });
  await db.exec(`update public.driver_finance_claims set expenses=jsonb_set(expenses,'{0,id}','"${ids[9]}"')
    where claim_id='${historicalSource.claim_id}'`);
  const historicalTarget = await advance({ history: true, category: "trip", amount: 400 });
  await switchClaim(historicalSource, "trip");
  const merged = await scalar("select to_jsonb(c) as value from public.driver_finance_claims c where claim_id=$1", [historicalTarget.claim_id]);
  assert.equal(merged.expenses.length, 2);
  assert.equal(merged.expenses.reduce((sum, item) => sum + item.amount, 0), 700);
  const listed = await scalar("select public.staff_order_advances($1,$2) as value", [order, date]);
  assert.equal(listed.length, 2);
  assert.ok(listed.some(item => item.claimId === edited.claim_id && item.amount === 1200));
  assert.ok((await scalar("select count(*)::int as value from public.driver_finance_events")) >= 10);
});

test("staff category switch rolls back on wrong region, wrong order, target pending, underflow and overflow", async t => {
  const { db, scalar, day, advance } = await fixture(t);
  const c = await advance();
  const run = (target = order) => scalar("select public.staff_switch_advance_category($1,$2,$3,$4,'trip') as value",
    [target, date, c.claim_id, c.version]);
  await assert.rejects(run(otherOrder), /subject changed/);
  const unclaimed = `${driver}/${assignment}/company/${ids[12]}.jpg`;
  await db.query("insert into storage.objects values('driver-finance-receipts',$1)", [unclaimed]);
  await assert.rejects(advance({ category: "trip", receipts: [unclaimed] }), /Receipt not available/);
  await db.exec(`update public.profiles set region_id='${ids[10]}'`);
  await assert.rejects(run(), /access required/);
  await db.exec(`update public.profiles set region_id='${region}'`);
  await db.exec(`insert into public.driver_finance_claims(assignment_id,driver_id,region_id,category,status,expenses)
    values('${assignment}','${driver}','${region}','trip','pending','[]')`);
  const before = await day();
  await assert.rejects(run(), /review first/);
  assert.deepEqual(await day(), before);
  await db.exec(`update public.driver_finance_claims set status='approved' where category='trip';
    update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverAdvanceCompanyReport}','10') where id='${order}'`);
  await assert.rejects(run(), /Booked advance changed/);
  await db.exec(`update public.orders set finance_by_date=jsonb_set(
    jsonb_set(finance_by_date,'{${date},driverAdvanceCompanyReport}','1600'),
    '{${date},driverAdvanceTripReport}','99999999999999') where id='${order}'`);
  await assert.rejects(run(), /Finance limit exceeded/);
  assert.equal(await scalar("select version as value from public.driver_finance_claims where claim_id=$1", [c.claim_id]), c.version);
  await db.exec("create or replace function public.is_staff() returns boolean language sql as $$select false$$");
  await assert.rejects(run(), /Staff required/);
});

test("approved live and historical advances edit up/down, clear, retry once and preserve staff additions and audit history", async t => {
  const { db, scalar, day, advance, request } = await fixture(t);
  for (const history of [false, true]) {
    let c = await advance({ history });
    const initial = (await day()).driverAdvanceCompanyReport;
    const key = request();
    c = await advance({ history, amount: 2000, version: c.version, key });
    assert.equal(c.status, "approved");
    assert.equal((await day()).driverAdvanceCompanyReport, initial + 500);
    const events = await scalar("select count(*)::int as value from public.driver_finance_events");
    await advance({ history, amount: 2000, version: c.version - 2, key });
    assert.equal(await scalar("select count(*)::int as value from public.driver_finance_events"), events);
    await assert.rejects(advance({ history, amount: 2000, version: c.version - 2 }), /already submitted|changed/);
    await db.exec(`update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverAdvanceCompanyReport}',
      to_jsonb((finance_by_date->'${date}'->>'driverAdvanceCompanyReport')::numeric+300)) where id='${order}';`);
    c = await advance({ history, amount: 100, version: c.version });
    assert.equal((await day()).driverAdvanceCompanyReport, initial - 1100);
    c = await advance({ history, amount: 0, version: c.version });
    assert.equal((await day()).driverAdvanceCompanyReport, initial - 1200);
    assert.equal(c.review_note, "修改后按差额更新入账");
    assert.equal((await day()).fixedWage, 5000);
    assert.ok(await scalar("select exists(select 1 from public.driver_finance_events where snapshot->>'status'='approved') as value"));
  }
  let trip = await advance({ category: "trip", amount: 300 });
  await advance({ category: "trip", amount: 800, version: trip.version });
  assert.equal((await day()).driverAdvanceTripReport, 1000);
  assert.equal((await day()).fuelCost, 2000);
  assert.equal(await scalar(`select finance_by_date->'2026-10-02'->>'fuelCost' as value from public.orders where id='${order}'`), "99");
});

test("fuel corrections and reassignment remove the previous contribution exactly once and retain unrelated order costs", async t => {
  const { scalar, day, fuel, request } = await fixture(t);
  let c = await fuel();
  assert.equal((await day()).fuelCost, 8000);
  c = await fuel({ amount: 4000, version: c.version });
  assert.equal((await day()).fuelCost, 6000);
  const key = request();
  const version = c.version;
  c = await fuel({ target: otherAssignment, amount: 7000, version, key });
  assert.equal((await day()).fuelCost, 2000);
  assert.equal((await day(otherOrder)).fuelCost, 7500);
  const events = await scalar("select count(*)::int as value from public.driver_daily_fuel_events");
  await fuel({ target: otherAssignment, amount: 7000, version, key });
  assert.equal(await scalar("select count(*)::int as value from public.driver_daily_fuel_events"), events);
  c = await fuel({ target: otherAssignment, amount: 0, version: c.version });
  assert.equal((await day(otherOrder)).fuelCost, 500);
  assert.equal((await day()).driverAdvanceCompanyReport, 100);
  assert.equal(c.amount, 0);
});

test("pending and rejected revisions have no old booked contribution; overtime posts immediately and recalculates both rates", async t => {
  const { db, day, advance } = await fixture(t);
  let c = await advance();
  await db.exec(`update public.driver_finance_claims set status='pending' where claim_id='${c.claim_id}';
    update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverAdvanceCompanyReport}','100') where id='${order}';`);
  c = await advance({ version: c.version, amount: 800 });
  assert.equal((await day()).driverAdvanceCompanyReport, 900);
  await db.exec(`update public.driver_finance_claims set status='rejected' where claim_id='${c.claim_id}';
    update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverAdvanceCompanyReport}','100') where id='${order}';`);
  c = await advance({ version: c.version, amount: 500 });
  assert.equal((await day()).driverAdvanceCompanyReport, 600);
  let overtime = await advance({ category: "overtime", hours: 2 });
  assert.equal(overtime.status, "approved");
  assert.equal((await day()).driverOvertimeHours, 2);
  assert.equal((await day()).driverOvertimeFee, 3000);
  assert.equal((await day()).overtimeRequestAmount, 4000);
  overtime = await advance({ category: "overtime", hours: 3, version: overtime.version });
  assert.equal(overtime.status, "approved");
  assert.equal((await day()).driverOvertimeHours, 3);
  assert.equal((await day()).driverOvertimeFee, 4500);
  assert.equal((await day()).overtimeRequestAmount, 6000);
  overtime = await advance({ category: "overtime", hours: 1.5, version: overtime.version });
  assert.equal(overtime.status, "approved");
  assert.equal((await day()).driverOvertimeHours, 1.5);
  assert.equal((await day()).driverOvertimeFee, 2250);
  assert.equal((await day()).overtimeRequestAmount, 3000);
  await advance({ category: "overtime", hours: 0, version: overtime.version });
  assert.equal((await day()).driverOvertimeFee, 0);
  assert.equal((await day()).overtimeRequestAmount, 0);
});

test("revisions roll back claim and money on underflow, overflow, changed overtime, driver or revoked assignment", async t => {
  const { db, scalar, day, advance, fuel } = await fixture(t);
  const c = await advance();
  await db.exec(`update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverAdvanceCompanyReport}','100') where id='${order}';`);
  await assert.rejects(advance({ version: c.version, amount: 2000 }), /Booked advance changed/);
  assert.equal(await scalar("select version as value from public.driver_finance_claims where category='company'"), c.version);
  assert.equal((await day()).driverAdvanceCompanyReport, 100);
  await db.exec(`update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverAdvanceCompanyReport}','99999999999999') where id='${order}';`);
  await assert.rejects(advance({ version: c.version, amount: 2000 }), /Finance limit exceeded/);
  const f = await fuel();
  await db.exec(`update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},fuelCost}','1') where id='${order}';`);
  await assert.rejects(fuel({ version: f.version, amount: 100 }), /Booked fuel changed/);
  assert.equal(await scalar("select version as value from public.driver_daily_fuel"), f.version);
  await db.exec(`update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},fuelCost}','8000') where id='${order}';
    update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},fuelCost}','99999999999999') where id='${otherOrder}';`);
  await assert.rejects(fuel({ version: f.version, amount: 1, target: otherAssignment }), /Fuel cost limit exceeded/);
  assert.equal((await day()).fuelCost, 8000);
  const ot = await advance({ category: "overtime", hours: 2 });
  await db.exec(`update public.driver_finance_claims set status='approved' where claim_id='${ot.claim_id}';
    update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverOvertimeHours}','4') where id='${order}';`);
  await assert.rejects(advance({ category: "overtime", hours: 1, version: ot.version }), /Booked overtime changed/);
  await db.exec(`update public.orders set driver='Different Driver' where id='${order}';`);
  await assert.rejects(advance({ version: c.version }), /Order finance or driver changed/);
  await db.exec(`update public.driver_assignments set status='revoked' where id='${assignment}';`);
  await assert.rejects(advance({ version: c.version }), /own trip required/);
});

test("historical and formerly pending overtime replace existing hours, retry once and preserve other finances", async t => {
  const { db, scalar, day, advance, request } = await fixture(t);
  await db.exec(`update public.orders set finance_by_date=jsonb_set(finance_by_date,'{${date},driverOvertimeHours}','7') where id='${order}';`);
  const key = request();
  let c = await advance({ category: "overtime", history: true, hours: 1.25, key });
  assert.equal(c.status, "approved");
  assert.equal((await day()).driverOvertimeHours, 1.25);
  await advance({ category: "overtime", history: true, hours: 1.25, key });
  assert.equal((await day()).driverOvertimeHours, 1.25);
  await db.exec(`update public.driver_finance_claims set status='pending' where claim_id='${c.claim_id}';`);
  c = await advance({ category: "overtime", history: true, hours: 0.5, version: c.version });
  assert.equal(c.status, "approved");
  assert.equal((await day()).driverOvertimeFee, 750);
  assert.equal((await day()).overtimeRequestAmount, 1000);
  assert.equal((await day()).fixedWage, 5000);
  assert.equal((await day()).fuelCost, 2000);
  assert.ok(await scalar("select exists(select 1 from public.driver_finance_events where snapshot->>'category'='overtime') as value"));
});

test("receipt editing stays limited to own eligible trips and internal revision functions cannot be called by clients", async t => {
  const { db, scalar, advance, fuel } = await fixture(t);
  let c = await advance();
  const path = `${driver}/${assignment}/company/${expenseId}.jpg`;
  const fuelPath = `${driver}/${date}/${expenseId}.jpg`;
  const historyPath = `${driver}/${link}/trip/${expenseId}.jpg`;
  await db.query("insert into storage.objects values('driver-finance-receipts',$1),('driver-fuel-receipts',$2)", [path, fuelPath]);
  assert.equal(await scalar("select public.can_access_driver_receipt($1,true) as value", [path]), true);
  assert.equal(await scalar("select public.can_access_driver_receipt($1,true) as value", [historyPath]), true);
  assert.equal(await scalar("select public.can_access_driver_receipt($1,true) as value", [path.replace(driver, ids[18])]), false);
  c = await advance({ version: c.version, receipts: [path] });
  assert.deepEqual(c.expenses[0].receipts, [path]);
  c = await advance({ version: c.version, receipts: [] });
  assert.deepEqual(c.expenses[0].receipts, []);
  let f = await fuel();
  assert.equal(await scalar("select public.can_access_driver_fuel_receipt($1,true) as value", [fuelPath]), true);
  f = await fuel({ version: f.version, receipts: [fuelPath] });
  assert.deepEqual(f.receipts, [fuelPath]);
  assert.equal(await scalar("select has_function_privilege('authenticated','public.apply_driver_finance_revision(uuid,public.driver_finance_claims)','execute') as value"), false);
  assert.equal(await scalar("select has_function_privilege('authenticated','public.apply_driver_fuel_revision(uuid,public.driver_daily_fuel)','execute') as value"), false);
  await db.exec(`update public.driver_assignments set status='revoked' where id='${assignment}';`);
  assert.equal(await scalar("select public.can_access_driver_receipt($1,true) as value", [path]), false);
  assert.equal(await scalar("select public.can_access_driver_fuel_receipt($1,true) as value", [fuelPath]), true);
  await db.exec(`update public.driver_assignments set status='revoked';`);
  assert.equal(await scalar("select public.can_access_driver_fuel_receipt($1,true) as value", [fuelPath]), false);
});
