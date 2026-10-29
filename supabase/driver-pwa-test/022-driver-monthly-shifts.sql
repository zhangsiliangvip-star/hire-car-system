-- ONLY isolated zsipqwipauzgbqvppwjf. No production migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table public.driver_monthly_shifts (
 driver_id uuid not null references public.drivers(id),
 region_id uuid not null references public.regions(id),
 month text not null check(month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 rest_dates date[] not null default '{}', note text not null default '' check(length(note)<=1000),
 version bigint not null default 1, request_id uuid not null,
 submitted_at timestamptz not null default now(), primary key(driver_id,month)
);
alter table public.driver_monthly_shifts enable row level security;
revoke all on public.driver_monthly_shifts from public,anon,authenticated;
create table public.driver_monthly_shift_events (
 id uuid primary key default gen_random_uuid(), driver_id uuid not null, month text not null,
 actor_id uuid references auth.users(id), occurred_at timestamptz not null default now(), snapshot jsonb not null
);
alter table public.driver_monthly_shift_events enable row level security;
revoke all on public.driver_monthly_shift_events from public,anon,authenticated;
create function public.record_driver_monthly_shift_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.driver_monthly_shift_events(driver_id,month,actor_id,snapshot)
 values(new.driver_id,new.month,auth.uid(),to_jsonb(new));
 return new;
end; $$;
create trigger driver_monthly_shift_event after insert or update on public.driver_monthly_shifts
 for each row execute function public.record_driver_monthly_shift_event();
create function public.driver_monthly_shift(target_month text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity record; result jsonb;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Invalid month' using errcode='22023'; end if;
 select jsonb_build_object('month',f.month,'version',f.version,'dates',to_jsonb(f.rest_dates),'note',f.note) into result
 from public.driver_monthly_shifts f where f.driver_id=identity.driver_id and f.region_id=identity.region_id and f.month=target_month;
 return coalesce(result,jsonb_build_object('month',target_month,'version',0,'dates','[]'::jsonb,'note',''));
end; $$;
create function public.submit_driver_monthly_shift(target_month text,expected_version bigint,target_request uuid,
 rest_dates date[],note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare identity record; f public.driver_monthly_shifts; normalized date[];
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 perform 1 from public.driver_auth_links where driver_id=identity.driver_id for update;
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
 or expected_version is null or expected_version<0 or target_request is null or rest_dates is null
 or cardinality(rest_dates)>31 or note is null or length(note)>1000 then
  raise exception 'Invalid shift submission' using errcode='22023'; end if;
 if exists(select 1 from unnest(rest_dates) d where d is null or to_char(d,'YYYY-MM')<>target_month)
 or (select count(distinct d) from unnest(rest_dates) d)<>cardinality(rest_dates) then
  raise exception 'Invalid rest dates' using errcode='22023'; end if;
 select coalesce(array_agg(d order by d),'{}'::date[]) into normalized from unnest(rest_dates) d;
 select * into f from public.driver_monthly_shifts where driver_id=identity.driver_id and month=target_month for update;
 if f.driver_id is not null and f.region_id<>identity.region_id then raise exception 'Driver region changed' using errcode='42501'; end if;
 if f.driver_id is not null and f.request_id=target_request then
  if f.rest_dates<>normalized or f.note<>btrim(note) then raise exception 'Request key changed' using errcode='40001'; end if;
  return public.driver_monthly_shift(target_month);
 end if;
 if (f.driver_id is null and expected_version<>0) or (f.driver_id is not null and f.version<>expected_version) then
  raise exception 'Shift changed' using errcode='40001'; end if;
 insert into public.driver_monthly_shifts(driver_id,region_id,month,rest_dates,note,request_id)
 values(identity.driver_id,identity.region_id,target_month,normalized,btrim(note),target_request)
 on conflict(driver_id,month) do update set rest_dates=excluded.rest_dates,note=excluded.note,
 version=driver_monthly_shifts.version+1,request_id=excluded.request_id,submitted_at=now();
 return public.driver_monthly_shift(target_month);
end; $$;
create function public.staff_driver_rest_days(service_dates date[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
 if service_dates is null or cardinality(service_dates) not between 1 and 3660
 or array_position(service_dates,null) is not null then raise exception 'Invalid service dates' using errcode='22023'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('driverId',f.driver_id,'date',d) order by f.driver_id,d)
 from public.driver_monthly_shifts f join public.drivers driver on driver.id=f.driver_id and driver.region_id=f.region_id
 cross join lateral unnest(f.rest_dates) d
 where d=any(service_dates) and (public.is_admin() or f.region_id=(select p.region_id from public.profiles p where p.id=auth.uid()))),'[]');
end; $$;
revoke all on function public.record_driver_monthly_shift_event() from public,anon,authenticated;
revoke all on function public.driver_monthly_shift(text),public.submit_driver_monthly_shift(text,bigint,uuid,date[],text),
 public.staff_driver_rest_days(date[]) from public,anon;
grant execute on function public.driver_monthly_shift(text),public.submit_driver_monthly_shift(text,bigint,uuid,date[],text),
 public.staff_driver_rest_days(date[]) to authenticated;
commit;
