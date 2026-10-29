-- Isolated synthetic fixtures only. Every write is rolled back.
begin;
set local statement_timeout='30s';
select set_config('driver_history.date',((now() at time zone 'Asia/Tokyo')::date-2)::text,true);
insert into public.regions(id,name) values
 ('f2900300-0000-4000-8000-000000000001','Historical finance fixture region');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900300-0000-4000-8000-000000000001','historical-finance-admin@example.invalid','{}'),
 ('f1900300-0000-4000-8000-000000000002','historical-finance-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin'
 where id='f1900300-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('f3900300-0000-4000-8000-000000000001','Historical finance fixture driver',
  'f2900300-0000-4000-8000-000000000001');
insert into public.orders(id,date,end_date,status,region_id,driver,finance_by_date) values
 ('f4900300-0000-4000-8000-000000000001',current_setting('driver_history.date')::date,
  current_setting('driver_history.date')::date,'予約確定','f2900300-0000-4000-8000-000000000001',
  'Historical finance fixture driver',
  jsonb_build_object(current_setting('driver_history.date'),
   jsonb_build_object('driver','Historical finance fixture driver','driverWage',10000)));
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900300-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900300-0000-4000-8000-000000000002',
 'f3900300-0000-4000-8000-000000000001');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900300-0000-4000-8000-000000000002',true);
select public.ensure_driver_historical_finance_links(
 to_char(current_setting('driver_history.date')::date,'YYYY-MM'));
do $test$
declare day date:=current_setting('driver_history.date')::date;
 projection jsonb; link_id uuid; result jsonb; expense jsonb;
 receipt_path text; request_id uuid:='f6900300-0000-4000-8000-000000000001';
begin
 projection:=public.driver_historical_finance_data(to_char(day,'YYYY-MM'));
 if jsonb_array_length(projection->'trips') is distinct from 1
  or projection->'trips'->0->>'historical' is distinct from 'true' then
  raise exception 'Historical order missing from finance projection'; end if;
 link_id:=(projection->'trips'->0->>'assignmentId')::uuid;
 perform set_config('driver_history.link',link_id::text,true);
 if exists(select 1 from public.driver_orders(target_date=>day) where order_id='f4900300-0000-4000-8000-000000000001') then
  raise exception 'Historical finance created a driver assignment'; end if;
 receipt_path:=auth.uid()::text||'/'||link_id::text||'/company/f7900300-0000-4000-8000-000000000001.jpg';
 if not public.can_access_driver_receipt(receipt_path,true) then
  raise exception 'Eligible historical receipt upload denied'; end if;
 expense:=(jsonb_build_array(jsonb_build_object('id','f5900300-0000-4000-8000-000000000001',
  'type','company','detail','Historical parking','amount',500,'receipts','[]'::jsonb)));
 result:=public.submit_driver_historical_finance(link_id,'company',0,request_id,expense,0);
 if result->>'status' is distinct from 'pending'
  or result->>'historical' is distinct from 'true' then
  raise exception 'Historical finance submission failed'; end if;
 if public.submit_driver_historical_finance(link_id,'company',0,request_id,expense,0)<>result then
  raise exception 'Historical submission retry was not idempotent'; end if;
 if public.can_access_driver_receipt(receipt_path,true)
  or not public.can_access_driver_receipt(receipt_path,false) then
  raise exception 'Pending claim receipt access mismatch'; end if;
 projection:=public.driver_historical_finance_data(to_char(day,'YYYY-MM'));
 if jsonb_array_length(projection->'trips'->0->'claims')<>1
  or projection->'trips'->0->'claims'->0->>'historical' is distinct from 'true'
  or projection->'trips'->0->'claims'->0->>'status' is distinct from 'pending' then
  raise exception 'Historical claim missing from the driver projection'; end if;
 perform set_config('request.jwt.claim.sub','f1900300-0000-4000-8000-000000000001',true);
 result:=public.review_driver_finance(link_id,'company',1,'approved','Checked historical claim');
 if result->>'status' is distinct from 'approved'
  or result->>'historical' is distinct from 'true' then
  raise exception 'Historical approval failed'; end if;
 if (select (finance_by_date->day::text->>'driverAdvanceCompanyReport')::numeric
   from public.orders where id='f4900300-0000-4000-8000-000000000001') is distinct from 500 then
  raise exception 'Approved historical expense was not posted to the service date'; end if;
 if jsonb_array_length(public.admin_driver_finance(to_char(day,'YYYY-MM')))<>1 then
  raise exception 'Historical claim missing from admin review'; end if;
end;
$test$;
reset role;
do $audit$
declare link_id uuid:=current_setting('driver_history.link')::uuid;
begin
 if not exists(select 1 from public.driver_historical_finance_links
  where id=link_id and created_by='f1900300-0000-4000-8000-000000000002' and created_at is not null) then
  raise exception 'Historical link audit metadata missing'; end if;
 if not exists(select 1 from public.driver_finance_claims
  where historical_link_id=link_id and assignment_id is null) then
  raise exception 'Historical claim subject association mismatch'; end if;
 if (select count(*) from public.driver_finance_events
  where historical_link_id=link_id and actor_id is not null)<2 then
  raise exception 'Historical finance event audit missing'; end if;
end;
$audit$;
rollback;
