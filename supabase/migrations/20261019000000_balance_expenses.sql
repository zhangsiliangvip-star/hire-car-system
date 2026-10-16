create table public.balance_expense_items (
  id uuid primary key default gen_random_uuid(),
  company_name text not null default '' check (char_length(company_name) <= 200),
  name text not null check (char_length(name) between 1 and 200),
  monthly_amounts jsonb not null default '{}'::jsonb
    check (jsonb_typeof(monthly_amounts) = 'object'),
  unique (company_name, name)
);

alter table public.balance_expense_items enable row level security;
revoke all on public.balance_expense_items from anon, authenticated;
grant select, insert, update, delete on public.balance_expense_items to authenticated;

create policy "Authenticated users can manage balance expense items"
  on public.balance_expense_items for all to authenticated
  using (true) with check (true);
