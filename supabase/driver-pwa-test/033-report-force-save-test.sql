-- Isolated project only. Every fixture is rolled back.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000033','Force save test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000033','force-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000034','force-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000033';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000033','Force driver','b2000000-0000-4000-8000-000000000033');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000033',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000034','b3000000-0000-4000-8000-000000000033');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000034',true);
select set_config('force.report',(public.driver_report_command(null,0,gen_random_uuid(),'checkout',
 '{"useDefault":false,"address":"Synthetic depot","km":100}')->>'id'),true);
do $test$
declare item uuid:=current_setting('force.report')::uuid; r jsonb;
 stamp timestamptz; stop_id uuid:=gen_random_uuid(); pending_id uuid:=gen_random_uuid();
 following_id uuid:=gen_random_uuid(); appended_id uuid;
begin
 select departed_at into stamp from public.driver_daily_reports where id=item;
 begin
  perform public.driver_report_command(item,1,gen_random_uuid(),'edit_stops',
   jsonb_build_object('stops','[]'::jsonb,'return',jsonb_build_object(
    'address','Synthetic return','km',90,'returnedAt',stamp-interval '1 minute')));
  raise exception 'Out-of-order report saved without force';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.driver_report_command(item,1,gen_random_uuid(),'edit_stops',
   jsonb_build_object('stops','[]'::jsonb,'force',true,'return',jsonb_build_object(
    'address','Synthetic return','km',-1,'returnedAt',stamp-interval '1 minute')));
  raise exception 'Invalid odometer accepted with force';
 exception when invalid_parameter_value then null; end;
 r:=public.driver_report_command(item,1,gen_random_uuid(),'edit_stops',
  jsonb_build_object('force',true,'stops',jsonb_build_array(jsonb_build_object(
   'id',stop_id,'address','Filled stop','arrivedAt',null,'arrivedKm',null,
   'departedAt',null,'departedKm',null,'plannedKm',50))));
 if jsonb_array_length(r->'stops')<>1 then raise exception 'Could not save filled stop fixture'; end if;
 r:=public.driver_report_command(item,2,gen_random_uuid(),'remove_stop',jsonb_build_object('stopId',stop_id));
 if jsonb_array_length(r->'stops')<>0 then raise exception 'Filled stop was not deleted'; end if;
 r:=public.driver_report_command(item,3,gen_random_uuid(),'edit_stops',
  jsonb_build_object('force',true,'stops',jsonb_build_array(jsonb_build_object(
   'id',pending_id,'address','Pending stop','arrivedAt',stamp-interval '2 minutes','arrivedKm',101,
   'departedAt',null,'departedKm',null),jsonb_build_object(
   'id',following_id,'address','Following stop','arrivedAt',stamp-interval '4 minutes','arrivedKm',95,
   'departedAt',stamp-interval '3 minutes','departedKm',94)),'return',jsonb_build_object(
   'address','Synthetic return','km',90,'returnedAt',stamp-interval '1 minute')));
 if (r->>'returnedAt')::timestamptz>=stamp or (r->>'returnKm')::numeric<>90 or
   r->'stops'->0->>'departedAt' is not null or
   r->'stops'->1->>'id'<>following_id::text then
  raise exception 'Forced incomplete or out-of-order report was not preserved';
 end if;
 r:=public.driver_report_command(item,4,gen_random_uuid(),'add_stop',jsonb_build_object('address',''));
 if jsonb_array_length(r->'stops')<>3 or r->'stops'->2->>'address'<>''
 then raise exception 'Could not append a stop after return'; end if;
 appended_id:=(r->'stops'->2->>'id')::uuid;
 r:=public.driver_report_command(item,5,gen_random_uuid(),'remove_stop',jsonb_build_object('stopId',appended_id));
 if jsonb_array_length(r->'stops')<>2 then raise exception 'Could not delete a stop after return'; end if;
end;
$test$;
select 'report_force_save_checks_passed' as result;
rollback;
