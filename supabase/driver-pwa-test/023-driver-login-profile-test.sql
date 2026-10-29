-- Synthetic fixtures only; all data rolls back.
begin;
set local statement_timeout='25s';
insert into public.regions(id,name) values('f2900230-0000-4000-8000-000000000001','Profile fixture');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900230-0000-4000-8000-000000000001','profile-admin@example.invalid','{}'),
 ('f1900230-0000-4000-8000-000000000002','profile-driver@example.invalid','{}'),
 ('f1900230-0000-4000-8000-000000000003','profile-other@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='f1900230-0000-4000-8000-000000000001';
update public.profiles set region_id='f2900230-0000-4000-8000-000000000001'
 where id in ('f1900230-0000-4000-8000-000000000002','f1900230-0000-4000-8000-000000000003');
insert into public.drivers(id,name,region_id,phone,wechat,whatsapp,license_expiry) values
 ('f3900230-0000-4000-8000-000000000001','Profile driver','f2900230-0000-4000-8000-000000000001','Original phone','Original WeChat','Original WhatsApp','2028-12-31'),
 ('f3900230-0000-4000-8000-000000000002','Other profile driver','f2900230-0000-4000-8000-000000000001','','','',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900230-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900230-0000-4000-8000-000000000002','f3900230-0000-4000-8000-000000000001');
select public.bind_driver_identity('f1900230-0000-4000-8000-000000000003','f3900230-0000-4000-8000-000000000002');
do $test$
declare result jsonb;
begin
 result:=public.admin_driver_login_target('f3900230-0000-4000-8000-000000000001');
 if result->>'userId' is distinct from 'f1900230-0000-4000-8000-000000000002' then raise exception 'Wrong target'; end if;
 if not exists(select 1 from jsonb_array_elements(public.admin_driver_logins()) x
  where x->>'driverId'='f3900230-0000-4000-8000-000000000001' and x->>'email'='profile-driver@example.invalid') then
  raise exception 'Login email missing'; end if;
 if exists(select 1 from jsonb_array_elements(public.admin_driver_logins()) x where x ? 'password' or x ? 'encrypted_password') then
  raise exception 'Password exposed'; end if;
end;
$test$;
select set_config('request.jwt.claim.sub','f1900230-0000-4000-8000-000000000002',true);
do $test$
declare result jsonb;
begin
 result:=public.driver_own_profile();
 if result->>'phone' is distinct from 'Original phone' or result->>'prompted' is distinct from 'false' then raise exception 'Initial projection'; end if;
 begin perform public.admin_driver_logins(); raise exception 'Driver sees auth emails';
 exception when insufficient_privilege then null; end;
 begin perform public.admin_driver_login_target('f3900230-0000-4000-8000-000000000002'); raise exception 'Driver targets other account';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.driver_profile_preferences; raise exception 'Raw preferences readable';
 exception when insufficient_privilege then null; end;
 begin perform public.update_driver_own_profile(0,'skip','{"phone":"Overwrite"}'); raise exception 'Skip wrote contacts';
 exception when invalid_parameter_value then null; end;
 result:=public.update_driver_own_profile(0,'skip','{}');
 if result->>'version' is distinct from '1' or result->>'prompted' is distinct from 'true'
 or result->>'phone' is distinct from 'Original phone' then raise exception 'Skip changed existing driver'; end if;
 begin perform public.update_driver_own_profile(0,'save','{"phone":"","wechat":"","whatsapp":"","licenseExpiry":""}'); raise exception 'Stale profile';
 exception when serialization_failure then null; end;
 begin perform public.update_driver_own_profile(1,'save','{"phone":"","wechat":"","whatsapp":"","licenseExpiry":"","driverId":"f3900230-0000-4000-8000-000000000002"}'); raise exception 'Ownership injection';
 exception when invalid_parameter_value then null; end;
 result:=public.update_driver_own_profile(1,'save','{"phone":"","wechat":"","whatsapp":"","licenseExpiry":""}');
 if result->>'phone' is distinct from '' or result->>'licenseExpiry' is distinct from '' then raise exception 'Optional blank fields rejected'; end if;
 result:=public.update_driver_own_profile(2,'save','{"phone":" 12345 ","wechat":" WeChat ","whatsapp":" WhatsApp ","licenseExpiry":"2029-01-31"}');
 if result->>'phone' is distinct from '12345' or result->>'wechat' is distinct from 'WeChat'
 or result->>'licenseExpiry' is distinct from '2029-01-31' then raise exception 'Saved projection'; end if;
 perform set_config('request.jwt.claim.sub','f1900230-0000-4000-8000-000000000003',true);
 if public.driver_own_profile()->>'phone' is distinct from '' or public.driver_own_profile()->>'prompted' is distinct from 'false' then
  raise exception 'Other driver isolation'; end if;
end;
$test$;
reset role;
do $test$
begin
 if (select phone from public.drivers where id='f3900230-0000-4000-8000-000000000001') is distinct from '12345'
 or (select license_expiry from public.drivers where id='f3900230-0000-4000-8000-000000000001') is distinct from '2029-01-31'::date then
  raise exception 'Driver record not synchronized'; end if;
 if (select name from public.drivers where id='f3900230-0000-4000-8000-000000000001') is distinct from 'Profile driver' then raise exception 'Identity changed'; end if;
 if has_function_privilege('anon','public.admin_driver_logins()','EXECUTE')
 or has_function_privilege('anon','public.update_driver_own_profile(bigint,text,jsonb)','EXECUTE') then raise exception 'Anonymous execution'; end if;
end;
$test$;
update public.driver_auth_links set status='suspended',version=version+1 where driver_id='f3900230-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900230-0000-4000-8000-000000000002',true);
do $test$
begin
 begin perform public.driver_own_profile(); raise exception 'Suspended read'; exception when insufficient_privilege then null; end;
 begin perform public.update_driver_own_profile(3,'skip','{}'); raise exception 'Suspended write'; exception when insufficient_privilege then null; end;
end;
$test$;
select 'driver_login_profile_checks_passed' as result;
rollback;
