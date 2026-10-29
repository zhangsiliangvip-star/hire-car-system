begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

alter table public.drivers
 add column if not exists personal_slogan text not null default '';
do $constraint$
begin
 if not exists (select 1 from pg_constraint where conname='drivers_personal_slogan_length_check'
  and conrelid='public.drivers'::regclass) then
  alter table public.drivers add constraint drivers_personal_slogan_length_check
   check (char_length(personal_slogan)<=100);
 end if;
end;
$constraint$;

create table if not exists public.driver_portal_settings (
 singleton boolean primary key default true check (singleton),
 global_slogan text not null default '平安出行，美好的一天'
  check (char_length(global_slogan)<=100),
 updated_at timestamptz not null default now()
);
alter table public.driver_portal_settings enable row level security;
revoke all on public.driver_portal_settings from public,anon,authenticated;
insert into public.driver_portal_settings(singleton) values(true)
 on conflict(singleton) do nothing;

create function public.driver_portal_greetings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity record; global_text text; personal_text text:='';
begin
 if not public.is_staff() then
  select * into identity from public.driver_identity();
  if not found then raise exception 'Driver required' using errcode='42501'; end if;
  select coalesce(d.personal_slogan,'') into personal_text
   from public.drivers d where d.id=identity.driver_id;
 end if;
 select global_slogan into global_text from public.driver_portal_settings where singleton=true;
 if not found then raise exception 'Driver portal settings unavailable'; end if;
 return jsonb_build_object('globalSlogan',global_text,'personalSlogan',personal_text);
end;
$$;

create function public.admin_update_driver_global_slogan(target_slogan text) returns text
language plpgsql security definer set search_path='' as $$
declare saved text;
begin
 if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
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
revoke all on function public.driver_portal_greetings(),public.admin_update_driver_global_slogan(text)
 from public,anon;
grant execute on function public.driver_portal_greetings(),public.admin_update_driver_global_slogan(text)
 to authenticated;

commit;
