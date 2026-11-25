begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.driver_monthly_shifts
  add column attendance_dates date[] not null default '{}'::date[]
    check (cardinality(attendance_dates) <= 31);

create function public.driver_monthly_shift_v2(target_month text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare identity record; result jsonb;
begin
  select * into identity from public.driver_identity();
  if not found then raise exception 'Driver required' using errcode = '42501'; end if;
  if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Invalid month' using errcode = '22023';
  end if;
  select jsonb_build_object('month', f.month, 'version', f.version, 'dates', to_jsonb(f.rest_dates),
    'attendanceDates', to_jsonb(f.attendance_dates), 'note', f.note)
    into result from public.driver_monthly_shifts f
    where f.driver_id = identity.driver_id and f.region_id = identity.region_id and f.month = target_month;
  return coalesce(result, jsonb_build_object('month', target_month, 'version', 0,
    'dates', '[]'::jsonb, 'attendanceDates', '[]'::jsonb, 'note', ''));
end; $$;

create function public.submit_driver_monthly_shift_v2(target_month text, expected_version bigint,
  target_request uuid, rest_dates date[], attendance_dates date[], note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare identity record; f public.driver_monthly_shifts; normalized_rest date[]; normalized_attendance date[];
begin
  select * into identity from public.driver_identity();
  if not found then raise exception 'Driver required' using errcode = '42501'; end if;
  perform 1 from public.driver_auth_links where driver_id = identity.driver_id for update;
  select * into identity from public.driver_identity();
  if not found then raise exception 'Driver required' using errcode = '42501'; end if;
  if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or expected_version is null or expected_version < 0 or target_request is null
    or rest_dates is null or attendance_dates is null or cardinality(rest_dates) > 31
    or cardinality(attendance_dates) > 31 or note is null or length(note) > 1000 then
    raise exception 'Invalid shift submission' using errcode = '22023';
  end if;
  if exists(select 1 from unnest(rest_dates) d where d is null or to_char(d, 'YYYY-MM') <> target_month)
    or (select count(distinct d) from unnest(rest_dates) d) <> cardinality(rest_dates)
    or exists(select 1 from unnest(attendance_dates) d where d is null or to_char(d, 'YYYY-MM') <> target_month)
    or (select count(distinct d) from unnest(attendance_dates) d) <> cardinality(attendance_dates)
    or rest_dates && attendance_dates then
    raise exception 'Invalid shift dates' using errcode = '22023';
  end if;
  select coalesce(array_agg(d order by d), '{}'::date[]) into normalized_rest from unnest(rest_dates) d;
  select coalesce(array_agg(d order by d), '{}'::date[]) into normalized_attendance from unnest(attendance_dates) d;
  select * into f from public.driver_monthly_shifts
    where driver_id = identity.driver_id and month = target_month for update;
  if f.driver_id is not null and f.region_id <> identity.region_id then
    raise exception 'Driver region changed' using errcode = '42501';
  end if;
  if f.driver_id is not null and f.request_id = target_request then
    if f.rest_dates <> normalized_rest or f.attendance_dates <> normalized_attendance or f.note <> btrim(note) then
      raise exception 'Request key changed' using errcode = '40001';
    end if;
    return public.driver_monthly_shift_v2(target_month);
  end if;
  if (f.driver_id is null and expected_version <> 0) or (f.driver_id is not null and f.version <> expected_version) then
    raise exception 'Shift changed' using errcode = '40001';
  end if;
  insert into public.driver_monthly_shifts(driver_id, region_id, month, rest_dates, attendance_dates, note, request_id)
    values(identity.driver_id, identity.region_id, target_month, normalized_rest, normalized_attendance, btrim(note), target_request)
    on conflict(driver_id, month) do update set rest_dates = excluded.rest_dates,
      attendance_dates = excluded.attendance_dates, note = excluded.note,
      version = driver_monthly_shifts.version + 1, request_id = excluded.request_id, submitted_at = now();
  return public.driver_monthly_shift_v2(target_month);
end; $$;

create function public.staff_driver_monthly_shift_v2(target_driver uuid, target_month text) returns jsonb
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
  select jsonb_build_object('month', f.month, 'version', f.version, 'dates', to_jsonb(f.rest_dates),
    'attendanceDates', to_jsonb(f.attendance_dates), 'note', f.note)
    into result from public.driver_monthly_shifts f
    where f.driver_id = target_driver and f.region_id = driver.region_id and f.month = target_month;
  return coalesce(result, jsonb_build_object('month', target_month, 'version', 0,
    'dates', '[]'::jsonb, 'attendanceDates', '[]'::jsonb, 'note', ''));
end; $$;

create function public.staff_submit_driver_monthly_shift_v2(target_driver uuid, target_month text,
  expected_version bigint, target_request uuid, rest_dates date[], attendance_dates date[], note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare driver public.drivers; f public.driver_monthly_shifts; normalized_rest date[]; normalized_attendance date[];
begin
  if not public.is_staff() then raise exception 'Staff required' using errcode = '42501'; end if;
  select * into driver from public.drivers where id = target_driver for no key update;
  if not found or not coalesce(public.is_admin() or driver.region_id = (
    select p.region_id from public.profiles p where p.id = auth.uid()
  ), false) then raise exception 'Driver access denied' using errcode = '42501'; end if;
  perform 1 from public.driver_auth_links where driver_id = target_driver for update;
  if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or expected_version is null or expected_version < 0 or target_request is null
    or rest_dates is null or attendance_dates is null or cardinality(rest_dates) > 31
    or cardinality(attendance_dates) > 31 or note is null or length(note) > 1000 then
    raise exception 'Invalid shift submission' using errcode = '22023';
  end if;
  if exists(select 1 from unnest(rest_dates) d where d is null or to_char(d, 'YYYY-MM') <> target_month)
    or (select count(distinct d) from unnest(rest_dates) d) <> cardinality(rest_dates)
    or exists(select 1 from unnest(attendance_dates) d where d is null or to_char(d, 'YYYY-MM') <> target_month)
    or (select count(distinct d) from unnest(attendance_dates) d) <> cardinality(attendance_dates)
    or rest_dates && attendance_dates then
    raise exception 'Invalid shift dates' using errcode = '22023';
  end if;
  select coalesce(array_agg(d order by d), '{}'::date[]) into normalized_rest from unnest(rest_dates) d;
  select coalesce(array_agg(d order by d), '{}'::date[]) into normalized_attendance from unnest(attendance_dates) d;
  select * into f from public.driver_monthly_shifts where driver_id = target_driver and month = target_month for update;
  if f.driver_id is not null and f.region_id <> driver.region_id then
    raise exception 'Driver region changed' using errcode = '42501';
  end if;
  if f.driver_id is not null and f.request_id = target_request then
    if f.rest_dates <> normalized_rest or f.attendance_dates <> normalized_attendance or f.note <> btrim(note) then
      raise exception 'Request key changed' using errcode = '40001';
    end if;
    return public.staff_driver_monthly_shift_v2(target_driver, target_month);
  end if;
  if (f.driver_id is null and expected_version <> 0) or (f.driver_id is not null and f.version <> expected_version) then
    raise exception 'Shift changed' using errcode = '40001';
  end if;
  insert into public.driver_monthly_shifts(driver_id, region_id, month, rest_dates, attendance_dates, note, request_id)
    values(target_driver, driver.region_id, target_month, normalized_rest, normalized_attendance, btrim(note), target_request)
    on conflict(driver_id, month) do update set rest_dates = excluded.rest_dates,
      attendance_dates = excluded.attendance_dates, note = excluded.note,
      version = driver_monthly_shifts.version + 1, request_id = excluded.request_id, submitted_at = now();
  return public.staff_driver_monthly_shift_v2(target_driver, target_month);
end; $$;

create function public.staff_driver_shift_requests(service_dates date[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Staff required' using errcode = '42501'; end if;
  if service_dates is null or cardinality(service_dates) not between 1 and 3660
    or array_position(service_dates, null) is not null then
    raise exception 'Invalid service dates' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('driverId', requests.driver_id,
      'date', requests.service_date, 'type', requests.request_type)
      order by requests.driver_id, requests.service_date, requests.request_type)
    from (
      select f.driver_id, d as service_date, 'rest'::text as request_type
      from public.driver_monthly_shifts f
      join public.drivers driver on driver.id = f.driver_id and driver.region_id = f.region_id
      cross join lateral unnest(f.rest_dates) d
      where d = any(service_dates)
        and (public.is_admin() or f.region_id = (select p.region_id from public.profiles p where p.id = auth.uid()))
      union all
      select f.driver_id, d as service_date, 'attendance'::text as request_type
      from public.driver_monthly_shifts f
      join public.drivers driver on driver.id = f.driver_id and driver.region_id = f.region_id
      cross join lateral unnest(f.attendance_dates) d
      where d = any(service_dates)
        and (public.is_admin() or f.region_id = (select p.region_id from public.profiles p where p.id = auth.uid()))
    ) requests
  ), '[]'::jsonb);
end; $$;

revoke all on function public.submit_driver_monthly_shift_v2(text, bigint, uuid, date[], date[], text),
  public.staff_submit_driver_monthly_shift_v2(uuid, text, bigint, uuid, date[], date[], text),
  public.driver_monthly_shift_v2(text), public.staff_driver_monthly_shift_v2(uuid, text),
  public.staff_driver_shift_requests(date[])
  from public, anon;
grant execute on function public.submit_driver_monthly_shift_v2(text, bigint, uuid, date[], date[], text),
  public.staff_submit_driver_monthly_shift_v2(uuid, text, bigint, uuid, date[], date[], text),
  public.driver_monthly_shift_v2(text), public.staff_driver_monthly_shift_v2(uuid, text),
  public.staff_driver_shift_requests(date[])
  to authenticated;

commit;
