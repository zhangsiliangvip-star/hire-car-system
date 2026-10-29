-- Isolated test project only. All synthetic fixtures and commands roll back.
-- Historical 006 behavior: run before 007; reason/snapshot assertions are superseded by 007 tests.
begin;
set local statement_timeout='20s';
create temporary table report_results(name text,passed boolean not null check(passed)) on commit drop;
grant insert,select on report_results to authenticated,anon;
insert into public.regions(id,name) values
 ('c2000000-0000-4000-8000-000000000001','Report A'),('c2000000-0000-4000-8000-000000000002','Report B');
insert into auth.users(id,email,raw_user_meta_data) values
 ('c1000000-0000-4000-8000-000000000001','report-admin@example.invalid','{}'),
 ('c1000000-0000-4000-8000-000000000002','report-a@example.invalid','{}'),
 ('c1000000-0000-4000-8000-000000000003','report-b@example.invalid','{}'),
 ('c1000000-0000-4000-8000-000000000004','report-c@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='c1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('c3000000-0000-4000-8000-000000000001','Report A','c2000000-0000-4000-8000-000000000001'),
 ('c3000000-0000-4000-8000-000000000002','Report B','c2000000-0000-4000-8000-000000000001'),
 ('c3000000-0000-4000-8000-000000000003','Report C','c2000000-0000-4000-8000-000000000002');
insert into public.driver_report_depots(driver_id,region_id,name,address,updated_by) values
 ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Synthetic depot','Default test address','c1000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('c1000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001');
select public.bind_driver_identity('c1000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000002');
select public.bind_driver_identity('c1000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
do $$
declare r jsonb; prior jsonb; item uuid; sid text; v bigint; req uuid:=gen_random_uuid(); bad jsonb; u text;
begin
 r:=public.driver_report_command(null,0,req,'checkout','{"useDefault":true,"address":"","km":100}');
 item:=(r->>'id')::uuid;
 if r->>'departureAddress'<>'Default test address' or (r->>'serviceDate')::date<>(clock_timestamp() at time zone 'Asia/Tokyo')::date then raise exception 'Automatic departure incorrect'; end if;
 if public.driver_report_command(null,0,req,'checkout','{"useDefault":true,"address":"","km":100}')<>r then raise exception 'Checkout replay failed'; end if;
 begin perform public.driver_report_command(null,0,gen_random_uuid(),'checkout','{"useDefault":false,"address":"x","km":100}'); raise exception 'Second open shift allowed';
 exception when serialization_failure then null; end;
 begin perform public.driver_report_command(null,0,req,'checkout','{"useDefault":false,"address":"changed","km":100}'); raise exception 'Key payload changed';
 exception when serialization_failure then null; end;
 insert into report_results values('automatic checkout default and idempotency one active',true);
 r:=public.driver_report_command(item,1,gen_random_uuid(),'add_stop','{"address":"Test stop"}');
 sid:=r->'stops'->0->>'id';
 begin perform public.driver_report_command(item,2,gen_random_uuid(),'depart',jsonb_build_object('stopId',sid,'km',101)); raise exception 'Departure before arrival allowed';
 exception when serialization_failure then null; end;
 r:=public.driver_report_command(item,2,gen_random_uuid(),'arrive',jsonb_build_object('stopId',sid,'km',101));
 begin perform public.driver_report_command(item,3,gen_random_uuid(),'return','{"useDefault":false,"address":"x","km":102}'); raise exception 'Return with open stop allowed';
 exception when invalid_parameter_value then null; end;
 begin perform public.driver_report_command(item,3,gen_random_uuid(),'depart',jsonb_build_object('stopId',sid,'km',100)); raise exception 'Odometer went backwards';
 exception when invalid_parameter_value then null; end;
 r:=public.driver_report_command(item,3,gen_random_uuid(),'rest_start','{}');
 begin perform public.driver_report_command(item,4,gen_random_uuid(),'rest_start','{}'); raise exception 'Overlapping rests allowed';
 exception when invalid_parameter_value then null; end;
 r:=public.driver_report_command(item,4,gen_random_uuid(),'rest_end','{}');
 r:=public.driver_report_command(item,5,gen_random_uuid(),'rest_start','{}');
 r:=public.driver_report_command(item,6,gen_random_uuid(),'rest_end','{}');
 r:=public.driver_report_command(item,7,gen_random_uuid(),'depart',jsonb_build_object('stopId',sid,'km',102));
 insert into report_results values('stop chronology monotonic odometers and multiple rests',true);
 prior:=r;
 bad:=(r->'stops'->0)||jsonb_build_object('reason','Correction','arrivedAt',clock_timestamp()+interval '1 day');
 begin perform public.driver_report_command(item,8,gen_random_uuid(),'edit_stop',bad); raise exception 'Future correction allowed';
 exception when invalid_parameter_value then null; end;
 bad:=(r->'stops'->0)||jsonb_build_object('reason','Correction','arrivedKm',99);
 begin perform public.driver_report_command(item,8,gen_random_uuid(),'edit_stop',bad); raise exception 'Correction odometer backwards allowed';
 exception when invalid_parameter_value then null; end;
 bad:=(r->'stops'->0)||jsonb_build_object('reason','','address','Corrected');
 begin perform public.driver_report_command(item,8,gen_random_uuid(),'edit_stop',bad); raise exception 'Unexplained correction allowed';
 exception when invalid_parameter_value then null; end;
 r:=public.driver_report_command(item,8,gen_random_uuid(),'edit_stop',(r->'stops'->0)||jsonb_build_object('reason','Address typo','address','Corrected test stop'));
 if r->'stops'->0->>'address'<>'Corrected test stop' then raise exception 'Correction not saved'; end if;
 insert into report_results values('manual correction future odometer reason checks',true);
 foreach u in array array['c1000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000004'] loop
  perform set_config('request.jwt.claim.sub',u,true);
  if jsonb_array_length(public.driver_reports()->'reports')<>0 or public.driver_reports()->'depot'<>'null'::jsonb then raise exception 'Other driver read leaked'; end if;
  begin perform public.driver_report_command(item,9,gen_random_uuid(),'rest_start','{}'); raise exception 'Other driver write allowed';
  exception when no_data_found then null; end;
 end loop;
 perform set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
 insert into report_results values('same-region and cross-region own-report isolation',true);
 r:=public.driver_report_command(item,9,gen_random_uuid(),'rest_start','{}');
 begin perform public.driver_report_command(item,10,gen_random_uuid(),'return','{"useDefault":false,"address":"x","km":110}'); raise exception 'Return while resting allowed';
 exception when invalid_parameter_value then null; end;
 r:=public.driver_report_command(item,10,gen_random_uuid(),'rest_end','{}');
 r:=public.driver_report_command(item,11,gen_random_uuid(),'return','{"useDefault":false,"address":"Manual return","km":110}');
 if r->>'returnAddress'<>'Manual return' or (r->>'returnKm')::numeric<>110 or r->>'returnedAt' is null then raise exception 'Return not recorded'; end if;
 begin perform public.driver_report_command(item,12,gen_random_uuid(),'rest_start','{}'); raise exception 'Closed report clocking allowed';
 exception when serialization_failure then null; end;
 begin perform public.driver_report_command(item,1,gen_random_uuid(),'edit_stop',(r->'stops'->0)||jsonb_build_object('reason','old')); raise exception 'Stale correction allowed';
 exception when serialization_failure then null; end;
 if public.driver_report_command(null,0,req,'checkout','{"useDefault":true,"address":"","km":100}')->>'returnedAt' is not null then raise exception 'Replay result not original'; end if;
 perform set_config('report_test.id',item::text,true);
 insert into report_results values('return snapshot closes shift and late replay original',true);
 begin perform 1 from public.driver_daily_reports; raise exception 'Raw reports allowed';
 exception when insufficient_privilege then null; end;
 begin perform 1 from public.driver_report_events; raise exception 'Raw audit allowed';
 exception when insufficient_privilege then null; end;
 insert into report_results values('direct report and audit access denied',true);
end; $$;
reset role;
insert into report_results select 'audit before after reason server attribution',
 count(*)=12 and bool_and(actor_user_id='c1000000-0000-4000-8000-000000000002' and occurred_at is not null)
 and count(*) filter(where command->>'action'='edit_stop' and before_data->'stops'->0->>'address'='Test stop'
 and after_data->'stops'->0->>'address'='Corrected test stop' and command->'payload'->>'reason'='Address typo')=1
 from public.driver_report_events where report_id=current_setting('report_test.id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select set_config('report_test.overnight',(public.driver_report_command(null,0,gen_random_uuid(),'checkout',
 '{"useDefault":false,"address":"Overnight test","km":200}')->>'id'),true);
reset role;
-- Simulate yesterday's checkout only on this rollback fixture, never on a user's report.
update public.driver_daily_reports set departed_at=clock_timestamp()-interval '25 hours',
 service_date=((clock_timestamp()-interval '25 hours') at time zone 'Asia/Tokyo')::date
 where id=current_setting('report_test.overnight')::uuid;
set local role authenticated;
do $$
declare r jsonb; item uuid:=current_setting('report_test.overnight')::uuid; start_at timestamptz; payload jsonb;
begin
 r:=public.driver_report_command(item,1,gen_random_uuid(),'add_stop','{"address":"Overnight stop"}');
 start_at:=(r->>'departedAt')::timestamptz;
 payload:=(r->'stops'->0)||jsonb_build_object('arrivedAt',start_at+interval '1 hour','arrivedKm',205,
   'departedAt',start_at+interval '2 hours','departedKm',206,'reason','Manual overnight entry');
 r:=public.driver_report_command(item,2,gen_random_uuid(),'edit_stop',payload);
 if (r->'stops'->0->>'arrivedAt')::timestamptz<>start_at+interval '1 hour'
  or (r->'stops'->0->>'departedAt')::timestamptz<>start_at+interval '2 hours' then raise exception 'Manual times not retained'; end if;
 r:=public.driver_report_command(item,3,gen_random_uuid(),'return','{"useDefault":false,"address":"Overnight return","km":210}');
 if (r->>'returnedAt')::timestamptz-start_at<interval '25 hours'
  or (r->>'serviceDate')::date<>(start_at at time zone 'Asia/Tokyo')::date then raise exception 'Overnight shift cut at midnight'; end if;
 insert into report_results values('manual times and overnight service date retained',true);
 begin perform public.driver_report_command(null,0,gen_random_uuid(),'checkout',
  '{"useDefault":false,"address":"x","km":210,"regionId":"forged"}');
  raise exception 'Direct RPC extra fields allowed';
 exception when invalid_parameter_value then null; end;
 begin perform public.driver_report_command(null,0,gen_random_uuid(),'checkout',
  '{"useDefault":false,"address":"x","km":null}');
  raise exception 'Direct RPC null odometer allowed';
 exception when invalid_parameter_value then null; end;
 insert into report_results values('direct rpc rejects extra fields and null odometer',true);
end; $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select public.set_driver_identity_status('c3000000-0000-4000-8000-000000000001','suspended',1);
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
do $$ begin
 begin perform public.driver_report_command(null,0,gen_random_uuid(),'checkout','{"useDefault":false,"address":"x","km":110}'); raise exception 'Suspended clocking allowed';
 exception when insufficient_privilege then null; end;
 if jsonb_array_length(public.driver_reports()->'reports')<>0 then raise exception 'Suspended read allowed'; end if;
end; $$;
insert into report_results values('suspended access immediately denied',true);
set local role anon;
do $$ begin
 begin perform public.driver_reports(); raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null; end;
 begin perform public.driver_report_command(null,0,gen_random_uuid(),'rest_start','{}'); raise exception 'Anonymous write allowed';
 exception when insufficient_privilege then null; end;
end; $$;
insert into report_results values('anonymous rpc denied',true);
reset role;
select count(*) as passed_checks,bool_and(passed) as all_passed from report_results;
rollback;
