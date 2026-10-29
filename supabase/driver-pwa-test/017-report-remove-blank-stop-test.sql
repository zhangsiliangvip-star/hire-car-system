-- Isolated project only. Synthetic rows and identities are rolled back.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Removal test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','removal-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','removal-driver@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000003','removal-other@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Removal driver','b2000000-0000-4000-8000-000000000001'),
 ('b3000000-0000-4000-8000-000000000002','Other driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000003','b3000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $test$
declare r jsonb; saved jsonb; p jsonb; sid uuid; item uuid; req uuid; first_id uuid; last_id uuid;
begin
 r:=public.driver_report_command(null,0,gen_random_uuid(),'checkout','{"useDefault":false,"address":"Depot","km":0}');
 item:=(r->>'id')::uuid;
 r:=public.driver_report_command(item,1,gen_random_uuid(),'add_stop','{"address":""}');
 first_id:=(r->'stops'->0->>'id')::uuid;
 r:=public.driver_report_command(item,2,gen_random_uuid(),'add_stop','{"address":"Filled"}');
 r:=public.driver_report_command(item,3,gen_random_uuid(),'add_stop','{"address":"","km":0}');
 r:=public.driver_report_command(item,4,gen_random_uuid(),'add_stop','{"address":""}');
 last_id:=(r->'stops'->3->>'id')::uuid;
 saved:=r; req:=gen_random_uuid(); p:=jsonb_build_object('stopId',last_id);
 r:=public.driver_report_command(item,5,req,'remove_stop',p);
 if (r->>'version')::integer<>6 or r->'stops'<>((saved->'stops')-3) then raise exception 'Last blank removal failed'; end if;
 if public.driver_report_command(item,5,req,'remove_stop',p)<>r then raise exception 'Removal replay failed'; end if;
 saved:=r;
 begin
  perform public.driver_report_command(item,5,gen_random_uuid(),'remove_stop',jsonb_build_object('stopId',first_id));
  raise exception 'Old version accepted';
 exception when serialization_failure then null; end;
 begin
  perform public.driver_report_command(item,5,req,'remove_stop',jsonb_build_object('stopId',first_id));
  raise exception 'Reused key accepted';
 exception when serialization_failure then null; end;
 for sid in select (value->>'id')::uuid from jsonb_array_elements(r->'stops') where value->>'address'='Filled' or value->>'plannedKm'='0' loop
  begin
   perform public.driver_report_command(item,6,gen_random_uuid(),'remove_stop',jsonb_build_object('stopId',sid));
   raise exception 'Nonempty stop removed';
  exception when invalid_parameter_value then null; end;
 end loop;
 begin
  perform public.driver_report_command(item,6,gen_random_uuid(),'remove_stop',jsonb_build_object('stopId',gen_random_uuid()));
  raise exception 'Missing stop accepted';
 exception when no_data_found then null; end;
 perform set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
 begin
  perform public.driver_report_command(item,6,gen_random_uuid(),'remove_stop',jsonb_build_object('stopId',first_id));
  raise exception 'Another driver removed row';
 exception when no_data_found then null; end;
 perform set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
 if public.driver_reports()->'reports'->0<>saved then raise exception 'Rejected removals changed report'; end if;
 r:=public.driver_report_command(item,6,gen_random_uuid(),'remove_stop',jsonb_build_object('stopId',first_id));
 if jsonb_array_length(r->'stops')<>2 or r->'stops'<>((saved->'stops')-0) then raise exception 'Middle blank removal reordered rows'; end if;
 r:=public.driver_report_command(item,7,gen_random_uuid(),'add_stop','{"address":""}');
 if jsonb_array_length(r->'stops')<>3 then raise exception 'Append after removal failed'; end if;
 r:=public.driver_report_command(item,8,gen_random_uuid(),'remove_stop',jsonb_build_object('stopId',r->'stops'->2->>'id'));
 if public.driver_reports()->'reports'->0<>r or (r->>'version')::integer<>9 then raise exception 'Removal not persisted'; end if;
end;
$test$;
select 'blank_stop_removal_checks_passed' as result;
rollback;
