begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values
 ('f2900290-0000-4000-8000-000000000001','Manager A'),
 ('f2900290-0000-4000-8000-000000000002','Manager B');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900290-0000-4000-8000-000000000001','manager-staff@example.invalid','{}');
update public.profiles set account_type='staff',role='user',region_id='f2900290-0000-4000-8000-000000000001'
 where id='f1900290-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('f3900290-0000-4000-8000-000000000001','Manager fixture driver','f2900290-0000-4000-8000-000000000001');
insert into public.companies(id,name,operations_manager,maintenance_manager,region_id) values
 ('f4900290-0000-4000-8000-000000000001','Manager fixture owner','Correct operations manager','Not operations manager','f2900290-0000-4000-8000-000000000001'),
 ('f4900290-0000-4000-8000-000000000002','Manager fixture foreign owner','Private foreign manager','','f2900290-0000-4000-8000-000000000002');
insert into public.vehicles(id,name,plate,owner_company,region_id) values
 ('f5900290-0000-4000-8000-000000000001','Manager fixture vehicle','Manager fixture plate','Manager fixture owner','f2900290-0000-4000-8000-000000000001');
insert into public.driver_daily_reports(id,driver_id,region_id,service_date,departed_at,departure_address,departure_km,
 header,created_by,updated_by) values
 ('f6900290-0000-4000-8000-000000000001','f3900290-0000-4000-8000-000000000001','f2900290-0000-4000-8000-000000000001',
 (now() at time zone 'Asia/Tokyo')::date,now(),'Manager fixture depot',100,
 '{"vehicleNumber":"Manager fixture plate","driverName":"","passengerCount":null}',
 'f1900290-0000-4000-8000-000000000001','f1900290-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900290-0000-4000-8000-000000000001',true);
do $test$
declare row jsonb;
begin
 select e into row from jsonb_array_elements(public.staff_operation_reports(to_char(now() at time zone 'Asia/Tokyo','YYYY-MM'))) e
 where e->'report'->>'id'='f6900290-0000-4000-8000-000000000001';
 if row->>'company' is distinct from 'Manager fixture owner'
 or row->>'operationsManager' is distinct from 'Correct operations manager' then
  raise exception 'Wrong company manager mapping'; end if;
 if row::text like '%Not operations manager%' or row::text like '%Private foreign manager%' then
  raise exception 'Unrelated manager leaked'; end if;
end;
$test$;
reset role;
-- A vehicle referencing only an out-of-region company must not reveal that manager.
update public.vehicles set owner_company='Manager fixture foreign owner' where id='f5900290-0000-4000-8000-000000000001';
set local role authenticated;
do $test$
declare row jsonb;
begin
 select e into row from jsonb_array_elements(public.staff_operation_reports(to_char(now() at time zone 'Asia/Tokyo','YYYY-MM'))) e
 where e->'report'->>'id'='f6900290-0000-4000-8000-000000000001';
 if row->>'operationsManager' is not null then raise exception 'Cross-region manager mapping'; end if;
end;
$test$;
reset role;
update public.driver_daily_reports set header=jsonb_set(header,'{vehicleNumber}','"Unknown fixture plate"')
 where id='f6900290-0000-4000-8000-000000000001';
set local role authenticated;
do $test$
declare row jsonb;
begin
 select e into row from jsonb_array_elements(public.staff_operation_reports(to_char(now() at time zone 'Asia/Tokyo','YYYY-MM'))) e
 where e->'report'->>'id'='f6900290-0000-4000-8000-000000000001';
 if row->>'company' is not null or row->>'operationsManager' is not null then raise exception 'Missing vehicle mapping'; end if;
end;
$test$;
select 'operations_manager_mapping_checks_passed' as result;
rollback;
