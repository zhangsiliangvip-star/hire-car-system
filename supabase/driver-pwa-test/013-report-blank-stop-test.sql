-- Isolated project only. All synthetic fixtures are rolled back.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Blank stop test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','blank-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','blank-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Blank driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $test$
declare r jsonb; item uuid; saved jsonb; p jsonb; req uuid:=gen_random_uuid(); stop_id text;
begin
 r:=public.driver_report_command(null,0,gen_random_uuid(),'checkout','{"useDefault":false,"address":"Depot","km":100}');
 item:=(r->>'id')::uuid;
 p:='{"address":"","arrivedAt":null,"departedAt":null}';
 r:=public.driver_report_command(item,1,req,'add_stop',p);
 if (r->>'version')::integer<>2 or jsonb_array_length(r->'stops')<>1
 or r->'stops'->0->>'address'<>''
 or r->'stops'->0->>'plannedKm' is not null or r->'stops'->0->>'arrivedKm' is not null
 or r->'stops'->0->>'arrivedAt' is not null then raise exception 'Blank stop not saved'; end if;
 if public.driver_report_command(item,1,req,'add_stop',p)<>r then raise exception 'Blank retry failed'; end if;
 if public.driver_reports()->'reports'->0<>r then raise exception 'Blank stop read failed'; end if;
 saved:=r; stop_id:=r->'stops'->0->>'id';
 begin
  perform public.driver_report_command(item,2,gen_random_uuid(),'add_stop',p);
  raise exception 'Appended after unfinished stop';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.driver_report_command(item,2,gen_random_uuid(),'return','{"useDefault":false,"address":"Depot","km":120}');
  raise exception 'Returned with blank stop';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.driver_report_command(item,2,gen_random_uuid(),'arrive',jsonb_build_object('stopId',stop_id,'km',110));
  raise exception 'Clocked blank address';
 exception when invalid_parameter_value then null; end;
 if public.driver_reports()->'reports'->0<>saved then raise exception 'Failed command persisted'; end if;
 r:=public.driver_report_command(item,2,gen_random_uuid(),'edit_stops',jsonb_build_object('stops',saved->'stops'));
 r:=public.driver_report_command(item,3,gen_random_uuid(),'edit_stops',
  jsonb_build_object('stops',jsonb_set(r->'stops','{0,address}','"Filled stop"')));
 r:=public.driver_report_command(item,4,gen_random_uuid(),'arrive',jsonb_build_object('stopId',stop_id,'km',110));
 r:=public.driver_report_command(item,5,gen_random_uuid(),'depart',jsonb_build_object('stopId',stop_id,'km',110));
 r:=public.driver_report_command(item,6,gen_random_uuid(),'return','{"useDefault":false,"address":"Depot","km":120}');
 if r->>'returnedAt' is null then raise exception 'Filled stop cannot return'; end if;
end;
$test$;
select 'blank_stop_checks_passed' as result;
rollback;
