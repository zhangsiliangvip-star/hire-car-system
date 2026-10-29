-- Synthetic fixtures; all writes roll back.
begin;
set local statement_timeout='25s';
insert into public.regions(id,name) values
 ('f2900270-0000-4000-8000-000000000001','Execution A'),
 ('f2900270-0000-4000-8000-000000000002','Execution B');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900270-0000-4000-8000-000000000001','execution-admin@example.invalid','{}'),
 ('f1900270-0000-4000-8000-000000000002','execution-driver@example.invalid','{}'),
 ('f1900270-0000-4000-8000-000000000003','execution-staff@example.invalid','{}'),
 ('f1900270-0000-4000-8000-000000000004','execution-other-staff@example.invalid','{}');
update public.profiles set account_type='staff',role='admin'
 where id='f1900270-0000-4000-8000-000000000001';
update public.profiles set account_type='staff',role='user',region_id='f2900270-0000-4000-8000-000000000001'
 where id='f1900270-0000-4000-8000-000000000003';
update public.profiles set account_type='staff',role='user',region_id='f2900270-0000-4000-8000-000000000002'
 where id='f1900270-0000-4000-8000-000000000004';
insert into public.drivers(id,name,region_id) values
 ('f3900270-0000-4000-8000-000000000001','Execution driver','f2900270-0000-4000-8000-000000000001');
insert into public.orders(id,date,end_date,status,region_id,customer,order_price) values
 ('f4900270-0000-4000-8000-000000000001',(now() at time zone 'Asia/Tokyo')::date,
 (now() at time zone 'Asia/Tokyo')::date+1,'予約確定','f2900270-0000-4000-8000-000000000001','Private customer',99999);
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900270-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900270-0000-4000-8000-000000000002','f3900270-0000-4000-8000-000000000001');
select set_config('execution.assignment',public.dispatch_test_driver_order(
 'f4900270-0000-4000-8000-000000000001','f3900270-0000-4000-8000-000000000001',
 (now() at time zone 'Asia/Tokyo')::date)::text,true);
select public.dispatch_test_driver_order('f4900270-0000-4000-8000-000000000001','f3900270-0000-4000-8000-000000000001',
 (now() at time zone 'Asia/Tokyo')::date+1);
select set_config('request.jwt.claim.sub','f1900270-0000-4000-8000-000000000003',true);
do $test$
declare result jsonb;
begin
 result:=public.staff_driver_execution_status();
 if result->>'date' is distinct from ((now() at time zone 'Asia/Tokyo')::date)::text
 or jsonb_array_length(result->'rows')<>1 or result->'rows'->0->>'status' is distinct from 'assigned'
 or result->'rows'->0->>'orderId' is distinct from 'f4900270-0000-4000-8000-000000000001'
 or (select count(*) from jsonb_object_keys(result->'rows'->0))<>4 then raise exception 'Wrong day or excess projection'; end if;
end;
$test$;
select set_config('request.jwt.claim.sub','f1900270-0000-4000-8000-000000000004',true);
do $test$
begin
 if public.staff_driver_execution_status()->'rows'<>'[]'::jsonb then raise exception 'Cross-region status'; end if;
end;
$test$;
select set_config('request.jwt.claim.sub','f1900270-0000-4000-8000-000000000002',true);
do $test$
declare state text; expected bigint:=1; result jsonb;
begin
 begin perform public.staff_driver_execution_status(); raise exception 'Driver staff endpoint';
 exception when insufficient_privilege then null; end;
 foreach state in array array['acknowledged','en_route','arrived','in_service','completed'] loop
   perform public.transition_driver_assignment(current_setting('execution.assignment')::uuid,expected,gen_random_uuid(),state);
   expected:=expected+1;
   perform set_config('request.jwt.claim.sub','f1900270-0000-4000-8000-000000000003',true);
   result:=public.staff_driver_execution_status();
   if state='completed' then
     if result->'rows'->0->>'status' is distinct from state
       or (result->'rows'->0->>'version')::bigint<>expected then raise exception 'Completed status missing'; end if;
   elsif result->'rows'->0->>'status' is distinct from state
     or (result->'rows'->0->>'version')::bigint<>expected then raise exception 'Mobile status not reflected'; end if;
   perform set_config('request.jwt.claim.sub','f1900270-0000-4000-8000-000000000002',true);
 end loop;
end;
$test$;
reset role;
update public.driver_assignments set service_date=(now() at time zone 'Asia/Tokyo')::date-1
 where id=current_setting('execution.assignment')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900270-0000-4000-8000-000000000003',true);
do $test$
begin
 if public.staff_driver_execution_status()->'rows'<>'[]'::jsonb then raise exception 'Previous-day status'; end if;
end;
$test$;
reset role;
update public.driver_assignments set service_date=(now() at time zone 'Asia/Tokyo')::date
 where id=current_setting('execution.assignment')::uuid;
do $test$
begin
 if (select status from public.orders where id='f4900270-0000-4000-8000-000000000001') is distinct from '予約確定'
 or (select count(*) from public.orders where id='f4900270-0000-4000-8000-000000000001')<>1 then
 raise exception 'Completion changed/deleted booking'; end if;
 if has_function_privilege('anon','public.staff_driver_execution_status()','EXECUTE') then raise exception 'Anon status'; end if;
end;
$test$;
-- Revoked/cancelled orders do not retain status indicators.
update public.driver_assignments set status='revoked',version=version+1,revoked_at=now()
 where id=current_setting('execution.assignment')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900270-0000-4000-8000-000000000001',true);
do $test$
begin
 if public.staff_driver_execution_status()->'rows'<>'[]'::jsonb then raise exception 'Revoked label'; end if;
end;
$test$;
select public.dispatch_test_driver_order('f4900270-0000-4000-8000-000000000001','f3900270-0000-4000-8000-000000000001',
 (now() at time zone 'Asia/Tokyo')::date);
do $test$
begin
 if jsonb_array_length(public.staff_driver_execution_status()->'rows')<>1 then raise exception 'Reassignment missing'; end if;
end;
$test$;
reset role;
update public.orders set off_dates=array[(now() at time zone 'Asia/Tokyo')::date]
 where id='f4900270-0000-4000-8000-000000000001';
set local role authenticated;
do $test$
begin
 if public.staff_driver_execution_status()->'rows'<>'[]'::jsonb then raise exception 'Off-date label'; end if;
end;
$test$;
reset role;
update public.orders set off_dates='{}' where id='f4900270-0000-4000-8000-000000000001';
set local role authenticated;
select public.dispatch_test_driver_order('f4900270-0000-4000-8000-000000000001','f3900270-0000-4000-8000-000000000001',
 (now() at time zone 'Asia/Tokyo')::date);
reset role;
update public.orders set status='キャンセル' where id='f4900270-0000-4000-8000-000000000001';
set local role authenticated;
do $test$
begin
 if public.staff_driver_execution_status()->'rows'<>'[]'::jsonb then raise exception 'Cancelled label'; end if;
end;
$test$;
select 'driver_execution_status_checks_passed' as result;
rollback;
