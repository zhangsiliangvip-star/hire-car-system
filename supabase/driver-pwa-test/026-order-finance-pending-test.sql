-- Synthetic fixtures; every change and audit snapshot rolls back.
begin;
set local statement_timeout='25s';
insert into public.regions(id,name) values('f2900260-0000-4000-8000-000000000001','Order review fixture');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900260-0000-4000-8000-000000000001','order-review-admin@example.invalid','{}'),
 ('f1900260-0000-4000-8000-000000000002','order-review-driver@example.invalid','{}'),
 ('f1900260-0000-4000-8000-000000000003','order-review-staff@example.invalid','{}');
update public.profiles set account_type='staff',role='admin'
 where id='f1900260-0000-4000-8000-000000000001';
update public.profiles set account_type='staff',role='user',region_id='f2900260-0000-4000-8000-000000000001'
 where id='f1900260-0000-4000-8000-000000000003';
insert into public.drivers(id,name,region_id) values
 ('f3900260-0000-4000-8000-000000000001','Order review driver','f2900260-0000-4000-8000-000000000001');
insert into public.orders(id,date,end_date,status,region_id,driver,finance_by_date) values
 ('f4900260-0000-4000-8000-000000000001','2026-10-25','2026-10-26','予約確定','f2900260-0000-4000-8000-000000000001',
 'Order review driver','{"2026-10-25":{"driver":"Order review driver","driverAdvanceCompanyReport":100,"driverAdvanceTripReport":200,"driverOvertimeHours":0,"driverOvertimeRate":1000,"fuelCost":500}}'),
 ('f4900260-0000-4000-8000-000000000002','2026-10-25','2026-10-25','予約確定','f2900260-0000-4000-8000-000000000001',
 'Order review driver','{"2026-10-25":{"driver":"Order review driver","driverAdvanceCompanyReport":300}}');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900260-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900260-0000-4000-8000-000000000002','f3900260-0000-4000-8000-000000000001');
select set_config('review.a',public.dispatch_test_driver_order(
 'f4900260-0000-4000-8000-000000000001','f3900260-0000-4000-8000-000000000001','2026-10-25')::text,true);
select set_config('review.b',public.dispatch_test_driver_order(
 'f4900260-0000-4000-8000-000000000002','f3900260-0000-4000-8000-000000000001','2026-10-25')::text,true);
reset role;
update public.driver_assignments set status='completed' where id in(current_setting('review.a')::uuid,current_setting('review.b')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900260-0000-4000-8000-000000000002',true);
select public.submit_driver_finance(current_setting('review.a')::uuid,'company',0,gen_random_uuid(),
 '[{"id":"f7900260-0000-4000-8000-000000000001","type":"company","detail":"Parking","amount":1000,"receipts":[]}]',0);
select public.submit_driver_finance(current_setting('review.a')::uuid,'trip',0,gen_random_uuid(),
 '[{"id":"f7900260-0000-4000-8000-000000000002","type":"trip","detail":"Toll","amount":2000,"receipts":[]}]',0);
select public.submit_driver_finance(current_setting('review.a')::uuid,'overtime',0,gen_random_uuid(),'[]',1.5);
select public.submit_driver_finance(current_setting('review.b')::uuid,'company',0,gen_random_uuid(),
 '[{"id":"f7900260-0000-4000-8000-000000000003","type":"company","detail":"Other order","amount":3000,"receipts":[]}]',0);
select set_config('review.fuel',(public.submit_driver_daily_fuel('2026-10-25',current_setting('review.a')::uuid,0,gen_random_uuid(),4000,'[]')->>'id'),true);
do $test$
begin
 begin perform public.admin_order_finance_pending('2026-10'); raise exception 'Driver reviewed';
 exception when insufficient_privilege then null; end;
end;
$test$;
select set_config('request.jwt.claim.sub','f1900260-0000-4000-8000-000000000003',true);
do $test$
begin
 begin perform public.admin_order_finance_pending('2026-10'); raise exception 'Staff reviewed';
 exception when insufficient_privilege then null; end;
end;
$test$;
select set_config('request.jwt.claim.sub','f1900260-0000-4000-8000-000000000001',true);
do $test$
declare result jsonb; before_finance jsonb;
begin
 result:=public.admin_order_finance_pending('2026-10');
 if jsonb_array_length(result)<>5 then raise exception 'Missing pending claims'; end if;
 if (select count(*) from jsonb_array_elements(result) r where r->>'orderId'='f4900260-0000-4000-8000-000000000001')<>4
 or (select count(*) from jsonb_object_keys(result->0))<>5 then raise exception 'Incorrect order or excess projection'; end if;
 if public.admin_order_finance_pending('2026-11')<>'[]'::jsonb then raise exception 'Wrong month'; end if;
 begin perform public.admin_order_finance_pending('2026-13'); raise exception 'Invalid month allowed';
 exception when invalid_parameter_value then null; end;
 select finance_by_date into before_finance from public.orders where id='f4900260-0000-4000-8000-000000000001';
 perform public.review_driver_finance(current_setting('review.a')::uuid,'company',1,'rejected','Duplicate');
 perform public.review_driver_daily_fuel(current_setting('review.fuel')::uuid,1,'rejected','Wrong receipt');
 if (select finance_by_date from public.orders where id='f4900260-0000-4000-8000-000000000001')<>before_finance then
 raise exception 'Rejection changed booked totals'; end if;
 if jsonb_array_length(public.admin_order_finance_pending('2026-10'))<>3 then raise exception 'Rejected items not removed'; end if;
end;
$test$;
reset role;
do $test$
begin
 if not exists(select 1 from public.driver_finance_claims where assignment_id=current_setting('review.a')::uuid
   and category='company' and status='rejected' and version=2 and review_note='Duplicate')
 or not exists(select 1 from public.driver_finance_events where assignment_id=current_setting('review.a')::uuid
   and snapshot->>'status'='rejected' and snapshot->>'review_note'='Duplicate')
 or not exists(select 1 from public.driver_daily_fuel_events where fuel_id=current_setting('review.fuel')::uuid
   and snapshot->>'status'='rejected') then raise exception 'Rejection audit lost'; end if;
end;
$test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900260-0000-4000-8000-000000000002',true);
select public.submit_driver_finance(current_setting('review.a')::uuid,'company',2,gen_random_uuid(),
 '[{"id":"f7900260-0000-4000-8000-000000000004","type":"company","detail":"Corrected parking","amount":500,"receipts":[]}]',0);
select public.submit_driver_daily_fuel('2026-10-25',current_setting('review.a')::uuid,2,gen_random_uuid(),2000,'[]');
select set_config('request.jwt.claim.sub','f1900260-0000-4000-8000-000000000001',true);
do $test$
begin
 if jsonb_array_length(public.admin_order_finance_pending('2026-10'))<>5 then raise exception 'Resubmission missing'; end if;
 perform public.review_driver_finance(current_setting('review.a')::uuid,'company',3,'approved','Corrected');
 perform public.review_driver_finance(current_setting('review.a')::uuid,'trip',1,'approved','');
 perform public.review_driver_finance(current_setting('review.a')::uuid,'overtime',1,'approved','');
 perform public.review_driver_daily_fuel(current_setting('review.fuel')::uuid,3,'approved','');
 if jsonb_array_length(public.admin_order_finance_pending('2026-10'))<>1 then raise exception 'Approved claims still pending'; end if;
 begin perform public.review_driver_finance(current_setting('review.a')::uuid,'company',4,'rejected','Undo');
 raise exception 'Approved claim revoked'; exception when serialization_failure then null; end;
 begin perform public.review_driver_daily_fuel(current_setting('review.fuel')::uuid,4,'rejected','Undo');
 raise exception 'Approved fuel revoked'; exception when serialization_failure then null; end;
 if (select finance_by_date->'2026-10-25'->>'driverAdvanceCompanyReport' from public.orders where id='f4900260-0000-4000-8000-000000000001')<>'600'
 or (select finance_by_date->'2026-10-25'->>'driverAdvanceTripReport' from public.orders where id='f4900260-0000-4000-8000-000000000001')<>'2200'
 or (select (finance_by_date->'2026-10-25'->>'driverOvertimeHours')::numeric from public.orders where id='f4900260-0000-4000-8000-000000000001')<>1.5
 or (select finance_by_date->'2026-10-25'->>'fuelCost' from public.orders where id='f4900260-0000-4000-8000-000000000001')<>'2500'
 or (select finance_by_date->'2026-10-25'->>'driverAdvanceCompanyReport' from public.orders where id='f4900260-0000-4000-8000-000000000002')<>'300'
 then raise exception 'Wrong accounting allocation'; end if;
end;
$test$;
reset role;
do $test$
begin
 if has_function_privilege('anon','public.admin_order_finance_pending(text)','EXECUTE') then raise exception 'Anon read'; end if;
end;
$test$;
select 'order_finance_pending_checks_passed' as result;
rollback;
