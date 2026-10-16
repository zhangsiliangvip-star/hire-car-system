begin;

grant usage on schema public to service_role;
grant select, update on table public.profiles to service_role;

commit;
