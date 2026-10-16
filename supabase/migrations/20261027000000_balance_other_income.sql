begin;

alter table public.balance_expense_items
  add column kind text not null default 'expense'
    check (kind in ('expense', 'income'));

alter table public.balance_expense_items
  drop constraint balance_expense_items_region_company_name_key;
alter table public.balance_expense_items
  add constraint balance_expense_items_region_company_kind_name_key
    unique (region_id, company_name, kind, name);

commit;
