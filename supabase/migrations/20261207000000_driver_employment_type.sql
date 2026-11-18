begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
alter table public.drivers add column if not exists employment_type text not null default '常勤'
  check (employment_type in ('常勤', '非常勤'));
notify pgrst, 'reload schema';
commit;
