-- Isolated zsipqwipauzgbqvppwjf only. Reuses existing pending-only review commands.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create function public.admin_order_finance_pending(target_month text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
 raise exception 'Invalid month' using errcode='22023'; end if;
 select coalesce(jsonb_agg(x.item order by x.service_date,x.order_id,x.kind,x.category),'[]'::jsonb) into result from (
   select a.service_date,a.order_id,'finance' kind,c.category,
     jsonb_build_object('kind','finance','orderId',a.order_id,'date',a.service_date,'driverName',d.name,
       'claim',public.driver_finance_claim_json(c)) item
   from public.driver_finance_claims c
   join public.driver_assignments a on a.id=c.assignment_id and a.driver_id=c.driver_id and a.region_id=c.region_id
   join public.drivers d on d.id=c.driver_id and d.region_id=c.region_id
   where c.status='pending' and to_char(a.service_date,'YYYY-MM')=target_month
   union all
   select f.service_date,a.order_id,'fuel','fuel',
     jsonb_build_object('kind','fuel','orderId',a.order_id,'date',f.service_date,'driverName',d.name,
       'claim',public.driver_daily_fuel_json(f))
   from public.driver_daily_fuel f
   join public.driver_assignments a on a.id=f.assignment_id and a.driver_id=f.driver_id
     and a.region_id=f.region_id and a.service_date=f.service_date
   join public.drivers d on d.id=f.driver_id and d.region_id=f.region_id
   where f.status='pending' and to_char(f.service_date,'YYYY-MM')=target_month
 ) x;
 return result;
end;
$$;
revoke all on function public.admin_order_finance_pending(text) from public,anon;
grant execute on function public.admin_order_finance_pending(text) to authenticated;
commit;
