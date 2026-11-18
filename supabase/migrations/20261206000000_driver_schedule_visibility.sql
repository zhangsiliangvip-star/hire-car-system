begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
alter table public.drivers add column if not exists show_in_schedule boolean not null default true;
notify pgrst, 'reload schema';
commit;
