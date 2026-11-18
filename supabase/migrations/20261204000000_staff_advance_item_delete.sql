begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.staff_delete_advance_item(target_order uuid,target_date date,target_claim uuid,
 expected_version bigint,target_expense uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.driver_finance_claims; a public.driver_assignments; l public.driver_historical_finance_links;
 o public.orders; f jsonb; remaining jsonb; item jsonb; field text; amount numeric; total numeric; booked numeric;
begin
 if not public.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
 if target_expense is null or target_date is null or expected_version is null or expected_version<1 then
  raise exception 'Invalid deletion' using errcode='22023'; end if;
 select * into c from public.driver_finance_claims where claim_id=target_claim;
 if not found then raise exception 'Claim unavailable' using errcode='40001'; end if;
 if c.assignment_id is not null then
  select * into a from public.driver_assignments where id=c.assignment_id for update;
 else
  select * into l from public.driver_historical_finance_links where id=c.historical_link_id for update;
 end if;
 if coalesce(a.order_id,l.order_id) is distinct from target_order
  or coalesce(a.service_date,l.service_date) is distinct from target_date
  or coalesce(a.driver_id,l.driver_id) is distinct from c.driver_id
  or coalesce(a.region_id,l.region_id) is distinct from c.region_id then
  raise exception 'Claim subject changed' using errcode='40001'; end if;
 if not exists(select 1 from public.orders where id=target_order and region_id=c.region_id
  and (public.is_admin() or region_id=(select p.region_id from public.profiles p where p.id=auth.uid()))) then
  raise exception 'Staff order access required' using errcode='42501'; end if;
 select * into c from public.driver_finance_claims where claim_id=target_claim for update;
 if c.version<>expected_version or c.status<>'approved' or c.category not in ('company','trip') then
  raise exception 'Claim changed; refresh' using errcode='40001'; end if;
 if (select count(*) from jsonb_array_elements(c.expenses) e where e->>'id'=target_expense::text)<>1 then
  raise exception 'Expense changed; refresh' using errcode='40001'; end if;
 select e into item from jsonb_array_elements(c.expenses) e where e->>'id'=target_expense::text;
 select coalesce(jsonb_agg(e order by n),'[]'),coalesce(sum((e->>'amount')::numeric),0)
  into remaining,total from jsonb_array_elements(c.expenses) with ordinality x(e,n)
  where e->>'id'<>target_expense::text;
 amount:=(item->>'amount')::numeric;
 select * into o from public.orders where id=target_order for update;
 if o.region_id is distinct from c.region_id or o.status='キャンセル'
  or target_date<o.date or target_date>o.end_date or target_date=any(o.off_dates) then
  raise exception 'Order eligibility changed' using errcode='40001'; end if;
 f:=coalesce(o.finance_by_date->target_date::text,'{}');
 if coalesce(f->>'driver',o.driver) is distinct from
  (select name from public.drivers where id=c.driver_id and region_id=c.region_id)
  or coalesce(f->>'driverPaymentType','')='company_advance' then
  raise exception 'Order driver changed' using errcode='40001'; end if;
 field:=case c.category when 'company' then 'driverAdvanceCompanyReport' else 'driverAdvanceTripReport' end;
 booked:=coalesce((f->>field)::numeric,0);
 if booked<total+amount then raise exception 'Booked advance changed' using errcode='40001'; end if;
 f:=f||jsonb_build_object(field,booked-amount);
 update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),array[target_date::text],f,true)
  where id=target_order;
 update public.driver_finance_claims set expenses=remaining,version=version+1,request_id=gen_random_uuid(),
  baseline=public.driver_finance_category_baseline(f,category),reviewed_at=now(),reviewed_by=auth.uid(),
  review_note='后台削除明细并扣回立替：'||(item->>'detail') where claim_id=c.claim_id;
 return jsonb_build_object('deleted',true);
end;
$$;
revoke all on function public.staff_delete_advance_item(uuid,date,uuid,bigint,uuid) from public,anon;
grant execute on function public.staff_delete_advance_item(uuid,date,uuid,bigint,uuid) to authenticated;
commit;
