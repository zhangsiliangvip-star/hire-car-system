-- Synthetic fixtures only; all data rolls back.
begin;
set local statement_timeout='25s';
insert into public.regions(id,name) values
 ('f2900220-0000-4000-8000-000000000001','Shift region'),
 ('f2900220-0000-4000-8000-000000000002','Other shift region');
insert into auth.users(id,email,raw_user_meta_data) values
 ('f1900220-0000-4000-8000-000000000001','shift-admin@example.invalid','{}'),
 ('f1900220-0000-4000-8000-000000000002','shift-driver@example.invalid','{}'),
 ('f1900220-0000-4000-8000-000000000003','shift-other@example.invalid','{}'),
 ('f1900220-0000-4000-8000-000000000004','shift-staff@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='f1900220-0000-4000-8000-000000000001';
update public.profiles set account_type='staff',role='user',region_id='f2900220-0000-4000-8000-000000000001'
 where id='f1900220-0000-4000-8000-000000000004';
insert into public.drivers(id,name,region_id) values
 ('f3900220-0000-4000-8000-000000000001','Shift driver','f2900220-0000-4000-8000-000000000001'),
 ('f3900220-0000-4000-8000-000000000002','Other shift driver','f2900220-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900220-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('f1900220-0000-4000-8000-000000000002','f3900220-0000-4000-8000-000000000001');
select public.bind_driver_identity('f1900220-0000-4000-8000-000000000003','f3900220-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','f1900220-0000-4000-8000-000000000002',true);
do $test$
declare request uuid:=gen_random_uuid(); result jsonb;
begin
 if public.driver_monthly_shift('2026-11')<> '{"month":"2026-11","version":0,"dates":[],"note":""}'::jsonb then raise exception 'Empty month shape'; end if;
 begin perform public.submit_driver_monthly_shift('2026-11',0,request,array['2026-12-01'::date],''); raise exception 'Cross-month accepted';
 exception when invalid_parameter_value then null; end;
 begin perform public.submit_driver_monthly_shift('2026-11',0,request,array['2026-11-01'::date,'2026-11-01'::date],''); raise exception 'Duplicate dates';
 exception when invalid_parameter_value then null; end;
 begin perform public.submit_driver_monthly_shift('2026-11',0,request,array[null::date],''); raise exception 'Null date';
 exception when invalid_parameter_value then null; end;
 result:=public.submit_driver_monthly_shift('2026-11',0,request,array['2026-11-15'::date,'2026-11-01'::date],'  Monthly note  ');
 if result<> '{"month":"2026-11","version":1,"dates":["2026-11-01","2026-11-15"],"note":"Monthly note"}'::jsonb then raise exception 'Submit shape/sorting'; end if;
 if public.submit_driver_monthly_shift('2026-11',0,request,array['2026-11-01'::date,'2026-11-15'::date],'Monthly note')<>result then raise exception 'Replay'; end if;
 begin perform public.submit_driver_monthly_shift('2026-11',1,request,'{}',''); raise exception 'Changed replay payload';
 exception when serialization_failure then null; end;
 begin perform public.submit_driver_monthly_shift('2026-11',0,gen_random_uuid(),'{}',''); raise exception 'Stale version';
 exception when serialization_failure then null; end;
 begin perform public.staff_driver_rest_days(array['2026-11-01'::date]); raise exception 'Driver staff access';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.driver_monthly_shifts; raise exception 'Raw shifts readable';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.driver_monthly_shift_events; raise exception 'Raw events readable';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','f1900220-0000-4000-8000-000000000003',true);
 if public.driver_monthly_shift('2026-11')->>'version'<>'0' then raise exception 'Other driver read'; end if;
 perform public.submit_driver_monthly_shift('2026-11',0,gen_random_uuid(),array['2026-11-01'::date],'Private other note');
 perform set_config('request.jwt.claim.sub','f1900220-0000-4000-8000-000000000004',true);
 result:=public.staff_driver_rest_days(array['2026-11-01'::date,'2026-11-02'::date]);
 if result<>'[{"driverId":"f3900220-0000-4000-8000-000000000001","date":"2026-11-01"}]'::jsonb then raise exception 'Staff minimal projection/region'; end if;
 begin perform public.driver_monthly_shift('2026-11'); raise exception 'Staff impersonated driver';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub','f1900220-0000-4000-8000-000000000001',true);
 if jsonb_array_length(public.staff_driver_rest_days(array['2026-11-01'::date]))<>2 then raise exception 'Admin cross-region'; end if;
 perform set_config('request.jwt.claim.sub','f1900220-0000-4000-8000-000000000002',true);
 result:=public.submit_driver_monthly_shift('2026-11',1,gen_random_uuid(),array['2026-11-02'::date],'Changed note');
 if result->>'version'<>'2' then raise exception 'Version update'; end if;
 perform set_config('request.jwt.claim.sub','f1900220-0000-4000-8000-000000000004',true);
 if public.staff_driver_rest_days(array['2026-11-01'::date])<>'[]'::jsonb then raise exception 'Removed rest still shown'; end if;
 if jsonb_array_length(public.staff_driver_rest_days(array['2026-11-02'::date]))<>1 then raise exception 'New rest not immediate'; end if;
 perform set_config('request.jwt.claim.sub','f1900220-0000-4000-8000-000000000002',true);
 perform public.submit_driver_monthly_shift('2026-12',0,gen_random_uuid(),array['2026-12-01'::date],'Next month');
 result:=public.submit_driver_monthly_shift('2026-11',2,gen_random_uuid(),'{}','No requested rest');
 if result->'dates'<>'[]'::jsonb or public.driver_monthly_shift('2026-12')->'dates'<>'["2026-12-01"]'::jsonb then raise exception 'Month replacement affected another month'; end if;
end;
$test$;
reset role;
do $test$
begin
 if (select count(*) from public.driver_monthly_shift_events where driver_id='f3900220-0000-4000-8000-000000000001')<>4 then raise exception 'Shift audit count/replay'; end if;
 if has_function_privilege('anon','public.submit_driver_monthly_shift(text,bigint,uuid,date[],text)','EXECUTE') then raise exception 'Anonymous write'; end if;
 if has_function_privilege('authenticated','public.record_driver_monthly_shift_event()','EXECUTE') then raise exception 'Audit helper exposed'; end if;
end;
$test$;
update public.driver_auth_links set status='suspended',version=version+1 where driver_id='f3900220-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1900220-0000-4000-8000-000000000002',true);
do $test$
begin
 begin perform public.driver_monthly_shift('2026-11'); raise exception 'Suspended read';
 exception when insufficient_privilege then null; end;
 begin perform public.submit_driver_monthly_shift('2026-11',3,gen_random_uuid(),'{}',''); raise exception 'Suspended write';
 exception when insufficient_privilege then null; end;
end;
$test$;
select 'monthly_shift_checks_passed' as result;
rollback;
