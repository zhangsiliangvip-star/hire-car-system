-- ONLY isolated zsipqwipauzgbqvppwjf. Historical order reads do not create assignments.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create function public.driver_historical_orders(target_date date)
returns table (
 order_id uuid, service_date date, departure_time text, pickup text,
 destination text, vehicle text, vehicle_number text, order_name text,
 trip_summary text, notes text
) language plpgsql stable security definer set search_path='' as $$
begin
 if target_date is null then
  raise exception 'Service date required' using errcode='22023';
 end if;
 if target_date >= (now() at time zone 'Asia/Tokyo')::date then
  return;
 end if;
 return query
 select o.id,target_date,o.time,o.pickup,o.destination,
  public.service_vehicle_name(o,target_date),public.service_vehicle_plate(o,target_date),
  coalesce(o.customer,''),coalesce(o.finance_by_date->target_date::text->>'tripSummary',''),
  coalesce(o.notes,'')
 from public.driver_identity() di
 join public.drivers d on d.id=di.driver_id and d.region_id=di.region_id
 join public.orders o on o.region_id=di.region_id
 where target_date between o.date and o.end_date
  and not(target_date=any(o.off_dates))
  and o.status<>'キャンセル'
  and public.service_driver_name(o,target_date)=di.driver_name
  and d.name=di.driver_name
  and (select count(*) from public.drivers same_name
   where same_name.region_id=di.region_id and same_name.name=di.driver_name)=1
  and not exists(select 1 from public.driver_assignments a
   where a.order_id=o.id and a.service_date=target_date)
 order by o.time,o.id
 limit 200;
end;
$$;

revoke all on function public.driver_historical_orders(date) from public,anon,authenticated;
grant execute on function public.driver_historical_orders(date) to authenticated;

commit;
