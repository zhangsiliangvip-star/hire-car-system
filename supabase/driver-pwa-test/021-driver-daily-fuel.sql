-- ONLY isolated zsipqwipauzgbqvppwjf. No production migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table public.driver_daily_fuel (
 id uuid primary key default gen_random_uuid(),
 driver_id uuid not null references public.drivers(id),
 region_id uuid not null references public.regions(id),
 assignment_id uuid not null references public.driver_assignments(id), baseline jsonb not null,
 service_date date not null, version bigint not null default 1,
 status text not null check(status in ('pending','approved','rejected')),
 amount bigint not null check(amount between 1 and 99999999999999),
 receipts jsonb not null, request_id uuid not null,
 submitted_at timestamptz not null default now(), reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id), review_note text not null default '',
 unique(driver_id,service_date)
);
alter table public.driver_daily_fuel enable row level security;
revoke all on public.driver_daily_fuel from public,anon,authenticated;
create table public.driver_daily_fuel_events (
 id uuid primary key default gen_random_uuid(), fuel_id uuid not null references public.driver_daily_fuel(id),
 actor_id uuid references auth.users(id), occurred_at timestamptz not null default now(), snapshot jsonb not null
);
alter table public.driver_daily_fuel_events enable row level security;
revoke all on public.driver_daily_fuel_events from public,anon,authenticated;
-- One approved daily cost, linked to exactly one chosen order/day.
create view public.driver_daily_fuel_costs with (security_barrier=true) as
 select f.id,f.driver_id,f.region_id,f.assignment_id,f.service_date,f.amount,f.reviewed_at
 from public.driver_daily_fuel f where f.status='approved' and public.is_admin();
revoke all on public.driver_daily_fuel_costs from public,anon;
grant select on public.driver_daily_fuel_costs to authenticated;
create function public.record_driver_daily_fuel_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.driver_daily_fuel_events(fuel_id,actor_id,snapshot) values(new.id,auth.uid(),to_jsonb(new));
 return new;
end; $$;
create trigger driver_daily_fuel_event after insert or update on public.driver_daily_fuel
 for each row execute function public.record_driver_daily_fuel_event();
create function public.driver_daily_fuel_json(f public.driver_daily_fuel) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',f.id,'date',f.service_date,'assignmentId',f.assignment_id,'version',f.version,'status',f.status,
 'amount',f.amount,'receipts',f.receipts,'reviewNote',f.review_note);
$$;
create function public.has_driver_fuel_day(target_driver uuid,target_region uuid,target_date date) returns boolean
language sql stable security definer set search_path='' as $$
 select target_date<=(now() at time zone 'Asia/Tokyo')::date and exists(
  select 1 from public.driver_assignments a join public.orders o on o.id=a.order_id and o.region_id=a.region_id
  where a.driver_id=target_driver and a.region_id=target_region and a.service_date=target_date and a.status='completed'
  and o.status<>'キャンセル' and a.service_date between o.date and o.end_date and not(a.service_date=any(o.off_dates)));
$$;
create function public.driver_daily_fuel_data(target_month text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity record; result jsonb;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid month' using errcode='22023'; end if;
 select coalesce(jsonb_agg(public.driver_daily_fuel_json(f) order by f.service_date),'[]') into result
 from public.driver_daily_fuel f where f.driver_id=identity.driver_id and f.region_id=identity.region_id
 and to_char(f.service_date,'YYYY-MM')=target_month;
 return result;
end; $$;
create function public.submit_driver_daily_fuel(target_date date,target_assignment uuid,expected_version bigint,target_request uuid,
 amount bigint,receipts jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity record; f public.driver_daily_fuel; receipt jsonb; p text; a public.driver_assignments; o public.orders;
begin
 select ord.* into o from public.orders ord join public.driver_assignments x on x.order_id=ord.id
 where x.id=target_assignment for share of ord;
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 perform 1 from public.driver_auth_links where driver_id=identity.driver_id for update;
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 select * into a from public.driver_assignments where id=target_assignment
 and driver_id=identity.driver_id and region_id=identity.region_id for share;
 if not found or a.status<>'completed' or a.service_date is distinct from target_date or o.status='キャンセル'
 or target_date>(now() at time zone 'Asia/Tokyo')::date or target_date<o.date or target_date>o.end_date or target_date=any(o.off_dates) then
  raise exception 'Completed own day required' using errcode='42501'; end if;
 if expected_version is null or expected_version<0 or target_request is null or amount is null
 or amount not between 1 and 99999999999999 or jsonb_typeof(receipts) is distinct from 'array' then
  raise exception 'Invalid fuel submission' using errcode='22023'; end if;
 if jsonb_array_length(receipts)>5 then raise exception 'Too many receipts' using errcode='22023'; end if;
 for receipt in select value from jsonb_array_elements(receipts) loop
  if jsonb_typeof(receipt) is distinct from 'string' then raise exception 'Invalid receipt' using errcode='22023'; end if;
  p:=receipt#>>'{}';
  if p !~ ('^'||auth.uid()::text||'/'||target_date::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
  or not exists(select 1 from storage.objects where bucket_id='driver-fuel-receipts' and name=p) then
   raise exception 'Own stored receipt required' using errcode='42501'; end if;
 end loop;
 select * into f from public.driver_daily_fuel where driver_id=identity.driver_id and service_date=target_date for update;
 if f.id is not null and f.request_id=target_request then
  if f.amount<>amount or f.receipts<>receipts or f.assignment_id<>target_assignment then raise exception 'Request key changed' using errcode='40001'; end if;
  return public.driver_daily_fuel_json(f);
 end if;
 if (f.id is null and expected_version<>0) or (f.id is not null and (f.version<>expected_version or f.status<>'rejected')) then
  raise exception 'Daily fuel already submitted or changed' using errcode='40001'; end if;
 insert into public.driver_daily_fuel(driver_id,region_id,service_date,assignment_id,baseline,status,amount,receipts,request_id)
 values(identity.driver_id,identity.region_id,target_date,a.id,
 jsonb_build_object('fuelCost',o.finance_by_date->target_date::text->'fuelCost'),'pending',amount,receipts,target_request)
 on conflict(driver_id,service_date) do update set version=driver_daily_fuel.version+1,status='pending',
 assignment_id=excluded.assignment_id,baseline=excluded.baseline,
 amount=excluded.amount,receipts=excluded.receipts,request_id=excluded.request_id,submitted_at=now(),
 review_note='',reviewed_at=null,reviewed_by=null returning * into f;
 return public.driver_daily_fuel_json(f);
end; $$;
create function public.admin_driver_daily_fuel(target_month text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Invalid month' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('driverName',d.name,'pickup',o.pickup,'destination',o.destination,
 'claim',public.driver_daily_fuel_json(f))
 order by f.service_date,d.name) from public.driver_daily_fuel f join public.drivers d on d.id=f.driver_id
 join public.driver_assignments a on a.id=f.assignment_id join public.orders o on o.id=a.order_id
 where to_char(f.service_date,'YYYY-MM')=target_month),'[]');
end; $$;
create function public.review_driver_daily_fuel(target_fuel uuid,expected_version bigint,decision text,note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.driver_daily_fuel; a public.driver_assignments; o public.orders; day_finance jsonb; total numeric;
begin
 if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 select ord.* into o from public.orders ord join public.driver_assignments x on x.order_id=ord.id
 join public.driver_daily_fuel d on d.assignment_id=x.id where d.id=target_fuel for update of ord;
 select * into f from public.driver_daily_fuel where id=target_fuel for update;
 if not found or f.version is distinct from expected_version or f.status<>'pending' then
  raise exception 'Pending fuel changed' using errcode='40001'; end if;
 if decision is null or decision not in ('approved','rejected') or note is null or length(note)>500
 or (decision='rejected' and length(btrim(note))=0) then raise exception 'Invalid review' using errcode='22023'; end if;
 if decision='approved' then
  select * into a from public.driver_assignments where id=f.assignment_id for share;
  if not found or a.driver_id<>f.driver_id or a.region_id<>f.region_id or a.service_date<>f.service_date
  or a.status<>'completed' or o.status='キャンセル' or f.service_date<o.date or f.service_date>o.end_date
  or f.service_date=any(o.off_dates) then raise exception 'Linked order changed' using errcode='40001'; end if;
  day_finance:=coalesce(o.finance_by_date->f.service_date::text,'{}');
  if jsonb_build_object('fuelCost',day_finance->'fuelCost')<>f.baseline then
   raise exception 'Order fuel cost changed; reject for resubmission' using errcode='40001'; end if;
  total:=coalesce((day_finance->>'fuelCost')::numeric,0)+f.amount;
  if total>99999999999999 then raise exception 'Fuel cost limit exceeded' using errcode='22023'; end if;
  day_finance:=day_finance||jsonb_build_object('fuelCost',total);
  update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'),array[f.service_date::text],day_finance,true)
   where id=o.id;
 end if;
 update public.driver_daily_fuel set status=decision,version=version+1,review_note=btrim(note),
 reviewed_at=now(),reviewed_by=auth.uid() where id=f.id returning * into f;
 return public.driver_daily_fuel_json(f);
end; $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('driver-fuel-receipts','driver-fuel-receipts',false,5242880,array['image/jpeg','image/png','image/webp']);
create function public.can_access_driver_fuel_receipt(path text,writing boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare identity record; day date;
begin
 if path is null or path !~ '^[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp)$' then return false; end if;
 if not writing and public.is_admin() then return true; end if;
 select * into identity from public.driver_identity();
 if not found or split_part(path,'/',1)<>auth.uid()::text then return false; end if;
 begin day:=split_part(path,'/',2)::date; exception when datetime_field_overflow or invalid_datetime_format then return false; end;
 if not writing then
  return public.has_driver_fuel_day(identity.driver_id,identity.region_id,day) or exists(
   select 1 from public.driver_daily_fuel f where f.driver_id=identity.driver_id and f.region_id=identity.region_id
   and f.service_date=day and f.receipts ? path);
 end if;
 return public.has_driver_fuel_day(identity.driver_id,identity.region_id,day) and not exists(
  select 1 from public.driver_daily_fuel f where f.driver_id=identity.driver_id and f.service_date=day and f.status<>'rejected');
end; $$;
create policy driver_fuel_receipt_insert on storage.objects for insert to authenticated
 with check(bucket_id='driver-fuel-receipts' and public.can_access_driver_fuel_receipt(name,true));
create policy driver_fuel_receipt_select on storage.objects for select to authenticated
 using(bucket_id='driver-fuel-receipts' and public.can_access_driver_fuel_receipt(name,false));
revoke all on function public.record_driver_daily_fuel_event(),public.driver_daily_fuel_json(public.driver_daily_fuel),
 public.has_driver_fuel_day(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.driver_daily_fuel_data(text),public.submit_driver_daily_fuel(date,uuid,bigint,uuid,bigint,jsonb),
 public.admin_driver_daily_fuel(text),public.review_driver_daily_fuel(uuid,bigint,text,text),
 public.can_access_driver_fuel_receipt(text,boolean) from public,anon;
grant execute on function public.driver_daily_fuel_data(text),public.submit_driver_daily_fuel(date,uuid,bigint,uuid,bigint,jsonb),
 public.admin_driver_daily_fuel(text),public.review_driver_daily_fuel(uuid,bigint,text,text),
 public.can_access_driver_fuel_receipt(text,boolean) to authenticated;
commit;
