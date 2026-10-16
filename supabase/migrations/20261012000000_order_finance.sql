alter table public.orders
  add column order_price numeric(14, 0) not null default 0 check (order_price >= 0),
  add column etc_company_report numeric(14, 0) not null default 0 check (etc_company_report >= 0),
  add column etc_trip_report numeric(14, 0) not null default 0 check (etc_trip_report >= 0),
  add column fuel_cost numeric(14, 0) not null default 0 check (fuel_cost >= 0),
  add column fuel_consumption numeric(10, 2) not null default 0 check (fuel_consumption >= 0),
  add column driver_advance_company_report numeric(14, 0) not null default 0
    check (driver_advance_company_report >= 0),
  add column driver_advance_trip_report numeric(14, 0) not null default 0
    check (driver_advance_trip_report >= 0),
  add column company_advance_company_report numeric(14, 0) not null default 0
    check (company_advance_company_report >= 0),
  add column company_advance_trip_report numeric(14, 0) not null default 0
    check (company_advance_trip_report >= 0),
  add column driver_overtime_fee numeric(14, 0) not null default 0
    check (driver_overtime_fee >= 0),
  add column driver_wage numeric(14, 0) not null default 0 check (driver_wage >= 0);
