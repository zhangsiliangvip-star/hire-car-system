create table public.regions (
  id uuid primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into public.regions (id, name) values
  ('60000000-0000-4000-8000-000000000001', '东京'),
  ('60000000-0000-4000-8000-000000000002', '大阪'),
  ('60000000-0000-4000-8000-000000000003', '北海道')
on conflict (id) do update set name = excluded.name;

alter table public.profiles
  add column region_id uuid references public.regions (id);
alter table public.orders
  add column region_id uuid references public.regions (id);
alter table public.drivers
  add column region_id uuid references public.regions (id);
alter table public.vehicles
  add column region_id uuid references public.regions (id);
alter table public.order_sources
  add column region_id uuid references public.regions (id);
alter table public.companies
  add column region_id uuid references public.regions (id);

update public.profiles
set region_id = '60000000-0000-4000-8000-000000000001'
where region_id is null;
update public.orders
set region_id = '60000000-0000-4000-8000-000000000001'
where region_id is null;
update public.drivers
set region_id = '60000000-0000-4000-8000-000000000001'
where region_id is null;
update public.vehicles
set region_id = '60000000-0000-4000-8000-000000000001'
where region_id is null;
update public.order_sources
set region_id = '60000000-0000-4000-8000-000000000001'
where region_id is null;
update public.companies
set region_id = '60000000-0000-4000-8000-000000000001'
where region_id is null;

alter table public.profiles alter column region_id set default '60000000-0000-4000-8000-000000000001';
alter table public.profiles alter column region_id set not null;
alter table public.orders alter column region_id set default '60000000-0000-4000-8000-000000000001';
alter table public.orders alter column region_id set not null;
alter table public.drivers alter column region_id set default '60000000-0000-4000-8000-000000000001';
alter table public.drivers alter column region_id set not null;
alter table public.vehicles alter column region_id set default '60000000-0000-4000-8000-000000000001';
alter table public.vehicles alter column region_id set not null;
alter table public.order_sources alter column region_id set default '60000000-0000-4000-8000-000000000001';
alter table public.order_sources alter column region_id set not null;
alter table public.companies alter column region_id set default '60000000-0000-4000-8000-000000000001';
alter table public.companies alter column region_id set not null;

alter table public.regions enable row level security;
revoke all on public.regions from anon, authenticated;
grant select on public.regions to authenticated;

create function public.current_region_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select region_id
  from public.profiles
  where id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.current_region_id() from public, anon;
grant execute on function public.current_region_id() to authenticated;

create policy "Users can read assigned region"
  on public.regions for select to authenticated
  using ((select public.is_admin()) or id = (select public.current_region_id()));

create index profiles_region_id_idx on public.profiles (region_id);
create index orders_region_date_idx on public.orders (region_id, date, end_date);
create index drivers_region_id_idx on public.drivers (region_id);
create index vehicles_region_id_idx on public.vehicles (region_id);
create index order_sources_region_id_idx on public.order_sources (region_id);
create index companies_region_id_idx on public.companies (region_id);

alter table public.drivers drop constraint if exists drivers_name_key;
alter table public.companies drop constraint if exists companies_name_key;
alter table public.order_sources drop constraint if exists order_sources_company_name_key;
drop index if exists public.vehicles_plate_unique_idx;

create unique index drivers_region_name_key on public.drivers (region_id, name);
create unique index companies_region_name_key on public.companies (region_id, name);
create unique index order_sources_region_name_key on public.order_sources (region_id, company_name);
create unique index vehicles_region_plate_unique_idx on public.vehicles (region_id, plate) where plate <> '';

drop policy if exists "Authenticated users can manage orders" on public.orders;
create policy "Users can manage orders in their region"
  on public.orders for all to authenticated
  using ((select public.is_admin()) or region_id = (select public.current_region_id()))
  with check ((select public.is_admin()) or region_id = (select public.current_region_id()));

drop policy if exists "Authenticated users can manage drivers" on public.drivers;
create policy "Users can manage drivers in their region"
  on public.drivers for all to authenticated
  using ((select public.is_admin()) or region_id = (select public.current_region_id()))
  with check ((select public.is_admin()) or region_id = (select public.current_region_id()));

drop policy if exists "Authenticated users can manage vehicles" on public.vehicles;
create policy "Users can manage vehicles in their region"
  on public.vehicles for all to authenticated
  using ((select public.is_admin()) or region_id = (select public.current_region_id()))
  with check ((select public.is_admin()) or region_id = (select public.current_region_id()));

drop policy if exists "Authenticated users can manage order sources" on public.order_sources;
create policy "Users can manage order sources in their region"
  on public.order_sources for all to authenticated
  using ((select public.is_admin()) or region_id = (select public.current_region_id()))
  with check ((select public.is_admin()) or region_id = (select public.current_region_id()));

drop policy if exists "Authenticated users can manage companies" on public.companies;
create policy "Users can manage companies in their region"
  on public.companies for all to authenticated
  using ((select public.is_admin()) or region_id = (select public.current_region_id()))
  with check ((select public.is_admin()) or region_id = (select public.current_region_id()));