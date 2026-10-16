alter table public.orders
  add column accounting_assignee text not null default '';
