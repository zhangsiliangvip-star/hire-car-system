-- Test project only. Every fixture and acknowledgement rolls back.
begin;
set local statement_timeout = '20s';
create temporary table trip_results (name text primary key, passed boolean not null check(passed)) on commit drop;
grant insert,select on trip_results to authenticated,anon;
insert into public.regions(id,name) values
 ('e2000000-0000-4000-8000-000000000001','Trip Test A'),
 ('e2000000-0000-4000-8000-000000000002','Trip Test B');
insert into auth.users(id,email,raw_user_meta_data) values
 ('e1000000-0000-4000-8000-000000000001','trip-admin@example.invalid','{}'),
 ('e1000000-0000-4000-8000-000000000002','trip-driver-a@example.invalid','{}'),
 ('e1000000-0000-4000-8000-000000000003','trip-driver-b@example.invalid','{}');
update public.profiles set account_type='staff',role='admin'
 where id='e1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('e3000000-0000-4000-8000-000000000001','Trip Driver A','e2000000-0000-4000-8000-000000000001'),
 ('e3000000-0000-4000-8000-000000000002','Trip Driver B','e2000000-0000-4000-8000-000000000002');
insert into public.orders(id,date,end_date,status,pickup,destination,time,region_id,order_price,notes) values
 ('e4000000-0000-4000-8000-000000000001','2026-10-27','2026-10-28','予約確定','Test Airport','Test Hotel','09:30','e2000000-0000-4000-8000-000000000001',99999,'Private accounting note'),
 ('e4000000-0000-4000-8000-000000000002','2026-10-27','2026-10-27','予約確定','Other Region','Other Hotel','14:00','e2000000-0000-4000-8000-000000000002',88888,'Other note');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('e1000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001');
select public.bind_driver_identity('e1000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000002');
select public.dispatch_test_driver_order('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','2026-10-27');
select public.dispatch_test_driver_order('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','2026-10-28');
select public.dispatch_test_driver_order('e4000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','2026-10-27');
do $$ begin
 begin
  perform public.dispatch_test_driver_order('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000002','2026-10-27');
  raise exception 'Cross-region dispatch allowed';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.dispatch_test_driver_order('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','2026-10-29');
  raise exception 'Out-of-range dispatch allowed';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.dispatch_test_driver_order('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','2026-10-27');
  raise exception 'Duplicate active day allowed';
 exception when unique_violation then null; end;
end; $$;
insert into trip_results values('dispatch scope date and duplicate checks',true);
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
insert into trip_results select 'own service day only',count(*)=1 and bool_and(order_id='e4000000-0000-4000-8000-000000000001') from public.driver_orders('2026-10-27');
insert into trip_results select 'next service day only',count(*)=1 from public.driver_orders('2026-10-28');
insert into trip_results select 'no unrelated dates',count(*)=0 from public.driver_orders('2026-10-29');
insert into trip_results select 'projection has exactly nine allowed keys',
 count(*)=1 and bool_and((select count(*)=9 from jsonb_object_keys(to_jsonb(t))))
 from public.driver_orders('2026-10-27') t;
do $$
declare own_id uuid; other_day uuid; other_driver uuid; value bigint;
begin
 select assignment_id into own_id from public.driver_orders('2026-10-27');
 select assignment_id into other_day from public.driver_orders('2026-10-28');
 value:=public.acknowledge_driver_assignment(own_id,1,'e5000000-0000-4000-8000-000000000001');
 if value<>2 then raise exception 'Version did not increment'; end if;
 value:=public.acknowledge_driver_assignment(own_id,1,'e5000000-0000-4000-8000-000000000001');
 if value<>2 then raise exception 'Idempotent retry failed'; end if;
 begin
  perform public.acknowledge_driver_assignment(own_id,1,'e5000000-0000-4000-8000-000000000002');
  raise exception 'Stale acknowledgement allowed';
 exception when serialization_failure then null; end;
 begin
  perform public.acknowledge_driver_assignment(other_day,1,'e5000000-0000-4000-8000-000000000001');
  raise exception 'Idempotency key reuse allowed';
 exception when serialization_failure then null; end;
 begin
  perform public.dispatch_test_driver_order('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','2026-10-28');
  raise exception 'Driver self-dispatch allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform 1 from public.driver_assignments;
  raise exception 'Raw assignment read allowed';
 exception when insufficient_privilege then null; end;
end; $$;
insert into trip_results values('ack idempotency versions and payload conflict',true),('no driver self-dispatch or raw table access',true);
reset role;
insert into trip_results select 'exactly one acknowledgement event',count(*)=1
 from public.driver_assignment_events where event_type='acknowledged'
 and assignment_id in (select id from public.driver_assignments where order_id='e4000000-0000-4000-8000-000000000001');
-- Switch to the other driver's real assignment ID without revealing it to driver A.
select set_config('trip_test.other_assignment',(select id::text from public.driver_assignments where order_id='e4000000-0000-4000-8000-000000000002'),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.driver_orders(null,current_setting('trip_test.other_assignment')::uuid)) then raise exception 'Other driver read leaked'; end if;
 begin
  perform public.acknowledge_driver_assignment(current_setting('trip_test.other_assignment')::uuid,1,'e5000000-0000-4000-8000-000000000003');
  raise exception 'Other driver acknowledgement allowed';
 exception when no_data_found then null; end;
end; $$;
insert into trip_results values('guessed other assignment cannot read or acknowledge',true);
reset role;
update public.orders set notes=notes||' changed' where id='e4000000-0000-4000-8000-000000000001';
set local role authenticated;
insert into trip_results select 'order edit atomically revokes all old segments',count(*)=0 from public.driver_orders('2026-10-27');
reset role;
insert into trip_results select 'revocation events retained',count(*)=2
 from public.driver_assignment_events where event_type='revoked'
 and assignment_id in (select id from public.driver_assignments where order_id='e4000000-0000-4000-8000-000000000001');
set local role anon;
do $$ begin
 begin perform public.driver_orders('2026-10-27'); raise exception 'Anonymous RPC allowed';
 exception when insufficient_privilege then null; end;
end; $$;
insert into trip_results values('anonymous order RPC denied',true);
reset role;
select count(*) as passed_checks,bool_and(passed) as all_passed from trip_results;
rollback;
