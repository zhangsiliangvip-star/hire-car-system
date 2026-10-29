-- Isolated zsipqwipauzgbqvppwjf only; read-only dispatch indicators.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create function public.staff_driver_execution_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare day date:=(now() at time zone 'Asia/Tokyo')::date; result jsonb;
begin
 if not public.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
 select jsonb_build_object('date',day,'rows',coalesce(jsonb_agg(
   jsonb_build_object('orderId',a.order_id,'date',a.service_date,'status',a.status,'version',a.version)
   order by a.order_id),'[]'::jsonb)) into result
 from public.driver_assignments a
 join public.orders o on o.id=a.order_id and o.region_id=a.region_id
 where a.service_date=day and a.status in ('assigned','acknowledged','en_route','arrived','in_service')
   and o.status<>'キャンセル' and day between o.date and o.end_date and not(day=any(o.off_dates))
   and (public.is_admin() or a.region_id=(select p.region_id from public.profiles p where p.id=auth.uid()));
 return result;
end;
$$;
revoke all on function public.staff_driver_execution_status() from public,anon;
grant execute on function public.staff_driver_execution_status() to authenticated;
commit;
