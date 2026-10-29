-- Isolated zsipqwipauzgbqvppwjf only; no financial writes or public buckets.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create function public.staff_order_receipts(target_order uuid,target_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_staff() or not exists(select 1 from public.orders o where o.id=target_order
   and (public.is_admin() or o.region_id=(select p.region_id from public.profiles p where p.id=auth.uid()))) then
   raise exception 'Staff order access required' using errcode='42501'; end if;
 if target_date is null then raise exception 'Service date required' using errcode='22023'; end if;
 select coalesce(jsonb_agg(x.receipt order by x.category,x.path),'[]'::jsonb) into result from (
   select c.category,p.path,jsonb_build_object('bucket','driver-finance-receipts',
     'path',p.path,'category',c.category,'detail',e.item->>'detail') receipt
   from public.driver_finance_claims c
   join public.driver_assignments a on a.id=c.assignment_id and a.region_id=c.region_id and a.driver_id=c.driver_id
   cross join lateral jsonb_array_elements(c.expenses) e(item)
   cross join lateral jsonb_array_elements_text(e.item->'receipts') p(path)
   where a.order_id=target_order and a.service_date=target_date and c.status='approved' and c.category in ('company','trip')
   union all
   select 'fuel',p.path,jsonb_build_object('bucket','driver-fuel-receipts',
     'path',p.path,'category','fuel','detail','燃油费')
   from public.driver_daily_fuel f
   join public.driver_assignments a on a.id=f.assignment_id and a.region_id=f.region_id and a.driver_id=f.driver_id
   cross join lateral jsonb_array_elements_text(f.receipts) p(path)
   where a.order_id=target_order and a.service_date=target_date and f.service_date=target_date and f.status='approved'
 ) x;
 return result;
end;
$$;
create function public.can_read_approved_order_receipt(target_bucket text,target_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.is_staff() and exists(
   select 1 from (
     select a.region_id from public.driver_finance_claims c
     join public.driver_assignments a on a.id=c.assignment_id and a.region_id=c.region_id and a.driver_id=c.driver_id
     join public.orders o on o.id=a.order_id and o.region_id=a.region_id
     cross join lateral jsonb_array_elements(c.expenses) e(item)
     where target_bucket='driver-finance-receipts' and c.status='approved' and c.category in ('company','trip')
       and e.item->'receipts' ? target_path
     union all
     select a.region_id from public.driver_daily_fuel f
     join public.driver_assignments a on a.id=f.assignment_id and a.region_id=f.region_id and a.driver_id=f.driver_id
     join public.orders o on o.id=a.order_id and o.region_id=a.region_id
     where target_bucket='driver-fuel-receipts' and f.status='approved' and f.receipts ? target_path
   ) allowed where public.is_admin()
     or allowed.region_id=(select p.region_id from public.profiles p where p.id=auth.uid()));
$$;
create policy staff_approved_order_receipt_select on storage.objects for select to authenticated
 using(bucket_id in ('driver-finance-receipts','driver-fuel-receipts')
   and public.can_read_approved_order_receipt(bucket_id,name));
revoke all on function public.staff_order_receipts(uuid,date),
 public.can_read_approved_order_receipt(text,text) from public,anon;
grant execute on function public.staff_order_receipts(uuid,date),
 public.can_read_approved_order_receipt(text,text) to authenticated;
commit;
