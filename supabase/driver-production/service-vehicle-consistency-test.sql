\set ON_ERROR_STOP on
begin;
insert into public.regions(id,name) values
 ('a1900900-0000-4000-8000-000000000001','Vehicle consistency fixture'),
 ('a1900900-0000-4000-8000-000000000002','Other fixture region');
insert into auth.users(id,email,raw_user_meta_data) values
 ('a1900900-0000-4000-8000-000000000011','vehicle-admin@example.invalid','{"region_id":"a1900900-0000-4000-8000-000000000001"}'),
 ('a1900900-0000-4000-8000-000000000012','vehicle-driver@example.invalid','{"region_id":"a1900900-0000-4000-8000-000000000001"}');
update public.profiles set account_type='staff',role='admin' where id='a1900900-0000-4000-8000-000000000011';
insert into public.drivers(id,name,region_id) values
 ('a1900900-0000-4000-8000-000000000021','Vehicle consistency driver','a1900900-0000-4000-8000-000000000001');
insert into public.vehicles(id,name,plate,region_id,owner_company) values
 ('a1900900-0000-4000-8000-000000000041','Base model','BASE','a1900900-0000-4000-8000-000000000001','Base company'),
 ('a1900900-0000-4000-8000-000000000042','Daily model','DAILY','a1900900-0000-4000-8000-000000000001','Daily company'),
 ('a1900900-0000-4000-8000-000000000043','New model','NEW','a1900900-0000-4000-8000-000000000001','New company'),
 ('a1900900-0000-4000-8000-000000000044','Forbidden model','OTHER-REGION','a1900900-0000-4000-8000-000000000002','Other company');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900900-0000-4000-8000-000000000011',true);
select public.bind_driver_identity('a1900900-0000-4000-8000-000000000012','a1900900-0000-4000-8000-000000000021');
reset role;
insert into public.orders(id,date,end_date,status,driver,region_id,vehicle,vehicle_plate,finance_by_date)
values('a1900900-0000-4000-8000-000000000031',(now() at time zone 'Asia/Tokyo')::date,
 (now() at time zone 'Asia/Tokyo')::date+1,'予約確定','Vehicle consistency driver','a1900900-0000-4000-8000-000000000001',
 'Base model','BASE',jsonb_build_object(
 ((now() at time zone 'Asia/Tokyo')::date)::text,jsonb_build_object('vehicle','','vehiclePlate','','dailyFare',1234),
 ((now() at time zone 'Asia/Tokyo')::date+1)::text,jsonb_build_object('vehicle','Daily model','vehiclePlate','DAILY','dailyFare',5678)));
insert into public.driver_daily_reports(id,driver_id,region_id,service_date,departed_at,departure_address,departure_km,
 returned_at,return_address,return_km,created_by,updated_by,header)
select 'a1900900-0000-4000-8000-000000000051',a.driver_id,a.region_id,a.service_date,
 (a.service_date+time '09:00') at time zone 'Asia/Tokyo','Synthetic garage',100,
 (a.service_date+time '10:00') at time zone 'Asia/Tokyo','Synthetic garage',120,
 'a1900900-0000-4000-8000-000000000012','a1900900-0000-4000-8000-000000000012',
 jsonb_build_object('assignmentId',a.id,'vehicleNumber','BASE','driverName','Fixture driver','passengerCount',1)
from public.driver_assignments a where a.order_id='a1900900-0000-4000-8000-000000000031'
 and a.service_date=(now() at time zone 'Asia/Tokyo')::date;

update public.orders set finance_by_date=jsonb_set(finance_by_date,
 array[((now() at time zone 'Asia/Tokyo')::date)::text],
 finance_by_date->((now() at time zone 'Asia/Tokyo')::date)::text||'{"vehicle":"New model","vehiclePlate":"NEW"}')
where id='a1900900-0000-4000-8000-000000000031';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900900-0000-4000-8000-000000000012',true);
do $test$
declare data jsonb;
begin
 data:=public.driver_reports();
 if (data->>'vehicleLinking') is distinct from 'true' then
  raise exception 'Vehicle link feature marker missing'; end if;
 if (data->'reports'->0->'header'->>'vehicleNumber') is distinct from 'NEW' then
  raise exception 'Historical report did not display current service-day plate'; end if;
 if (public.driver_report_defaults((now() at time zone 'Asia/Tokyo')::date)->'orders'->0->>'vehicleNumber') is distinct from 'NEW' then
  raise exception 'Trip and report defaults disagree'; end if;
 if (select vehicle from public.driver_orders((now() at time zone 'Asia/Tokyo')::date,null)) is distinct from 'New model' then
  raise exception 'Driver trip model not synchronized'; end if;
 if (public.driver_report_defaults((now() at time zone 'Asia/Tokyo')::date+1)->'orders'->0->>'vehicleNumber') is distinct from 'DAILY' then
  raise exception 'Other service day was changed'; end if;
 perform public.driver_report_command('a1900900-0000-4000-8000-000000000051',1,
  'a1900900-0000-4000-8000-000000000061','edit_stops',
  jsonb_build_object('stops','[]'::jsonb,'header',
   (data->'reports'->0->'header')||jsonb_build_object('serviceDate',(now() at time zone 'Asia/Tokyo')::date,
    'vehicleBaseline','NEW','vehicleNumber','DAILY')));
 data:=public.driver_reports();
 if (data->'reports'->0->'header'->>'vehicleNumber') is distinct from 'DAILY'
 or (public.driver_report_defaults((now() at time zone 'Asia/Tokyo')::date)->'orders'->0->>'vehicleNumber') is distinct from 'DAILY' then
  raise exception 'Report edit did not update the linked order'; end if;
 begin
  perform public.driver_report_command('a1900900-0000-4000-8000-000000000051',2,
   'a1900900-0000-4000-8000-000000000062','edit_stops',
   jsonb_build_object('stops','[]'::jsonb,'header',
    (data->'reports'->0->'header')||jsonb_build_object('serviceDate',(now() at time zone 'Asia/Tokyo')::date,
     'vehicleBaseline','DAILY','vehicleNumber','OTHER-REGION')));
  raise exception 'Cross-region plate accepted';
 exception when sqlstate 'PVS02' then null;
 end;
 begin
  perform public.driver_report_command('a1900900-0000-4000-8000-000000000051',2,
   'a1900900-0000-4000-8000-000000000063','edit_stops',
   jsonb_build_object('stops','[]'::jsonb,'header',
    (data->'reports'->0->'header')||jsonb_build_object('serviceDate',(now() at time zone 'Asia/Tokyo')::date,
     'vehicleBaseline','BASE','vehicleNumber','NEW')));
  raise exception 'Stale vehicle edit accepted';
 exception when serialization_failure then null;
 end;
 begin
  perform public.driver_report_command('a1900900-0000-4000-8000-000000000051',2,
   'a1900900-0000-4000-8000-000000000065','edit_stops',
   jsonb_build_object('stops','[]'::jsonb,'header',
    (data->'reports'->0->'header')||jsonb_build_object('serviceDate',(now() at time zone 'Asia/Tokyo')::date,
     'assignmentId',public.driver_report_defaults((now() at time zone 'Asia/Tokyo')::date+1)->'orders'->0->>'assignmentId',
     'vehicleBaseline','DAILY','vehicleNumber','DAILY')));
  raise exception 'Another service date accepted as report link';
 exception when sqlstate 'PVS01' then null;
 end;
end;
$test$;
reset role;
do $test$
declare item public.orders; data jsonb;
begin
 select * into item from public.orders where id='a1900900-0000-4000-8000-000000000031';
 if (item.finance_by_date->((now() at time zone 'Asia/Tokyo')::date)::text->>'dailyFare') is distinct from '1234'
 or (item.finance_by_date->((now() at time zone 'Asia/Tokyo')::date+1)::text->>'dailyFare') is distinct from '5678' then
  raise exception 'Vehicle edit changed financial amounts'; end if;
 if public.service_vehicle_plate(item,(now() at time zone 'Asia/Tokyo')::date+1) is distinct from 'DAILY' then
  raise exception 'Report edit affected another service date'; end if;
 if has_function_privilege('anon','public.apply_driver_report_header(public.driver_daily_reports,jsonb,timestamptz)','execute')
 or has_function_privilege('authenticated','public.linked_report_header(public.driver_daily_reports)','execute') then
  raise exception 'Internal vehicle helper exposed'; end if;
end;
$test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900900-0000-4000-8000-000000000011',true);
do $test$
declare data jsonb; doc jsonb;
begin
 data:=public.staff_operation_reports(to_char((now() at time zone 'Asia/Tokyo')::date,'YYYY-MM'),
  'a1900900-0000-4000-8000-000000000001');
 if (data->0->'report'->'header'->>'vehicleNumber') is distinct from 'DAILY'
 or (data->0->>'company') is distinct from 'Daily company' then
  raise exception 'Operations plate/company do not follow the linked order'; end if;
 doc:=data->0->'report';
 doc:=jsonb_set(doc,'{header}',doc->'header'||'{"vehicleNumber":"NEW","vehicleBaseline":"DAILY"}');
 perform public.staff_operation_report_command(jsonb_build_object('action','edit','report',doc,
  'requestId','a1900900-0000-4000-8000-000000000064','reason','Synthetic vehicle correction'));
 if (public.staff_operation_reports(to_char((now() at time zone 'Asia/Tokyo')::date,'YYYY-MM'),
   'a1900900-0000-4000-8000-000000000001')->0->'report'->'header'->>'vehicleNumber') is distinct from 'NEW' then
  raise exception 'Operations edit did not synchronize the service-day order'; end if;
end;
$test$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900900-0000-4000-8000-000000000012',true);
do $test$
declare data jsonb;
begin
 data:=public.driver_reports();
 perform public.driver_report_command('a1900900-0000-4000-8000-000000000051',3,
  'a1900900-0000-4000-8000-000000000066','edit_stops',
  jsonb_build_object('stops','[]'::jsonb,'header',
   (data->'reports'->0->'header')||jsonb_build_object('serviceDate',(now() at time zone 'Asia/Tokyo')::date,
    'vehicleBaseline','NEW','vehicleNumber','')));
 if (public.driver_report_defaults((now() at time zone 'Asia/Tokyo')::date)->'orders'->0->>'vehicleNumber') is distinct from ''
 or (public.driver_reports()->'reports'->0->'header'->>'vehicleNumber') is distinct from '' then
  raise exception 'Cleared plate was guessed or restored'; end if;
end;
$test$;
reset role;
insert into public.orders(id,date,end_date,status,driver,region_id,vehicle,vehicle_plate,finance_by_date)
values('a1900900-0000-4000-8000-000000000032',(now() at time zone 'Asia/Tokyo')::date+2,
 (now() at time zone 'Asia/Tokyo')::date+2,'予約確定','','a1900900-0000-4000-8000-000000000001',
 'Base model','BASE',jsonb_build_object(((now() at time zone 'Asia/Tokyo')::date+2)::text,
 jsonb_build_object('vehicle','Base model','vehiclePlate','BASE','dailyFare',2222)));
update public.orders set finance_by_date=jsonb_set(finance_by_date,
 array[((now() at time zone 'Asia/Tokyo')::date+2)::text],
 finance_by_date->((now() at time zone 'Asia/Tokyo')::date+2)::text||'{"vehicle":"New model","vehiclePlate":"NEW"}')
where id='a1900900-0000-4000-8000-000000000032';
do $test$
begin
 if (select vehicle_plate from public.orders where id='a1900900-0000-4000-8000-000000000032') is distinct from 'NEW' then
  raise exception 'Single-day root did not follow daily selection'; end if;
end;
$test$;
update public.orders set vehicle='Daily model',vehicle_plate='DAILY'
where id='a1900900-0000-4000-8000-000000000032';
do $test$
begin
 if (select public.service_vehicle_plate(o,o.date) from public.orders o
   where id='a1900900-0000-4000-8000-000000000032') is distinct from 'DAILY' then
  raise exception 'Root entrance did not update the single-day override'; end if;
 if exists(select 1 from public.driver_assignments where order_id='a1900900-0000-4000-8000-000000000031'
   and (status<>'assigned' or version<>1)) then
  raise exception 'Vehicle-only edits changed dispatch execution state'; end if;
end;
$test$;
select 'service_vehicle_consistency_checks_passed' as result;
rollback;
