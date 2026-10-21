alter table public.order_sources
  add column if not exists short_name text not null default '';
