alter table public.vehicle_monthly_finances
  add column region_id uuid references public.regions (id);
alter table public.balance_expense_items
  add column region_id uuid references public.regions (id);

update public.vehicle_monthly_finances as finance
set region_id = vehicle.region_id
from public.vehicles as vehicle
where vehicle.id = finance.vehicle_id;

update public.balance_expense_items
set region_id = '60000000-0000-4000-8000-000000000001'
where region_id is null;

alter table public.vehicle_monthly_finances alter column region_id set not null;
alter table public.balance_expense_items alter column region_id set not null;

alter table public.vehicles
  add constraint vehicles_id_region_key unique (id, region_id);
alter table public.vehicle_monthly_finances
  add constraint vehicle_monthly_finances_vehicle_region_fkey
  foreign key (vehicle_id, region_id)
  references public.vehicles (id, region_id) on delete cascade;

alter table public.balance_expense_items
  drop constraint balance_expense_items_company_name_name_key;
alter table public.balance_expense_items
  add constraint balance_expense_items_region_company_name_key
  unique (region_id, company_name, name);

create index vehicle_monthly_finances_region_month_idx
  on public.vehicle_monthly_finances (region_id, month);
create index balance_expense_items_region_idx
  on public.balance_expense_items (region_id);

drop policy "Authenticated users can manage vehicle monthly finances"
  on public.vehicle_monthly_finances;
create policy "Users can manage vehicle monthly finances in their region"
  on public.vehicle_monthly_finances for all to authenticated
  using ((select public.is_admin()) or region_id = (select public.current_region_id()))
  with check ((select public.is_admin()) or region_id = (select public.current_region_id()));

drop policy "Authenticated users can manage balance expense items"
  on public.balance_expense_items;
create policy "Users can manage balance expense items in their region"
  on public.balance_expense_items for all to authenticated
  using ((select public.is_admin()) or region_id = (select public.current_region_id()))
  with check ((select public.is_admin()) or region_id = (select public.current_region_id()));
