-- Isolated synthetic fixtures; every write rolls back.
begin;
set local statement_timeout='25s';
insert into public.regions(id,name) values('f2900210-0000-4000-8000-000000000001','Fuel fixture region');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900210-0000-4000-8000-000000000001','fuel-admin@example.invalid','{}'),
 ('f1900210-0000-4000-8000-000000000002','fuel-driver@example.invalid','{}'),
 ('f1900210-0000-4000-8000-000000000003','fuel-other@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='f1900210-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('f3900210-0000-4000-8000-000000000001','Fuel driver','f2900210-0000-4000-8000-000000000001'),
 ('f3900210-0000-4000-8000-000000000002','Fuel other','f2900210-0000-4000-8000-000000000001');
insert into public.orders(id,date,end_date,status,region_id,driver,finance_by_date) values
 ('f4900210-0000-4000-8000-000000000001','2026-10-25','2026-10-26','予約確定',
 'f2900210-0000-4000-8000-000000000001','Fuel driver',
 '{"2026-10-25":{"driver":"Fuel driver","driverWage":10000,"fuelCost":100,"driverAdvanceCompanyReport":500},
 "2026-10-26":{"driver":"Fuel driver","driverWage":10000,"fuelCost":0}}'),
 ('f4900210-0000-4000-8000-000000000002','2026-10-25','2026-10-25','予約確定',
 'f2900210-0000-4000-8000-000000000001','Fuel driver',
 '{"2026-10-25":{"driver":"Fuel driver","driverWage":10000,"fuelCost":200}}');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900210-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900210-0000-4000-8000-000000000002','f3900210-0000-4000-8000-000000000001');
select public.bind_driver_identity('f1900210-0000-4000-8000-000000000003','f3900210-0000-4000-8000-000000000002');
select set_config('fuel.a',public.dispatch_test_driver_order(
 'f4900210-0000-4000-8000-000000000001','f3900210-0000-4000-8000-000000000001','2026-10-25')::text,true);
select set_config('fuel.b',public.dispatch_test_driver_order(
 'f4900210-0000-4000-8000-000000000002','f3900210-0000-4000-8000-000000000001','2026-10-25')::text,true);
select set_config('fuel.c',public.dispatch_test_driver_order(
 'f4900210-0000-4000-8000-000000000001','f3900210-0000-4000-8000-000000000001','2026-10-26')::text,true);
reset role;
update public.driver_assignments set status='completed' where id in
 (current_setting('fuel.a')::uuid,current_setting('fuel.b')::uuid,current_setting('fuel.c')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900210-0000-4000-8000-000000000002',true);
do $test$
declare a uuid:=current_setting('fuel.a')::uuid; b uuid:=current_setting('fuel.b')::uuid;
 request uuid:=gen_random_uuid(); result jsonb; fuel_id uuid; path text;
begin
 begin perform public.submit_driver_daily_fuel('2026-10-26',a,0,request,1000,'[]'); raise exception 'Wrong service date accepted';
 exception when insufficient_privilege then null; end;
 begin perform public.submit_driver_daily_fuel('2026-10-25',a,0,request,0,'[]'); raise exception 'Zero fuel accepted';
 exception when invalid_parameter_value then null; end;
 path:='f1900210-0000-4000-8000-000000000002/2026-10-25/f7900210-0000-4000-8000-000000000001.jpg';
 if not public.can_access_driver_fuel_receipt(path,true) then raise exception 'Own day photo denied'; end if;
 begin perform public.submit_driver_daily_fuel('2026-10-25',a,0,request,1000,jsonb_build_array(path));
  raise exception 'Missing stored receipt accepted'; exception when insufficient_privilege then null; end;
 result:=public.submit_driver_daily_fuel('2026-10-25',a,0,request,1000,'[]');
 fuel_id:=(result->>'id')::uuid;
 if result->>'assignmentId'<>a::text or result->>'status'<>'pending' then raise exception 'Submit shape'; end if;
 if public.submit_driver_daily_fuel('2026-10-25',a,0,request,1000,'[]')<>result then raise exception 'Replay failed'; end if;
 begin perform public.submit_driver_daily_fuel('2026-10-25',b,0,request,1000,'[]');
  raise exception 'Changed order replay accepted'; exception when serialization_failure then null; end;
 begin perform public.submit_driver_daily_fuel('2026-10-25',b,0,gen_random_uuid(),1000,'[]');
  raise exception 'Second order duplicate daily cost'; exception when serialization_failure then null; end;
 if public.can_access_driver_fuel_receipt(path,true) then raise exception 'Pending upload mutable'; end if;
 if exists(select 1 from public.driver_daily_fuel_costs) then raise exception 'Pending/driver ledger leak'; end if;
 begin perform 1 from public.driver_daily_fuel; raise exception 'Raw fuel readable'; exception when insufficient_privilege then null; end;
 begin perform public.review_driver_daily_fuel(fuel_id,1,'approved',''); raise exception 'Driver reviewed';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','f1900210-0000-4000-8000-000000000003',true);
 if public.driver_daily_fuel_data('2026-10')<>'[]' or public.can_access_driver_fuel_receipt(path,false) then raise exception 'Other driver read'; end if;
 begin perform public.submit_driver_daily_fuel('2026-10-25',a,0,gen_random_uuid(),1000,'[]');
  raise exception 'Other driver wrote'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','f1900210-0000-4000-8000-000000000001',true);
 if exists(select 1 from public.driver_daily_fuel_costs) then raise exception 'Pending cost booked'; end if;
 if (select finance_by_date->'2026-10-25'->>'fuelCost' from public.orders
  where id='f4900210-0000-4000-8000-000000000001') is distinct from '100' then raise exception 'Pending fuel changed order'; end if;
 result:=public.review_driver_daily_fuel(fuel_id,1,'approved','Checked');
 if result->>'version'<>'2' then raise exception 'Review version'; end if;
 if (select count(*) from public.driver_daily_fuel_costs)<>1 then raise exception 'Approved ledger missing'; end if;
 begin perform public.review_driver_daily_fuel(fuel_id,1,'approved',''); raise exception 'Double review';
 exception when serialization_failure then null; end;
 perform set_config('request.jwt.claim.sub','f1900210-0000-4000-8000-000000000002',true);
 if public.driver_finance_data('2026-10')->'wages'->0->>'base' is distinct from '10000'
 or public.driver_finance_data('2026-10')->'wages'->0->>'advances' is distinct from '500' then
  raise exception 'Fuel incorrectly added to wages/advances'; end if;
 result:=public.submit_driver_daily_fuel('2026-10-26',current_setting('fuel.c')::uuid,0,gen_random_uuid(),1500,'[]');
 fuel_id:=(result->>'id')::uuid;
 perform set_config('request.jwt.claim.sub','f1900210-0000-4000-8000-000000000001',true);
 update public.orders set finance_by_date=jsonb_set(finance_by_date,'{2026-10-26,fuelCost}','50')
 where id='f4900210-0000-4000-8000-000000000001';
 begin perform public.review_driver_daily_fuel(fuel_id,1,'approved',''); raise exception 'Concurrent fuel overwritten';
 exception when serialization_failure then null; end;
 result:=public.review_driver_daily_fuel(fuel_id,1,'rejected','Reconcile');
 perform set_config('request.jwt.claim.sub','f1900210-0000-4000-8000-000000000002',true);
 result:=public.submit_driver_daily_fuel('2026-10-26',current_setting('fuel.c')::uuid,2,gen_random_uuid(),1500,'[]');
 perform set_config('request.jwt.claim.sub','f1900210-0000-4000-8000-000000000001',true);
 result:=public.review_driver_daily_fuel(fuel_id,3,'approved','Checked again');
end;
$test$;
reset role;
do $test$
begin
 if (select finance_by_date->'2026-10-25'->>'fuelCost' from public.orders where id='f4900210-0000-4000-8000-000000000001')<>'1100'
 or (select finance_by_date->'2026-10-25'->>'fuelCost' from public.orders where id='f4900210-0000-4000-8000-000000000002')<>'200'
 or (select finance_by_date->'2026-10-26'->>'fuelCost' from public.orders where id='f4900210-0000-4000-8000-000000000001')<>'1550' then
  raise exception 'Wrong order/day allocation'; end if;
 if exists(select 1 from public.driver_assignments where id in
  (current_setting('fuel.a')::uuid,current_setting('fuel.b')::uuid,current_setting('fuel.c')::uuid) and status<>'completed') then
  raise exception 'Fuel approval revoked assignments'; end if;
 if (select count(*) from public.driver_daily_fuel_events where snapshot->>'driver_id'='f3900210-0000-4000-8000-000000000001')<>6 then
  raise exception 'Daily fuel audit wrong'; end if;
 if (select public from storage.buckets where id='driver-fuel-receipts') then raise exception 'Public fuel receipts'; end if;
end;
$test$;
select 'daily_fuel_checks_passed' as result;
rollback;
