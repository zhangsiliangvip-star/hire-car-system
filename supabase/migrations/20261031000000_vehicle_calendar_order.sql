-- Shared manual vehicle order for the calendar; null keeps the default generation order.
alter table public.vehicles add column if not exists calendar_order integer;
