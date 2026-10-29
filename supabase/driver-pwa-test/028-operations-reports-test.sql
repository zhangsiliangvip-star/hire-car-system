-- Synthetic fixtures only; permanent deletion checks erase these fixture reports only.
begin;
set local statement_timeout='30s';
insert into public.regions(id,name) values
 ('f2900280-0000-4000-8000-000000000001','Operations A'),
 ('f2900280-0000-4000-8000-000000000002','Operations B');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900280-0000-4000-8000-000000000001','operations-admin@example.invalid','{}'),
 ('f1900280-0000-4000-8000-000000000002','operations-staff-a@example.invalid','{}'),
 ('f1900280-0000-4000-8000-000000000003','operations-staff-b@example.invalid','{}'),
 ('f1900280-0000-4000-8000-000000000004','operations-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin'
 where id='f1900280-0000-4000-8000-000000000001';
update public.profiles set account_type='staff',role='user',region_id='f2900280-0000-4000-8000-000000000001'
 where id='f1900280-0000-4000-8000-000000000002';
update public.profiles set account_type='staff',role='user',region_id='f2900280-0000-4000-8000-000000000002'
 where id='f1900280-0000-4000-8000-000000000003';
insert into public.drivers(id,name,region_id) values
 ('f3900280-0000-4000-8000-000000000001','Operations driver A','f2900280-0000-4000-8000-000000000001'),
 ('f3900280-0000-4000-8000-000000000002','Operations driver B','f2900280-0000-4000-8000-000000000002');
insert into public.vehicles(id,name,plate,owner_company,region_id) values
 ('f5900280-0000-4000-8000-000000000001','Operations car','Operations plate','Operations company','f2900280-0000-4000-8000-000000000001');
select set_config('operations.day',((now() at time zone 'Asia/Tokyo')::date-2)::text,true);
insert into public.driver_daily_reports(id,driver_id,region_id,service_date,departed_at,departure_address,departure_km,
 returned_at,return_address,return_km,header,created_by,updated_by) values
 ('f6900280-0000-4000-8000-000000000001','f3900280-0000-4000-8000-000000000001','f2900280-0000-4000-8000-000000000001',
 current_setting('operations.day')::date,(current_setting('operations.day')||' 09:00+09')::timestamptz,'Departure',100,
 (current_setting('operations.day')||' 18:00+09')::timestamptz,'Return',150,
 jsonb_build_object('vehicleNumber','Operations plate','driverName','Manual name','passengerCount',3,
 'dutyStartTime','08:30','dutyEndTime','10:30','dutyStartDate',current_setting('operations.day'),
 'dutyEndDate',current_setting('operations.day')::date+1),
 'f1900280-0000-4000-8000-000000000004','f1900280-0000-4000-8000-000000000004'),
 ('f6900280-0000-4000-8000-000000000002','f3900280-0000-4000-8000-000000000001','f2900280-0000-4000-8000-000000000001',
 current_setting('operations.day')::date,(current_setting('operations.day')||' 19:00+09')::timestamptz,'Open depot',150,
 null,null,null,'{"vehicleNumber":"","driverName":"","passengerCount":null}',
 'f1900280-0000-4000-8000-000000000004','f1900280-0000-4000-8000-000000000004'),
 ('f6900280-0000-4000-8000-000000000003','f3900280-0000-4000-8000-000000000002','f2900280-0000-4000-8000-000000000002',
 current_setting('operations.day')::date,(current_setting('operations.day')||' 09:00+09')::timestamptz,'Other depot',100,
 null,null,null,'{"vehicleNumber":"","driverName":"","passengerCount":null}',
 'f1900280-0000-4000-8000-000000000001','f1900280-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900280-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900280-0000-4000-8000-000000000004','f3900280-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','f1900280-0000-4000-8000-000000000002',true);
do $test$
declare rows jsonb; doc jsonb; command jsonb; result jsonb; bad jsonb;
begin
 rows:=public.staff_operation_reports(left(current_setting('operations.day'),7));
 if jsonb_array_length(rows)<>2 or exists(select 1 from jsonb_array_elements(rows) e
  where e->>'regionId'<>'f2900280-0000-4000-8000-000000000001') then raise exception 'Regional list failed'; end if;
 select e->'report' into doc from jsonb_array_elements(rows) e where e->'report'->>'id'='f6900280-0000-4000-8000-000000000001';
 if (select e->>'company' from jsonb_array_elements(rows) e where e->'report'->>'id'=doc->>'id')
  is distinct from 'Operations company' then raise exception 'Company resolution failed'; end if;
 if public.staff_operation_reports('2000-01')<>'[]'::jsonb then raise exception 'Month filter failed'; end if;
 begin perform public.staff_operation_reports(left(current_setting('operations.day'),7),'f2900280-0000-4000-8000-000000000002');
  raise exception 'Cross-region read'; exception when insufficient_privilege then null; end;
 -- Full edit includes an added stop and all dated duty fields.
 doc:=doc||jsonb_build_object('departureAddress','Changed depot','stops',jsonb_build_array(jsonb_build_object(
  'id','f7900280-0000-4000-8000-000000000001','address','Edited stop','arrivedAt',current_setting('operations.day')||'T10:00:00+09:00',
  'departedAt',current_setting('operations.day')||'T11:00:00+09:00','arrivedKm',110,'departedKm',111,'plannedKm',110)));
 command:=jsonb_build_object('action','edit','requestId','f8900280-0000-4000-8000-000000000001','report',doc,'reason','Staff correction');
 result:=public.staff_operation_report_command(command);
 if result->'report'->>'version'<>'2' or result->'report'->>'departureAddress'<>'Changed depot'
 or result->'report'->'header'->>'dutyEndDate' is distinct from (current_setting('operations.day')::date+1)::text then
  raise exception 'Full edit failed'; end if;
 if public.staff_operation_report_command(command)<>result then raise exception 'Retry not idempotent'; end if;
 perform set_config('operations.updated', (result->'report')::text,true);
 begin perform public.staff_operation_report_command(command||jsonb_build_object('requestId',gen_random_uuid()));
  raise exception 'Stale version accepted'; exception when serialization_failure then null; end;
 -- Reject direct-RPC malformed documents as well as invalid time/km sequences.
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  (result->'report')||'{"driverId":"f3900280-0000-4000-8000-000000000002"}',
  (result->'report')||'{"departureKm":-1}', (result->'report')||'{"returnKm":90}',
  (result->'report')||jsonb_build_object('departedAt',now()+interval '1 day'),
  (result->'report')||jsonb_build_object('header',(result->'report'->'header')||jsonb_build_object('dutyEndDate',current_setting('operations.day')::date-1)),
  (result->'report')||jsonb_build_object('stops',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'address','Invalid',
   'arrivedAt',null,'arrivedKm',null,'departedAt',current_setting('operations.day')||'T10:00:00+09:00','departedKm',110)))
 )) loop
  begin perform public.staff_operation_report_command(jsonb_build_object('action','edit','requestId',gen_random_uuid(),'report',bad,'reason','Invalid'));
   raise exception 'Invalid report accepted'; exception when invalid_parameter_value or check_violation then null; end;
 end loop;
end;
$test$;
select set_config('request.jwt.claim.sub','f1900280-0000-4000-8000-000000000004',true);
do $test$
declare result jsonb; command jsonb;
begin
 begin perform public.staff_operation_reports(left(current_setting('operations.day'),7));
  raise exception 'Driver staff read'; exception when insufficient_privilege then null; end;
 begin perform public.staff_operation_report_command('{"action":"delete","reportId":"f6900280-0000-4000-8000-000000000001","expectedVersion":2}');
  raise exception 'Driver staff delete'; exception when insufficient_privilege then null; end;
 select e into result from jsonb_array_elements(public.driver_reports()->'reports') e
  where e->>'id'='f6900280-0000-4000-8000-000000000001';
 if result->>'departureAddress'<>'Changed depot' or result->'stops'->0->>'address'<>'Edited stop' then
  raise exception 'Staff edits not visible on phone'; end if;
 -- Driver remains able to use existing report command after staff edit.
 perform public.driver_report_command('f6900280-0000-4000-8000-000000000001',2,gen_random_uuid(),'edit_stops',
  jsonb_build_object('stops',result->'stops'));
end;
$test$;
select set_config('request.jwt.claim.sub','f1900280-0000-4000-8000-000000000003',true);
do $test$
begin
 begin perform public.staff_operation_report_command('{"action":"delete","reportId":"f6900280-0000-4000-8000-000000000001","expectedVersion":3}');
  raise exception 'Cross-region delete'; exception when insufficient_privilege then null; end;
 begin perform public.staff_operation_report_command(jsonb_build_object('action','edit','requestId',gen_random_uuid(),
  'report',current_setting('operations.updated')::jsonb,'reason','Wrong region'));
  raise exception 'Cross-region edit'; exception when insufficient_privilege then null; end;
end;
$test$;
reset role;
do $test$
declare r public.driver_daily_reports; h jsonb;
begin
 -- Dates are preserved by legacy headers and shift as dates, not timestamps.
 select * into r from public.driver_daily_reports where id='f6900280-0000-4000-8000-000000000001';
 h:=(r.header-'dutyStartDate'-'dutyEndDate')||jsonb_build_object('serviceDate',r.service_date+1);
 r:=public.apply_driver_report_header(r,h,clock_timestamp());
 if r.header->>'dutyStartDate' is distinct from (current_setting('operations.day')::date+1)::text then
  raise exception 'Duty date shift not preserved'; end if;
 if (select count(*) from public.driver_report_events where report_id='f6900280-0000-4000-8000-000000000001')<>2
 or not exists(select 1 from public.driver_report_events where report_id='f6900280-0000-4000-8000-000000000001'
  and before_data->>'departureAddress'='Departure' and after_data->>'departureAddress'='Changed depot'
  and actor_user_id='f1900280-0000-4000-8000-000000000002' and command->>'reason'='Staff correction') then
  raise exception 'Audit snapshots missing'; end if;
 if has_function_privilege('anon','public.staff_operation_reports(text,uuid)','EXECUTE')
 or has_function_privilege('anon','public.staff_operation_report_command(jsonb)','EXECUTE') then raise exception 'Anon permissions'; end if;
end;
$test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900280-0000-4000-8000-000000000002',true);
select public.staff_operation_report_command('{"action":"delete","reportId":"f6900280-0000-4000-8000-000000000001","expectedVersion":3}');
select public.staff_operation_report_command('{"action":"delete","reportId":"f6900280-0000-4000-8000-000000000002","expectedVersion":1}');
select set_config('request.jwt.claim.sub','f1900280-0000-4000-8000-000000000004',true);
do $test$
declare result jsonb;
begin
 if exists(select 1 from jsonb_array_elements(public.driver_reports()->'reports') e
  where e->>'id' in ('f6900280-0000-4000-8000-000000000001','f6900280-0000-4000-8000-000000000002')) then
  raise exception 'Deleted reports still visible on phone'; end if;
 result:=public.driver_report_command(null,0,gen_random_uuid(),'checkout',jsonb_build_object(
  'useDefault',false,'address','New dated checkout','km',200,'header',jsonb_build_object(
  'serviceDate',current_setting('operations.day'),'vehicleNumber','Operations plate','driverName','Dated driver','passengerCount',1,
  'dutyStartTime','23:00','dutyEndTime','02:00','dutyStartDate',current_setting('operations.day'),
  'dutyEndDate',current_setting('operations.day')::date+1)));
 if result->'header'->>'dutyStartDate' is distinct from current_setting('operations.day') then
  raise exception 'New phone duty dates not saved'; end if;
end;
$test$;
reset role;
do $test$
begin
 if exists(select 1 from public.driver_daily_reports where id in ('f6900280-0000-4000-8000-000000000001','f6900280-0000-4000-8000-000000000002'))
 or exists(select 1 from public.driver_report_events where report_id='f6900280-0000-4000-8000-000000000001')
 or not exists(select 1 from public.driver_daily_reports where id='f6900280-0000-4000-8000-000000000003') then
  raise exception 'Permanent erase failed or changed another region'; end if;
end;
$test$;
select 'operations_report_checks_passed' as result;
rollback;
