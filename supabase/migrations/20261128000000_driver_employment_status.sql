begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
alter table public.drivers add column employment_status text not null default '在職'
  check (employment_status in ('在職', '休暇', '離職'));
notify pgrst, 'reload schema';
commit;
