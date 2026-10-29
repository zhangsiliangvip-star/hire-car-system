\set ON_ERROR_STOP on
begin;
insert into public.regions(id,name) values('a1900800-0000-4000-8000-000000000001','Selected plate fixture');
insert into auth.users(id,email,raw_user_meta_data) values
 ('a1900800-0000-4000-8000-000000000011','plate-admin@example.invalid','{"region_id":"a1900800-0000-4000-8000-000000000001"}'),
 ('a1900800-0000-4000-8000-000000000012','plate-driver@example.invalid','{"region_id":"a1900800-0000-4000-8000-000000000001"}');
update public.profiles set account_type='staff',role='admin' where id='a1900800-0000-4000-8000-000000000011';
insert into public.drivers(id,name,region_id) values
 ('a1900800-0000-4000-8000-000000000021','Selected plate driver','a1900800-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900800-0000-4000-8000-000000000011',true);
select public.bind_driver_identity('a1900800-0000-4000-8000-000000000012','a1900800-0000-4000-8000-000000000021');
reset role;
insert into public.orders(id,date,end_date,status,driver,region_id,vehicle,vehicle_plate,finance_by_date)
values('a1900800-0000-4000-8000-000000000031',(now() at time zone 'Asia/Tokyo')::date,
 (now() at time zone 'Asia/Tokyo')::date+1,'予約確定','Selected plate driver','a1900800-0000-4000-8000-000000000001',
 'Base model','BASE-SELECTED',jsonb_build_object(
 ((now() at time zone 'Asia/Tokyo')::date)::text,jsonb_build_object('vehicle','','vehiclePlate','','dailyFare',1234),
 ((now() at time zone 'Asia/Tokyo')::date+1)::text,jsonb_build_object('vehicle','Daily model','vehiclePlate','DAILY-SELECTED')));
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900800-0000-4000-8000-000000000012',true);
do $test$
begin
 if (public.driver_report_defaults((now() at time zone 'Asia/Tokyo')::date)->'orders'->0->>'vehicleNumber') is distinct from 'BASE-SELECTED' then
  raise exception 'Blank finance defaults masked order selected plate'; end if;
 if (public.driver_report_defaults((now() at time zone 'Asia/Tokyo')::date+1)->'orders'->0->>'vehicleNumber') is distinct from 'DAILY-SELECTED' then
  raise exception 'Daily selected vehicle plate not used'; end if;
end;
$test$;
reset role;
insert into public.vehicles(id,name,plate,region_id) values
 ('a1900800-0000-4000-8000-000000000041','Base model','DO-NOT-GUESS','a1900800-0000-4000-8000-000000000001');
update public.orders set vehicle_plate='',finance_by_date=jsonb_set(finance_by_date,
 array[((now() at time zone 'Asia/Tokyo')::date+1)::text,'vehiclePlate'],'""')
 where id='a1900800-0000-4000-8000-000000000031';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900800-0000-4000-8000-000000000012',true);
do $test$
begin
 if (public.driver_report_defaults((now() at time zone 'Asia/Tokyo')::date)->'orders'->0->>'vehicleNumber') is distinct from '' then
  raise exception 'Unselected plate guessed from model'; end if;
 if (public.driver_report_defaults((now() at time zone 'Asia/Tokyo')::date+1)->'orders'->0->>'vehicleNumber') is distinct from '' then
  raise exception 'Empty daily plate fell back to another vehicle'; end if;
end;
$test$;
select 'driver_selected_plate_checks_passed' as result;
rollback;
