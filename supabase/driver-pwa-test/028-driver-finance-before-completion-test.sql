-- Isolated synthetic fixtures; all writes roll back.
begin;
set local statement_timeout='25s';
select set_config('finance.before_date',(now() at time zone 'Asia/Tokyo')::date::text,true);
insert into public.regions(id,name) values('f2900280-0000-4000-8000-000000000001','Early finance fixture region');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900280-0000-4000-8000-000000000001','early-finance-admin@example.invalid','{}'),
 ('f1900280-0000-4000-8000-000000000002','early-finance-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='f1900280-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('f3900280-0000-4000-8000-000000000001','Early finance driver','f2900280-0000-4000-8000-000000000001');
insert into public.orders(id,date,end_date,status,region_id,driver,finance_by_date) values
 ('f4900280-0000-4000-8000-000000000001',current_setting('finance.before_date')::date,
  current_setting('finance.before_date')::date,'予約確定','f2900280-0000-4000-8000-000000000001',
  'Early finance driver',jsonb_build_object(current_setting('finance.before_date'),
   jsonb_build_object('driver','Early finance driver','driverWage',10000,'fuelCost',100)));
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900280-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900280-0000-4000-8000-000000000002','f3900280-0000-4000-8000-000000000001');
select set_config('finance.before_assignment',public.dispatch_test_driver_order(
 'f4900280-0000-4000-8000-000000000001','f3900280-0000-4000-8000-000000000001',
 current_setting('finance.before_date')::date)::text,true);
reset role;
update public.driver_assignments set status='in_service'
 where id=current_setting('finance.before_assignment')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900280-0000-4000-8000-000000000002',true);
do $test$
declare
 a uuid:=current_setting('finance.before_assignment')::uuid;
 day date:=current_setting('finance.before_date')::date;
 request uuid:=gen_random_uuid();
 expense jsonb:='[{"id":"f5900280-0000-4000-8000-000000000001","type":"company",
  "detail":"Parking","amount":500,"receipts":[]}]';
 result jsonb;
begin
 if jsonb_array_length(public.driver_finance_data(to_char(day,'YYYY-MM'))->'trips')<>1 then
  raise exception 'In-progress assignment missing from finance projection'; end if;
 if not public.can_access_driver_receipt(
  auth.uid()::text||'/'||a::text||'/company/f7900280-0000-4000-8000-000000000001.jpg',true) then
  raise exception 'In-progress assignment receipt upload denied'; end if;
 result:=public.submit_driver_finance(a,'company',0,request,expense,0);
 if result->>'status'<>'pending' then raise exception 'In-progress expense claim not pending'; end if;
 if not public.can_access_driver_fuel_receipt(
  auth.uid()::text||'/'||day::text||'/f7900280-0000-4000-8000-000000000002.jpg',true) then
  raise exception 'In-progress fuel receipt upload denied'; end if;
 result:=public.submit_driver_daily_fuel(day,a,0,gen_random_uuid(),1500,'[]');
 if result->>'status'<>'pending' then raise exception 'In-progress fuel claim not available'; end if;
 if (select finance_by_date->current_setting('finance.before_date')->>'fuelCost' from public.orders
  where id='f4900280-0000-4000-8000-000000000001')<>'100' then
  raise exception 'Pending claim changed order finance'; end if;
 perform set_config('request.jwt.claim.sub','f1900280-0000-4000-8000-000000000001',true);
 begin perform public.review_driver_finance(a,'company',1,'approved','');
  raise exception 'In-progress expense claim was approved';
 exception when serialization_failure then null; end;
 begin perform public.review_driver_daily_fuel((result->>'id')::uuid,1,'approved','');
  raise exception 'In-progress fuel claim was approved';
 exception when serialization_failure then null; end;
end;
$test$;
reset role;
rollback;
