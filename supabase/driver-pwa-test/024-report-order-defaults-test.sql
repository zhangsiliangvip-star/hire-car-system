-- Synthetic fixtures only; all data rolls back.
begin;
set local statement_timeout='25s';
insert into public.regions(id,name) values
 ('f2900240-0000-4000-8000-000000000001','Defaults A'),
 ('f2900240-0000-4000-8000-000000000002','Defaults B');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900240-0000-4000-8000-000000000001','defaults-admin@example.invalid','{}'),
 ('f1900240-0000-4000-8000-000000000002','defaults-driver@example.invalid','{}'),
 ('f1900240-0000-4000-8000-000000000003','defaults-other@example.invalid','{}');
update public.profiles set account_type='staff',role='admin'
 where id='f1900240-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('f3900240-0000-4000-8000-000000000001','Defaults driver','f2900240-0000-4000-8000-000000000001'),
 ('f3900240-0000-4000-8000-000000000002','Other driver','f2900240-0000-4000-8000-000000000001');
insert into public.companies(id,name,region_id,garage_address) values
 ('f5900240-0000-4000-8000-000000000001','Owner A','f2900240-0000-4000-8000-000000000001','Garage A'),
 ('f5900240-0000-4000-8000-000000000002','Owner B','f2900240-0000-4000-8000-000000000001','Garage B'),
 ('f5900240-0000-4000-8000-000000000003','Other region owner','f2900240-0000-4000-8000-000000000002','Other region garage');
insert into public.vehicles(id,name,plate,owner_company,region_id) values
 ('f6900240-0000-4000-8000-000000000001','Same model','PLATE-A','Owner A','f2900240-0000-4000-8000-000000000001'),
 ('f6900240-0000-4000-8000-000000000002','Same model','PLATE-B','Owner B','f2900240-0000-4000-8000-000000000001'),
 ('f6900240-0000-4000-8000-000000000003','Same model','OTHER-PLATE','Other region owner','f2900240-0000-4000-8000-000000000002');
insert into public.orders(id,date,end_date,status,pickup,destination,time,vehicle,region_id,finance_by_date,notes) values
 ('f4900240-0000-4000-8000-000000000001','2026-10-27','2026-10-28','予約確定','Airport','Hotel','09:00','Same model','f2900240-0000-4000-8000-000000000001',
 '{"2026-10-27":{"vehicle":"Same model","vehiclePlate":"PLATE-A"},"2026-10-28":{"vehicle":"Same model","vehiclePlate":"PLATE-B"}}','Private note'),
 ('f4900240-0000-4000-8000-000000000002','2026-10-27','2026-10-27','予約確定','Hotel','Airport','14:00','Missing model','f2900240-0000-4000-8000-000000000001','{"2026-10-27":{"vehicle":"Missing model","vehiclePlate":"UNREGISTERED"}}',''),
 ('f4900240-0000-4000-8000-000000000003','2026-10-27','2026-10-27','予約確定','Other driver pickup','Other destination','18:00','Same model','f2900240-0000-4000-8000-000000000001','{"2026-10-27":{"vehicle":"Same model","vehiclePlate":"PLATE-B"}}','');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900240-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900240-0000-4000-8000-000000000002','f3900240-0000-4000-8000-000000000001');
select public.bind_driver_identity('f1900240-0000-4000-8000-000000000003','f3900240-0000-4000-8000-000000000002');
select public.dispatch_test_driver_order('f4900240-0000-4000-8000-000000000001','f3900240-0000-4000-8000-000000000001','2026-10-27');
select public.dispatch_test_driver_order('f4900240-0000-4000-8000-000000000001','f3900240-0000-4000-8000-000000000001','2026-10-28');
select public.dispatch_test_driver_order('f4900240-0000-4000-8000-000000000002','f3900240-0000-4000-8000-000000000001','2026-10-27');
select public.dispatch_test_driver_order('f4900240-0000-4000-8000-000000000003','f3900240-0000-4000-8000-000000000002','2026-10-27');
select set_config('request.jwt.claim.sub','f1900240-0000-4000-8000-000000000002',true);
do $test$
declare result jsonb; saved jsonb;
begin
 result:=public.driver_report_defaults('2026-10-27');
 if result->>'driverName' is distinct from 'Defaults driver' or jsonb_array_length(result->'orders')<>2
 or result->'orders'->0->>'vehicleNumber' is distinct from 'PLATE-A'
 or result->'orders'->0->'depot'->>'address' is distinct from 'Garage A'
 or result->'orders'->1->>'vehicleNumber' is distinct from 'UNREGISTERED'
 or result->'orders'->1->'depot' is distinct from 'null'::jsonb then raise exception 'Wrong defaults or ownership'; end if;
 if (select count(*) from jsonb_object_keys(result))<>3
 or (select count(*) from jsonb_object_keys(result->'orders'->0))<>6 then raise exception 'Unexpected data exposed'; end if;
 result:=public.driver_report_defaults('2026-10-28');
 if jsonb_array_length(result->'orders')<>1 or result->'orders'->0->>'vehicleNumber' is distinct from 'PLATE-B'
 or result->'orders'->0->'depot'->>'address' is distinct from 'Garage B' then raise exception 'Daily vehicle ignored'; end if;
 if public.driver_report_defaults('2026-10-29')->'orders' <> '[]'::jsonb then raise exception 'Wrong service date'; end if;
 saved:=public.driver_report_command(null,0,gen_random_uuid(),'checkout',
   '{"useDefault":false,"address":"Manual garage","km":100,"header":{"serviceDate":"2026-10-27","vehicleNumber":"Manual plate","driverName":"Manual driver","passengerCount":null}}');
 perform public.driver_report_defaults('2026-10-27');
 if public.driver_reports()->'reports'->0 is distinct from saved then raise exception 'Saved report overwritten'; end if;
 begin perform public.driver_report_defaults(null); raise exception 'Null date allowed';
 exception when invalid_parameter_value then null; end;
end;
$test$;
select set_config('request.jwt.claim.sub','f1900240-0000-4000-8000-000000000003',true);
do $test$
begin
 if jsonb_array_length(public.driver_report_defaults('2026-10-27')->'orders')<>1
 or public.driver_report_defaults('2026-10-27')->>'driverName' is distinct from 'Other driver' then
 raise exception 'Other driver scope'; end if;
end;
$test$;
reset role;
-- A vehicle cannot read a garage from another region's company.
update public.vehicles set owner_company='Other region owner' where id='f6900240-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900240-0000-4000-8000-000000000002',true);
do $test$
begin
 if public.driver_report_defaults('2026-10-27')->'orders'->0->'depot' is distinct from 'null'::jsonb then
 raise exception 'Cross-region company selected'; end if;
end;
$test$;
reset role;
-- With no plate, duplicate model names must not pick an arbitrary vehicle.
update public.orders set finance_by_date=jsonb_set(finance_by_date,'{2026-10-27,vehiclePlate}','""')
 where id='f4900240-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900240-0000-4000-8000-000000000001',true);
select public.dispatch_test_driver_order('f4900240-0000-4000-8000-000000000001','f3900240-0000-4000-8000-000000000001','2026-10-27');
select set_config('request.jwt.claim.sub','f1900240-0000-4000-8000-000000000002',true);
do $test$
begin
 if public.driver_report_defaults('2026-10-27')->'orders'->0->'depot' is distinct from 'null'::jsonb
 or public.driver_report_defaults('2026-10-27')->'orders'->0->>'vehicleNumber' is distinct from '' then
 raise exception 'Ambiguous vehicle selected'; end if;
end;
$test$;
reset role;
update public.driver_assignments set status='revoked',version=version+1,revoked_at=now()
 where driver_id='f3900240-0000-4000-8000-000000000001';
set local role authenticated;
do $test$
begin
 if public.driver_report_defaults('2026-10-27')->'orders' <> '[]'::jsonb then raise exception 'Revoked assignment visible'; end if;
end;
$test$;
reset role;
update public.driver_auth_links set status='suspended',version=version+1
 where driver_id='f3900240-0000-4000-8000-000000000001';
set local role authenticated;
do $test$
begin
 begin perform public.driver_report_defaults('2026-10-27'); raise exception 'Suspended read';
 exception when insufficient_privilege then null; end;
end;
$test$;
reset role;
do $test$
begin
 if has_function_privilege('anon','public.driver_report_defaults(date)','EXECUTE') then raise exception 'Anon access'; end if;
end;
$test$;
select 'report_order_defaults_checks_passed' as result;
rollback;
