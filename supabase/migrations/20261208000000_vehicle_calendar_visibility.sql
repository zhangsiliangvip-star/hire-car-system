begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
alter table public.vehicles add column if not exists show_in_calendar boolean not null default true;
notify pgrst, 'reload schema';
commit;
