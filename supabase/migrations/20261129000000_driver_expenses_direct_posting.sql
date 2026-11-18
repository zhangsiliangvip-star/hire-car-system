begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.post_driver_advance_claim(target_claim uuid)
returns public.driver_finance_claims
language plpgsql security definer set search_path='' as $$
declare c public.driver_finance_claims; o public.orders; a public.driver_assignments;
 l public.driver_historical_finance_links; day date; f jsonb; field text; amount numeric; driver_name text;
begin
 select * into c from public.driver_finance_claims where claim_id=target_claim for update;
 if not found or c.status<>'pending' or c.category not in ('company','trip') then
  raise exception 'Pending advance claim required' using errcode='40001'; end if;
 if c.assignment_id is not null then
  select * into a from public.driver_assignments where id=c.assignment_id for update;
  select * into o from public.orders where id=a.order_id for update;
  day:=a.service_date;
  if a.id is null or o.id is null or a.status='revoked' or a.driver_id<>c.driver_id
   or a.region_id<>c.region_id or o.region_id<>c.region_id or o.status='キャンセル'
   or day> (now() at time zone 'Asia/Tokyo')::date or day<o.date or day>o.end_date
   or day=any(o.off_dates) then
   raise exception 'Active own trip required' using errcode='42501'; end if;
 else
  select * into l from public.driver_historical_finance_links where id=c.historical_link_id for update;
  select * into o from public.orders where id=l.order_id for update;
  day:=l.service_date;
  if l.id is null or o.id is null or l.driver_id<>c.driver_id or l.region_id<>c.region_id
   or o.region_id<>c.region_id or o.status='キャンセル'
   or not exists(select 1 from public.driver_historical_orders(day) h
    where h.order_id=l.order_id and h.service_date=day) then
   raise exception 'Eligible own historical order required' using errcode='42501'; end if;
 end if;
 f:=coalesce(o.finance_by_date->day::text,'{}');
 select name into driver_name from public.drivers where id=c.driver_id and region_id=c.region_id;
 if driver_name is null or coalesce(f->>'driver',o.driver) is distinct from driver_name
  or coalesce(f->>'driverPaymentType','')='company_advance'
  or public.driver_finance_category_baseline(f,c.category)<>c.baseline then
  raise exception 'Order finance or driver changed' using errcode='40001'; end if;
 field:=case when c.category='company' then 'driverAdvanceCompanyReport' else 'driverAdvanceTripReport' end;
 select coalesce(sum((value->>'amount')::numeric),0) into amount
  from jsonb_array_elements(c.expenses) where value->>'type'=c.category;
 amount:=coalesce((f->>field)::numeric,0)+amount;
 if amount>99999999999999 then raise exception 'Finance limit exceeded' using errcode='22023'; end if;
 f:=f||jsonb_build_object(field,amount);
 update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),array[day::text],f,true)
  where id=o.id;
 update public.driver_finance_claims set status='approved',version=version+1,
  review_note='提交后自动入账',reviewed_at=now(),reviewed_by=null
  where claim_id=c.claim_id returning * into c;
 return c;
end;
$$;

create function public.post_driver_fuel_claim(target_claim uuid)
returns public.driver_daily_fuel
language plpgsql security definer set search_path='' as $$
declare c public.driver_daily_fuel; a public.driver_assignments; o public.orders; f jsonb; amount numeric;
begin
 select * into c from public.driver_daily_fuel where id=target_claim for update;
 if not found or c.status<>'pending' then
  raise exception 'Pending fuel claim required' using errcode='40001'; end if;
 select * into a from public.driver_assignments where id=c.assignment_id for share;
 select * into o from public.orders where id=a.order_id for update;
 if a.id is null or o.id is null or a.driver_id<>c.driver_id or a.region_id<>c.region_id
  or o.region_id<>c.region_id or a.service_date<>c.service_date or a.status='revoked'
  or o.status='キャンセル' or c.service_date>(now() at time zone 'Asia/Tokyo')::date
  or c.service_date<o.date or c.service_date>o.end_date or c.service_date=any(o.off_dates) then
  raise exception 'Active own fuel day required' using errcode='42501'; end if;
 f:=coalesce(o.finance_by_date->c.service_date::text,'{}');
 if jsonb_build_object('fuelCost',f->'fuelCost')<>c.baseline then
  raise exception 'Order fuel cost changed' using errcode='40001'; end if;
 amount:=coalesce((f->>'fuelCost')::numeric,0)+c.amount;
 if amount>99999999999999 then raise exception 'Fuel cost limit exceeded' using errcode='22023'; end if;
 f:=f||jsonb_build_object('fuelCost',amount);
 update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),array[c.service_date::text],f,true)
  where id=o.id;
 update public.driver_daily_fuel set status='approved',version=version+1,
  review_note='提交后自动入账',reviewed_at=now(),reviewed_by=null
  where id=c.id returning * into c;
 return c;
end;
$$;

revoke all on function public.post_driver_advance_claim(uuid),public.post_driver_fuel_claim(uuid)
 from public,anon,authenticated;

do $patch$
declare definition text; signature text; ending text;
begin
 foreach signature in array array[
  'public.submit_driver_finance(uuid,text,bigint,uuid,jsonb,numeric)',
  'public.submit_driver_historical_finance(uuid,text,bigint,uuid,jsonb,numeric)'
 ] loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
  ending:=E' return public.driver_finance_claim_json(c);\nend;';
  if position(ending in definition)=0
   or position('post_driver_advance_claim' in definition)>0 then
   raise exception 'Unexpected advance submission definition: %',signature; end if;
  definition:=replace(definition,ending,
   E' if target_category in (''company'',''trip'') then\n  c:=public.post_driver_advance_claim(c.claim_id);\n end if;\n'||ending);
  definition:=replace(definition,'for share of ord','for update of ord');
  execute definition;
 end loop;
 signature:='public.submit_driver_daily_fuel(date,uuid,bigint,uuid,bigint,jsonb)';
 definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 ending:=E' return public.driver_daily_fuel_json(f);\nend;';
 if position(ending in definition)=0 or position('post_driver_fuel_claim' in definition)>0 then
  raise exception 'Unexpected fuel submission definition'; end if;
 definition:=replace(definition,ending,E' f:=public.post_driver_fuel_claim(f.id);\n'||ending);
 definition:=replace(definition,'for share of ord','for update of ord');
 execute definition;
end;
$patch$;

commit;
