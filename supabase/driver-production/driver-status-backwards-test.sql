-- Synthetic local/isolated fixtures only; all data rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='30s';
insert into public.regions(id,name) values
 ('a1900600-0000-4000-8000-000000000001','Status regression'),
 ('a1900600-0000-4000-8000-000000000002','Status other region');
insert into auth.users(id,email,raw_user_meta_data) values
 ('a1900600-0000-4000-8000-000000000011','status-admin@example.invalid','{"region_id":"a1900600-0000-4000-8000-000000000001"}'),
 ('a1900600-0000-4000-8000-000000000012','status-driver@example.invalid','{"region_id":"a1900600-0000-4000-8000-000000000001"}'),
 ('a1900600-0000-4000-8000-000000000013','status-other@example.invalid','{"region_id":"a1900600-0000-4000-8000-000000000001"}'),
 ('a1900600-0000-4000-8000-000000000014','status-staff@example.invalid','{"region_id":"a1900600-0000-4000-8000-000000000001"}'),
 ('a1900600-0000-4000-8000-000000000015','status-cross@example.invalid','{"region_id":"a1900600-0000-4000-8000-000000000002"}');
update public.profiles set account_type='staff',role='admin' where id='a1900600-0000-4000-8000-000000000011';
update public.profiles set account_type='staff',role='user'
 where id in ('a1900600-0000-4000-8000-000000000014','a1900600-0000-4000-8000-000000000015');
insert into public.drivers(id,name,region_id) values
 ('a1900600-0000-4000-8000-000000000021','Status driver','a1900600-0000-4000-8000-000000000001'),
 ('a1900600-0000-4000-8000-000000000022','Other status driver','a1900600-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','a1900600-0000-4000-8000-000000000011',true);
set local role authenticated;
select public.bind_driver_identity('a1900600-0000-4000-8000-000000000012','a1900600-0000-4000-8000-000000000021');
select public.bind_driver_identity('a1900600-0000-4000-8000-000000000013','a1900600-0000-4000-8000-000000000022');
reset role;
insert into public.orders(id,date,end_date,status,pickup,destination,time,driver,region_id)
 values('a1900600-0000-4000-8000-000000000031',(now() at time zone 'Asia/Tokyo')::date,
 (now() at time zone 'Asia/Tokyo')::date+1,'予約確定','Pickup','Destination','09:00','Status driver',
 'a1900600-0000-4000-8000-000000000001');
select set_config('test.status_assignment',id::text,true) from public.driver_assignments
 where order_id='a1900600-0000-4000-8000-000000000031' and service_date=(now() at time zone 'Asia/Tokyo')::date;
select set_config('request.jwt.claim.sub','a1900600-0000-4000-8000-000000000012',true);
set local role authenticated;
do $test$
declare item uuid:=current_setting('test.status_assignment')::uuid; ver bigint:=1;
 state text; req uuid; result jsonb;
begin
 foreach state in array array['acknowledged','en_route','arrived','in_service','completed',
  'in_service','arrived','en_route','acknowledged','assigned',
  'acknowledged','en_route','arrived','in_service','completed'] loop
  req:=gen_random_uuid();
  if public.transition_driver_assignment(item,ver,req,state)<>ver+1 then raise exception 'Wrong version'; end if;
  if public.transition_driver_assignment(item,ver,req,state)<>ver+1 then raise exception 'Retry not idempotent'; end if;
  begin
   perform public.transition_driver_assignment(item,ver,gen_random_uuid(),state);
   raise exception 'Stale version accepted';
  exception when serialization_failure then null; end;
  ver:=ver+1;
  perform set_config('request.jwt.claim.sub','a1900600-0000-4000-8000-000000000014',true);
  result:=public.staff_driver_execution_status();
  if jsonb_array_length(result->'rows')<>1 or result->'rows'->0->>'status' is distinct from state
  or (result->'rows'->0->>'version')::bigint<>ver then raise exception 'Daily card status not synchronized'; end if;
  perform set_config('request.jwt.claim.sub','a1900600-0000-4000-8000-000000000012',true);
 end loop;
 begin perform public.transition_driver_assignment(item,ver,gen_random_uuid(),'arrived');
  raise exception 'Skipped backward step accepted';
 exception when serialization_failure then null; end;
 perform set_config('request.jwt.claim.sub','a1900600-0000-4000-8000-000000000013',true);
 begin perform public.transition_driver_assignment(item,ver,gen_random_uuid(),'in_service');
  raise exception 'Another driver changed assignment';
 exception when no_data_found then null; end;
 perform set_config('request.jwt.claim.sub','a1900600-0000-4000-8000-000000000015',true);
 if public.staff_driver_execution_status()->'rows'<>'[]'::jsonb then raise exception 'Cross-region status leaked'; end if;
end;
$test$;
reset role;
do $test$
begin
 if (select count(*) from public.driver_assignment_events where assignment_id=current_setting('test.status_assignment')::uuid)<>15 then
  raise exception 'History lost or duplicated'; end if;
 if not exists(select 1 from public.driver_assignment_events
  where assignment_id=current_setting('test.status_assignment')::uuid and event_type='assigned') then
  raise exception 'Rollback to pending not recorded'; end if;
 if not exists(select 1 from public.orders where id='a1900600-0000-4000-8000-000000000031' and status='予約確定') then
  raise exception 'Order changed during driver transitions'; end if;
end;
$test$;
update public.orders set status='キャンセル' where id='a1900600-0000-4000-8000-000000000031';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900600-0000-4000-8000-000000000012',true);
do $test$
begin
 begin perform public.transition_driver_assignment(current_setting('test.status_assignment')::uuid,16,gen_random_uuid(),'in_service');
  raise exception 'Cancelled/revoked assignment reversed';
 exception when no_data_found then null; end;
 perform set_config('request.jwt.claim.sub','a1900600-0000-4000-8000-000000000014',true);
 if public.staff_driver_execution_status()->'rows'<>'[]'::jsonb then raise exception 'Cancelled label visible'; end if;
end;
$test$;
select 'driver_status_backwards_checks_passed' as result;
rollback;
