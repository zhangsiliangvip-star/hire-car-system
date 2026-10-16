alter table public.orders
  add column finance_by_date jsonb not null default '{}'::jsonb
    check (jsonb_typeof(finance_by_date) = 'object');

update public.orders
set finance_by_date = jsonb_build_object(
      date::text,
      jsonb_build_object(
        'driver', driver,
        'vehicle', vehicle,
        'etcCompanyReport', etc_company_report,
        'etcTripReport', etc_trip_report,
        'fuelCost', fuel_cost,
        'fuelConsumption', fuel_consumption,
        'driverAdvanceCompanyReport', driver_advance_company_report,
        'driverAdvanceTripReport', driver_advance_trip_report,
        'companyAdvanceCompanyReport', company_advance_company_report,
        'companyAdvanceTripReport', company_advance_trip_report,
        'driverOvertimeFee', driver_overtime_fee,
        'driverWage', driver_wage
      )
    );

alter table public.orders
  drop column etc_company_report,
  drop column etc_trip_report,
  drop column fuel_cost,
  drop column fuel_consumption,
  drop column driver_advance_company_report,
  drop column driver_advance_trip_report,
  drop column company_advance_company_report,
  drop column company_advance_trip_report,
  drop column driver_overtime_fee,
  drop column driver_wage;
