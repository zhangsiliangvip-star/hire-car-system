-- Isolated project only. Every fixture is rolled back.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Multiple drafts test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','drafts-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','drafts-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Drafts driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $test$
declare r jsonb; item uuid; saved jsonb; p jsonb; req uuid; i integer; a timestamptz;
begin
 r:=public.driver_report_command(null,0,gen_random_uuid(),'checkout','{"useDefault":false,"address":"Depot","km":100}');
 item:=(r->>'id')::uuid; a:=(r->>'departedAt')::timestamptz;
 for i in 1..100 loop
  req:=gen_random_uuid(); p:='{"address":"","arrivedAt":null,"departedAt":null}';
  r:=public.driver_report_command(item,i,req,'add_stop',p);
  if jsonb_array_length(r->'stops')<>i or (r->>'version')::integer<>i+1
  or r->'stops'->(i-1)->>'address'<>'' or r->'stops'->(i-1)->>'plannedKm' is not null then
   raise exception 'Blank append failed'; end if;
  if public.driver_report_command(item,i,req,'add_stop',p)<>r then raise exception 'Retry duplicated row'; end if;
 end loop;
 saved:=r;
 if public.driver_reports()->'reports'->0<>r then raise exception 'Read lost blank rows'; end if;
 begin
  perform public.driver_report_command(item,101,gen_random_uuid(),'add_stop',p);
  raise exception 'Exceeded 100 rows';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.driver_report_command(item,101,gen_random_uuid(),'return','{"useDefault":false,"address":"Depot","km":120}');
  raise exception 'Returned with blanks';
 exception when invalid_parameter_value then null; end;
 p:=jsonb_build_object('stops',saved->'stops');
 p:=jsonb_set(p,'{stops,1}',(p->'stops'->1)||jsonb_build_object('address','Out of order','arrivedAt',a,'arrivedKm',110));
 begin
  perform public.driver_report_command(item,101,gen_random_uuid(),'edit_stops',p);
  raise exception 'Timed stop bypassed earlier pending row';
 exception when invalid_parameter_value then null; end;
 if public.driver_reports()->'reports'->0<>saved then raise exception 'Failed operation persisted'; end if;
 p:=jsonb_build_object('stops',saved->'stops');
 for i in 0..99 loop
  p:=jsonb_set(p,array['stops',i::text],(p->'stops'->i)||jsonb_build_object(
   'address','Filled','arrivedAt',a,'arrivedKm',100,'departedAt',a,'departedKm',100));
 end loop;
 r:=public.driver_report_command(item,101,gen_random_uuid(),'edit_stops',p);
 r:=public.driver_report_command(item,102,gen_random_uuid(),'return','{"useDefault":false,"address":"Depot","km":120}');
 if r->>'returnedAt' is null then raise exception 'Filled rows cannot return'; end if;
end;
$test$;
select 'multiple_drafts_checks_passed' as result;
rollback;
