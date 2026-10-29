-- Isolated synthetic fixtures; all writes roll back.
begin;
set local statement_timeout='25s';
insert into public.regions(id,name) values('f2900200-0000-4000-8000-000000000001','Category fixture region');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900200-0000-4000-8000-000000000001','category-admin@example.invalid','{}'),
 ('f1900200-0000-4000-8000-000000000002','category-driver@example.invalid','{}'),
 ('f1900200-0000-4000-8000-000000000003','category-other@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='f1900200-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('f3900200-0000-4000-8000-000000000001','Category driver','f2900200-0000-4000-8000-000000000001'),
 ('f3900200-0000-4000-8000-000000000002','Category other','f2900200-0000-4000-8000-000000000001');
insert into public.orders(id,date,end_date,status,region_id,driver,finance_by_date) values
 ('f4900200-0000-4000-8000-000000000001','2026-10-25','2026-10-25','予約確定',
 'f2900200-0000-4000-8000-000000000001','Category driver',
 '{"2026-10-25":{"driver":"Category driver","driverWage":10000,"driverAdvanceCompanyReport":100,
 "driverAdvanceTripReport":200,"driverOvertimeHours":2,"driverOvertimeRate":2000,"overtimeRequestRate":3000}}');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900200-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900200-0000-4000-8000-000000000002','f3900200-0000-4000-8000-000000000001');
select public.bind_driver_identity('f1900200-0000-4000-8000-000000000003','f3900200-0000-4000-8000-000000000002');
select set_config('finance.category_assignment',public.dispatch_test_driver_order(
 'f4900200-0000-4000-8000-000000000001','f3900200-0000-4000-8000-000000000001','2026-10-25')::text,true);
reset role;
update public.driver_assignments set status='completed' where id=current_setting('finance.category_assignment')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900200-0000-4000-8000-000000000002',true);
do $test$
declare a uuid:=current_setting('finance.category_assignment')::uuid; result jsonb; projection jsonb;
 company jsonb:='[{"id":"f5900200-0000-4000-8000-000000000001","type":"company","detail":"Parking","amount":500,"receipts":[]}]';
 trip jsonb:='[{"id":"f5900200-0000-4000-8000-000000000002","type":"trip","detail":"Toll","amount":700,"receipts":[]}]';
 request uuid:=gen_random_uuid(); path text; bad jsonb;
begin
 result:=public.submit_driver_finance(a,'company',0,request,company,0);
 if result->>'category'<>'company' or result->>'status'<>'pending' then raise exception 'Company submit'; end if;
 if public.submit_driver_finance(a,'company',0,request,company,0)<>result then raise exception 'Replay mismatch'; end if;
 begin perform public.submit_driver_finance(a,'company',0,request,jsonb_set(company,'{0,amount}','501'),0);
  raise exception 'Key payload reuse accepted'; exception when serialization_failure then null; end;
 -- Pending company cannot block uploading trip photos or submitting trip independently.
 path:='f1900200-0000-4000-8000-000000000002/'||a||'/';
 if public.can_access_driver_receipt(path||'company/f7900200-0000-4000-8000-000000000001.jpg',true)
 or not public.can_access_driver_receipt(path||'trip/f7900200-0000-4000-8000-000000000001.jpg',true) then
  raise exception 'Upload locks not category-specific'; end if;
 for bad in select value from jsonb_array_elements('[null,{},[],[{"id":"f5900200-0000-4000-8000-000000000001","type":"trip","detail":"x","amount":5,"receipts":[]}]]') loop
  begin perform public.submit_driver_finance(a,'company',0,gen_random_uuid(),bad,0);
   raise exception 'Invalid category accepted'; exception when invalid_parameter_value then null; end;
 end loop;
 result:=public.submit_driver_finance(a,'trip',0,gen_random_uuid(),trip,0);
 if result->>'version'<>'1' then raise exception 'Trip must have own version'; end if;
 result:=public.submit_driver_finance(a,'overtime',0,gen_random_uuid(),'[]',1.5);
 projection:=public.driver_finance_data('2026-10');
 if jsonb_array_length(projection->'trips'->0->'claims')<>3
 or projection->'wages'->0->>'advances'<>'300' or projection->'wages'->0->>'overtime'<>'4000' then
  raise exception 'Pending affected payroll or DTO'; end if;
 begin perform public.review_driver_finance(a,'company',1,'approved','');
  raise exception 'Driver reviewed'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','f1900200-0000-4000-8000-000000000003',true);
 if jsonb_array_length(public.driver_finance_data('2026-10')->'trips')<>0 then raise exception 'Other driver read'; end if;
 begin perform public.submit_driver_finance(a,'trip',1,gen_random_uuid(),trip,0);
  raise exception 'Other driver wrote'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','f1900200-0000-4000-8000-000000000001',true);
 result:=public.review_driver_finance(a,'company',1,'approved','Company only');
 perform set_config('request.jwt.claim.sub','f1900200-0000-4000-8000-000000000002',true);
 projection:=public.driver_finance_data('2026-10');
 if projection->'wages'->0->>'advances'<>'800' or projection->'wages'->0->>'overtime'<>'4000' then
  raise exception 'Company approval changed pending trip/overtime'; end if;
 perform set_config('request.jwt.claim.sub','f1900200-0000-4000-8000-000000000001',true);
 begin perform public.review_driver_finance(a,'company',1,'approved','');
  raise exception 'Double approval'; exception when serialization_failure then null; end;
 update public.orders set finance_by_date=jsonb_set(finance_by_date,'{2026-10-25,driverAdvanceTripReport}','201')
 where id='f4900200-0000-4000-8000-000000000001';
 begin perform public.review_driver_finance(a,'trip',1,'approved','');
  raise exception 'Changed category baseline overwritten'; exception when serialization_failure then null; end;
 update public.orders set finance_by_date=jsonb_set(finance_by_date,'{2026-10-25,driverAdvanceTripReport}','200')
 where id='f4900200-0000-4000-8000-000000000001';
 -- Approving company must not stale the pending trip or overtime baseline.
 result:=public.review_driver_finance(a,'trip',1,'rejected','Please correct');
 perform set_config('request.jwt.claim.sub','f1900200-0000-4000-8000-000000000002',true);
 result:=public.submit_driver_finance(a,'trip',2,gen_random_uuid(),trip,0);
 if result->>'version'<>'3' then raise exception 'Rejected category resubmission'; end if;
 perform set_config('request.jwt.claim.sub','f1900200-0000-4000-8000-000000000001',true);
 result:=public.review_driver_finance(a,'trip',3,'approved','Trip only');
 result:=public.review_driver_finance(a,'overtime',1,'approved','Overtime only');
 perform set_config('request.jwt.claim.sub','f1900200-0000-4000-8000-000000000002',true);
 projection:=public.driver_finance_data('2026-10');
 if projection->'wages'->0->>'advances'<>'1500' or projection->'wages'->0->>'overtime'<>'3000'
 or jsonb_array_length(projection->'trips')<>1 then raise exception 'Approved totals/assignment'; end if;
 if projection::text like '%dailyFare%' or projection::text like '%driverOvertimeRate%' then raise exception 'Private projection'; end if;
end;
$test$;
reset role;
do $test$
declare f jsonb; a uuid:=current_setting('finance.category_assignment')::uuid;
begin
 select finance_by_date->'2026-10-25' into f from public.orders where id='f4900200-0000-4000-8000-000000000001';
 if f->>'driverAdvanceCompanyReport'<>'600' or f->>'driverAdvanceTripReport'<>'900'
 or f->>'driverOvertimeHours'<>'1.5' or f->>'overtimeRequestAmount'<>'4500' then raise exception 'Finance write mismatch'; end if;
 if (select count(*) from public.driver_finance_claims where assignment_id=a and status='approved')<>3 then raise exception 'Independent claim states'; end if;
 if (select count(*) from public.driver_finance_events where assignment_id=a)<>8 then raise exception 'Category audit events'; end if;
 if has_function_privilege('authenticated','public.driver_finance_category_baseline(jsonb,text)','execute')
 or to_regprocedure('public.submit_driver_finance(uuid,bigint,uuid,jsonb,numeric)') is not null then
  raise exception 'Legacy RPC still callable'; end if;
 if (select public from storage.buckets where id='driver-finance-receipts') then raise exception 'Public receipts'; end if;
 update public.orders set finance_by_date=jsonb_set(finance_by_date,'{2026-10-25,driver}','"Category other"')
 where id='f4900200-0000-4000-8000-000000000001';
 if (select status from public.driver_assignments where id=a)<>'revoked' then raise exception 'Dispatch invalidation'; end if;
end;
$test$;
select 'finance_category_checks_passed' as result;
rollback;
