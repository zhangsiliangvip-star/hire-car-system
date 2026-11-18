begin;

alter table public.drivers
  add column postal_code text not null default ''
    check (postal_code = '' or postal_code ~ '^[0-9]{3}-[0-9]{4}$');

notify pgrst, 'reload schema';

commit;
