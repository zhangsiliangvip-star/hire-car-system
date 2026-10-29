-- Synthetic fixtures; no real claims or storage objects are changed.
begin;
set local statement_timeout='25s';
insert into public.regions(id,name) values
 ('f2900250-0000-4000-8000-000000000001','Receipt region A'),
 ('f2900250-0000-4000-8000-000000000002','Receipt region B');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900250-0000-4000-8000-000000000001','receipt-admin@example.invalid','{}'),
 ('f1900250-0000-4000-8000-000000000002','receipt-driver@example.invalid','{}'),
 ('f1900250-0000-4000-8000-000000000003','receipt-staff@example.invalid','{}'),
 ('f1900250-0000-4000-8000-000000000004','receipt-other-staff@example.invalid','{}');
update public.profiles set account_type='staff',role='admin'
 where id='f1900250-0000-4000-8000-000000000001';
update public.profiles set account_type='staff',role='user',region_id='f2900250-0000-4000-8000-000000000001'
 where id='f1900250-0000-4000-8000-000000000003';
update public.profiles set account_type='staff',role='user',region_id='f2900250-0000-4000-8000-000000000002'
 where id='f1900250-0000-4000-8000-000000000004';
insert into public.drivers(id,name,region_id) values
 ('f3900250-0000-4000-8000-000000000001','Receipt driver','f2900250-0000-4000-8000-000000000001');
insert into public.orders(id,date,end_date,status,region_id) values
 ('f4900250-0000-4000-8000-000000000001','2026-10-25','2026-10-26','予約確定','f2900250-0000-4000-8000-000000000001'),
 ('f4900250-0000-4000-8000-000000000002','2026-10-25','2026-10-25','予約確定','f2900250-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900250-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900250-0000-4000-8000-000000000002','f3900250-0000-4000-8000-000000000001');
reset role;
insert into public.driver_assignments(id,order_id,driver_id,region_id,service_date,status,created_by) values
 ('f6900250-0000-4000-8000-000000000001','f4900250-0000-4000-8000-000000000001','f3900250-0000-4000-8000-000000000001','f2900250-0000-4000-8000-000000000001','2026-10-25','completed','f1900250-0000-4000-8000-000000000001'),
 ('f6900250-0000-4000-8000-000000000002','f4900250-0000-4000-8000-000000000001','f3900250-0000-4000-8000-000000000001','f2900250-0000-4000-8000-000000000001','2026-10-26','completed','f1900250-0000-4000-8000-000000000001'),
 ('f6900250-0000-4000-8000-000000000003','f4900250-0000-4000-8000-000000000002','f3900250-0000-4000-8000-000000000001','f2900250-0000-4000-8000-000000000001','2026-10-25','completed','f1900250-0000-4000-8000-000000000001');
select set_config('receipt.company','f1900250-0000-4000-8000-000000000002/f6900250-0000-4000-8000-000000000001/company/f7900250-0000-4000-8000-000000000001.jpg',true);
select set_config('receipt.trip','f1900250-0000-4000-8000-000000000002/f6900250-0000-4000-8000-000000000001/trip/f7900250-0000-4000-8000-000000000002.jpg',true);
select set_config('receipt.fuel','f1900250-0000-4000-8000-000000000002/2026-10-25/f7900250-0000-4000-8000-000000000003.jpg',true);
insert into public.driver_finance_claims(assignment_id,driver_id,region_id,category,status,expenses,overtime_hours,baseline,request_id)
select 'f6900250-0000-4000-8000-000000000001','f3900250-0000-4000-8000-000000000001','f2900250-0000-4000-8000-000000000001',
 category,status,jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'type',category,'detail',detail,'amount',100,
 'receipts',jsonb_build_array(path))),0,'{}',gen_random_uuid()
from (values
 ('company','approved','Parking',current_setting('receipt.company')),
 ('trip','pending','Pending toll',current_setting('receipt.trip'))) x(category,status,detail,path);
insert into public.driver_finance_claims(assignment_id,driver_id,region_id,category,status,expenses,overtime_hours,baseline,request_id)
select assignment,'f3900250-0000-4000-8000-000000000001','f2900250-0000-4000-8000-000000000001','trip','approved',
 jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'type','trip','detail','Other order or day','amount',100,
 'receipts',jsonb_build_array('not-this-order.jpg'))),0,'{}',gen_random_uuid()
from (values ('f6900250-0000-4000-8000-000000000002'::uuid),('f6900250-0000-4000-8000-000000000003'::uuid)) x(assignment);
insert into public.driver_daily_fuel(driver_id,region_id,assignment_id,baseline,service_date,status,amount,receipts,request_id)
values('f3900250-0000-4000-8000-000000000001','f2900250-0000-4000-8000-000000000001','f6900250-0000-4000-8000-000000000001',
 '{}','2026-10-25','approved',1000,jsonb_build_array(current_setting('receipt.fuel')),gen_random_uuid());
insert into storage.objects(bucket_id,name) values
 ('driver-finance-receipts',current_setting('receipt.company')),
 ('driver-finance-receipts',current_setting('receipt.trip')),
 ('driver-fuel-receipts',current_setting('receipt.fuel'));
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900250-0000-4000-8000-000000000003',true);
do $test$
declare result jsonb;
begin
 result:=public.staff_order_receipts('f4900250-0000-4000-8000-000000000001','2026-10-25');
 if jsonb_array_length(result)<>2 or result->0->>'detail' is distinct from 'Parking'
 or result->1->>'category' is distinct from 'fuel' then raise exception 'Approved order/date projection'; end if;
 if (select count(*) from jsonb_object_keys(result->0))<>4 then raise exception 'Extra data exposed'; end if;
 if public.staff_order_receipts('f4900250-0000-4000-8000-000000000001','2026-10-27')<>'[]'::jsonb then raise exception 'Wrong date'; end if;
 if not public.can_read_approved_order_receipt('driver-finance-receipts',current_setting('receipt.company'))
 or not public.can_read_approved_order_receipt('driver-fuel-receipts',current_setting('receipt.fuel'))
 or public.can_read_approved_order_receipt('driver-finance-receipts',current_setting('receipt.trip'))
 or public.can_read_approved_order_receipt('driver-fuel-receipts',current_setting('receipt.company')) then raise exception 'Receipt access filter'; end if;
 if (select count(*) from storage.objects where name in(current_setting('receipt.company'),current_setting('receipt.trip'),current_setting('receipt.fuel')))<>2 then
 raise exception 'Storage RLS approved-only'; end if;
 begin perform 1 from public.driver_finance_claims; raise exception 'Raw claims exposed'; exception when insufficient_privilege then null; end;
end;
$test$;
select set_config('request.jwt.claim.sub','f1900250-0000-4000-8000-000000000004',true);
do $test$
begin
 begin perform public.staff_order_receipts('f4900250-0000-4000-8000-000000000001','2026-10-25');
 raise exception 'Other region access'; exception when insufficient_privilege then null; end;
 if public.can_read_approved_order_receipt('driver-finance-receipts',current_setting('receipt.company'))
 or exists(select 1 from storage.objects where name=current_setting('receipt.company')) then raise exception 'Other region photo'; end if;
end;
$test$;
select set_config('request.jwt.claim.sub','f1900250-0000-4000-8000-000000000002',true);
do $test$
begin
 begin perform public.staff_order_receipts('f4900250-0000-4000-8000-000000000001','2026-10-25');
 raise exception 'Driver staff endpoint'; exception when insufficient_privilege then null; end;
 if public.can_read_approved_order_receipt('driver-finance-receipts',current_setting('receipt.company')) then raise exception 'Driver staff policy'; end if;
end;
$test$;
reset role;
update public.driver_finance_claims set status='rejected'
 where assignment_id='f6900250-0000-4000-8000-000000000001' and category='trip';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900250-0000-4000-8000-000000000003',true);
do $test$
begin
 if jsonb_array_length(public.staff_order_receipts('f4900250-0000-4000-8000-000000000001','2026-10-25'))<>2
 or public.can_read_approved_order_receipt('driver-finance-receipts',current_setting('receipt.trip')) then raise exception 'Rejected exposed'; end if;
end;
$test$;
reset role;
update public.driver_finance_claims set status='approved'
 where assignment_id='f6900250-0000-4000-8000-000000000001' and category='trip';
update public.driver_assignments set status='revoked',version=version+1,revoked_at=now()
 where id='f6900250-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900250-0000-4000-8000-000000000003',true);
do $test$
begin
 if jsonb_array_length(public.staff_order_receipts('f4900250-0000-4000-8000-000000000001','2026-10-25'))<>3 then
 raise exception 'Booked receipt history lost'; end if;
 if not exists(select 1 from storage.objects where name=current_setting('receipt.trip')) then raise exception 'Approved storage access'; end if;
end;
$test$;
select set_config('request.jwt.claim.sub','f1900250-0000-4000-8000-000000000001',true);
do $test$
begin
 if jsonb_array_length(public.staff_order_receipts('f4900250-0000-4000-8000-000000000001','2026-10-25'))<>3 then raise exception 'Admin access'; end if;
end;
$test$;
reset role;
do $test$
begin
 if has_function_privilege('anon','public.staff_order_receipts(uuid,date)','EXECUTE') then raise exception 'Anon access'; end if;
end;
$test$;
select 'order_approved_receipts_checks_passed' as result;
rollback;
