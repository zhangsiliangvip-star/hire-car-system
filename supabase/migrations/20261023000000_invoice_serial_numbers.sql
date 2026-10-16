create table public.invoice_counters (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_number bigint not null check (last_number > 0)
);

create table public.invoice_numbers (
  order_id uuid not null references public.orders(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  serial_number bigint not null check (serial_number > 0),
  created_at timestamptz not null default now(),
  primary key (order_id, company_id),
  unique (company_id, serial_number)
);

alter table public.invoice_counters enable row level security;
alter table public.invoice_numbers enable row level security;
revoke all on public.invoice_counters, public.invoice_numbers from public, anon, authenticated;

create function public.allocate_invoice_number(p_order_id uuid, p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_company public.companies%rowtype;
  v_number bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not coalesce((
    public.is_admin() or v_order.region_id = public.current_region_id()
  ), false) then
    raise exception 'Order not accessible' using errcode = '42501';
  end if;

  select * into v_company from public.companies where id = p_company_id for share;
  if not found or v_company.region_id <> v_order.region_id or v_company.name <> v_order.company then
    raise exception 'Order company does not match; refresh and retry' using errcode = '22023';
  end if;

  select serial_number into v_number from public.invoice_numbers
    where order_id = p_order_id and company_id = p_company_id;
  if not found then
    insert into public.invoice_counters(company_id, last_number) values (p_company_id, 1)
    on conflict (company_id) do update set last_number = public.invoice_counters.last_number + 1
    returning last_number into v_number;
    insert into public.invoice_numbers(order_id, company_id, serial_number)
      values (p_order_id, p_company_id, v_number);
  end if;

  return 'INV-' || lpad(v_number::text, greatest(6, length(v_number::text)), '0');
end;
$$;

revoke all on function public.allocate_invoice_number(uuid, uuid) from public, anon;
grant execute on function public.allocate_invoice_number(uuid, uuid) to authenticated;
