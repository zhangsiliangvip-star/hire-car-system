import test from "node:test";
import assert from "node:assert/strict";
import { buildDriverProductionMigration } from "../scripts/build-driver-production-migration.mjs";

test("production migration is atomic, provenance-tracked and excludes test fixtures", () => {
  const sql = buildDriverProductionMigration();
  assert.equal(sql.match(/^begin;$/gm)?.length, 1);
  assert.equal(sql.match(/^commit;$/gm)?.length, 1);
  assert.equal(sql.match(/^-- Source:/gm)?.length, 29);
  assert.equal(sql.match(/SHA256: [a-f0-9]{64}/g)?.length, 29);
  assert.doesNotMatch(sql, /Expected the two inspected legacy staff profiles/);
  assert.doesNotMatch(sql, /create table public\.driver_wage_items/);
  assert.doesNotMatch(sql, /demo_driver_a_ready|driver-a@pwa-test|f4000000-0000/);
  assert.match(sql, /Existing business data changed during migration/);
  assert.match(sql, /Initial migration must not introduce driver accounts or dispatch fixtures/);
  assert.match(sql, /create table public\.driver_historical_finance_links/);
  assert.match(sql, /create function public\.driver_historical_orders/);
  assert.match(sql, /create function public\.submit_driver_historical_finance/);
});

test("historical finance migration drops the assignment-key before allowing null assignments", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(new URL("../supabase/migrations/20261115000000_driver_historical_finance.sql", import.meta.url), "utf8");
  assert.ok(sql.indexOf("drop constraint driver_finance_claims_pkey") < sql.indexOf("alter column assignment_id drop not null"));
  assert.ok(sql.indexOf("alter column assignment_id drop not null") < sql.indexOf("primary key(claim_id)"));
});

test("formal dispatch supersedes test invalidation and cannot expose test dispatch", () => {
  const sql = buildDriverProductionMigration();
  assert.match(sql, /drop trigger revoke_test_order_assignments on public\.orders/);
  assert.match(sql, /revoke all on function public\.dispatch_test_driver_order\(uuid,uuid,date\) from authenticated/);
  assert.match(sql, /previous\.driver_id is not distinct from target/);
  assert.match(sql, /target is not null and day>=today/);
  assert.match(sql, /create trigger sync_driver_identity_orders/);
  assert.match(sql, /create trigger sync_driver_name_change/);
  assert.match(sql, /create trigger retain_driver_order_history/);
  assert.match(sql, /errcode='PDR01'/);
});
