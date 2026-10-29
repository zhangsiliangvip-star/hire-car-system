do $$
begin
  if current_setting('server_version_num')::integer < 170000
    or to_regclass('public.regions') is null
    or to_regclass('public.driver_wage_items') is null
    or to_regclass('public.driver_auth_links') is not null then
    raise exception 'Unexpected production baseline; inspect before migration';
  end if;
  if exists(select 1 from public.profiles where region_id is null)
    or exists(select 1 from public.drivers where region_id is null)
    or not exists(select 1 from public.profiles where role='admin') then
    raise exception 'Confirmed staff/driver regions and an administrator are required';
  end if;
end;
$$;

create temporary table driver_production_before on commit drop as
select 'profiles'::text as table_name, id, to_jsonb(p) as original from public.profiles p
union all select 'orders', id, to_jsonb(o) from public.orders o
union all select 'drivers', id, to_jsonb(d) from public.drivers d
union all select 'driver_wage_items', id, to_jsonb(w) from public.driver_wage_items w;
