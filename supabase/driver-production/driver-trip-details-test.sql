-- Local/isolated fixtures only; no production records are changed.
\set ON_ERROR_STOP on
begin;
insert into public.regions(id,name) values('a1900700-0000-4000-8000-000000000001','Trip detail fixture');
insert into auth.users(id,email,raw_user_meta_data) values
 ('a1900700-0000-4000-8000-000000000011','detail-admin@example.invalid','{"region_id":"a1900700-0000-4000-8000-000000000001"}'),
 ('a1900700-0000-4000-8000-000000000012','detail-driver@example.invalid','{"region_id":"a1900700-0000-4000-8000-000000000001"}'),
 ('a1900700-0000-4000-8000-000000000013','detail-other@example.invalid','{"region_id":"a1900700-0000-4000-8000-000000000001"}');
update public.profiles set account_type='staff',role='admin' where id='a1900700-0000-4000-8000-000000000011';
insert into public.drivers(id,name,region_id) values
 ('a1900700-0000-4000-8000-000000000021','Detail driver','a1900700-0000-4000-8000-000000000001'),
 ('a1900700-0000-4000-8000-000000000022','Other detail driver','a1900700-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900700-0000-4000-8000-000000000011',true);
select public.bind_driver_identity('a1900700-0000-4000-8000-000000000012','a1900700-0000-4000-8000-000000000021');
select public.bind_driver_identity('a1900700-0000-4000-8000-000000000013','a1900700-0000-4000-8000-000000000022');
reset role;
insert into public.orders(id,date,end_date,status,driver,region_id,customer,notes,order_price,finance_by_date)
values('a1900700-0000-4000-8000-000000000031',(now() at time zone 'Asia/Tokyo')::date,
 (now() at time zone 'Asia/Tokyo')::date+1,'予約確定','Detail driver','a1900700-0000-4000-8000-000000000001',
 'Detail order',E'備考一\n備考二',99999,jsonb_build_object(
 ((now() at time zone 'Asia/Tokyo')::date)::text,jsonb_build_object('tripSummary',E'Today\nRoute','dailyFare',99999),
 ((now() at time zone 'Asia/Tokyo')::date+1)::text,jsonb_build_object('tripSummary','Tomorrow route')));
select set_config('test.detail_assignment',id::text,true) from public.driver_assignments
 where order_id='a1900700-0000-4000-8000-000000000031' and service_date=(now() at time zone 'Asia/Tokyo')::date;
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900700-0000-4000-8000-000000000012',true);
do $test$
declare doc jsonb; tomorrow uuid;
begin
 select to_jsonb(d) into doc from public.driver_trip_detail(current_setting('test.detail_assignment')::uuid) d;
 if doc->>'order_name'<>'Detail order' or doc->>'trip_summary'<>E'Today\nRoute' or doc->>'notes'<>E'備考一\n備考二'
 or (select count(*) from jsonb_object_keys(doc))<>12 then raise exception 'Wrong detail projection'; end if;
 if doc ? 'finance_by_date' or doc ? 'order_price' or doc ? 'dailyFare' then raise exception 'Financial data exposed'; end if;
 select assignment_id into tomorrow from public.driver_orders((now() at time zone 'Asia/Tokyo')::date+1);
 if (select trip_summary from public.driver_trip_detail(tomorrow))<>'Tomorrow route' then raise exception 'Wrong service-day summary'; end if;
 if exists(select 1 from public.driver_trip_detail(null)) then raise exception 'Null selector exposed trips'; end if;
 perform set_config('request.jwt.claim.sub','a1900700-0000-4000-8000-000000000013',true);
 if exists(select 1 from public.driver_trip_detail(current_setting('test.detail_assignment')::uuid)) then raise exception 'Other driver read details'; end if;
 perform set_config('request.jwt.claim.sub','a1900700-0000-4000-8000-000000000011',true);
 if exists(select 1 from public.driver_trip_detail(current_setting('test.detail_assignment')::uuid)) then raise exception 'Staff accessed driver details'; end if;
end;
$test$;
reset role;
update public.orders set status='キャンセル' where id='a1900700-0000-4000-8000-000000000031';
set local role authenticated;
select set_config('request.jwt.claim.sub','a1900700-0000-4000-8000-000000000012',true);
do $test$
begin
 if exists(select 1 from public.driver_trip_detail(current_setting('test.detail_assignment')::uuid)) then raise exception 'Revoked details exposed'; end if;
 if has_function_privilege('anon','public.driver_trip_detail(uuid)','execute') then raise exception 'Anonymous detail access'; end if;
end;
$test$;
select 'driver_trip_details_checks_passed' as result;
rollback;
