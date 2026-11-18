begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.drivers
  add column bank_name text not null default '' check (length(bank_name) <= 200),
  add column bank_branch text not null default '' check (length(bank_branch) <= 200),
  add column bank_account_type text not null default '' check (bank_account_type in ('', '普通', '当座', '貯蓄')),
  add column bank_account_number text not null default '' check (length(bank_account_number) <= 20 and bank_account_number ~ '^[0-9]*$'),
  add column bank_account_holder text not null default '' check (length(bank_account_holder) <= 200);

create function public.staff_driver_monthly_shift(target_driver uuid, target_month text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare driver public.drivers; result jsonb;
begin
  if not public.is_staff() then raise exception 'Staff required' using errcode = '42501'; end if;
  select * into driver from public.drivers where id = target_driver;
  if not found or not coalesce(public.is_admin() or driver.region_id = (
    select p.region_id from public.profiles p where p.id = auth.uid()
  ), false) then raise exception 'Driver access denied' using errcode = '42501'; end if;
  if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Invalid month' using errcode = '22023';
  end if;
  if exists(select 1 from public.driver_monthly_shifts f where f.driver_id = target_driver
    and f.month = target_month and f.region_id <> driver.region_id) then
    raise exception 'Driver region changed' using errcode = '42501';
  end if;
  select jsonb_build_object('month', f.month, 'version', f.version, 'dates', to_jsonb(f.rest_dates), 'note', f.note)
    into result from public.driver_monthly_shifts f
    where f.driver_id = target_driver and f.region_id = driver.region_id and f.month = target_month;
  return coalesce(result, jsonb_build_object('month', target_month, 'version', 0, 'dates', '[]'::jsonb, 'note', ''));
end; $$;

create function public.staff_submit_driver_monthly_shift(target_driver uuid, target_month text,
  expected_version bigint, target_request uuid, rest_dates date[], note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare driver public.drivers; f public.driver_monthly_shifts; normalized date[];
begin
  if not public.is_staff() then raise exception 'Staff required' using errcode = '42501'; end if;
  select * into driver from public.drivers where id = target_driver for no key update;
  if not found or not coalesce(public.is_admin() or driver.region_id = (
    select p.region_id from public.profiles p where p.id = auth.uid()
  ), false) then raise exception 'Driver access denied' using errcode = '42501'; end if;
  -- Match the mobile writer's lock even when this month's shift does not exist yet.
  perform 1 from public.driver_auth_links where driver_id = target_driver for update;
  if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or expected_version is null or expected_version < 0 or target_request is null or rest_dates is null
    or cardinality(rest_dates) > 31 or note is null or length(note) > 1000 then
    raise exception 'Invalid shift submission' using errcode = '22023';
  end if;
  if exists(select 1 from unnest(rest_dates) d where d is null or to_char(d, 'YYYY-MM') <> target_month)
    or (select count(distinct d) from unnest(rest_dates) d) <> cardinality(rest_dates) then
    raise exception 'Invalid rest dates' using errcode = '22023';
  end if;
  select coalesce(array_agg(d order by d), '{}'::date[]) into normalized from unnest(rest_dates) d;
  select * into f from public.driver_monthly_shifts where driver_id = target_driver and month = target_month for update;
  if f.driver_id is not null and f.region_id <> driver.region_id then
    raise exception 'Driver region changed' using errcode = '42501';
  end if;
  if f.driver_id is not null and f.request_id = target_request then
    if f.rest_dates <> normalized or f.note <> btrim(note) then
      raise exception 'Request key changed' using errcode = '40001';
    end if;
    return public.staff_driver_monthly_shift(target_driver, target_month);
  end if;
  if (f.driver_id is null and expected_version <> 0) or (f.driver_id is not null and f.version <> expected_version) then
    raise exception 'Shift changed' using errcode = '40001';
  end if;
  insert into public.driver_monthly_shifts(driver_id, region_id, month, rest_dates, note, request_id)
    values(target_driver, driver.region_id, target_month, normalized, btrim(note), target_request)
    on conflict(driver_id, month) do update set rest_dates = excluded.rest_dates, note = excluded.note,
      version = driver_monthly_shifts.version + 1, request_id = excluded.request_id, submitted_at = now();
  return public.staff_driver_monthly_shift(target_driver, target_month);
end; $$;

revoke all on function public.staff_driver_monthly_shift(uuid,text),
  public.staff_submit_driver_monthly_shift(uuid,text,bigint,uuid,date[],text) from public,anon;
grant execute on function public.staff_driver_monthly_shift(uuid,text),
  public.staff_submit_driver_monthly_shift(uuid,text,bigint,uuid,date[],text) to authenticated;
commit;
