begin;

create temporary table audit_test_context as select
  gen_random_uuid() as admin_id, gen_random_uuid() as user_id,
  gen_random_uuid() as driver_id, gen_random_uuid() as vehicle_id,
  gen_random_uuid() as order_id, gen_random_uuid() as company_id,
  gen_random_uuid() as source_id, gen_random_uuid() as monthly_id,
  gen_random_uuid() as expense_id;
grant select on audit_test_context to authenticated;

create function pg_temp.audit_assert(p_pass boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_pass is distinct from true then raise exception 'FAIL: %', p_message; end if;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data)
  select admin_id, admin_id || '@audit-test.invalid', '{"full_name":"Audit Admin"}'::jsonb
  from audit_test_context
  union all
  select user_id, user_id || '@audit-test.invalid', '{"full_name":"Audit User"}'::jsonb
  from audit_test_context;
update public.profiles set role = 'admin'
  where id = (select admin_id from audit_test_context);

select set_config('request.jwt.claims',
  jsonb_build_object('sub', admin_id::text, 'role', 'authenticated')::text, true)
  from audit_test_context;
set local role authenticated;

insert into public.drivers (id, name)
  select driver_id, driver_id::text from audit_test_context;
select pg_temp.audit_assert(
  (select count(*) = 1 from public.audit_logs where record_id = (select driver_id from audit_test_context)),
  'insert produces exactly one event');
insert into public.drivers (id, name)
  select driver_id, driver_id::text from audit_test_context
  on conflict (id) do update set name = excluded.name;
select pg_temp.audit_assert(
  (select count(*) = 1 from public.audit_logs where record_id = (select driver_id from audit_test_context)),
  'no-op upsert does not create a phantom INSERT or UPDATE');
select pg_temp.audit_assert(
  (select last_operation ->> 'actorId' = (select admin_id::text from audit_test_context)
    and last_operation ->> 'actorName' = 'Audit Admin' from public.drivers
    where id = (select driver_id from audit_test_context)),
  'operator comes from the authenticated session');

insert into public.vehicles (id, name)
  select vehicle_id, vehicle_id::text from audit_test_context;
insert into public.companies (id, name, seal_image)
  select company_id, company_id::text,
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
  from audit_test_context;
insert into public.order_sources (id, company_name)
  select source_id, source_id::text from audit_test_context;
insert into public.orders (id, date, end_date, customer, company, status)
  select order_id, '2026-10-16', '2026-10-16', order_id::text, company_id::text, '予約確定'
  from audit_test_context;
insert into public.vehicle_monthly_finances (id, region_id, vehicle_id, month)
  select monthly_id, '60000000-0000-4000-8000-000000000001', vehicle_id, '2026-10'
  from audit_test_context;
insert into public.balance_expense_items (id, region_id, company_name, name)
  select expense_id, '60000000-0000-4000-8000-000000000001', company_id::text, expense_id::text
  from audit_test_context;

select set_config('request.jwt.claims',
  jsonb_build_object('sub', user_id::text, 'role', 'authenticated')::text, true)
  from audit_test_context;
update public.drivers set phone = '123', last_operation = '{"actorName":"FORGED"}'
  where id = (select driver_id from audit_test_context);
select pg_temp.audit_assert(
  (select last_operation ->> 'actorName' = 'Audit User' from public.drivers
    where id = (select driver_id from audit_test_context)),
  'client cannot forge operator metadata');
update public.drivers set last_operation = '{"actorName":"FORGED AGAIN"}'
  where id = (select driver_id from audit_test_context);
select pg_temp.audit_assert(
  (select last_operation ->> 'actorName' = 'Audit User' from public.drivers
    where id = (select driver_id from audit_test_context)),
  'metadata-only writes preserve the last real operator');
select pg_temp.audit_assert((select count(*) = 0 from public.audit_logs),
  'ordinary users cannot read any audit history');
do $$ begin
  begin
    delete from public.audit_logs;
    raise exception 'FAIL: ordinary user can delete logs';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.audit_logs(actor_name, table_name, record_id, record_label, action)
    values ('FORGED', 'drivers', gen_random_uuid(), 'FORGED', 'INSERT');
    raise exception 'FAIL: ordinary user can insert logs';
  exception when insufficient_privilege then null;
  end;
end; $$;

select public.allocate_invoice_number(order_id, company_id) from audit_test_context;
select public.allocate_invoice_number(order_id, company_id) from audit_test_context;
update public.orders set finance_by_date = '{"2026-10-16":{"fuelCost":100}}'
  where id = (select order_id from audit_test_context);

reset role;
select set_config('request.jwt.claims',
  jsonb_build_object('sub', admin_id::text, 'role', 'authenticated')::text, true)
  from audit_test_context;
set local role authenticated;
select pg_temp.audit_assert(
  (select count(*) = 2 from public.audit_logs where record_id = (select driver_id from audit_test_context)),
  'one real update, no phantom upsert or metadata event');
select pg_temp.audit_assert(
  (select count(*) = 1 from public.audit_logs where table_name = 'invoice_numbers'
    and record_id = (select order_id from audit_test_context)),
  'reusing an invoice number does not create another allocation');
select pg_temp.audit_assert(
  (select before_data ->> 'phone' = '' and after_data ->> 'phone' = '123'
    and actor_name = 'Audit User' from public.audit_logs
    where record_id = (select driver_id from audit_test_context) and action = 'UPDATE'),
  'before and after snapshots identify the actual user');
select pg_temp.audit_assert(
  (select after_data ->> 'seal_image' like '[PNG:%]'
    and after_data::text not like '%data:image%'
    and not (after_data ? 'last_operation')
    from public.audit_logs where record_id = (select company_id from audit_test_context)),
  'seal image contents and operational metadata are excluded from snapshots');
select pg_temp.audit_assert(
  (select count(distinct table_name) = 8 from public.audit_logs
    where record_id in (select driver_id from audit_test_context
      union all select vehicle_id from audit_test_context
      union all select company_id from audit_test_context
      union all select source_id from audit_test_context
      union all select order_id from audit_test_context
      union all select monthly_id from audit_test_context
      union all select expense_id from audit_test_context)),
  'all eight business tables are covered');

reset role;
create function pg_temp.audit_test_failure()
returns trigger language plpgsql as $$
begin
  if new.record_id = (select driver_id from audit_test_context) then
    raise exception 'intentional audit failure';
  end if;
  return new;
end; $$;
create trigger audit_test_failure before insert on public.audit_logs
  for each row execute function pg_temp.audit_test_failure();
do $$ begin
  begin
    update public.drivers set phone = 'MUST ROLLBACK'
      where id = (select driver_id from audit_test_context);
    raise exception 'FAIL: audit failure did not reject business write';
  exception when raise_exception then
    if sqlerrm <> 'intentional audit failure' then raise; end if;
  end;
end; $$;
drop trigger audit_test_failure on public.audit_logs;
select pg_temp.audit_assert(
  (select phone = '123' from public.drivers where id = (select driver_id from audit_test_context)),
  'audit failure rolls back the business write');

set local role authenticated;
delete from public.vehicles where id = (select vehicle_id from audit_test_context);
delete from public.orders where id = (select order_id from audit_test_context);
delete from public.drivers where id = (select driver_id from audit_test_context);
select pg_temp.audit_assert(
  (select count(*) = 2 from public.audit_logs where table_name = 'vehicle_monthly_finances'
    and record_id = (select monthly_id from audit_test_context)),
  'cascaded monthly-expense deletion is retained');
select pg_temp.audit_assert(
  (select count(*) = 2 from public.audit_logs where table_name = 'invoice_numbers'
    and record_id = (select order_id from audit_test_context)),
  'cascaded invoice-number deletion is retained');
select pg_temp.audit_assert(
  (select count(*) = 3 from public.audit_logs where record_id = (select driver_id from audit_test_context)),
  'deleted business record retains INSERT, UPDATE and DELETE history');
reset role;
delete from auth.users where id = (select user_id from audit_test_context);
select pg_temp.audit_assert(
  (select count(*) > 0 from public.audit_logs
    where actor_id = (select user_id from audit_test_context) and actor_name = 'Audit User'),
  'deleting an operator account does not erase history');

select 'PASS: eight business tables, real/no-op upserts, operator attribution, forgery protection, admin-only history, invoice reuse, snapshots, image redaction, atomic failure rollback, cascade deletion, deleted actor retention' as result;
rollback;
