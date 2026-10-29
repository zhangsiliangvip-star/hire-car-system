-- Isolated project only. Current direct-edit behavior, all fixtures rolled back.
begin;
set local statement_timeout='20s';
create temporary table direct_edit_results(name text,passed boolean not null check(passed)) on commit drop;
grant insert,select on direct_edit_results to authenticated;
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Direct edit test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','direct-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','direct-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Direct edit driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $$
declare r jsonb; item uuid; p jsonb; req uuid:=gen_random_uuid(); start_req uuid:=gen_random_uuid(); base jsonb;
begin
 base:='{"useDefault":false,"address":"Synthetic checkout","km":100}'::jsonb;
 r:=public.driver_report_command(null,0,start_req,'checkout',base); item:=(r->>'id')::uuid;
 r:=public.driver_report_command(item,1,gen_random_uuid(),'add_stop','{"address":"Old synthetic stop"}');
 p:=(r->'stops'->0)||jsonb_build_object('address','New synthetic stop');
 r:=public.driver_report_command(item,2,req,'edit_stop',p);
 if r->'stops'->0->>'address'<>'New synthetic stop' then raise exception 'Direct edit failed'; end if;
 if public.driver_report_command(item,2,req,'edit_stop',p)<>r then raise exception 'Retry changed data'; end if;
 insert into direct_edit_results values('reason-free editing and retry',true);
 begin perform public.driver_report_command(item,2,req,'edit_stop',p||'{"address":"Different"}');
  raise exception 'Changed payload accepted with same key';
 exception when serialization_failure then null; end;
 begin perform public.driver_report_command(item,2,gen_random_uuid(),'edit_stop',p);
  raise exception 'Stale version accepted';
 exception when serialization_failure then null; end;
 insert into direct_edit_results values('payload and version conflicts preserved',true);
 begin perform public.driver_report_command(item,3,gen_random_uuid(),'edit_stop',
  p||jsonb_build_object('arrivedAt',clock_timestamp()+interval '1 day','arrivedKm',101));
  raise exception 'Future time accepted';
 exception when invalid_parameter_value then null; end;
 begin perform public.driver_report_command(item,3,gen_random_uuid(),'edit_stop',
  p||jsonb_build_object('arrivedAt',clock_timestamp(),'arrivedKm',99));
  raise exception 'Backwards odometer accepted';
 exception when invalid_parameter_value then null; end;
 insert into direct_edit_results values('chronology and odometer protections preserved',true);
 r:=public.driver_report_command(item,3,gen_random_uuid(),'edit_stop',p||jsonb_build_object(
  'arrivedAt',clock_timestamp(),'arrivedKm',101,'departedAt',clock_timestamp(),'departedKm',102));
 r:=public.driver_report_command(item,4,gen_random_uuid(),'return','{"useDefault":false,"address":"Synthetic return","km":110}');
 if public.driver_report_command(null,0,start_req,'checkout',base)<>r then
  raise exception 'Late replay must return current projection without snapshot'; end if;
 r:=public.driver_report_command(item,5,gen_random_uuid(),'edit_stop',
  (r->'stops'->0)||'{"address":"Closed report edited"}');
 if r->'stops'->0->>'address'<>'Closed report edited' then raise exception 'Closed report correction failed'; end if;
 perform set_config('direct_edit.report',item::text,true);
 insert into direct_edit_results values('return and closed correction without reason',true);
end; $$;
reset role;
insert into direct_edit_results select 'only minimal deduplication metadata, no content snapshots',
 count(*)=6 and bool_and(before_data is null and after_data='{}'::jsonb
 and (select array_agg(k)=array['fingerprint'] from jsonb_object_keys(command) k)
 and length(command->>'fingerprint')=64)
 from public.driver_report_events where report_id=current_setting('direct_edit.report')::uuid;
select count(*) as passed_checks,bool_and(passed) as all_passed from direct_edit_results;
rollback;
