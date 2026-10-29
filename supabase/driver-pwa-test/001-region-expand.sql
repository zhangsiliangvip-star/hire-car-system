-- Test project only: zsipqwipauzgbqvppwjf. Verify the Dashboard URL before execution.
-- Preparatory expansion, NOT a complete permission migration; do not enable driver accounts.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $$
begin
  if to_regclass('public.regions') is not null then
    raise exception 'Expected the inspected pre-region test schema; stop and inspect before rerunning';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and column_name = 'region_id'
  ) then
    raise exception 'Unexpected existing region columns; refusing partial migration';
  end if;
  if exists (
    select 1
    from (values ('profiles'), ('orders'), ('drivers'), ('vehicles'),
                 ('companies'), ('order_sources'), ('vehicle_monthly_finances'),
                 ('balance_expense_items')) as expected(name)
    where to_regclass('public.' || expected.name) is null
  ) then
    raise exception 'Missing an inspected legacy table';
  end if;
end;
$$;

lock table public.profiles, public.orders, public.drivers, public.vehicles,
  public.companies, public.order_sources, public.vehicle_monthly_finances,
  public.balance_expense_items in access exclusive mode;

create temporary table driver_pwa_before (
  table_name text primary key,
  row_count bigint not null,
  content_hash text not null
) on commit drop;

do $$
declare
  target text;
  total bigint;
  digest text;
begin
  foreach target in array array[
    'profiles', 'orders', 'drivers', 'vehicles', 'companies',
    'order_sources', 'vehicle_monthly_finances', 'balance_expense_items'
  ] loop
    execute format(
      'select count(*), md5(coalesce(string_agg(to_jsonb(t)::text, '','' order by id), '''')) from public.%I t',
      target
    ) into total, digest;
    insert into driver_pwa_before values (target, total, digest);
  end loop;
end;
$$;

create table public.regions (
  id uuid primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table public.regions enable row level security;
revoke all on public.regions from public, anon, authenticated;

alter table public.profiles add column region_id uuid references public.regions(id);
alter table public.orders add column region_id uuid references public.regions(id);
alter table public.drivers add column region_id uuid references public.regions(id);
alter table public.vehicles add column region_id uuid references public.regions(id);
alter table public.companies add column region_id uuid references public.regions(id);
alter table public.order_sources add column region_id uuid references public.regions(id);
alter table public.vehicle_monthly_finances add column region_id uuid references public.regions(id);
alter table public.balance_expense_items add column region_id uuid references public.regions(id);

do $$
declare
  original record;
  total bigint;
  digest text;
begin
  for original in select * from driver_pwa_before loop
    execute format(
      'select count(*), md5(coalesce(string_agg((to_jsonb(t) - ''region_id'')::text, '','' order by id), '''')) from public.%I t',
      original.table_name
    ) into total, digest;
    if total <> original.row_count or digest <> original.content_hash then
      raise exception 'Legacy data preservation check failed for %', original.table_name;
    end if;
  end loop;
end;
$$;

-- No backfill, default region, policy replacement, Auth change, or driver activation.
select 'region_expand_verified' as result,
       count(*) as preserved_tables,
       sum(row_count) as preserved_rows
from driver_pwa_before;
commit;
