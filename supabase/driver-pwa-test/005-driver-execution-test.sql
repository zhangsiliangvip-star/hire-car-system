-- Isolated test project only. Uses independent synthetic fixtures; rolls back every write.
begin;
set local statement_timeout='20s';
create temporary table execution_results(name text,passed boolean not null check(passed)) on commit drop;
grant insert,select on execution_results to authenticated,anon;
insert into public.regions(id,name) values
 ('d2000000-0000-4000-8000-000000000001','Execution A'),
 ('d2000000-0000-4000-8000-000000000002','Execution B');
insert into auth.users(id,email,raw_user_meta_data) values
 ('d1000000-0000-4000-8000-000000000001','execution-admin@example.invalid','{}'),
 ('d1000000-0000-4000-8000-000000000002','execution-a@example.invalid','{}'),
 ('d1000000-0000-4000-8000-000000000003','execution-b@example.invalid','{}'),
 ('d1000000-0000-4000-8000-000000000004','execution-c@example.invalid','{}');
update public.profiles set account_type='staff',role='admin'
 where id='d1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('d3000000-0000-4000-8000-000000000001','Execution A','d2000000-0000-4000-8000-000000000001'),
 ('d3000000-0000-4000-8000-000000000002','Execution B','d2000000-0000-4000-8000-000000000001'),
 ('d3000000-0000-4000-8000-000000000003','Execution C','d2000000-0000-4000-8000-000000000002');
insert into public.orders(id,date,end_date,status,region_id) values
 ('d4000000-0000-4000-8000-000000000001','2026-10-27','2026-10-27','予約確定','d2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('d1000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001');
select public.bind_driver_identity('d1000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000002');
select public.bind_driver_identity('d1000000-0000-4000-8000-000000000004','d3000000-0000-4000-8000-000000000003');
select set_config('execution.assignment',public.dispatch_test_driver_order(
 'd4000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-10-27')::text,true);
do $$
declare u text; item uuid:=current_setting('execution.assignment')::uuid;
begin
 foreach u in array array['d1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000004'] loop
  perform set_config('request.jwt.claim.sub',u,true);
  if exists(select 1 from public.driver_orders(null,item)) then raise exception 'Other driver read leaked'; end if;
  begin
   perform public.transition_driver_assignment(item,1,gen_random_uuid(),'acknowledged');
   raise exception 'Other driver write allowed';
  exception when no_data_found then null; end;
 end loop;
end; $$;
insert into execution_results values('same-region and cross-region ownership',true);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
do $$
declare
 item uuid:=current_setting('execution.assignment')::uuid;
 req uuid:='d5000000-0000-4000-8000-000000000001';
 state text; v bigint:=2; result bigint; step_request uuid;
begin
 begin
  perform public.transition_driver_assignment(item,1,gen_random_uuid(),'completed');
  raise exception 'Skipped states allowed';
 exception when serialization_failure then null; end;
 if public.acknowledge_driver_assignment(item,1,req)<>2 then raise exception 'Ack failed'; end if;
 foreach state in array array['en_route','arrived','in_service','completed'] loop
  step_request:=gen_random_uuid();
  result:=public.transition_driver_assignment(item,v,step_request,state);
  if result<>v+1 then raise exception 'Legal transition version wrong'; end if;
  if public.transition_driver_assignment(item,v,step_request,state)<>result then
   raise exception 'Event replay did not return original result';
  end if;
  v:=result;
 end loop;
 if public.acknowledge_driver_assignment(item,1,req)<>2 then raise exception 'Late replay must return original result'; end if;
 begin
  perform public.transition_driver_assignment(item,1,req,'en_route');
  raise exception 'Reused key different state allowed';
 exception when serialization_failure then null; end;
 begin
  perform public.acknowledge_driver_assignment(item,2,req);
  raise exception 'Reused key different version allowed';
 exception when serialization_failure then null; end;
 begin
  perform public.transition_driver_assignment(item,6,gen_random_uuid(),'en_route');
  raise exception 'Completed trip restarted';
 exception when serialization_failure then null; end;
 begin
  perform public.transition_driver_assignment(item,5,gen_random_uuid(),'completed');
  raise exception 'Repeated completion created another event';
 exception when serialization_failure then null; end;
 begin
  perform public.transition_driver_assignment(item,6,gen_random_uuid(),'revoked');
  raise exception 'Driver revoked trip';
 exception when invalid_parameter_value then null; end;
 begin
  perform 1 from public.driver_assignment_events;
  raise exception 'Raw event table readable';
 exception when insufficient_privilege then null; end;
end; $$;
insert into execution_results values('five sequential states and late replay',true),
 ('no skips restart stale version or payload key reuse',true),('no driver raw audit access',true);
reset role;
insert into execution_results select 'five events with server actor time and versions',
 count(*)=5 and bool_and(actor_user_id='d1000000-0000-4000-8000-000000000002'
 and occurred_at is not null and result_version=expected_version+1)
 from public.driver_assignment_events where assignment_id=current_setting('execution.assignment')::uuid;
insert into execution_results select 'completed version six',status='completed' and version=6
 from public.driver_assignments where id=current_setting('execution.assignment')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select public.set_driver_identity_status('d3000000-0000-4000-8000-000000000001','suspended',1);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin
  perform public.acknowledge_driver_assignment(current_setting('execution.assignment')::uuid,1,
   'd5000000-0000-4000-8000-000000000001');
  raise exception 'Suspended identity replay allowed';
 exception when insufficient_privilege then null; end;
end; $$;
insert into execution_results values('suspension immediately blocks replay',true);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select public.set_driver_identity_status('d3000000-0000-4000-8000-000000000001','active',2);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
reset role;
-- Revocation is still the conservative test-only order-edit rule.
update public.orders set notes='Synthetic edit' where id='d4000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin
  perform public.acknowledge_driver_assignment(current_setting('execution.assignment')::uuid,1,
   'd5000000-0000-4000-8000-000000000001');
  raise exception 'Revoked assignment replay exposed';
 exception when no_data_found then null; end;
end; $$;
insert into execution_results values('revocation blocks even earlier valid replay',true);
set local role anon;
do $$ begin
 begin
  perform public.transition_driver_assignment(current_setting('execution.assignment')::uuid,1,gen_random_uuid(),'en_route');
  raise exception 'Anonymous execution allowed';
 exception when insufficient_privilege then null; end;
end; $$;
insert into execution_results values('anonymous execution denied',true);
reset role;
select count(*) as passed_checks,bool_and(passed) as all_passed from execution_results;
rollback;
