-- Isolated project only. Every fixture is rolled back.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Table save test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','table-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','table-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Table driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select set_config('table.report',(public.driver_report_command(null,0,gen_random_uuid(),'checkout',
 '{"useDefault":false,"address":"Synthetic depot","km":100}')->>'id'),true);
reset role;
update public.driver_daily_reports set departed_at=clock_timestamp()-interval '3 hours',
 service_date=((clock_timestamp()-interval '3 hours') at time zone 'Asia/Tokyo')::date
 where id=current_setting('table.report')::uuid;
set local role authenticated;
do $test$
declare item uuid:=current_setting('table.report')::uuid; r jsonb; p jsonb; bad jsonb; saved jsonb;
 req uuid:=gen_random_uuid(); a timestamptz:=clock_timestamp()-interval '2 hours';
begin
 r:=public.driver_report_command(item,1,gen_random_uuid(),'add_stop',
  jsonb_build_object('address','Stop 1','km',110,'arrivedAt',a,'departedAt',a+interval '30 minutes'));
 r:=public.driver_report_command(item,2,gen_random_uuid(),'add_stop',
  jsonb_build_object('address','Stop 2','km',120,'arrivedAt',a+interval '30 minutes','departedAt',a+interval '60 minutes'));
 p:=jsonb_build_object('stops',jsonb_build_array(
  (r->'stops'->0)||jsonb_build_object('address','Changed 1','departedAt',a+interval '40 minutes'),
  (r->'stops'->1)||jsonb_build_object('address','Changed 2','arrivedAt',a+interval '40 minutes')));
 r:=public.driver_report_command(item,3,req,'edit_stops',p);
 if (r->>'version')::integer<>4 or r->'stops'->0->>'address'<>'Changed 1'
 or r->'stops'->1->>'address'<>'Changed 2' then raise exception 'Batch failed'; end if;
 if public.driver_report_command(item,3,req,'edit_stops',p)<>r then raise exception 'Batch retry failed'; end if;
 saved:=r;
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('stops',jsonb_build_array(p->'stops'->0)),
  jsonb_build_object('stops',jsonb_build_array(p->'stops'->1,p->'stops'->0)),
  jsonb_set(p,'{stops,1,arrivedKm}','99'),
  jsonb_set(p,'{stops,1,address}','""')
 )) loop
  begin
   perform public.driver_report_command(item,4,gen_random_uuid(),'edit_stops',bad);
   raise exception 'Invalid batch accepted';
  exception when invalid_parameter_value then null; end;
  if public.driver_reports()->'reports'->0<>saved then raise exception 'Partial batch persisted'; end if;
 end loop;
 begin
  perform public.driver_report_command(item,3,gen_random_uuid(),'edit_stops',p);
  raise exception 'Stale batch accepted';
 exception when serialization_failure then null; end;
 r:=public.driver_report_command(item,4,gen_random_uuid(),'return','{"useDefault":false,"address":"Synthetic return","km":130}');
 r:=public.driver_report_command(item,5,gen_random_uuid(),'edit_stops',
  jsonb_set(p,'{stops,0,address}','"Closed correction"'));
 if r->'stops'->0->>'address'<>'Closed correction' then raise exception 'Closed batch failed'; end if;
end;
$test$;
select 'table_save_checks_passed' as result;
rollback;
