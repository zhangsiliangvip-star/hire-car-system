-- Isolated project only. Synthetic fixtures, all rolled back.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Departure edit test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','departure-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','departure-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Departure driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select set_config('departure.report',(public.driver_report_command(null,0,gen_random_uuid(),'checkout',
 '{"useDefault":false,"address":"Synthetic depot","km":100}')->>'id'),true);
reset role;
update public.driver_daily_reports set departed_at=(clock_timestamp() at time zone 'Asia/Tokyo')::date::timestamp at time zone 'Asia/Tokyo'
 where id=current_setting('departure.report')::uuid;
set local role authenticated;
do $test$
declare item uuid:=current_setting('departure.report')::uuid; r jsonb; p jsonb; bad jsonb; saved jsonb;
 req uuid:=gen_random_uuid(); a timestamptz;
begin
 r:=public.driver_reports()->'reports'->0;
 a:=(r->>'departedAt')::timestamptz;
 p:=jsonb_build_object('stops','[]'::jsonb,'departure',
   jsonb_build_object('address','Corrected depot','km',99,'departedAt',a+interval '1 minute'));
 r:=public.driver_report_command(item,1,req,'edit_stops',p);
 if (r->>'version')::integer<>2 or r->>'departureAddress'<>'Corrected depot'
 or r->>'departureKm'<>'99' or (r->>'departedAt')::timestamptz<>a+interval '1 minute' then
  raise exception 'Departure edit failed'; end if;
 if public.driver_report_command(item,1,req,'edit_stops',p)<>r then raise exception 'Retry failed'; end if;
 r:=public.driver_report_command(item,2,gen_random_uuid(),'add_stop',
  jsonb_build_object('address','Stop','km',110,'arrivedAt',a+interval '1 hour','departedAt',a+interval '2 hours'));
 p:=jsonb_set(p,'{stops}',r->'stops'); saved:=r;
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(p,'{departure,departedAt}',to_jsonb(a+interval '1 day')),
  jsonb_set(p,'{departure,departedAt}',to_jsonb(a-interval '1 minute')),
  jsonb_set(p,'{departure,departedAt}',to_jsonb(a+interval '90 minutes')),
  jsonb_set(p,'{departure,km}','111'),
  jsonb_set(p,'{departure,km}','-1'),
  jsonb_set(p,'{departure,km}','99.55'),
  jsonb_set(p,'{departure,address}','""'),
  jsonb_set(p,'{departure,extra}','true'),
  jsonb_set(p,'{departure,departedAt}','"2026-10-27T00:01:00"')
 )) loop
  begin
   perform public.driver_report_command(item,3,gen_random_uuid(),'edit_stops',bad);
   raise exception 'Invalid departure accepted';
  exception when invalid_parameter_value then null; end;
  if public.driver_reports()->'reports'->0<>saved then raise exception 'Partial edit persisted'; end if;
 end loop;
 p:=jsonb_set(p,'{departure,address}','"Depot with stop edit"');
 p:=jsonb_set(p,'{stops,0,address}','"Changed stop"');
 r:=public.driver_report_command(item,3,gen_random_uuid(),'edit_stops',p);
 if (r->>'version')::integer<>4 or r->'stops'->0->>'address'<>'Changed stop'
 or r->>'departureAddress'<>'Depot with stop edit' then raise exception 'Atomic table edit failed'; end if;
 begin
  perform public.driver_report_command(item,3,gen_random_uuid(),'edit_stops',p);
  raise exception 'Stale edit accepted';
 exception when serialization_failure then null; end;
 r:=public.driver_report_command(item,4,gen_random_uuid(),'return','{"useDefault":false,"address":"Synthetic return","km":130}');
 r:=public.driver_report_command(item,5,gen_random_uuid(),'edit_stops',
  jsonb_set(p,'{departure,address}','"Closed correction"'));
 if r->>'departureAddress'<>'Closed correction' then raise exception 'Closed edit failed'; end if;
end;
$test$;
select 'departure_edit_checks_passed' as result;
rollback;
