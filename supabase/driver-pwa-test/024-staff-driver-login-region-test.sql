-- Synthetic fixtures only; all data rolls back.
begin;
set local statement_timeout='25s';
insert into public.regions(id,name) values
 ('f2900240-0000-4000-8000-000000000001','Staff login region A'),
 ('f2900240-0000-4000-8000-000000000002','Staff login region B');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900240-0000-4000-8000-000000000001','staff-login-admin@example.invalid','{}'),
 ('f1900240-0000-4000-8000-000000000002','staff-login-a@example.invalid','{}'),
 ('f1900240-0000-4000-8000-000000000003','staff-login-b@example.invalid','{}'),
 ('f1900240-0000-4000-8000-000000000004','staff-login-driver-a@example.invalid','{}'),
 ('f1900240-0000-4000-8000-000000000005','staff-login-driver-b@example.invalid','{}'),
 ('f1900240-0000-4000-8000-000000000006','staff-login-pending-a@example.invalid','{}'),
 ('f1900240-0000-4000-8000-000000000007','staff-login-pending-b@example.invalid','{}');
update public.profiles set account_type='staff',role='admin',region_id='f2900240-0000-4000-8000-000000000001'
 where id='f1900240-0000-4000-8000-000000000001';
update public.profiles set account_type='staff',role='user',region_id='f2900240-0000-4000-8000-000000000001'
 where id='f1900240-0000-4000-8000-000000000002';
update public.profiles set account_type='staff',role='user',region_id='f2900240-0000-4000-8000-000000000002'
 where id='f1900240-0000-4000-8000-000000000003';
update public.profiles set region_id='f2900240-0000-4000-8000-000000000002'
 where id='f1900240-0000-4000-8000-000000000005';
update public.profiles set region_id='f2900240-0000-4000-8000-000000000001'
 where id='f1900240-0000-4000-8000-000000000004';
update public.profiles set region_id='f2900240-0000-4000-8000-000000000001'
 where id='f1900240-0000-4000-8000-000000000006';
update public.profiles set region_id='f2900240-0000-4000-8000-000000000002'
 where id='f1900240-0000-4000-8000-000000000007';
insert into public.drivers(id,name,region_id,phone,wechat,whatsapp,license_expiry) values
 ('f3900240-0000-4000-8000-000000000001','Region A driver','f2900240-0000-4000-8000-000000000001','','','',null),
 ('f3900240-0000-4000-8000-000000000002','Region B driver','f2900240-0000-4000-8000-000000000002','','','',null),
 ('f3900240-0000-4000-8000-000000000003','Unlinked region A driver','f2900240-0000-4000-8000-000000000001','','','',null);

set local role authenticated;
select set_config('request.jwt.claim.sub','f1900240-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900240-0000-4000-8000-000000000004','f3900240-0000-4000-8000-000000000001');
select public.bind_driver_identity('f1900240-0000-4000-8000-000000000005','f3900240-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.sub','f1900240-0000-4000-8000-000000000002',true);
do $test$
declare result jsonb;
begin
 result:=public.admin_driver_login_target('f3900240-0000-4000-8000-000000000001');
 if result->>'userId' is distinct from 'f1900240-0000-4000-8000-000000000004' then
  raise exception 'Regional staff could not inspect local driver login'; end if;
 if exists(select 1 from jsonb_array_elements(public.admin_driver_logins()) x
  where x->>'driverId'='f3900240-0000-4000-8000-000000000002') then
  raise exception 'Regional staff received a foreign-region email'; end if;
 begin perform public.admin_driver_login_target('f3900240-0000-4000-8000-000000000002');
  raise exception 'Regional staff accessed foreign driver';
 exception when insufficient_privilege then null; end;
 perform public.bind_driver_identity('f1900240-0000-4000-8000-000000000006','f3900240-0000-4000-8000-000000000003');
 begin perform public.bind_driver_identity('f1900240-0000-4000-8000-000000000007','f3900240-0000-4000-8000-000000000002');
  raise exception 'Regional staff bound foreign driver';
 exception when insufficient_privilege then null; end;
end;
$test$;

select set_config('request.jwt.claim.sub','f1900240-0000-4000-8000-000000000003',true);
do $test$
begin
 if exists(select 1 from jsonb_array_elements(public.admin_driver_logins()) x
  where x->>'driverId'='f3900240-0000-4000-8000-000000000001') then
  raise exception 'Other region staff received an email'; end if;
end;
$test$;

select set_config('request.jwt.claim.sub','f1900240-0000-4000-8000-000000000001',true);
do $test$
begin
 if (select count(*) from jsonb_array_elements(public.admin_driver_logins()))<>3 then
  raise exception 'Administrator did not receive all driver logins'; end if;
 if public.admin_driver_login_target('f3900240-0000-4000-8000-000000000002')->>'driverId'
  is distinct from 'f3900240-0000-4000-8000-000000000002' then
  raise exception 'Administrator could not inspect cross-region driver'; end if;
end;
$test$;
reset role;
do $test$
begin
 if not exists(select 1 from public.driver_auth_links
  where driver_id='f3900240-0000-4000-8000-000000000003'
   and user_id='f1900240-0000-4000-8000-000000000006') then
  raise exception 'Same-region bind failed'; end if;
 if exists(select 1 from public.driver_auth_links
  where user_id='f1900240-0000-4000-8000-000000000007') then
  raise exception 'Foreign-region bind was stored'; end if;
end;
$test$;
select 'staff_driver_login_region_checks_passed' as result;
rollback;
