begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create or replace function public.admin_update_driver_global_slogan(target_slogan text) returns text
language plpgsql security definer set search_path='' as $$
declare saved text;
begin
 if not public.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
 if target_slogan is null or char_length(target_slogan)>100 then
  raise exception 'Invalid slogan' using errcode='22023';
 end if;
 update public.driver_portal_settings
  set global_slogan=target_slogan,updated_at=now() where singleton=true
  returning global_slogan into saved;
 if not found then raise exception 'Driver portal settings unavailable'; end if;
 return saved;
end;
$$;

commit;
