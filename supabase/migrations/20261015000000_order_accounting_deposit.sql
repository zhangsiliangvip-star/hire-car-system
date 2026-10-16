alter table public.orders
  add column accounting_status text not null default '未完成'
    check (accounting_status in ('完成核算', '未完成')),
  add column deposit_method text not null default ''
    check (deposit_method in ('', '口座入金', '现金入金')),
  add column deposit_date date;
