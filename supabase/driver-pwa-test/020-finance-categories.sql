-- ONLY isolated zsipqwipauzgbqvppwjf. Apply after 019; no production migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table public.driver_finance_claims in access exclusive mode;
create temporary table previous_finance_claims on commit drop as select * from public.driver_finance_claims;
alter table public.driver_finance_claims add column category text not null default 'company'
 check(category in ('company','trip','overtime'));
alter table public.driver_finance_claims drop constraint driver_finance_claims_pkey;
alter table public.driver_finance_claims add primary key(assignment_id,category);
-- Preserve reviewed amounts and versions; splitting an approved record never books it again.
alter table public.driver_finance_claims disable trigger driver_finance_event;
delete from public.driver_finance_claims;
insert into public.driver_finance_claims
 (assignment_id,driver_id,region_id,category,version,status,expenses,overtime_hours,
 baseline,request_id,submitted_at,reviewed_at,reviewed_by,review_note)
select c.assignment_id,c.driver_id,c.region_id,k.category,c.version,c.status,
 coalesce((select jsonb_agg(e) from jsonb_array_elements(c.expenses) e where e->>'type'=k.category),'[]'),
 case when k.category='overtime' then c.overtime_hours else 0 end,
 c.baseline,c.request_id,c.submitted_at,c.reviewed_at,c.reviewed_by,c.review_note
from previous_finance_claims c cross join (values('company'),('trip'),('overtime')) k(category)
where k.category='overtime' or exists(select 1 from jsonb_array_elements(c.expenses) e where e->>'type'=k.category);
alter table public.driver_finance_claims enable trigger driver_finance_event;
alter table public.driver_finance_claims alter column category drop default;

create function public.driver_finance_category_baseline(f jsonb, category text) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('driverPaymentType',f->'driverPaymentType') ||
 case category when 'company' then jsonb_build_object('driverAdvanceCompanyReport',f->'driverAdvanceCompanyReport')
 when 'trip' then jsonb_build_object('driverAdvanceTripReport',f->'driverAdvanceTripReport')
 else public.driver_finance_baseline(f)-'driver'-'driverAdvanceCompanyReport'-'driverAdvanceTripReport' end;
$$;
update public.driver_finance_claims set baseline=public.driver_finance_category_baseline(baseline,category);
create or replace function public.driver_finance_claim_json(c public.driver_finance_claims)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('assignmentId',c.assignment_id,'category',c.category,'version',c.version,'status',c.status,
 'expenses',c.expenses,'overtimeHours',c.overtime_hours,'reviewNote',c.review_note,'submittedAt',c.submitted_at);
$$;
-- Retain the validated payroll formula while changing only the trip's claim projection.
do $patch$
declare d text;
begin
 d:=pg_get_functiondef('public.driver_finance_data(text)'::regprocedure);
 if position('''claim'',case when c.assignment_id is null then null else public.driver_finance_claim_json(c) end' in d)=0 then
  raise exception 'Unexpected finance projection'; end if;
 d:=replace(d,'''claim'',case when c.assignment_id is null then null else public.driver_finance_claim_json(c) end',
  '''claims'',coalesce((select jsonb_agg(public.driver_finance_claim_json(c) order by c.category)
   from public.driver_finance_claims c where c.assignment_id=a.id and c.driver_id=identity.driver_id),''[]''::jsonb)');
 d:=replace(d,'left join public.driver_finance_claims c on c.assignment_id=a.id and c.driver_id=identity.driver_id','');
 execute d;
end;
$patch$;
drop function public.submit_driver_finance(uuid,bigint,uuid,jsonb,numeric);
drop function public.review_driver_finance(uuid,bigint,text,text);
create function public.submit_driver_finance(target_assignment uuid, target_category text, expected_version bigint,
 target_request uuid, items jsonb, hours numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare identity record; a public.driver_assignments; o public.orders; c public.driver_finance_claims;
 e jsonb; receipt jsonb; p text; total numeric:=0; f jsonb;
begin
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
 if target_category is null or target_category not in ('company','trip','overtime')
 or target_request is null or expected_version is null or expected_version<0
 or hours is null or hours::text in ('NaN','Infinity','-Infinity') or hours<0 or hours>999 or hours<>round(hours,2)
 or jsonb_typeof(items) is distinct from 'array' then raise exception 'Invalid submission' using errcode='22023'; end if;
 if jsonb_array_length(items)>50 or
 (target_category='overtime' and items<>'[]') or
 (target_category<>'overtime' and (hours<>0 or jsonb_array_length(items)=0)) then
  raise exception 'Invalid category payload' using errcode='22023'; end if;
 select * into c from public.driver_finance_claims where assignment_id=a.id and category=target_category for update;
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
   or not (
    p ~ ('^'||auth.uid()::text||'/'||a.id::text||'/'||target_category||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
    or (p ~ ('^'||auth.uid()::text||'/'||a.id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
      and exists(select 1 from jsonb_array_elements(c.expenses) old_expense where old_expense->'receipts' ? p))
   ) then raise exception 'Receipt not available for category' using errcode='42501'; end if;
  end loop;
 end loop;
 if total>99999999999999 or
 (select count(distinct value->>'id') from jsonb_array_elements(items))<>jsonb_array_length(items) then
  raise exception 'Invalid expense totals' using errcode='22023'; end if;
 if c.assignment_id is not null and c.request_id=target_request then
  if c.expenses<>items or c.overtime_hours<>hours then raise exception 'Request key payload changed' using errcode='40001'; end if;
  return public.driver_finance_claim_json(c);
 end if;
 if (c.assignment_id is null and expected_version<>0) or
 (c.assignment_id is not null and (c.version<>expected_version or c.status<>'rejected')) then
  raise exception 'Category already submitted or changed' using errcode='40001'; end if;
 f:=coalesce(o.finance_by_date->a.service_date::text,'{}');
 insert into public.driver_finance_claims
 (assignment_id,category,driver_id,region_id,status,expenses,overtime_hours,baseline,request_id)
 values(a.id,target_category,a.driver_id,a.region_id,'pending',items,hours,public.driver_finance_category_baseline(f,target_category),target_request)
 on conflict(assignment_id,category) do update set version=driver_finance_claims.version+1,status='pending',
 expenses=excluded.expenses,overtime_hours=excluded.overtime_hours,baseline=excluded.baseline,request_id=excluded.request_id,
 submitted_at=now(),review_note='',reviewed_at=null,reviewed_by=null returning * into c;
 return public.driver_finance_claim_json(c);
end;
$$;
create function public.review_driver_finance(target_assignment uuid, target_category text, expected_version bigint,
 decision text, note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.driver_finance_claims; a public.driver_assignments; o public.orders;
 f jsonb; amount numeric; driver_name text; rate numeric; field text;
begin
 if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 select ord.* into o from public.orders ord join public.driver_assignments x on x.order_id=ord.id
 where x.id=target_assignment for update of ord;
 select * into a from public.driver_assignments where id=target_assignment for update;
 select * into c from public.driver_finance_claims where assignment_id=target_assignment and category=target_category for update;
 if not found or c.version is distinct from expected_version or c.status<>'pending' then
  raise exception 'Pending category changed' using errcode='40001'; end if;
 if decision is null or decision not in ('approved','rejected') or note is null or length(note)>500
 or (decision='rejected' and length(btrim(note))=0) then raise exception 'Invalid review' using errcode='22023'; end if;
 if decision='approved' then
  if a.status<>'completed' or o.status='キャンセル' or a.service_date<o.date or a.service_date>o.end_date
  or a.service_date=any(o.off_dates) then raise exception 'Trip changed' using errcode='40001'; end if;
  f:=coalesce(o.finance_by_date->a.service_date::text,'{}');
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
   select coalesce(sum((value->>'amount')::numeric),0) into amount from jsonb_array_elements(c.expenses);
   amount:=amount+coalesce((f->>field)::numeric,0);
   if amount>99999999999999 then raise exception 'Finance limit exceeded' using errcode='22023'; end if;
   f:=f||jsonb_build_object(field,amount);
  end if;
  f:=f||jsonb_build_object('driver',driver_name);
  update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),array[a.service_date::text],f,true) where id=o.id;
 end if;
 update public.driver_finance_claims set status=decision,version=version+1,review_note=btrim(note),
 reviewed_at=now(),reviewed_by=auth.uid() where assignment_id=c.assignment_id and category=c.category returning * into c;
 return public.driver_finance_claim_json(c);
end;
$$;
create or replace function public.can_access_driver_receipt(path text, writing boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if path is null or path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/((company|trip)/)?[0-9a-f-]{36}\.(jpg|png|webp)$' then return false; end if;
 if not writing and public.is_admin() then return true; end if;
 if writing and split_part(path,'/',3) not in ('company','trip') then return false; end if;
 return exists(select 1 from public.driver_identity() identity join public.driver_assignments a
  on a.driver_id=identity.driver_id and a.region_id=identity.region_id
  join public.orders o on o.id=a.order_id and o.region_id=a.region_id
  where split_part(path,'/',1)=auth.uid()::text and a.id::text=split_part(path,'/',2) and a.status='completed'
  and (not writing or (o.status<>'キャンセル' and a.service_date between o.date and o.end_date
   and not(a.service_date=any(o.off_dates)) and a.service_date<=(now() at time zone 'Asia/Tokyo')::date
   and not exists(select 1 from public.driver_finance_claims c where c.assignment_id=a.id
    and c.category=split_part(path,'/',3) and c.status<>'rejected'))));
end;
$$;
revoke all on function public.driver_finance_category_baseline(jsonb,text) from public,anon,authenticated;
revoke all on function public.submit_driver_finance(uuid,text,bigint,uuid,jsonb,numeric),
 public.review_driver_finance(uuid,text,bigint,text,text) from public,anon;
grant execute on function public.submit_driver_finance(uuid,text,bigint,uuid,jsonb,numeric),
 public.review_driver_finance(uuid,text,bigint,text,text) to authenticated;
commit;
