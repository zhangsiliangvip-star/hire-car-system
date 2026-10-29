-- Synthetic fixtures on the restored local production baseline only. Always rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='30s';
insert into public.regions(id,name) values
 ('a1900400-0000-4000-8000-000000000001','Production rehearsal only'),
 ('a1900400-0000-4000-8000-000000000002','Production rehearsal other region');
insert into auth.users(id,email,raw_user_meta_data) values
 ('a1900400-0000-4000-8000-000000000011','rollout-admin@example.invalid','{"region_id":"a1900400-0000-4000-8000-000000000001"}'),
 ('a1900400-0000-4000-8000-000000000012','rollout-driver-a@example.invalid','{"region_id":"a1900400-0000-4000-8000-000000000001"}'),
 ('a1900400-0000-4000-8000-000000000013','rollout-driver-b@example.invalid','{"region_id":"a1900400-0000-4000-8000-000000000001"}'),
 ('a1900400-0000-4000-8000-000000000014','rollout-staff@example.invalid','{"region_id":"a1900400-0000-4000-8000-000000000001"}');
update public.profiles set account_type='staff',role='admin'
 where id='a1900400-0000-4000-8000-000000000011';
update public.profiles set account_type='staff' where id='a1900400-0000-4000-8000-000000000014';
insert into public.drivers(id,name,region_id) values
 ('a1900400-0000-4000-8000-000000000021','Rollout driver A','a1900400-0000-4000-8000-000000000001'),
 ('a1900400-0000-4000-8000-000000000022','Rollout driver B','a1900400-0000-4000-8000-000000000001'),
 ('a1900400-0000-4000-8000-000000000023','Rollout driver A','a1900400-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','a1900400-0000-4000-8000-000000000011',true);
set local role authenticated;
select public.bind_driver_identity('a1900400-0000-4000-8000-000000000012','a1900400-0000-4000-8000-000000000021');
select public.bind_driver_identity('a1900400-0000-4000-8000-000000000013','a1900400-0000-4000-8000-000000000022');
reset role;

insert into public.orders(id,date,end_date,status,pickup,destination,time,driver,region_id,finance_by_date)
values('a1900400-0000-4000-8000-000000000031',
 (now() at time zone 'Asia/Tokyo')::date-1,(now() at time zone 'Asia/Tokyo')::date+1,
 '予約確定','Rehearsal pickup','Rehearsal destination','09:00','Rollout driver A',
 'a1900400-0000-4000-8000-000000000001',
 jsonb_build_object(((now() at time zone 'Asia/Tokyo')::date+1)::text,jsonb_build_object('driver','Rollout driver B')));

do $test$
declare n integer;
begin
 select count(*) into n from public.driver_assignments where order_id='a1900400-0000-4000-8000-000000000031';
 if n<>2 then raise exception 'Expected today/tomorrow assignments only, not historical'; end if;
 if not exists(select 1 from public.driver_assignments
   where order_id='a1900400-0000-4000-8000-000000000031'
   and driver_id='a1900400-0000-4000-8000-000000000022'
   and service_date=(now() at time zone 'Asia/Tokyo')::date+1) then
   raise exception 'Daily driver override not used'; end if;
end;
$test$;

select set_config('request.jwt.claim.sub','a1900400-0000-4000-8000-000000000012',true);
set local role authenticated;
do $test$
declare assignment uuid; n integer;
begin
 select assignment_id into assignment from public.driver_orders((now() at time zone 'Asia/Tokyo')::date);
 if assignment is null then raise exception 'Own assigned trip unavailable'; end if;
 perform public.transition_driver_assignment(assignment,1,'a1900400-0000-4000-8000-000000000041','acknowledged');
 select count(*) into n from public.orders;
 if n<>0 then raise exception 'Driver can read raw business orders'; end if;
 select count(*) into n from public.driver_wage_items;
 if n<>0 then raise exception 'Driver can read raw payroll'; end if;
 if public.current_region_id() is not null then raise exception 'Driver inherits staff region authorization'; end if;
 begin
   perform public.dispatch_test_driver_order('a1900400-0000-4000-8000-000000000031',
     'a1900400-0000-4000-8000-000000000021',(now() at time zone 'Asia/Tokyo')::date);
   raise exception 'Legacy test dispatch function remains callable';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.allocate_invoice_number('a1900400-0000-4000-8000-000000000031',
     'a1900400-0000-4000-8000-000000000001');
   raise exception 'Driver allocated an invoice';
 exception when insufficient_privilege then null;
 end;
end;
$test$;
reset role;
select set_config('request.jwt.claim.sub','a1900400-0000-4000-8000-000000000011',true);
update public.orders set pickup='Updated pickup',time='10:00',
 finance_by_date=finance_by_date||jsonb_build_object(((now() at time zone 'Asia/Tokyo')::date)::text,
 jsonb_build_object('orderPrice',12345))
 where id='a1900400-0000-4000-8000-000000000031';
do $test$
begin
 if not exists(select 1 from public.driver_assignments where order_id='a1900400-0000-4000-8000-000000000031'
   and service_date=(now() at time zone 'Asia/Tokyo')::date and status='acknowledged' and version=2) then
   raise exception 'Address/time/financial change reset execution progress'; end if;
end;
$test$;

update public.orders set driver='Rollout driver B' where id='a1900400-0000-4000-8000-000000000031';
do $test$
begin
 if (select count(*) from public.driver_assignments where order_id='a1900400-0000-4000-8000-000000000031'
   and service_date=(now() at time zone 'Asia/Tokyo')::date)<>2
   or not exists(select 1 from public.driver_assignments where order_id='a1900400-0000-4000-8000-000000000031'
   and service_date=(now() at time zone 'Asia/Tokyo')::date and driver_id='a1900400-0000-4000-8000-000000000022'
   and status='assigned' and version=1) then raise exception 'Reassignment did not retain history and reset new driver'; end if;
end;
$test$;

do $test$
begin
 begin
  insert into public.drivers(id,name,region_id) values
   ('a1900400-0000-4000-8000-000000000024','Rollout driver A','a1900400-0000-4000-8000-000000000001');
  raise exception 'Production driver name uniqueness was lost';
 exception when unique_violation then null;
 end;
end;
$test$;
insert into public.drivers(id,name,region_id) values
 ('a1900400-0000-4000-8000-000000000024','Unbound rollout driver','a1900400-0000-4000-8000-000000000001');
update public.orders set driver='Unbound rollout driver' where id='a1900400-0000-4000-8000-000000000031';
do $test$
begin
 if exists(select 1 from public.driver_assignments where order_id='a1900400-0000-4000-8000-000000000031'
   and service_date=(now() at time zone 'Asia/Tokyo')::date and status<>'revoked') then
   raise exception 'Unbound driver received a dispatch'; end if;
end;
$test$;
update public.orders set status='キャンセル' where id='a1900400-0000-4000-8000-000000000031';
do $test$
begin
 if exists(select 1 from public.driver_assignments where order_id='a1900400-0000-4000-8000-000000000031'
   and status<>'revoked') then raise exception 'Cancelled trip retained active dispatch'; end if;
 begin
   delete from public.orders where id='a1900400-0000-4000-8000-000000000031';
   raise exception 'Order history was deleted';
 exception when sqlstate 'PDR01' then null;
 end;
end;
$test$;

insert into public.orders(id,date,end_date,status,pickup,destination,time,driver,region_id)
values('a1900400-0000-4000-8000-000000000032',
 (now() at time zone 'Asia/Tokyo')::date-1,(now() at time zone 'Asia/Tokyo')::date+1,
 '予約確定','Binding fixture','Binding destination','09:00','Unbound rollout driver',
 'a1900400-0000-4000-8000-000000000001');
insert into auth.users(id,email,raw_user_meta_data)
values('a1900400-0000-4000-8000-000000000015','rollout-driver-c@example.invalid',
 '{"region_id":"a1900400-0000-4000-8000-000000000001","account_type":"staff","role":"admin"}');
do $test$
begin
 if not exists(select 1 from public.profiles where id='a1900400-0000-4000-8000-000000000015'
   and account_type='pending' and role='user' and region_id='a1900400-0000-4000-8000-000000000001') then
   raise exception 'Auth metadata elevated privileges or lost target region'; end if;
end;
$test$;
select public.bind_driver_identity('a1900400-0000-4000-8000-000000000015','a1900400-0000-4000-8000-000000000024');
do $test$
begin
 if (select count(*) from public.driver_assignments where order_id='a1900400-0000-4000-8000-000000000032'
   and status='assigned')<>2 then raise exception 'New binding did not synchronize future existing orders'; end if;
end;
$test$;
select public.set_driver_identity_status('a1900400-0000-4000-8000-000000000024','suspended',1);
do $test$
begin
 if exists(select 1 from public.driver_assignments where order_id='a1900400-0000-4000-8000-000000000032'
   and status<>'revoked') then raise exception 'Suspension left active assignments'; end if;
end;
$test$;
select public.set_driver_identity_status('a1900400-0000-4000-8000-000000000024','active',2);
update public.orders set off_dates=array[(now() at time zone 'Asia/Tokyo')::date+1]
 where id='a1900400-0000-4000-8000-000000000032';
do $test$
begin
 if (select count(*) from public.driver_assignments where order_id='a1900400-0000-4000-8000-000000000032'
   and status<>'revoked')<>1 then raise exception 'Off-date removal did not revoke exactly one day'; end if;
end;
$test$;
update public.drivers set name='Renamed rollout driver' where id='a1900400-0000-4000-8000-000000000024';
do $test$
begin
 if exists(select 1 from public.driver_assignments where order_id='a1900400-0000-4000-8000-000000000032'
   and status<>'revoked') then raise exception 'Renamed driver retains unmatched assignment'; end if;
end;
$test$;

select set_config('request.jwt.claim.sub','a1900400-0000-4000-8000-000000000014',true);
set local role authenticated;
do $test$
begin
 if not public.is_staff() or public.is_admin()
   or not exists(select 1 from public.orders where id='a1900400-0000-4000-8000-000000000031') then
   raise exception 'Existing same-region staff access regressed'; end if;
end;
$test$;
reset role;
select 'production_dispatch_checks_passed' as result;
rollback;
