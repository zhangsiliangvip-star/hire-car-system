-- Isolated project only. Synthetic fixtures rolled back.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Manual return test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','return-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','return-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Return driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $test$
declare r jsonb; saved jsonb; p jsonb; bad jsonb; item uuid; req uuid:=gen_random_uuid(); a timestamptz;
begin
 r:=public.driver_report_command(null,0,gen_random_uuid(),'checkout','{"useDefault":false,"address":"Depot","km":100}');
 item:=(r->>'id')::uuid; a:=(r->>'departedAt')::timestamptz;
 r:=public.driver_report_command(item,1,gen_random_uuid(),'add_stop','{"address":""}');
 saved:=r;
 p:=jsonb_build_object('stops',r->'stops','return',jsonb_build_object('address','Return','km',120,'returnedAt',a));
 begin
  perform public.driver_report_command(item,2,gen_random_uuid(),'edit_stops',p);
  raise exception 'Unfinished return accepted';
 exception when invalid_parameter_value then null; end;
 p:=jsonb_set(p,'{stops,0}',(p->'stops'->0)||jsonb_build_object(
  'address','Filled','arrivedAt',a,'arrivedKm',110,'departedAt',a,'departedKm',110));
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(p,'{return,km}','109'),jsonb_set(p,'{return,km}','120.55'),
  jsonb_set(p,'{return,returnedAt}',to_jsonb(a-interval '1 minute')),
  jsonb_set(p,'{return,returnedAt}',to_jsonb(clock_timestamp()+interval '1 day')),
  jsonb_set(p,'{return,returnedAt}','"2026-10-27T00:00:00"'),
  jsonb_set(p,'{return,address}','""'),jsonb_set(p,'{return,extra}','true')
 )) loop
  begin
   perform public.driver_report_command(item,2,gen_random_uuid(),'edit_stops',bad);
   raise exception 'Invalid return accepted';
  exception when invalid_parameter_value then null; end;
  if public.driver_reports()->'reports'->0<>saved then raise exception 'Partial return persisted'; end if;
 end loop;
 r:=public.driver_report_command(item,2,req,'edit_stops',p);
 if (r->>'version')::integer<>3 or (r->>'returnedAt')::timestamptz<>a
 or r->>'returnKm'<>'120' then raise exception 'Manual return failed'; end if;
 if public.driver_report_command(item,2,req,'edit_stops',p)<>r then raise exception 'Return retry failed'; end if;
 p:=jsonb_set(p,'{return,address}','"Corrected return"');
 p:=jsonb_set(p,'{return,km}','125');
 r:=public.driver_report_command(item,3,gen_random_uuid(),'edit_stops',p);
 if r->>'returnAddress'<>'Corrected return' or r->>'returnKm'<>'125' then raise exception 'Return edit failed'; end if;
 if public.driver_reports()->'reports'->0<>r then raise exception 'Return read failed'; end if;
 begin
  perform public.driver_report_command(item,3,gen_random_uuid(),'edit_stops',p);
  raise exception 'Stale return accepted';
 exception when serialization_failure then null; end;
end;
$test$;
select 'manual_return_checks_passed' as result;
rollback;
