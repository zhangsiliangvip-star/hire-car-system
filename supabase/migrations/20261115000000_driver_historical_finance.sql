-- Historical claims use audited links and never create assignments.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

create table public.driver_historical_finance_links (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 service_date date not null,
 driver_id uuid not null,
 region_id uuid not null,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 foreign key(driver_id,region_id) references public.drivers(id,region_id) on delete restrict,
 unique(id,driver_id,region_id),
 unique(order_id,service_date,driver_id)
);
create index driver_historical_finance_driver_date_idx
 on public.driver_historical_finance_links(driver_id,region_id,service_date);
alter table public.driver_historical_finance_links enable row level security;
revoke all on public.driver_historical_finance_links from public,anon,authenticated;

alter table public.driver_finance_claims add column historical_link_id uuid;
alter table public.driver_finance_claims drop constraint driver_finance_claims_pkey;
alter table public.driver_finance_claims alter column assignment_id drop not null;
alter table public.driver_finance_claims add column claim_id uuid not null default gen_random_uuid();
alter table public.driver_finance_claims add constraint driver_finance_claims_pkey primary key(claim_id);
alter table public.driver_finance_claims add constraint driver_finance_claim_subject_check
 check ((assignment_id is not null) <> (historical_link_id is not null));
alter table public.driver_finance_claims add constraint driver_finance_claim_historical_link_fkey
 foreign key(historical_link_id,driver_id,region_id)
 references public.driver_historical_finance_links(id,driver_id,region_id) on delete restrict;
create unique index driver_finance_claim_assignment_category_key
 on public.driver_finance_claims(assignment_id,category) where assignment_id is not null;
create unique index driver_finance_claim_historical_category_key
 on public.driver_finance_claims(historical_link_id,category) where historical_link_id is not null;

alter table public.driver_finance_events alter column assignment_id drop not null;
alter table public.driver_finance_events add column historical_link_id uuid references
 public.driver_historical_finance_links(id) on delete restrict;
alter table public.driver_finance_events add constraint driver_finance_event_subject_check
 check ((assignment_id is not null) <> (historical_link_id is not null));

create or replace function public.record_driver_finance_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.driver_finance_events(assignment_id,historical_link_id,actor_id,snapshot)
 values(new.assignment_id,new.historical_link_id,auth.uid(),to_jsonb(new));
 return new;
end;
$$;

create or replace function public.driver_finance_claim_json(c public.driver_finance_claims)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('assignmentId',coalesce(c.assignment_id,c.historical_link_id),
 'historical',c.historical_link_id is not null,'category',c.category,'version',c.version,'status',c.status,
 'expenses',c.expenses,'overtimeHours',c.overtime_hours,'reviewNote',c.review_note,'submittedAt',c.submitted_at);
$$;
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef(
  'public.submit_driver_finance(uuid,text,bigint,uuid,jsonb,numeric)'::regprocedure);
 if position('on conflict(assignment_id,category) do update' in definition)=0 then
  raise exception 'Unexpected assignment finance upsert';
 end if;
 definition:=replace(definition,'on conflict(assignment_id,category) do update',
  'on conflict(assignment_id,category) where assignment_id is not null do update');
 execute definition;
end;
$patch$;

create function public.ensure_driver_historical_finance_links(target_month text) returns void
language plpgsql security definer set search_path='' as $$
declare identity record; first_day date; last_day date; actor uuid:=(select auth.uid());
begin
 select * into identity from public.driver_identity();
 if not found or actor is null then raise exception 'Driver required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Invalid month' using errcode='22023'; end if;
 if (select count(*) from public.drivers where region_id=identity.region_id and name=identity.driver_name)<>1 then
  raise exception 'Ambiguous driver name' using errcode='42501'; end if;
 first_day:=to_date(target_month||'-01','YYYY-MM-DD');
 last_day:=least((first_day+interval '1 month'-interval '1 day')::date,
  (now() at time zone 'Asia/Tokyo')::date-1);
 insert into public.driver_historical_finance_links(order_id,service_date,driver_id,region_id,created_by)
 select h.order_id,h.service_date,identity.driver_id,identity.region_id,actor
 from generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') as calendar_days(service_day)
 cross join lateral public.driver_historical_orders(calendar_days.service_day::date) h
 on conflict(order_id,service_date,driver_id) do nothing;
end;
$$;

create function public.driver_historical_finance_data(target_month text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity record; trips jsonb;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Invalid month' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('assignmentId',l.id,'historical',true,
  'date',l.service_date,'pickup',h.pickup,'destination',h.destination,
  'existingOvertimeHours',coalesce((o.finance_by_date->l.service_date::text->>'driverOvertimeHours')::numeric,0),
  'claims',coalesce((select jsonb_agg(public.driver_finance_claim_json(c) order by c.category)
    from public.driver_finance_claims c where c.historical_link_id=l.id
      and c.driver_id=identity.driver_id),'[]'::jsonb))
  order by l.service_date,o.time,l.order_id),'[]'::jsonb) into trips
 from public.driver_historical_finance_links l
 join public.orders o on o.id=l.order_id and o.region_id=l.region_id
 cross join lateral public.driver_historical_orders(l.service_date) h
 where h.order_id=l.order_id and h.service_date=l.service_date
  and l.driver_id=identity.driver_id and l.region_id=identity.region_id
  and to_char(l.service_date,'YYYY-MM')=target_month;
 return jsonb_build_object('trips',trips);
end;
$$;

create function public.submit_driver_historical_finance(target_link uuid,target_category text,
 expected_version bigint,target_request uuid,items jsonb,hours numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare identity record; l public.driver_historical_finance_links; o public.orders;
 c public.driver_finance_claims; e jsonb; receipt jsonb; p text; total numeric:=0; f jsonb;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 perform 1 from public.driver_auth_links where driver_id=identity.driver_id for share;
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 select ord.* into o from public.orders ord join public.driver_historical_finance_links x on x.order_id=ord.id
 where x.id=target_link and x.driver_id=identity.driver_id and x.region_id=identity.region_id for update of ord;
 select * into l from public.driver_historical_finance_links
  where id=target_link and driver_id=identity.driver_id and region_id=identity.region_id for update;
 if not found or o.id is null
 or not exists(select 1 from public.driver_historical_orders(l.service_date) h
  where h.order_id=l.order_id and h.service_date=l.service_date) then
  raise exception 'Eligible own historical order required' using errcode='42501'; end if;
 if target_category is null or target_category not in ('company','trip','overtime')
 or target_request is null or expected_version is null or expected_version<0
 or hours is null or hours::text in ('NaN','Infinity','-Infinity') or hours<0 or hours>999 or hours<>round(hours,2)
 or jsonb_typeof(items) is distinct from 'array' then raise exception 'Invalid submission' using errcode='22023'; end if;
 if jsonb_array_length(items)>50 or
 (target_category='overtime' and items<>'[]') or
 (target_category<>'overtime' and (hours<>0 or jsonb_array_length(items)=0)) then
  raise exception 'Invalid category payload' using errcode='22023'; end if;
 select * into c from public.driver_finance_claims
  where historical_link_id=l.id and category=target_category for update;
 for e in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(e) is distinct from 'object' then raise exception 'Invalid expense' using errcode='22023'; end if;
  if not(e ?& array['id','type','detail','amount','receipts'])
  or exists(select 1 from jsonb_object_keys(e) k where k<>all(array['id','type','detail','amount','receipts']))
  or jsonb_typeof(e->'type') is distinct from 'string' or e->>'type'<>target_category
  or jsonb_typeof(e->'detail') is distinct from 'string' or length(btrim(e->>'detail')) not between 1 and 200
  or jsonb_typeof(e->'amount') is distinct from 'number'
  or jsonb_typeof(e->'receipts') is distinct from 'array' or jsonb_typeof(e->'id') is distinct from 'string' then
   raise exception 'Invalid expense' using errcode='22023'; end if;
  perform (e->>'id')::uuid;
  if (e->>'amount')::numeric<=0 or (e->>'amount')::numeric<>trunc((e->>'amount')::numeric)
  or jsonb_array_length(e->'receipts')>5 then raise exception 'Invalid amount/receipts' using errcode='22023'; end if;
  total:=total+(e->>'amount')::numeric;
  for receipt in select value from jsonb_array_elements(e->'receipts') loop
   if jsonb_typeof(receipt) is distinct from 'string' then raise exception 'Invalid receipt' using errcode='22023'; end if;
   p:=receipt#>>'{}';
   if not exists(select 1 from storage.objects where bucket_id='driver-finance-receipts' and name=p)
   or not (p ~ ('^'||auth.uid()::text||'/'||l.id::text||'/'||target_category||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
    or (p ~ ('^'||auth.uid()::text||'/'||l.id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
     and exists(select 1 from jsonb_array_elements(c.expenses) old_expense where old_expense->'receipts' ? p))) then
    raise exception 'Receipt not available for category' using errcode='42501'; end if;
  end loop;
 end loop;
 if total>99999999999999 or
  (select count(distinct value->>'id') from jsonb_array_elements(items))<>jsonb_array_length(items) then
  raise exception 'Invalid expense totals' using errcode='22023'; end if;
 if c.claim_id is not null and c.request_id=target_request then
  if c.expenses<>items or c.overtime_hours<>hours then raise exception 'Request key payload changed' using errcode='40001'; end if;
  return public.driver_finance_claim_json(c);
 end if;
 if (c.claim_id is null and expected_version<>0) or
  (c.claim_id is not null and (c.version<>expected_version or c.status<>'rejected')) then
  raise exception 'Category already submitted or changed' using errcode='40001'; end if;
 f:=coalesce(o.finance_by_date->l.service_date::text,'{}');
 insert into public.driver_finance_claims
  (historical_link_id,driver_id,region_id,category,status,expenses,overtime_hours,baseline,request_id)
 values(l.id,l.driver_id,l.region_id,target_category,'pending',items,hours,
  public.driver_finance_category_baseline(f,target_category),target_request)
 on conflict(historical_link_id,category) where historical_link_id is not null do update
  set version=driver_finance_claims.version+1,status='pending',expenses=excluded.expenses,
   overtime_hours=excluded.overtime_hours,baseline=excluded.baseline,request_id=excluded.request_id,
   submitted_at=now(),review_note='',reviewed_at=null,reviewed_by=null returning * into c;
 return public.driver_finance_claim_json(c);
end;
$$;

create or replace function public.review_driver_finance(target_assignment uuid,target_category text,
 expected_version bigint,decision text,note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.driver_finance_claims; a public.driver_assignments;
 l public.driver_historical_finance_links; o public.orders; f jsonb;
 amount numeric; driver_name text; rate numeric; field text; historical boolean:=false;
begin
 if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if target_category is null or target_category not in ('company','trip','overtime') then
  raise exception 'Invalid category' using errcode='22023'; end if;
 select * into a from public.driver_assignments where id=target_assignment for update;
 if found then
  select ord.* into o from public.orders ord where ord.id=a.order_id for update;
  select * into c from public.driver_finance_claims
   where assignment_id=target_assignment and category=target_category for update;
 else
  historical:=true;
  select * into l from public.driver_historical_finance_links where id=target_assignment for update;
  if not found then raise exception 'Finance subject unavailable' using errcode='40001'; end if;
  select ord.* into o from public.orders ord where ord.id=l.order_id for update;
  select * into c from public.driver_finance_claims
   where historical_link_id=l.id and category=target_category for update;
 end if;
 if c.claim_id is null or c.version is distinct from expected_version or c.status<>'pending' then
  raise exception 'Pending category changed' using errcode='40001'; end if;
 if decision is null or decision not in ('approved','rejected') or note is null or length(note)>500
 or (decision='rejected' and length(btrim(note))=0) then raise exception 'Invalid review' using errcode='22023'; end if;
 if decision='approved' then
  if historical then
   if not exists(select 1 from public.driver_historical_orders(l.service_date) h
     where h.order_id=l.order_id and h.service_date=l.service_date)
   or o.status='キャンセル' then raise exception 'Historical order changed' using errcode='40001'; end if;
   f:=coalesce(o.finance_by_date->l.service_date::text,'{}');
  else
   if a.status<>'completed' or o.status='キャンセル' or a.service_date<o.date
   or a.service_date>o.end_date or a.service_date=any(o.off_dates) then
    raise exception 'Trip changed' using errcode='40001'; end if;
   f:=coalesce(o.finance_by_date->a.service_date::text,'{}');
  end if;
  select name into driver_name from public.drivers where id=c.driver_id and region_id=c.region_id;
  if public.driver_finance_category_baseline(f,target_category)<>c.baseline
  or coalesce(f->>'driver',o.driver) is distinct from driver_name
  or coalesce(f->>'driverPaymentType','')='company_advance' then
   raise exception 'Category finance/driver changed; reject for resubmission' using errcode='40001'; end if;
  if target_category='overtime' then
   rate:=coalesce((f->>'driverOvertimeRate')::numeric,0);
   if greatest(round(rate*c.overtime_hours),round(coalesce((f->>'overtimeRequestRate')::numeric,0)*c.overtime_hours))>99999999999999 then
    raise exception 'Finance limit exceeded' using errcode='22023'; end if;
   f:=f||jsonb_build_object('driverOvertimeHours',c.overtime_hours,
    'driverOvertimeFee',case when rate>0 then round(rate*c.overtime_hours) else coalesce((f->>'driverOvertimeFee')::numeric,0) end);
   if f ? 'overtimeRequestRate' then
    f:=f||jsonb_build_object('overtimeRequestAmount',round(c.overtime_hours*coalesce((f->>'overtimeRequestRate')::numeric,0)));
   end if;
  else
   field:=case when target_category='company' then 'driverAdvanceCompanyReport' else 'driverAdvanceTripReport' end;
   select coalesce(sum((value->>'amount')::numeric),0) into amount
    from jsonb_array_elements(c.expenses) where value->>'type'=target_category;
   amount:=amount+coalesce((f->>field)::numeric,0);
   if amount>99999999999999 then raise exception 'Finance limit exceeded' using errcode='22023'; end if;
   f:=f||jsonb_build_object(field,amount);
  end if;
  update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),
   array[case when historical then l.service_date::text else a.service_date::text end],f,true)
   where id=o.id;
 end if;
 update public.driver_finance_claims set status=decision,version=version+1,review_note=btrim(note),
  reviewed_at=now(),reviewed_by=auth.uid() where claim_id=c.claim_id returning * into c;
 return public.driver_finance_claim_json(c);
end;
$$;

create or replace function public.admin_driver_finance(target_month text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Invalid month' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(x.payload order by x.submitted_at) from (
  select c.submitted_at,jsonb_build_object('driverName',d.name,'date',a.service_date,
   'pickup',o.pickup,'destination',o.destination,'claim',public.driver_finance_claim_json(c)) payload
  from public.driver_finance_claims c join public.driver_assignments a on a.id=c.assignment_id
  join public.orders o on o.id=a.order_id join public.drivers d on d.id=c.driver_id
  where to_char(a.service_date,'YYYY-MM')=target_month
  union all
  select c.submitted_at,jsonb_build_object('driverName',d.name,'date',l.service_date,
   'pickup',o.pickup,'destination',o.destination,'claim',public.driver_finance_claim_json(c)) payload
  from public.driver_finance_claims c
  join public.driver_historical_finance_links l on l.id=c.historical_link_id
   and l.driver_id=c.driver_id and l.region_id=c.region_id
  join public.orders o on o.id=l.order_id and o.region_id=l.region_id
  join public.drivers d on d.id=l.driver_id and d.region_id=l.region_id
  where to_char(l.service_date,'YYYY-MM')=target_month
 ) x),'[]'::jsonb);
end;
$$;

create or replace function public.can_access_driver_receipt(path text,writing boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare owner_id text; subject_id text;
begin
 if path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(?:(?:company|trip)/)?[0-9a-f-]{36}\.(jpg|png|webp)$'
  and path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/overtime/[0-9a-f-]{36}\.(jpg|png|webp)$' then return false; end if;
 if not writing and public.is_admin() then return true; end if;
 owner_id:=split_part(path,'/',1); subject_id:=split_part(path,'/',2);
 if owner_id<>auth.uid()::text then return false; end if;
 return exists(select 1 from public.driver_identity() identity
  join public.driver_assignments a on a.id::text=subject_id
   and a.driver_id=identity.driver_id and a.region_id=identity.region_id
  where a.status<>'revoked'
   and (not writing or not exists(select 1 from public.driver_finance_claims c
    where c.assignment_id=a.id and c.status<>'rejected')))
 or exists(select 1 from public.driver_identity() identity
  join public.driver_historical_finance_links l on l.id::text=subject_id
   and l.driver_id=identity.driver_id and l.region_id=identity.region_id
  where exists(select 1 from public.driver_historical_orders(l.service_date) h
    where h.order_id=l.order_id and h.service_date=l.service_date)
   and (not writing or not exists(select 1 from public.driver_finance_claims c
    where c.historical_link_id=l.id and c.status<>'rejected')));
end;
$$;

create or replace function public.staff_order_receipts(target_order uuid,target_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_staff() or not exists(select 1 from public.orders o where o.id=target_order
   and (public.is_admin() or o.region_id=(select p.region_id from public.profiles p where p.id=auth.uid()))) then
  raise exception 'Staff order access required' using errcode='42501'; end if;
 if target_date is null then raise exception 'Service date required' using errcode='22023'; end if;
 select coalesce(jsonb_agg(x.receipt order by x.category,x.path),'[]'::jsonb) into result from (
  select c.category,p.path,jsonb_build_object('bucket','driver-finance-receipts','path',p.path,
   'category',c.category,'detail',e.item->>'detail') receipt
  from public.driver_finance_claims c
  join public.driver_assignments a on a.id=c.assignment_id and a.region_id=c.region_id and a.driver_id=c.driver_id
  cross join lateral jsonb_array_elements(c.expenses) e(item)
  cross join lateral jsonb_array_elements_text(e.item->'receipts') p(path)
  where a.order_id=target_order and a.service_date=target_date and c.status='approved' and c.category in ('company','trip')
  union all
  select c.category,p.path,jsonb_build_object('bucket','driver-finance-receipts','path',p.path,
   'category',c.category,'detail',e.item->>'detail') receipt
  from public.driver_finance_claims c
  join public.driver_historical_finance_links l on l.id=c.historical_link_id
   and l.region_id=c.region_id and l.driver_id=c.driver_id
  cross join lateral jsonb_array_elements(c.expenses) e(item)
  cross join lateral jsonb_array_elements_text(e.item->'receipts') p(path)
  where l.order_id=target_order and l.service_date=target_date and c.status='approved' and c.category in ('company','trip')
  union all
  select 'fuel',p.path,jsonb_build_object('bucket','driver-fuel-receipts','path',p.path,'category','fuel','detail','燃油费')
  from public.driver_daily_fuel f
  join public.driver_assignments a on a.id=f.assignment_id and a.region_id=f.region_id and a.driver_id=f.driver_id
  cross join lateral jsonb_array_elements_text(f.receipts) p(path)
  where a.order_id=target_order and a.service_date=target_date and f.service_date=target_date and f.status='approved'
 ) x;
 return result;
end;
$$;

create or replace function public.can_read_approved_order_receipt(target_bucket text,target_path text) returns boolean
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
   select l.region_id from public.driver_finance_claims c
   join public.driver_historical_finance_links l on l.id=c.historical_link_id
    and l.region_id=c.region_id and l.driver_id=c.driver_id
   join public.orders o on o.id=l.order_id and o.region_id=l.region_id
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

revoke all on function public.ensure_driver_historical_finance_links(text),
 public.driver_historical_finance_data(text),public.submit_driver_historical_finance(uuid,text,bigint,uuid,jsonb,numeric)
 from public,anon;
grant execute on function public.ensure_driver_historical_finance_links(text),
 public.driver_historical_finance_data(text),public.submit_driver_historical_finance(uuid,text,bigint,uuid,jsonb,numeric)
 to authenticated;
revoke all on function public.record_driver_finance_event(),
 public.driver_finance_claim_json(public.driver_finance_claims),
 public.review_driver_finance(uuid,text,bigint,text,text),public.admin_driver_finance(text),
 public.can_access_driver_receipt(text,boolean),public.staff_order_receipts(uuid,date),
 public.can_read_approved_order_receipt(text,text) from public,anon;
grant execute on function public.review_driver_finance(uuid,text,bigint,text,text),
 public.admin_driver_finance(text),public.can_access_driver_receipt(text,boolean),
 public.staff_order_receipts(uuid,date),public.can_read_approved_order_receipt(text,text)
 to authenticated;
commit;
