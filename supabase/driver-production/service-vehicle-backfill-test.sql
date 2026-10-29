\set ON_ERROR_STOP on
begin;
insert into public.regions(id,name) values('a1900910-0000-4000-8000-000000000001','Backfill fixture');
insert into auth.users(id,email,raw_user_meta_data) values
 ('a1900910-0000-4000-8000-000000000011','backfill-admin@example.invalid','{"region_id":"a1900910-0000-4000-8000-000000000001"}');
update public.profiles set account_type='staff',role='admin' where id='a1900910-0000-4000-8000-000000000011';
select set_config('request.jwt.claim.sub','a1900910-0000-4000-8000-000000000011',true);
insert into public.drivers(id,name,region_id) values
 ('a1900910-0000-4000-8000-000000000021','Unique fixture driver','a1900910-0000-4000-8000-000000000001'),
 ('a1900910-0000-4000-8000-000000000022','Ambiguous fixture driver','a1900910-0000-4000-8000-000000000001');
insert into public.orders(id,date,end_date,status,driver,region_id,vehicle,vehicle_plate)
select id::uuid,(now() at time zone 'Asia/Tokyo')::date-10,(now() at time zone 'Asia/Tokyo')::date-10,
 (select status from public.orders limit 1),'',
 'a1900910-0000-4000-8000-000000000001','Model','LATEST'
from unnest(array['a1900910-0000-4000-8000-000000000031','a1900910-0000-4000-8000-000000000032',
 'a1900910-0000-4000-8000-000000000033']) id;
insert into public.driver_assignments(id,order_id,driver_id,region_id,service_date,created_by,status)
select id::uuid,order_id::uuid,driver_id::uuid,'a1900910-0000-4000-8000-000000000001',
 (now() at time zone 'Asia/Tokyo')::date-10,'a1900910-0000-4000-8000-000000000011',status
from (values
 ('a1900910-0000-4000-8000-000000000061','a1900910-0000-4000-8000-000000000031','a1900910-0000-4000-8000-000000000021','completed'),
 ('a1900910-0000-4000-8000-000000000062','a1900910-0000-4000-8000-000000000031','a1900910-0000-4000-8000-000000000021','revoked'),
 ('a1900910-0000-4000-8000-000000000063','a1900910-0000-4000-8000-000000000032','a1900910-0000-4000-8000-000000000022','completed'),
 ('a1900910-0000-4000-8000-000000000064','a1900910-0000-4000-8000-000000000033','a1900910-0000-4000-8000-000000000022','completed')
) x(id,order_id,driver_id,status);
insert into public.driver_daily_reports(id,driver_id,region_id,service_date,departed_at,departure_address,departure_km,
 returned_at,return_address,return_km,created_by,updated_by,header)
select id::uuid,driver_id::uuid,'a1900910-0000-4000-8000-000000000001',
 (now() at time zone 'Asia/Tokyo')::date-10,
 (((now() at time zone 'Asia/Tokyo')::date-10)+time '09:00') at time zone 'Asia/Tokyo','Synthetic garage',100,
 (((now() at time zone 'Asia/Tokyo')::date-10)+time '10:00') at time zone 'Asia/Tokyo','Synthetic garage',120,
 'a1900910-0000-4000-8000-000000000011','a1900910-0000-4000-8000-000000000011',
 '{"vehicleNumber":"KEEP-OLD","driverName":"Fixture","passengerCount":null}'::jsonb
from (values
 ('a1900910-0000-4000-8000-000000000051','a1900910-0000-4000-8000-000000000021'),
 ('a1900910-0000-4000-8000-000000000052','a1900910-0000-4000-8000-000000000022')
) x(id,driver_id);
with candidates as (
 select r.id,min(a.id::text)::uuid as assignment_id
 from public.driver_daily_reports r
 join public.driver_assignments a on a.driver_id=r.driver_id and a.region_id=r.region_id and a.service_date=r.service_date
 join public.orders o on o.id=a.order_id and o.region_id=r.region_id
 where nullif(r.header->>'assignmentId','') is null
 group by r.id having count(distinct a.order_id)=1
)
update public.driver_daily_reports r set header=r.header||jsonb_build_object('assignmentId',c.assignment_id),
 version=r.version+1,updated_at=clock_timestamp()
from candidates c where c.id=r.id;

do $test$
declare unique_report public.driver_daily_reports; ambiguous_report public.driver_daily_reports; projection jsonb;
begin
 select * into unique_report from public.driver_daily_reports where id='a1900910-0000-4000-8000-000000000051';
 select * into ambiguous_report from public.driver_daily_reports where id='a1900910-0000-4000-8000-000000000052';
 if unique_report.header->>'assignmentId' is null or unique_report.version<>2 then
  raise exception 'Unique historical order not linked and versioned'; end if;
 if (public.driver_report_projection(unique_report)->'header'->>'vehicleNumber') is distinct from 'LATEST' then
  raise exception 'Linked history did not display current plate'; end if;
 if ambiguous_report.header->>'assignmentId' is not null or ambiguous_report.version<>1 then
  raise exception 'Ambiguous historical report was guessed'; end if;
 projection:=public.driver_report_projection(ambiguous_report);
 if (projection->'header'->>'vehicleNumber') is distinct from 'KEEP-OLD'
 or jsonb_array_length(projection->'orderOptions')<>2 then
  raise exception 'Ambiguous report did not retain plate and manual choices'; end if;
end;
$test$;
select 'service_vehicle_backfill_checks_passed' as result;
rollback;
