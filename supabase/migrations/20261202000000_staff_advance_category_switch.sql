begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.staff_order_advances(target_order uuid,target_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_staff() or not exists(select 1 from public.orders o where o.id=target_order
  and (public.is_admin() or o.region_id=(select p.region_id from public.profiles p where p.id=auth.uid()))) then
  raise exception 'Staff order access required' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('claimId',c.claim_id,'category',c.category,
  'version',c.version,'amount',(select coalesce(sum((e->>'amount')::numeric),0)
   from jsonb_array_elements(c.expenses) e),'detail',(select string_agg(e->>'detail',' / ')
   from jsonb_array_elements(c.expenses) e)) order by c.category,c.claim_id),'[]')
  from public.driver_finance_claims c
  left join public.driver_assignments a on a.id=c.assignment_id
  left join public.driver_historical_finance_links l on l.id=c.historical_link_id
  where coalesce(a.order_id,l.order_id)=target_order and coalesce(a.service_date,l.service_date)=target_date
   and c.region_id=coalesce(a.region_id,l.region_id) and c.driver_id=coalesce(a.driver_id,l.driver_id)
   and c.status='approved' and c.category in ('company','trip') and jsonb_array_length(c.expenses)>0);
end;
$$;

create function public.staff_switch_advance_category(target_order uuid,target_date date,target_claim uuid,
 expected_version bigint,target_category text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.driver_finance_claims; dest public.driver_finance_claims; o public.orders;
 a public.driver_assignments; l public.driver_historical_finance_links; f jsonb; moved jsonb;
 amount numeric; source_field text; dest_field text; source_amount numeric; dest_amount numeric;
begin
 if target_category is null or target_category not in ('company','trip') or expected_version is null
  or expected_version<1 or target_date is null then
  raise exception 'Invalid switch' using errcode='22023'; end if;
 if not public.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
 -- Match submission lock order: subject, claims, then order.
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
 perform 1 from public.driver_finance_claims where
  (assignment_id=c.assignment_id or historical_link_id=c.historical_link_id)
  and category in ('company','trip') order by claim_id for update;
 select * into c from public.driver_finance_claims where claim_id=target_claim;
 if c.version<>expected_version or c.status<>'approved' or c.category not in ('company','trip')
  or c.category=target_category or jsonb_array_length(c.expenses)=0 then
  raise exception 'Claim changed; refresh' using errcode='40001'; end if;
 select * into dest from public.driver_finance_claims
  where (assignment_id=c.assignment_id or historical_link_id=c.historical_link_id) and category=target_category;
 if dest.claim_id is not null and dest.status<>'approved' then
  raise exception 'Target claim needs review first' using errcode='40001'; end if;
 if dest.claim_id is not null and exists(select 1 from jsonb_array_elements(c.expenses) x,
  jsonb_array_elements(dest.expenses) y where x->>'id'=y->>'id') then
  raise exception 'Duplicate expense IDs' using errcode='40001'; end if;
 if jsonb_array_length(c.expenses)+coalesce(jsonb_array_length(dest.expenses),0)>50 then
  raise exception 'Too many expenses' using errcode='22023'; end if;
 select * into o from public.orders where id=target_order for update;
 if o.region_id is distinct from c.region_id or o.status='キャンセル'
  or target_date<o.date or target_date>o.end_date or target_date=any(o.off_dates) then
  raise exception 'Order eligibility changed' using errcode='40001'; end if;
 f:=coalesce(o.finance_by_date->target_date::text,'{}');
 if coalesce(f->>'driver',o.driver) is distinct from
  (select name from public.drivers where id=c.driver_id and region_id=c.region_id)
  or coalesce(f->>'driverPaymentType','')='company_advance' then
  raise exception 'Order driver changed' using errcode='40001'; end if;
 source_field:=case c.category when 'company' then 'driverAdvanceCompanyReport' else 'driverAdvanceTripReport' end;
 dest_field:=case target_category when 'company' then 'driverAdvanceCompanyReport' else 'driverAdvanceTripReport' end;
 select coalesce(sum((e->>'amount')::numeric),0),jsonb_agg(e||jsonb_build_object('type',target_category))
  into amount,moved from jsonb_array_elements(c.expenses) e;
 source_amount:=coalesce((f->>source_field)::numeric,0);
 dest_amount:=coalesce((f->>dest_field)::numeric,0);
 if source_amount<amount then raise exception 'Booked advance changed' using errcode='40001'; end if;
 if dest.claim_id is not null and dest_amount<(select coalesce(sum((e->>'amount')::numeric),0)
  from jsonb_array_elements(dest.expenses) e) then
  raise exception 'Target booked advance changed' using errcode='40001'; end if;
 if dest_amount+amount>99999999999999 then raise exception 'Finance limit exceeded' using errcode='22023'; end if;
 f:=f||jsonb_build_object(source_field,source_amount-amount,dest_field,dest_amount+amount);
 update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),array[target_date::text],f,true)
  where id=target_order;
 update public.driver_finance_claims set expenses='[]',version=version+1,request_id=gen_random_uuid(),
  baseline=public.driver_finance_category_baseline(f,category),reviewed_at=now(),reviewed_by=auth.uid(),
  review_note='后台转移至'||target_category where claim_id=c.claim_id;
 if dest.claim_id is null then
  insert into public.driver_finance_claims(assignment_id,historical_link_id,driver_id,region_id,category,
   status,expenses,overtime_hours,baseline,request_id,review_note,reviewed_at,reviewed_by)
  values(c.assignment_id,c.historical_link_id,c.driver_id,c.region_id,target_category,'approved',moved,0,
   public.driver_finance_category_baseline(f,target_category),gen_random_uuid(),
   '后台从'||c.category||'转入',now(),auth.uid());
 else
  update public.driver_finance_claims set expenses=expenses||moved,version=version+1,request_id=gen_random_uuid(),
   baseline=public.driver_finance_category_baseline(f,category),reviewed_at=now(),reviewed_by=auth.uid(),
   review_note='后台从'||c.category||'转入' where claim_id=dest.claim_id;
 end if;
 return jsonb_build_object('switched',true);
end;
$$;
revoke all on function public.staff_order_advances(uuid,date) from public,anon;
revoke all on function public.staff_switch_advance_category(uuid,date,uuid,bigint,text) from public,anon;
grant execute on function public.staff_order_advances(uuid,date) to authenticated;
grant execute on function public.staff_switch_advance_category(uuid,date,uuid,bigint,text) to authenticated;
do $patch$
declare definition text; name text; subject text; needle text;
begin
 foreach name in array array['submit_driver_finance','submit_driver_historical_finance'] loop
  subject:=case name when 'submit_driver_finance' then 'a' else 'l' end;
  definition:=replace(pg_get_functiondef(
   ('public.'||name||'(uuid,text,bigint,uuid,jsonb,numeric)')::regprocedure),chr(13),'');
  needle:=subject||'.id::text||''/[0-9a-f-]{36}\.(jpg|png|webp)$''';
  if position(needle in definition)=0 then raise exception 'Unexpected receipt validator: %',name; end if;
  -- Existing same-claim references may retain their original category path after a staff transfer.
  definition:=replace(definition,needle,
   subject||'.id::text||''/(?:(?:company|trip)/)?[0-9a-f-]{36}\.(jpg|png|webp)$''');
  execute definition;
 end loop;
end;
$patch$;
commit;
