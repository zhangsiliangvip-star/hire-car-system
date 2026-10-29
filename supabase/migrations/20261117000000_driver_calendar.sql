begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

-- Read-only calendar projection: only the signed-in driver's own service days and vehicles.
create function public.driver_calendar(range_start date, range_end date)
returns table (
 order_id uuid, service_date date, departure_time text, order_name text,
 order_status text, vehicle text, vehicle_number text, trip_summary text
) language plpgsql stable security definer set search_path='' as $$
begin
 if range_start is null or range_end is null or range_end < range_start or range_end - range_start > 62 then
  raise exception 'Invalid calendar range' using errcode='22023';
 end if;
 return query
 select o.id,day.service_date,o.time,o.customer,o.status,
  public.service_vehicle_name(o,day.service_date),public.service_vehicle_plate(o,day.service_date),
  coalesce(o.finance_by_date->day.service_date::text->>'tripSummary','')
 from public.driver_identity() di
 join public.drivers d on d.id=di.driver_id and d.region_id=di.region_id
 join public.orders o on o.region_id=di.region_id and o.date<=range_end and o.end_date>=range_start
 cross join lateral (
  select generated::date as service_date
  from generate_series(greatest(o.date,range_start),least(o.end_date,range_end),interval '1 day') generated
 ) day
 where not(day.service_date=any(o.off_dates))
  and o.status<>'キャンセル'
  and public.service_driver_name(o,day.service_date)=di.driver_name
  and d.name=di.driver_name
  and (select count(*) from public.drivers same_name
   where same_name.region_id=di.region_id and same_name.name=di.driver_name)=1
 order by day.service_date,o.time,o.id
 limit 2000;
end;
$$;

revoke all on function public.driver_calendar(date,date) from public,anon,authenticated;
grant execute on function public.driver_calendar(date,date) to authenticated;

commit;
