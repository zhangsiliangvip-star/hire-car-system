alter table public.orders
  add column invoice_status text not null default '未完成'
    check (invoice_status in ('未完成', '已完成')),
  add column invoice_sent_date date;
