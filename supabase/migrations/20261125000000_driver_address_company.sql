begin;

alter table public.drivers
  add column address text not null default '' check (length(address) <= 1000),
  add column company_name text not null default '' check (length(company_name) <= 200);

notify pgrst, 'reload schema';

commit;
