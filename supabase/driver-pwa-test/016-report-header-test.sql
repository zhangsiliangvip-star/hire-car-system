-- Isolated project only. Every synthetic row is rolled back.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Header test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','header-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','header-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Header driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $test$
declare r jsonb; saved jsonb; p jsonb; bad jsonb; h jsonb; item uuid;
 req uuid:=gen_random_uuid(); day date:=(clock_timestamp() at time zone 'Asia/Tokyo')::date-2;
 a timestamptz;
begin
 h:=jsonb_build_object('serviceDate',day,'vehicleNumber','TEST-123','driverName','Manual name','passengerCount',3);
 p:=jsonb_build_object('useDefault',false,'address','Depot','km',100,'header',h);
 r:=public.driver_report_command(null,0,req,'checkout',p);
 item:=(r->>'id')::uuid; a:=(r->>'departedAt')::timestamptz;
 if r->>'serviceDate'<>day::text or r->'header'->>'vehicleNumber'<>'TEST-123'
 or r->'header'->>'driverName'<>'Manual name' or r->'header'->>'passengerCount'<>'3'
 or (a at time zone 'Asia/Tokyo')::date<>day then raise exception 'Header checkout failed'; end if;
 if public.driver_report_command(null,0,req,'checkout',p)<>r then raise exception 'Checkout retry failed'; end if;
 r:=public.driver_report_command(item,1,gen_random_uuid(),'add_stop',
  jsonb_build_object('address','Night stop','km',110,'arrivedAt',a+interval '10 hours','departedAt',a+interval '11 hours'));
 h:=h||jsonb_build_object('serviceDate',day-1,'vehicleNumber','Changed','driverName','Another display name','passengerCount',0);
 p:=jsonb_build_object('header',h,'stops',jsonb_build_array((r->'stops'->0)||jsonb_build_object(
  'arrivedAt',a-interval '14 hours','departedAt',a-interval '13 hours')),
  'departure',jsonb_build_object('address','Changed depot','km',99,'departedAt',a-interval '1 day'),
  'return',jsonb_build_object('address','Return','km',120,'returnedAt',a-interval '12 hours'));
 req:=gen_random_uuid();
 r:=public.driver_report_command(item,2,req,'edit_stops',p);
 if (r->>'version')::integer<>3 or r->>'serviceDate'<>(day-1)::text
 or r->'header'->>'passengerCount'<>'0'
 or (r->'stops'->0->>'departedAt')::timestamptz-(r->'stops'->0->>'arrivedAt')::timestamptz<>interval '1 hour'
 or (r->>'returnedAt')::timestamptz-(r->>'departedAt')::timestamptz<>interval '12 hours' then raise exception 'Atomic dated report failed'; end if;
 if public.driver_report_command(item,2,req,'edit_stops',p)<>r then raise exception 'Header retry failed'; end if;
 saved:=r;
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  jsonb_set(p,'{header,passengerCount}','-1'),jsonb_set(p,'{header,passengerCount}','1.5'),
  jsonb_set(p,'{header,passengerCount}','1000'),jsonb_set(p,'{header,extra}','true'),
  jsonb_set(p,'{header,driverName}','null'),jsonb_set(p,'{header,vehicleNumber}',to_jsonb(repeat('x',101))),
  jsonb_set(p,'{header,serviceDate}',to_jsonb(day+10)),
  jsonb_set(p,'{header,serviceDate}','"2026-02-30"')
 )) loop
  begin
   perform public.driver_report_command(item,3,gen_random_uuid(),'edit_stops',bad);
   raise exception 'Invalid header accepted';
  exception when invalid_parameter_value or invalid_datetime_format or datetime_field_overflow then null; end;
  if public.driver_reports()->'reports'->0<>saved then raise exception 'Partial header persisted'; end if;
 end loop;
 h:=h||jsonb_build_object('serviceDate',day-2,'passengerCount',null);
 p:=jsonb_set(p,'{header}',h);
 p:=jsonb_set(p,'{departure,departedAt}',to_jsonb(a-interval '2 days'));
 p:=jsonb_set(p,'{stops,0,arrivedAt}',to_jsonb(a-interval '38 hours'));
 p:=jsonb_set(p,'{stops,0,departedAt}',to_jsonb(a-interval '37 hours'));
 p:=jsonb_set(p,'{return,returnedAt}',to_jsonb(a-interval '36 hours'));
 r:=public.driver_report_command(item,3,gen_random_uuid(),'edit_stops',p);
 if r->>'serviceDate'<>(day-2)::text or r->'header'->>'passengerCount' is not null then raise exception 'Closed date edit failed'; end if;
 if public.driver_reports()->'reports'->0<>r then raise exception 'Header read failed'; end if;
 if (select driver_id from public.driver_identity())<>'b3000000-0000-4000-8000-000000000001'::uuid then raise exception 'Display name changed ownership'; end if;
end;
$test$;
select 'report_header_checks_passed' as result;
rollback;
