-- Isolated project only. Roll back all fixtures.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Stop dialog test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','dialog-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','dialog-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Dialog driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $test$
declare r jsonb; item uuid; stop_id uuid; req uuid:=gen_random_uuid(); p jsonb;
begin
 r:=public.driver_report_command(null,0,gen_random_uuid(),'checkout','{"useDefault":false,"address":"Synthetic depot","km":100}');
 item:=(r->>'id')::uuid;
 begin
  perform public.driver_report_command(item,1,gen_random_uuid(),'add_stop','{"address":"Invalid stop","km":99}');
  raise exception 'Backwards draft accepted';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.driver_report_command(item,1,gen_random_uuid(),'add_stop','{"address":"Invalid stop","km":"110"}');
  raise exception 'String draft accepted';
 exception when invalid_parameter_value then null; end;
 r:=public.driver_report_command(item,1,req,'add_stop','{"address":"Synthetic stop","km":110}');
 if r->'stops'->0->>'plannedKm'<>'110' or r->'stops'->0->>'arrivedAt' is not null
 or r->'stops'->0->>'arrivedKm' is not null then raise exception 'Draft triggered arrival or lost odometer'; end if;
 if public.driver_report_command(item,1,req,'add_stop','{"address":"Synthetic stop","km":110}')<>r
 then raise exception 'Draft retry failed'; end if;
 if public.driver_reports()->'reports'->0->'stops'->0->>'plannedKm'<>'110'
 then raise exception 'Draft not persistent on reload'; end if;
 stop_id:=(r->'stops'->0->>'id')::uuid;
 p:=(r->'stops'->0)||'{"plannedKm":111}';
 r:=public.driver_report_command(item,2,gen_random_uuid(),'edit_stop',p);
 r:=public.driver_report_command(item,3,gen_random_uuid(),'arrive',jsonb_build_object('stopId',stop_id,'km',111));
 r:=public.driver_report_command(item,4,gen_random_uuid(),'depart',jsonb_build_object('stopId',stop_id,'km',111));
 r:=public.driver_report_command(item,5,gen_random_uuid(),'return','{"useDefault":false,"address":"Synthetic return","km":120}');
 if r->'stops'->0->>'arrivedAt' is null or r->'stops'->0->>'departedAt' is null
 or r->'stops'->0->>'arrivedKm'<>'111' or r->'stops'->0->>'departedKm'<>'111'
 then raise exception 'Clock workflow failed'; end if;
end;
$test$;
select 'stop_dialog_checks_passed' as result;
rollback;
