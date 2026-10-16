alter table public.vehicles
  add column default_parking_fee bigint not null default 0
    check (default_parking_fee >= 0),
  add column default_insurance_fee bigint not null default 0
    check (default_insurance_fee >= 0);

create table public.vehicle_monthly_finances (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  parking_fee bigint not null default 0 check (parking_fee >= 0),
  insurance_fee bigint not null default 0 check (insurance_fee >= 0),
  inspection_fee bigint not null default 0 check (inspection_fee >= 0),
  repair_fee bigint not null default 0 check (repair_fee >= 0),
  supplies jsonb not null default '[]'::jsonb
    check (jsonb_typeof(supplies) = 'array'),
  start_odometer bigint check (start_odometer is null or start_odometer >= 0),
  end_odometer bigint check (
    end_odometer is null or
    (end_odometer >= 0 and (start_odometer is null or end_odometer >= start_odometer))
  ),
  unique (vehicle_id, month)
);

create index vehicle_monthly_finances_month_vehicle_idx
  on public.vehicle_monthly_finances (month, vehicle_id);

alter table public.vehicle_monthly_finances enable row level security;
revoke all on public.vehicle_monthly_finances from anon, authenticated;
grant select, insert, update, delete on public.vehicle_monthly_finances to authenticated;

create policy "Authenticated users can manage vehicle monthly finances"
  on public.vehicle_monthly_finances for all to authenticated
  using (true) with check (true);
