-- Only for zsipqwipauzgbqvppwjf, before any region data or dependent driver schema exists.
-- Do not run after later migrations. Failure leaves the schema unchanged.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
lock table public.regions, public.profiles, public.orders, public.drivers,
  public.vehicles, public.companies, public.order_sources,
  public.vehicle_monthly_finances, public.balance_expense_items in access exclusive mode;

do $$
declare
  target text;
  assigned bigint;
begin
  if exists (select 1 from public.regions) then
    raise exception 'Region records exist; rollback refused';
  end if;
  foreach target in array array[
    'profiles', 'orders', 'drivers', 'vehicles', 'companies',
    'order_sources', 'vehicle_monthly_finances', 'balance_expense_items'
  ] loop
    execute format('select count(*) from public.%I where region_id is not null', target)
      into assigned;
    if assigned > 0 then
      raise exception 'Region assignments exist in %; rollback refused', target;
    end if;
  end loop;
  if to_regclass('public.driver_auth_links') is not null
     or to_regclass('public.driver_assignments') is not null then
    raise exception 'Dependent driver schema exists; rollback refused';
  end if;
end;
$$;

alter table public.profiles drop column region_id restrict;
alter table public.orders drop column region_id restrict;
alter table public.drivers drop column region_id restrict;
alter table public.vehicles drop column region_id restrict;
alter table public.companies drop column region_id restrict;
alter table public.order_sources drop column region_id restrict;
alter table public.vehicle_monthly_finances drop column region_id restrict;
alter table public.balance_expense_items drop column region_id restrict;
drop table public.regions restrict;
commit;
