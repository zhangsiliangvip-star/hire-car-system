begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.driver_daily_fuel drop constraint driver_daily_fuel_amount_check;
alter table public.driver_daily_fuel add constraint driver_daily_fuel_amount_check
 check(amount between 0 and 99999999999999);

create function public.apply_driver_finance_revision(target_claim uuid, previous public.driver_finance_claims)
returns public.driver_finance_claims
language plpgsql security definer set search_path='' as $$
declare c public.driver_finance_claims; o public.orders; a public.driver_assignments;
 l public.driver_historical_finance_links; day date; f jsonb; field text; amount numeric;
 old_amount numeric:=0; current_amount numeric; driver_name text; rate numeric;
begin
 select * into c from public.driver_finance_claims where claim_id=target_claim for update;
 if not found or c.status<>'pending' then
  raise exception 'Pending revision required' using errcode='40001'; end if;
 if c.category='overtime' and previous.status is distinct from 'approved' then return c; end if;
 if c.assignment_id is not null then
  select * into a from public.driver_assignments where id=c.assignment_id for update;
  select * into o from public.orders where id=a.order_id for update;
  day:=a.service_date;
  if a.id is null or o.id is null or a.status='revoked' or a.driver_id<>c.driver_id
   or a.region_id<>c.region_id or o.region_id<>c.region_id or o.status='キャンセル'
   or day>(now() at time zone 'Asia/Tokyo')::date or day<o.date or day>o.end_date
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
 if c.category='overtime' then
  if coalesce((f->>'driverOvertimeHours')::numeric,0)<>previous.overtime_hours then
   raise exception 'Booked overtime changed; contact staff' using errcode='40001'; end if;
  rate:=coalesce((f->>'driverOvertimeRate')::numeric,0);
  if greatest(round(rate*c.overtime_hours),round(coalesce((f->>'overtimeRequestRate')::numeric,0)*c.overtime_hours))>99999999999999 then
   raise exception 'Finance limit exceeded' using errcode='22023'; end if;
  f:=f||jsonb_build_object('driverOvertimeHours',c.overtime_hours,
   'driverOvertimeFee',case when rate>0 then round(rate*c.overtime_hours)
    else coalesce((f->>'driverOvertimeFee')::numeric,0) end);
  if f ? 'overtimeRequestRate' then
   f:=f||jsonb_build_object('overtimeRequestAmount',round(c.overtime_hours*coalesce((f->>'overtimeRequestRate')::numeric,0)));
  end if;
 elsif c.category in ('company','trip') then
  field:=case when c.category='company' then 'driverAdvanceCompanyReport' else 'driverAdvanceTripReport' end;
  select coalesce(sum((value->>'amount')::numeric),0) into amount
   from jsonb_array_elements(c.expenses) where value->>'type'=c.category;
  if previous.status='approved' then
   select coalesce(sum((value->>'amount')::numeric),0) into old_amount
    from jsonb_array_elements(previous.expenses) where value->>'type'=c.category;
  end if;
  current_amount:=coalesce((f->>field)::numeric,0);
  if current_amount<old_amount then
   raise exception 'Booked advance changed; contact staff' using errcode='40001'; end if;
  amount:=current_amount-old_amount+amount;
  if amount>99999999999999 then raise exception 'Finance limit exceeded' using errcode='22023'; end if;
  f:=f||jsonb_build_object(field,amount);
 else raise exception 'Invalid category' using errcode='22023';
 end if;
 update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),array[day::text],f,true)
  where id=o.id;
 update public.driver_finance_claims set status='approved',version=version+1,
  review_note=case when previous.status='approved' then '修改后按差额更新入账' else '提交后自动入账' end,
  reviewed_at=now(),reviewed_by=null where claim_id=c.claim_id returning * into c;
 return c;
end;
$$;

create function public.apply_driver_fuel_revision(target_claim uuid, previous public.driver_daily_fuel)
returns public.driver_daily_fuel
language plpgsql security definer set search_path='' as $$
declare c public.driver_daily_fuel; a public.driver_assignments; old_assignment public.driver_assignments;
 o public.orders; old_order public.orders; f jsonb; old_f jsonb; amount numeric; old_amount numeric:=0;
begin
 select * into c from public.driver_daily_fuel where id=target_claim for update;
 if not found or c.status<>'pending' then raise exception 'Pending fuel revision required' using errcode='40001'; end if;
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
 if previous.status='approved' then
  old_amount:=previous.amount;
  select * into old_assignment from public.driver_assignments where id=previous.assignment_id for share;
  select * into old_order from public.orders where id=old_assignment.order_id for update;
  if old_assignment.id is null or old_order.id is null or old_order.region_id<>c.region_id
   or old_assignment.driver_id<>c.driver_id or old_assignment.service_date<>c.service_date then
   raise exception 'Original fuel order changed; contact staff' using errcode='40001'; end if;
  old_f:=coalesce(old_order.finance_by_date->c.service_date::text,'{}');
  if coalesce((old_f->>'fuelCost')::numeric,0)<old_amount then
   raise exception 'Booked fuel changed; contact staff' using errcode='40001'; end if;
  if old_order.id<>o.id then
   old_f:=old_f||jsonb_build_object('fuelCost',coalesce((old_f->>'fuelCost')::numeric,0)-old_amount);
   update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),array[c.service_date::text],old_f,true)
    where id=old_order.id;
   old_amount:=0;
  end if;
 end if;
 amount:=coalesce((f->>'fuelCost')::numeric,0)-old_amount+c.amount;
 if amount>99999999999999 then raise exception 'Fuel cost limit exceeded' using errcode='22023'; end if;
 f:=f||jsonb_build_object('fuelCost',amount);
 update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),array[c.service_date::text],f,true)
  where id=o.id;
 update public.driver_daily_fuel set status='approved',version=version+1,
  review_note=case when previous.status='approved' then '修改后按差额更新入账' else '提交后自动入账' end,
  reviewed_at=now(),reviewed_by=null where id=c.id returning * into c;
 return c;
end;
$$;

revoke all on function public.apply_driver_finance_revision(uuid,public.driver_finance_claims),
 public.apply_driver_fuel_revision(uuid,public.driver_daily_fuel) from public,anon,authenticated;

do $patch$
declare definition text; signature text; original text;
begin
 foreach signature in array array[
  'public.submit_driver_finance(uuid,text,bigint,uuid,jsonb,numeric)',
  'public.submit_driver_historical_finance(uuid,text,bigint,uuid,jsonb,numeric)'
 ] loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
  if position('c:=public.post_driver_advance_claim(c.claim_id);' in definition)=0
   or position('c.status<>''rejected''' in definition)=0 then
   raise exception 'Unexpected advance revision baseline: %',signature; end if;
  definition:=replace(definition,'c public.driver_finance_claims;','c public.driver_finance_claims; previous public.driver_finance_claims;');
  definition:=replace(definition,' or c.status<>''rejected''','');
  definition:=replace(definition,'jsonb_array_length(items)=0','(jsonb_array_length(items)=0 and expected_version=0)');
  definition:=replace(definition,' insert into public.driver_finance_claims',
   E' previous:=c;\n insert into public.driver_finance_claims');
  definition:=replace(definition,
   E' if target_category in (''company'',''trip'') then\n  c:=public.post_driver_advance_claim(c.claim_id);\n end if;',
   ' c:=public.apply_driver_finance_revision(c.claim_id,previous);');
  if signature='public.submit_driver_finance(uuid,text,bigint,uuid,jsonb,numeric)' then
   definition:=replace(definition,E'begin\n select ord.* into o',
    E'begin\n perform 1 from public.driver_auth_links where driver_id=(select i.driver_id from public.driver_identity() i) for share;\n select ord.* into o');
  end if;
  if position('previous:=c;' in definition)=0
   or position('apply_driver_finance_revision(c.claim_id,previous)' in definition)=0 then
   raise exception 'Could not enable advance revisions'; end if;
  execute definition;
 end loop;

 signature:='public.submit_driver_daily_fuel(date,uuid,bigint,uuid,bigint,jsonb)';
 definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 if position('f:=public.post_driver_fuel_claim(f.id);' in definition)=0
  or position('f.status<>''rejected''' in definition)=0 then
  raise exception 'Unexpected fuel revision baseline'; end if;
 definition:=replace(definition,'f public.driver_daily_fuel;','f public.driver_daily_fuel; previous public.driver_daily_fuel;');
 definition:=replace(definition,' or f.status<>''rejected''','');
 definition:=replace(definition,'amount not between 1 and 99999999999999',
  '(amount not between 0 and 99999999999999 or (amount=0 and expected_version=0))');
 definition:=replace(definition,' insert into public.driver_daily_fuel',
  E' previous:=f;\n insert into public.driver_daily_fuel');
 definition:=replace(definition,'f:=public.post_driver_fuel_claim(f.id);',
  'f:=public.apply_driver_fuel_revision(f.id,previous);');
 -- Serialize all same-driver daily fuel changes before locking either linked order.
 definition:=replace(definition,E'begin\n select ord.* into o',
  E'begin\n perform 1 from public.driver_auth_links where driver_id=(select i.driver_id from public.driver_identity() i) for update;\n select ord.* into o');
 if position('previous:=f;' in definition)=0
  or position('f:=public.apply_driver_fuel_revision(f.id,previous);' in definition)=0 then
  raise exception 'Could not enable fuel revisions'; end if;
 execute definition;

 signature:='public.can_access_driver_receipt(text,boolean)';
 definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 original:=definition;
 definition:=regexp_replace(definition,
  'and \(not writing or not exists\(select 1 from public\.driver_finance_claims c\s+where c\.(assignment_id|historical_link_id)=[al]\.id and c\.status<>''rejected''\)\)',
  '', 'g');
 if definition=original or position('c.status<>''rejected''' in definition)>0 then
  raise exception 'Unexpected finance receipt revision baseline'; end if;
 execute definition;

 signature:='public.can_access_driver_fuel_receipt(text,boolean)';
 definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 original:=definition;
 definition:=replace(definition,
  E' and not exists(\n  select 1 from public.driver_daily_fuel f where f.driver_id=identity.driver_id and f.service_date=day and f.status<>''rejected'')','');
 if definition=original then raise exception 'Unexpected fuel receipt revision baseline'; end if;
 execute definition;
end;
$patch$;

commit;
