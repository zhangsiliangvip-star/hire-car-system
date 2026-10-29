-- Isolated zsipqwipauzgbqvppwjf only. Read-only defaults; saved reports are unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create or replace function public.driver_report_defaults(target_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity record; result jsonb;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Active driver required' using errcode='42501'; end if;
 if target_date is null then raise exception 'Service date required' using errcode='22023'; end if;
 select jsonb_build_object('serviceDate',target_date,'driverName',d.name,
 'orders',coalesce((
   select jsonb_agg(jsonb_build_object(
     'assignmentId',a.assignment_id,'time',a.departure_time,'pickup',a.pickup,'destination',a.destination,
     'vehicleNumber',coalesce(nullif(v.plate,''),day.plate,''),
     'depot',case when nullif(btrim(c.garage_address),'') is not null then
       jsonb_build_object('name',c.name,'address',btrim(c.garage_address)) else null end
   ) order by a.departure_time,a.assignment_id)
   from public.driver_orders(target_date,null) a
   join public.orders o on o.id=a.order_id and o.region_id=identity.region_id
   cross join lateral (select
     coalesce(o.finance_by_date->target_date::text->>'vehicle',o.vehicle) as vehicle,
     coalesce(o.finance_by_date->target_date::text->>'vehiclePlate',
       to_jsonb(o)->>'vehicle_plate',to_jsonb(o)->>'plate') as plate) day
   left join lateral (
     select matched.* from public.vehicles matched
     where matched.region_id=identity.region_id
       and case when coalesce(day.plate,'')<>'' then matched.plate=day.plate else matched.name=day.vehicle end
       and (select count(*) from public.vehicles other where other.region_id=identity.region_id
         and case when coalesce(day.plate,'')<>'' then other.plate=day.plate else other.name=day.vehicle end)=1
   ) v on true
   left join lateral (
     select matched.* from public.companies matched
     where matched.region_id=identity.region_id and matched.name=v.owner_company
       and (select count(*) from public.companies other
         where other.region_id=identity.region_id and other.name=v.owner_company)=1
   ) c on true
 ),'[]'::jsonb)) into result
 from public.drivers d where d.id=identity.driver_id and d.region_id=identity.region_id;
 return result;
end;
$$;
revoke all on function public.driver_report_defaults(date) from public,anon;
grant execute on function public.driver_report_defaults(date) to authenticated;
commit;
