begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.driver_trip_detail(target_assignment uuid)
returns table (
 assignment_id uuid, order_id uuid, service_date date, departure_time text,
 pickup text, destination text, vehicle text, status text, version bigint,
 order_name text, trip_summary text, notes text
) language sql stable security definer set search_path='' as $$
 select a.assignment_id,a.order_id,a.service_date,a.departure_time,a.pickup,a.destination,a.vehicle,a.status,a.version,
 coalesce(o.customer,''),coalesce(o.finance_by_date->a.service_date::text->>'tripSummary',''),coalesce(o.notes,'')
 from public.driver_orders(null,target_assignment) a
 join public.orders o on o.id=a.order_id
 where target_assignment is not null;
$$;
revoke all on function public.driver_trip_detail(uuid) from public,anon;
grant execute on function public.driver_trip_detail(uuid) to authenticated;
commit;
