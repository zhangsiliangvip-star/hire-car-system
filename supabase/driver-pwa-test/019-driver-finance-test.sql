-- Isolated synthetic fixtures only. Every write is rolled back.
begin;
set local statement_timeout='25s';
insert into public.regions(id,name) values('f2900190-0000-4000-8000-000000000001','Finance fixture region');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900190-0000-4000-8000-000000000001','finance-admin@example.invalid','{}'),
 ('f1900190-0000-4000-8000-000000000002','finance-driver@example.invalid','{}'),
 ('f1900190-0000-4000-8000-000000000003','finance-other@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='f1900190-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('f3900190-0000-4000-8000-000000000001','Finance fixture driver','f2900190-0000-4000-8000-000000000001'),
 ('f3900190-0000-4000-8000-000000000002','Finance other driver','f2900190-0000-4000-8000-000000000001');
insert into public.orders(id,date,end_date,status,region_id,driver,finance_by_date) values
 ('f4900190-0000-4000-8000-000000000001','2026-10-25','2026-10-26','予約確定',
 'f2900190-0000-4000-8000-000000000001','Finance fixture driver',
 '{"2026-10-25":{"driver":"Finance fixture driver","dailyFare":100000,"driverWage":10000,
 "driverAdvanceCompanyReport":100,"driverAdvanceTripReport":200,"driverOvertimeRate":2000},
 "2026-10-26":{"driver":"Finance fixture driver","driverWageMode":"percentage","driverWagePercentage":50,
 "dailyFare":10000,"driverOvertimeHours":2,"driverOvertimeRate":1000,"overtimeRequestRate":3000,
 "overtimeRequestAmount":999999,"driverAdvanceCompanyReport":1000}}');
insert into public.driver_wage_items(region_id,month,driver,name,amount) values
 ('f2900190-0000-4000-8000-000000000001','2026-10','Finance fixture driver','Adjustment',-500),
 ('f2900190-0000-4000-8000-000000000001','2026-10','Finance other driver','Must not leak',999999);
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900190-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900190-0000-4000-8000-000000000002','f3900190-0000-4000-8000-000000000001');
select public.bind_driver_identity('f1900190-0000-4000-8000-000000000003','f3900190-0000-4000-8000-000000000002');
select set_config('finance.assignment',public.dispatch_test_driver_order(
 'f4900190-0000-4000-8000-000000000001','f3900190-0000-4000-8000-000000000001','2026-10-25')::text,true);
reset role;
-- Completion setup only: the existing execution tests cover the state transition chain.
update public.driver_assignments set status='completed' where id=current_setting('finance.assignment')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900190-0000-4000-8000-000000000002',true);
do $test$
declare a uuid:=current_setting('finance.assignment')::uuid; result jsonb; projection jsonb; bad jsonb;
 items jsonb:='[{"id":"f5900190-0000-4000-8000-000000000001","type":"company","detail":"Parking","amount":500,"receipts":[]},
 {"id":"f5900190-0000-4000-8000-000000000002","type":"trip","detail":"Toll","amount":700,"receipts":[]}]';
 request uuid:='f6900190-0000-4000-8000-000000000001';
begin
 if not public.can_access_driver_receipt('f1900190-0000-4000-8000-000000000002/'||a||'/f7900190-0000-4000-8000-000000000001.jpg',true)
 or public.can_access_driver_receipt('f1900190-0000-4000-8000-000000000003/'||a||'/f7900190-0000-4000-8000-000000000001.jpg',false) then
  raise exception 'Receipt path ownership failed'; end if;
 projection:=public.driver_finance_data('2026-10');
 if jsonb_array_length(projection->'trips')<>1 or jsonb_array_length(projection->'manualItems')<>1
 or projection->'manualItems'->0->>'amount'<>'-500' or projection->'wages'->1->>'base'<>'7500'
 or projection::text like '%999999%' or projection::text like '%dailyFare%' then raise exception 'Payroll projection mismatch/leak'; end if;
 if exists(select 1 from public.driver_wage_items) then raise exception 'Driver read staff payroll table'; end if;
 begin perform 1 from public.driver_finance_claims; raise exception 'Driver read claims table';
 exception when insufficient_privilege then null; end;
 for bad in select value from jsonb_array_elements('[null,{},[{"id":null}], [{"id":"f5900190-0000-4000-8000-000000000001","type":"company","detail":"x","amount":0,"receipts":[]}]]') loop
  begin perform public.submit_driver_finance(a,0,request,bad,1.5); raise exception 'Invalid expense accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
 result:=public.submit_driver_finance(a,0,request,items,1.5);
 if result->>'status'<>'pending' or result->>'version'<>'1' then raise exception 'Submit failed'; end if;
 if public.submit_driver_finance(a,0,request,items,1.5)<>result then raise exception 'Replay failed'; end if;
 begin
  perform public.submit_driver_finance(a,1,gen_random_uuid(),
   jsonb_set(items,'{0,receipts}',jsonb_build_array('f1900190-0000-4000-8000-000000000002/'||a||'/f7900190-0000-4000-8000-000000000001.jpg')),1.5);
  raise exception 'Missing stored receipt accepted';
 exception when insufficient_privilege then null; end;
 begin perform public.submit_driver_finance(a,0,request,items,2); raise exception 'Request key reused with changed payload';
 exception when serialization_failure then null; end;
 projection:=public.driver_finance_data('2026-10');
 if projection->'wages'->0->>'advances'<>'300' or projection->'wages'->0->>'overtime'<>'0' then
  raise exception 'Pending claim entered payroll'; end if;
 begin perform public.review_driver_finance(a,1,'approved',''); raise exception 'Driver approved claim';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','f1900190-0000-4000-8000-000000000003',true);
 if jsonb_array_length(public.driver_finance_data('2026-10')->'trips')<>0
 or jsonb_array_length(public.driver_finance_data('2026-10')->'manualItems')<>1 then raise exception 'Ownership projection failed'; end if;
 begin perform public.submit_driver_finance(a,1,gen_random_uuid(),items,1); raise exception 'Other driver wrote claim';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','f1900190-0000-4000-8000-000000000001',true);
 result:=public.review_driver_finance(a,1,'approved','Checked');
 if result->>'status'<>'approved' or result->>'version'<>'2' then raise exception 'Approval failed'; end if;
 begin perform public.review_driver_finance(a,1,'approved',''); raise exception 'Duplicate approval allowed';
 exception when serialization_failure then null; end;
 perform set_config('request.jwt.claim.sub','f1900190-0000-4000-8000-000000000002',true);
 projection:=public.driver_finance_data('2026-10');
 if projection->'wages'->0->>'advances'<>'1500' or projection->'wages'->0->>'overtime'<>'3000'
 or jsonb_array_length(projection->'trips')<>1 then raise exception 'Approval/payroll/revocation mismatch'; end if;
 if public.can_access_driver_receipt('f1900190-0000-4000-8000-000000000002/'||a||'/f7900190-0000-4000-8000-000000000001.jpg',true) then
  raise exception 'Approved receipt mutable'; end if;
end;
$test$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900190-0000-4000-8000-000000000001',true);
select set_config('finance.second',public.dispatch_test_driver_order(
 'f4900190-0000-4000-8000-000000000001','f3900190-0000-4000-8000-000000000001','2026-10-26')::text,true);
reset role;
update public.driver_assignments set status='completed' where id=current_setting('finance.second')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900190-0000-4000-8000-000000000002',true);
select public.submit_driver_finance(current_setting('finance.second')::uuid,0,gen_random_uuid(),'[]',2);
reset role;
update public.orders set finance_by_date=jsonb_set(finance_by_date,'{2026-10-26,driverAdvanceCompanyReport}','1100')
 where id='f4900190-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900190-0000-4000-8000-000000000001',true);
do $test$
declare a uuid:=current_setting('finance.second')::uuid; result jsonb;
begin
 begin perform public.review_driver_finance(a,1,'approved',''); raise exception 'Stale baseline overwritten';
 exception when serialization_failure then null; end;
 result:=public.review_driver_finance(a,1,'rejected','Please reconcile');
 if result->>'version'<>'2' then raise exception 'Rejection version'; end if;
 perform set_config('request.jwt.claim.sub','f1900190-0000-4000-8000-000000000002',true);
 result:=public.submit_driver_finance(a,2,gen_random_uuid(),'[]',1.25);
 if result->>'version'<>'3' or result->>'status'<>'pending' then raise exception 'Resubmission failed'; end if;
 perform set_config('request.jwt.claim.sub','f1900190-0000-4000-8000-000000000001',true);
 result:=public.review_driver_finance(a,3,'approved','Reconciled');
 if result->>'version'<>'4' then raise exception 'Resubmission approval failed'; end if;
end;
$test$;
reset role;
do $test$
declare a uuid:=current_setting('finance.assignment')::uuid;
begin
 if (select status from public.driver_assignments where id=a)<>'completed' then raise exception 'Approval revoked completed trip'; end if;
 if (select count(*) from public.driver_finance_events where assignment_id=a)<>2 then raise exception 'Audit events wrong'; end if;
 if exists(select 1 from storage.buckets where id='driver-finance-receipts' and public) then raise exception 'Public receipts'; end if;
 -- Dispatch changes must still revoke, unlike finance-only changes.
 update public.orders set finance_by_date=jsonb_set(finance_by_date,'{2026-10-25,driver}','"Finance other driver"')
 where id='f4900190-0000-4000-8000-000000000001';
 if (select status from public.driver_assignments where id=a)<>'revoked' then raise exception 'Driver change did not revoke'; end if;
end;
$test$;
select 'driver_finance_checks_passed' as result;
rollback;
