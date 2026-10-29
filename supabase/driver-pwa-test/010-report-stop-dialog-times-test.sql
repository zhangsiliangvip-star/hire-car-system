-- Isolated project only. Synthetic fixtures, including shifted checkout, all rolled back.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Stop times test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','times-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','times-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Times driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select set_config('times.report',(public.driver_report_command(null,0,gen_random_uuid(),'checkout',
 '{"useDefault":false,"address":"Synthetic depot","km":100}')->>'id'),true);
reset role;
update public.driver_daily_reports set departed_at=clock_timestamp()-interval '3 hours',
 service_date=( (clock_timestamp()-interval '3 hours') at time zone 'Asia/Tokyo')::date
 where id=current_setting('times.report')::uuid;
set local role authenticated;
do $test$
declare item uuid:=current_setting('times.report')::uuid; r jsonb; p jsonb; bad jsonb;
 req uuid:=gen_random_uuid(); a timestamptz:=clock_timestamp()-interval '2 hours';
 b timestamptz:=a+interval '30 minutes';
begin
 p:=jsonb_build_object('address','Synthetic timed stop','km',110,'arrivedAt',a,'departedAt',b);
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  p||jsonb_build_object('arrivedAt',null), p||jsonb_build_object('departedAt',a-interval '1 minute'),
  p||jsonb_build_object('arrivedAt',clock_timestamp()+interval '1 day','departedAt',null),
  p||jsonb_build_object('arrivedAt',a-interval '4 hours','departedAt',null),
  p||jsonb_build_object('arrivedAt',123), p||jsonb_build_object('arrivedAt','2026-10-27T12:00:00'),
  p-'km', p||jsonb_build_object('km',99)
 )) loop
  begin
   perform public.driver_report_command(item,1,gen_random_uuid(),'add_stop',bad);
   raise exception 'Invalid timed stop accepted: %',bad;
  exception when invalid_parameter_value then null; end;
 end loop;
 r:=public.driver_report_command(item,1,req,'add_stop',p);
 if (r->>'version')::integer<>2 or jsonb_array_length(r->'stops')<>1
 or (r->'stops'->0->>'departedAt')::timestamptz-(r->'stops'->0->>'arrivedAt')::timestamptz<>interval '30 minutes'
 or r->'stops'->0->>'arrivedKm'<>'110' or r->'stops'->0->>'departedKm'<>'110' then
  raise exception 'Timed stop not saved atomically'; end if;
 if public.driver_report_command(item,1,req,'add_stop',p)<>r then raise exception 'Retry failed'; end if;
 r:=public.driver_report_command(item,2,gen_random_uuid(),'add_stop',
  jsonb_build_object('address','Arrival only','km',115,'arrivedAt',b+interval '10 minutes','departedAt',null));
 if r->'stops'->1->>'arrivedAt' is null or r->'stops'->1->>'departedAt' is not null then
  raise exception 'Arrival-only state failed'; end if;
 r:=public.driver_report_command(item,3,gen_random_uuid(),'depart',
  jsonb_build_object('stopId',r->'stops'->1->>'id','km',115));
 r:=public.driver_report_command(item,4,gen_random_uuid(),'add_stop','{"address":"Blank times","km":120,"arrivedAt":null,"departedAt":null}');
 if r->'stops'->2->>'arrivedAt' is not null or r->'stops'->2->>'plannedKm'<>'120' then
  raise exception 'Blank times unexpectedly clocked'; end if;
 r:=public.driver_report_command(item,5,gen_random_uuid(),'arrive',
  jsonb_build_object('stopId',r->'stops'->2->>'id','km',120));
 r:=public.driver_report_command(item,6,gen_random_uuid(),'depart',
  jsonb_build_object('stopId',r->'stops'->2->>'id','km',120));
 r:=public.driver_report_command(item,7,gen_random_uuid(),'return','{"useDefault":false,"address":"Synthetic return","km":130}');
 if r->>'returnedAt' is null then raise exception 'Return failed'; end if;
end;
$test$;
select 'stop_dialog_time_checks_passed' as result;
rollback;
