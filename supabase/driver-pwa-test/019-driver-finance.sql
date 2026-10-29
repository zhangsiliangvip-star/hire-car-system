-- ONLY isolated zsipqwipauzgbqvppwjf. No production migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Test project did not yet contain the existing reservation payroll adjustment table.
create table public.driver_wage_items (
 id uuid primary key default gen_random_uuid(), region_id uuid not null references public.regions(id),
 month text not null check(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 driver text not null check(length(driver) between 1 and 200),
 company_name text not null default '', name text not null check(length(name) between 1 and 200),
 amount bigint not null check(amount between -99999999999999 and 99999999999999), last_operation jsonb
);
alter table public.driver_wage_items enable row level security;
revoke all on public.driver_wage_items from public,anon,authenticated;
grant select,insert,update,delete on public.driver_wage_items to authenticated;
create policy driver_wage_staff_access on public.driver_wage_items for all to authenticated
 using(public.is_staff() and (public.is_admin() or region_id=(select p.region_id from public.profiles p where p.id=auth.uid())))
 with check(public.is_staff() and (public.is_admin() or region_id=(select p.region_id from public.profiles p where p.id=auth.uid())));
do $$ begin
 if to_regprocedure('public.record_business_audit()') is not null then
  execute 'create trigger business_operation_stamp before insert or update on public.driver_wage_items
   for each row execute function public.record_business_audit()';
  execute 'create trigger business_audit after insert or update or delete on public.driver_wage_items
   for each row execute function public.record_business_audit()';
 end if;
end; $$;
create table public.driver_finance_claims (
 assignment_id uuid primary key references public.driver_assignments(id),
 driver_id uuid not null references public.drivers(id),
 region_id uuid not null references public.regions(id),
 version bigint not null default 1,
 status text not null check(status in ('pending','approved','rejected')),
 expenses jsonb not null, overtime_hours numeric not null,
 baseline jsonb not null, request_id uuid not null,
 submitted_at timestamptz not null default now(), reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id), review_note text not null default ''
);
alter table public.driver_finance_claims enable row level security;
revoke all on public.driver_finance_claims from public,anon,authenticated;
create table public.driver_finance_events (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.driver_assignments(id),
 actor_id uuid references auth.users(id), occurred_at timestamptz not null default now(), snapshot jsonb not null
);
alter table public.driver_finance_events enable row level security;
revoke all on public.driver_finance_events from public,anon,authenticated;
create function public.record_driver_finance_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.driver_finance_events(assignment_id,actor_id,snapshot)
 values(new.assignment_id,auth.uid(),to_jsonb(new));
 return new;
end;
$$;
create trigger driver_finance_event after insert or update on public.driver_finance_claims
 for each row execute function public.record_driver_finance_event();
create function public.driver_finance_claim_json(c public.driver_finance_claims)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('assignmentId',c.assignment_id,'version',c.version,'status',c.status,
 'expenses',c.expenses,'overtimeHours',c.overtime_hours,'reviewNote',c.review_note,'submittedAt',c.submitted_at);
$$;
create function public.driver_finance_baseline(f jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('driver',f->'driver','driverPaymentType',f->'driverPaymentType',
 'driverAdvanceCompanyReport',f->'driverAdvanceCompanyReport','driverAdvanceTripReport',f->'driverAdvanceTripReport',
 'driverOvertimeHours',f->'driverOvertimeHours','driverOvertimeRate',f->'driverOvertimeRate',
 'driverOvertimeFee',f->'driverOvertimeFee','overtimeRequestAmount',f->'overtimeRequestAmount',
 'overtimeRequestRate',f->'overtimeRequestRate');
$$;
create function public.driver_finance_data(target_month text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity record; trips jsonb; wages jsonb; manual_items jsonb;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Invalid month' using errcode='22023'; end if;
 if (select count(*) from public.drivers where region_id=identity.region_id and name=identity.driver_name)<>1 then
  raise exception 'Ambiguous payroll driver name; contact admin' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('assignmentId',a.id,'date',a.service_date,
  'pickup',o.pickup,'destination',o.destination,
  'existingOvertimeHours',coalesce((o.finance_by_date->a.service_date::text->>'driverOvertimeHours')::numeric,0),
  'claim',case when c.assignment_id is null then null else public.driver_finance_claim_json(c) end)
  order by a.service_date,o.time,a.id),'[]') into trips
 from public.driver_assignments a join public.orders o on o.id=a.order_id and o.region_id=a.region_id
 left join public.driver_finance_claims c on c.assignment_id=a.id and c.driver_id=identity.driver_id
 where a.driver_id=identity.driver_id and a.region_id=identity.region_id and a.status='completed'
 and to_char(a.service_date,'YYYY-MM')=target_month and a.service_date <= (now() at time zone 'Asia/Tokyo')::date
 and o.status<>'キャンセル' and a.service_date between o.date and o.end_date and not(a.service_date=any(o.off_dates));
 -- Existing staff payroll keys by region + driver name; fail closed on duplicate names above.
 select coalesce(jsonb_agg(jsonb_build_object('date',a.service_date,
 'base',case when f->>'driverWageMode'='percentage' then greatest(0,round((
   coalesce((f->>'dailyFare')::numeric,0)+coalesce((f->>'etcTripReport')::numeric,0)+
   coalesce((f->>'driverAdvanceTripReport')::numeric,0)+coalesce((f->>'companyAdvanceTripReport')::numeric,0)+
   case when f ? 'overtimeRequestRate' then
    round(coalesce((f->>'driverOvertimeHours')::numeric,0)*coalesce((f->>'overtimeRequestRate')::numeric,0))
   else coalesce((f->>'overtimeRequestAmount')::numeric,
    case when coalesce((f->>'driverOvertimeRate')::numeric,0)>0 then
     round(coalesce((f->>'driverOvertimeHours')::numeric,0)*(f->>'driverOvertimeRate')::numeric)
    else coalesce((f->>'driverOvertimeFee')::numeric,0) end) end-
   coalesce((f->>'etcCompanyReport')::numeric,0)-coalesce((f->>'fuelCost')::numeric,0)-
   coalesce((f->>'companyAdvanceCompanyReport')::numeric,0)-coalesce((f->>'driverAdvanceCompanyReport')::numeric,0)-
   coalesce((f->>'driverAdvanceTripReport')::numeric,0))*coalesce((f->>'driverWagePercentage')::numeric,50)/100))
   else coalesce((f->>'driverWage')::numeric,0) end,
 'bonus',coalesce((f->>'driverBonusWage')::numeric,0),
 'overtime',case when coalesce((f->>'driverOvertimeRate')::numeric,0)>0
  then round(coalesce((f->>'driverOvertimeHours')::numeric,0)*(f->>'driverOvertimeRate')::numeric)
  else coalesce((f->>'driverOvertimeFee')::numeric,0) end,
 'advances',coalesce((f->>'driverAdvanceCompanyReport')::numeric,0)+coalesce((f->>'driverAdvanceTripReport')::numeric,0))
 order by a.service_date,a.id),'[]') into wages
 from public.orders o cross join lateral jsonb_each(coalesce(o.finance_by_date,'{}')) entry
 cross join lateral (select entry.key::date as service_date,o.id,entry.value as f) a
 where o.region_id=identity.region_id and to_char(a.service_date,'YYYY-MM')=target_month
 and f->>'driver'=identity.driver_name and coalesce(f->>'driverPaymentType','')<>'company_advance';
 select coalesce(jsonb_agg(jsonb_build_object('name',name,'amount',amount) order by name,id),'[]')
 into manual_items from public.driver_wage_items
 where region_id=identity.region_id and driver=identity.driver_name and month=target_month;
 return jsonb_build_object('trips',trips,'wages',wages,'manualItems',manual_items);
end;
$$;
create function public.submit_driver_finance(target_assignment uuid, expected_version bigint,
 target_request uuid, items jsonb, hours numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare identity record; a public.driver_assignments; o public.orders; c public.driver_finance_claims;
 e jsonb; p text; total numeric:=0; f jsonb;
begin
 -- Same order/link/assignment locking order as dispatch and report workflows.
 select ord.* into o from public.orders ord join public.driver_assignments x on x.order_id=ord.id
 where x.id=target_assignment for share of ord;
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 perform 1 from public.driver_auth_links where driver_id=identity.driver_id for share;
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 select * into a from public.driver_assignments where id=target_assignment
  and driver_id=identity.driver_id and region_id=identity.region_id for update;
 if not found or a.status<>'completed' or o.status='キャンセル'
 or a.service_date>(now() at time zone 'Asia/Tokyo')::date or a.service_date<o.date
 or a.service_date>o.end_date or a.service_date=any(o.off_dates) then
  raise exception 'Completed own trip required' using errcode='42501'; end if;
 if target_request is null or expected_version is null or expected_version<0
 or hours is null or hours<0 or hours>999 or hours<>round(hours,2)
 or jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>50 then
  raise exception 'Invalid submission' using errcode='22023'; end if;
 for e in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(e) is distinct from 'object' or not(e ?& array['id','type','detail','amount','receipts'])
  or exists(select 1 from jsonb_object_keys(e) k where k<>all(array['id','type','detail','amount','receipts']))
  or e->>'type' not in ('company','trip') or jsonb_typeof(e->'type') is distinct from 'string'
  or jsonb_typeof(e->'detail') is distinct from 'string' or length(btrim(e->>'detail')) not between 1 and 200
  or jsonb_typeof(e->'amount') is distinct from 'number'
  or jsonb_typeof(e->'receipts') is distinct from 'array' or jsonb_array_length(e->'receipts')>5
  or jsonb_typeof(e->'id') is distinct from 'string' then
   raise exception 'Invalid expense' using errcode='22023'; end if;
  perform (e->>'id')::uuid;
  if (e->>'amount')::numeric<=0 or (e->>'amount')::numeric<>trunc((e->>'amount')::numeric) then
   raise exception 'Invalid expense amount' using errcode='22023'; end if;
  total:=total+(e->>'amount')::numeric;
  for p in select jsonb_array_elements_text(e->'receipts') loop
   if p !~ ('^'||auth.uid()::text||'/'||a.id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
   or not exists(select 1 from storage.objects where bucket_id='driver-finance-receipts' and name=p) then
    raise exception 'Receipt not available' using errcode='42501'; end if;
  end loop;
 end loop;
 if total>99999999999999 or
 (select count(distinct value->>'id') from jsonb_array_elements(items))<>jsonb_array_length(items) then
  raise exception 'Invalid expense totals' using errcode='22023'; end if;
 select * into c from public.driver_finance_claims where assignment_id=a.id for update;
 if found and c.request_id=target_request then
  if c.expenses<>items or c.overtime_hours<>hours then
   raise exception 'Request key payload changed' using errcode='40001'; end if;
  return public.driver_finance_claim_json(c);
 end if;
 if (c.assignment_id is null and expected_version<>0) or
 (c.assignment_id is not null and (c.version<>expected_version or c.status<>'rejected')) then
  raise exception 'Claim already submitted or changed' using errcode='40001'; end if;
 f:=coalesce(o.finance_by_date->a.service_date::text,'{}');
 insert into public.driver_finance_claims(assignment_id,driver_id,region_id,status,expenses,overtime_hours,baseline,request_id)
 values(a.id,a.driver_id,a.region_id,'pending',items,hours,public.driver_finance_baseline(f),target_request)
 on conflict(assignment_id) do update set version=driver_finance_claims.version+1,status='pending',
 expenses=excluded.expenses,overtime_hours=excluded.overtime_hours,baseline=excluded.baseline,request_id=excluded.request_id,
 submitted_at=now(),review_note='',reviewed_at=null,reviewed_by=null returning * into c;
 return public.driver_finance_claim_json(c);
end;
$$;
create function public.review_driver_finance(target_assignment uuid, expected_version bigint, decision text, note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.driver_finance_claims; a public.driver_assignments; o public.orders;
 f jsonb; company_sum numeric; trip_sum numeric; driver_name text; rate numeric;
begin
 if not public.is_admin() then raise exception 'Staff admin required' using errcode='42501'; end if;
 select ord.* into o from public.orders ord join public.driver_assignments x on x.order_id=ord.id
 where x.id=target_assignment for update of ord;
 select * into a from public.driver_assignments where id=target_assignment for update;
 select * into c from public.driver_finance_claims where assignment_id=target_assignment for update;
 if not found or c.version is distinct from expected_version or c.status<>'pending' then
  raise exception 'Pending claim changed' using errcode='40001'; end if;
 if decision is null or decision not in ('approved','rejected') or note is null or length(note)>500
 or (decision='rejected' and length(btrim(note))=0) then
  raise exception 'Invalid review' using errcode='22023'; end if;
 if decision='approved' then
  if a.status<>'completed' or o.status='キャンセル' or a.service_date<o.date or a.service_date>o.end_date
  or a.service_date=any(o.off_dates) then raise exception 'Trip changed' using errcode='40001'; end if;
  f:=coalesce(o.finance_by_date->a.service_date::text,'{}');
  select name into driver_name from public.drivers where id=c.driver_id and region_id=c.region_id;
  if public.driver_finance_baseline(f)<>c.baseline or coalesce(f->>'driver',o.driver)<>driver_name
  or coalesce(f->>'driverPaymentType','')='company_advance' then
   raise exception 'Finance/driver changed; reject for resubmission' using errcode='40001'; end if;
  select coalesce(sum((value->>'amount')::numeric) filter(where value->>'type'='company'),0),
   coalesce(sum((value->>'amount')::numeric) filter(where value->>'type'='trip'),0)
  into company_sum,trip_sum from jsonb_array_elements(c.expenses);
  company_sum:=company_sum+coalesce((f->>'driverAdvanceCompanyReport')::numeric,0);
  trip_sum:=trip_sum+coalesce((f->>'driverAdvanceTripReport')::numeric,0);
  rate:=coalesce((f->>'driverOvertimeRate')::numeric,0);
  if greatest(company_sum,trip_sum,round(rate*c.overtime_hours),
   round(coalesce((f->>'overtimeRequestRate')::numeric,0)*c.overtime_hours))>99999999999999 then
   raise exception 'Finance limit exceeded' using errcode='22023'; end if;
  f:=f||jsonb_build_object('driver',driver_name,'driverAdvanceCompanyReport',company_sum,
   'driverAdvanceTripReport',trip_sum,'driverOvertimeHours',c.overtime_hours,
   'driverOvertimeFee',case when rate>0 then round(rate*c.overtime_hours) else coalesce((f->>'driverOvertimeFee')::numeric,0) end);
  if f ? 'overtimeRequestRate' then
   f:=f||jsonb_build_object('overtimeRequestAmount',round(c.overtime_hours*coalesce((f->>'overtimeRequestRate')::numeric,0)));
  end if;
  update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),array[a.service_date::text],f,true) where id=o.id;
 end if;
 update public.driver_finance_claims set status=decision,version=version+1,review_note=btrim(note),
 reviewed_at=now(),reviewed_by=auth.uid() where assignment_id=c.assignment_id returning * into c;
 return public.driver_finance_claim_json(c);
end;
$$;
create function public.admin_driver_finance(target_month text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Invalid month' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('driverName',d.name,'date',a.service_date,
  'pickup',o.pickup,'destination',o.destination,'claim',public.driver_finance_claim_json(c)) order by c.submitted_at)
  from public.driver_finance_claims c join public.driver_assignments a on a.id=c.assignment_id
  join public.orders o on o.id=a.order_id join public.drivers d on d.id=c.driver_id
  where to_char(a.service_date,'YYYY-MM')=target_month),'[]');
end;
$$;
-- Finance-only approval must not revoke the executed assignment. Dispatch changes still revoke.
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.revoke_test_order_assignments()'::regprocedure);
 if position('for changed in' in d)=0 then raise exception 'Unknown revocation function'; end if;
 d:=replace(d,'for changed in',
  'if (to_jsonb(new)-''finance_by_date''-''last_operation'') = (to_jsonb(old)-''finance_by_date''-''last_operation'')
   and not exists(select 1 from (select jsonb_object_keys(coalesce(new.finance_by_date,''{}'')) as day
    union select jsonb_object_keys(coalesce(old.finance_by_date,''{}''))) dates
    where coalesce(new.finance_by_date->day->>''driver'',new.driver) is distinct from coalesce(old.finance_by_date->day->>''driver'',old.driver)
     or coalesce(new.finance_by_date->day->>''vehicle'',new.vehicle) is distinct from coalesce(old.finance_by_date->day->>''vehicle'',old.vehicle)
     or coalesce(new.finance_by_date->day->>''vehiclePlate'',to_jsonb(new)->>''vehicle_plate'') is distinct from coalesce(old.finance_by_date->day->>''vehiclePlate'',to_jsonb(old)->>''vehicle_plate'')
     or new.finance_by_date->day->>''driverPaymentType'' is distinct from old.finance_by_date->day->>''driverPaymentType'')
   then return new; end if;
  for changed in');
 execute d;
end;
$patch$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('driver-finance-receipts','driver-finance-receipts',false,5242880,array['image/jpeg','image/png','image/webp']);
create function public.can_access_driver_receipt(path text, writing boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then return false; end if;
 if not writing and public.is_admin() then return true; end if;
 return exists(select 1 from public.driver_identity() identity join public.driver_assignments a
  on a.driver_id=identity.driver_id and a.region_id=identity.region_id
  where split_part(path,'/',1)=auth.uid()::text and a.id::text=split_part(path,'/',2) and a.status='completed'
  and (not writing or not exists(select 1 from public.driver_finance_claims c where c.assignment_id=a.id and c.status<>'rejected')));
end;
$$;
create policy driver_receipt_insert on storage.objects for insert to authenticated
 with check(bucket_id='driver-finance-receipts' and public.can_access_driver_receipt(name,true));
create policy driver_receipt_select on storage.objects for select to authenticated
 using(bucket_id='driver-finance-receipts' and public.can_access_driver_receipt(name,false));
revoke all on function public.record_driver_finance_event(),
 public.driver_finance_claim_json(public.driver_finance_claims),public.driver_finance_baseline(jsonb)
 from public,anon,authenticated;
revoke all on function public.driver_finance_data(text),public.submit_driver_finance(uuid,bigint,uuid,jsonb,numeric),
 public.review_driver_finance(uuid,bigint,text,text),public.admin_driver_finance(text),public.can_access_driver_receipt(text,boolean) from public,anon;
grant execute on function public.driver_finance_data(text),public.submit_driver_finance(uuid,bigint,uuid,jsonb,numeric),
 public.review_driver_finance(uuid,bigint,text,text),public.admin_driver_finance(text),public.can_access_driver_receipt(text,boolean) to authenticated;
commit;
