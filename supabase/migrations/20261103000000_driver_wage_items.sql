begin;

create table public.driver_wage_items (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  driver text not null check (char_length(driver) between 1 and 200),
  company_name text not null default '' check (char_length(company_name) <= 200),
  name text not null check (char_length(name) between 1 and 200),
  amount bigint not null check (amount between -99999999999999 and 99999999999999),
  last_operation jsonb
);

create index driver_wage_items_scope_idx
  on public.driver_wage_items (region_id, month, company_name, driver);

alter table public.driver_wage_items enable row level security;
revoke all on public.driver_wage_items from public, anon;
grant select, insert, update, delete on public.driver_wage_items to authenticated;
create policy "Admins can manage driver wage items in their region"
  on public.driver_wage_items for all to authenticated
  using ((select public.is_admin()) or region_id = (select public.current_region_id()))
  with check ((select public.is_admin()) or region_id = (select public.current_region_id()));

create trigger business_operation_stamp
  before insert or update on public.driver_wage_items
  for each row execute function public.record_business_audit();
create trigger business_audit
  after insert or update or delete on public.driver_wage_items
  for each row execute function public.record_business_audit();

commit;
