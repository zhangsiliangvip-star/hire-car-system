-- Isolated zsipqwipauzgbqvppwjf only; extend the existing read-only projection.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create or replace function public.staff_operation_reports(target_month text, target_region uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare first_day date; result jsonb; actor_region uuid;
begin
 if not public.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
 select region_id into actor_region from public.profiles where id=auth.uid();
 if not public.is_admin() and (actor_region is null or (target_region is not null and target_region<>actor_region)) then
  raise exception 'Region denied' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Invalid month' using errcode='22023'; end if;
 first_day:=(target_month||'-01')::date;
 select coalesce(jsonb_agg(jsonb_build_object('regionId',r.region_id,'driverName',d.name,
  'company',vehicle.owner_company,'operationsManager',company.operations_manager,'report',public.driver_report_projection(r))
  order by r.service_date desc,r.departed_at desc,r.id),'[]'::jsonb)
 into result from public.driver_daily_reports r
 join public.drivers d on d.id=r.driver_id and d.region_id=r.region_id
 left join lateral (
  select min(v.owner_company) as owner_company from public.vehicles v
  where v.region_id=r.region_id and nullif(btrim(r.header->>'vehicleNumber'),'') is not null
   and btrim(v.plate)=btrim(r.header->>'vehicleNumber')
  having count(*)=1
 ) vehicle on true
 left join lateral (
  select min(c.operations_manager) as operations_manager from public.companies c
  where c.region_id=r.region_id and c.name=vehicle.owner_company
  having count(*)=1
 ) company on true
 where r.service_date>=first_day and r.service_date<first_day+interval '1 month'
  and (target_region is null or r.region_id=target_region)
  and (public.is_admin() or r.region_id=actor_region);
 return result;
end;
$fn$;
revoke all on function public.staff_operation_reports(text,uuid) from public,anon;
grant execute on function public.staff_operation_reports(text,uuid) to authenticated;
commit;
