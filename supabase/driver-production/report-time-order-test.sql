-- Local or isolated regression fixtures only; all data rolls back.
\set ON_ERROR_STOP on
begin;
insert into public.regions(id,name) values('b2500000-0000-4000-8000-000000000001','Time order fixture');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1500000-0000-4000-8000-000000000001','time-admin@example.invalid','{"region_id":"b2500000-0000-4000-8000-000000000001"}'),
 ('b1500000-0000-4000-8000-000000000002','time-driver@example.invalid','{"region_id":"b2500000-0000-4000-8000-000000000001"}');
update public.profiles set account_type='staff',role='admin' where id='b1500000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3500000-0000-4000-8000-000000000001','Time fixture driver','b2500000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1500000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1500000-0000-4000-8000-000000000002','b3500000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1500000-0000-4000-8000-000000000002',true);
do $test$
declare result jsonb; payload jsonb; bad jsonb; day date:=(now() at time zone 'Asia/Tokyo')::date+5;
begin
 result:=public.driver_report_command(null,0,gen_random_uuid(),'checkout',
   '{"useDefault":false,"address":"Depot","km":100}');
 result:=public.driver_report_command((result->>'id')::uuid,1,gen_random_uuid(),'add_stop','{"address":""}');
 payload:=jsonb_build_object('stops',jsonb_build_array(jsonb_build_object(
   'id',result->'stops'->0->>'id','address','Future stop','arrivedAt',day::text||'T23:40:00+09:00',
   'arrivedKm',110,'departedAt',day::text||'T23:50:00+09:00','departedKm',110)),
   'departure',jsonb_build_object('address','Depot','km',100,'departedAt',day::text||'T23:30:00+09:00'),
   'header',jsonb_build_object('serviceDate',day,'vehicleNumber','','driverName','Time fixture driver',
     'passengerCount',4,'dutyStartDate',day,'dutyStartTime','23:20','dutyEndDate',day+1,'dutyEndTime','00:20'));
 payload:=payload||jsonb_build_object('return',jsonb_build_object('address','Depot','km',120,
   'returnedAt',(day+1)::text||'T00:10:00+09:00'));
 bad:=jsonb_set(payload,'{header,dutyStartTime}','"23:35"');
 begin
   perform public.driver_report_command((result->>'id')::uuid,2,gen_random_uuid(),'edit_stops',bad);
   raise exception 'Duty starts after departure';
 exception when sqlstate 'PDT01' then null;
 end;
 bad:=jsonb_set(payload,'{header,dutyEndTime}','"00:05"');
 begin
   perform public.driver_report_command((result->>'id')::uuid,2,gen_random_uuid(),'edit_stops',bad);
   raise exception 'Duty ends before return';
 exception when sqlstate 'PDT03' then null;
 end;
 result:=public.driver_report_command((result->>'id')::uuid,2,gen_random_uuid(),'edit_stops',payload);
 if (result->>'version')::integer<>3 or (result->>'returnedAt')::timestamptz<=now() then
   raise exception 'Future overnight report was not saved'; end if;
end;
$test$;
reset role;
do $test$
declare item public.driver_daily_reports;
begin
 select * into item from public.driver_daily_reports where driver_id='b3500000-0000-4000-8000-000000000001';
 item.header:=jsonb_set(item.header,'{dutyStartTime}','"23:30"');
 item.header:=jsonb_set(item.header,'{dutyEndTime}','"00:10"');
 perform public.validate_driver_report(item);
 item.stops:=jsonb_set(item.stops,'{0,departedAt}','null');
 item.stops:=jsonb_set(item.stops,'{0,departedKm}','null');
 begin perform public.validate_driver_report(item); raise exception 'Unfinished stop accepted at return';
 exception when invalid_parameter_value then null; end;
 select * into item from public.driver_daily_reports where driver_id='b3500000-0000-4000-8000-000000000001';
 item.stops:=jsonb_set(item.stops,'{0,arrivedKm}','99');
 begin perform public.validate_driver_report(item); raise exception 'Backward odometer accepted';
 exception when invalid_parameter_value then null; end;
end;
$test$;
do $test$
begin
 perform set_config('test.report_payload',public.driver_report_projection(r)::text,true)
 from public.driver_daily_reports r where driver_id='b3500000-0000-4000-8000-000000000001';
end;
$test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','b1500000-0000-4000-8000-000000000001',true);
do $test$
declare saved jsonb:=current_setting('test.report_payload')::jsonb; edited jsonb; bad jsonb;
begin
 bad:=jsonb_set(saved,'{header,dutyStartTime}','"23:35"');
 begin
  perform public.staff_operation_report_command(jsonb_build_object('action','edit','requestId',gen_random_uuid(),
    'reason','Time fixture invalid','report',bad));
  raise exception 'Staff accepted invalid duty order';
 exception when sqlstate 'PDT01' then null;
 end;
 edited:=public.staff_operation_report_command(jsonb_build_object('action','edit','requestId',gen_random_uuid(),
   'reason','Time fixture future','report',saved));
 if (edited->'report'->>'version')::integer<>4 then raise exception 'Staff future edit failed'; end if;
end;
$test$;
select 'report_time_order_checks_passed' as result;
rollback;
