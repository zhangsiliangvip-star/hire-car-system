-- ONLY isolated zsipqwipauzgbqvppwjf. No production migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table public.driver_profile_preferences (
 driver_id uuid primary key references public.drivers(id),
 prompted boolean not null default false, version bigint not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.driver_profile_preferences enable row level security;
revoke all on public.driver_profile_preferences from public,anon,authenticated;
create function public.admin_driver_logins() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('driverId',l.driver_id,'userId',l.user_id,
 'email',u.email,'status',l.status,'version',l.version) order by l.driver_id)
 from public.driver_auth_links l join auth.users u on u.id=l.user_id),'[]');
end; $$;
create function public.admin_driver_login_target(target_driver uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.drivers; l public.driver_auth_links;
begin
 if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 select * into d from public.drivers where id=target_driver;
 if not found then raise exception 'Driver missing' using errcode='22023'; end if;
 select * into l from public.driver_auth_links where driver_id=d.id;
 return jsonb_build_object('driverId',d.id,'name',d.name,'regionId',d.region_id,
 'userId',l.user_id,'status',l.status,'version',l.version);
end; $$;
create function public.driver_own_profile() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity record; result jsonb;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 select jsonb_build_object('phone',coalesce(d.phone,''),'wechat',coalesce(d.wechat,''),
 'whatsapp',coalesce(d.whatsapp,''),'licenseExpiry',coalesce(d.license_expiry::text,''),
 'prompted',coalesce(p.prompted,false),'version',coalesce(p.version,0)) into result
 from public.drivers d left join public.driver_profile_preferences p on p.driver_id=d.id
 where d.id=identity.driver_id;
 return result;
end; $$;
create function public.update_driver_own_profile(expected_version bigint,action text,contacts jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare identity record; v bigint; p jsonb; expiry date;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 -- Match existing binding lock order: profile, driver, then identity link.
 perform 1 from public.profiles where id=auth.uid() for update;
 perform 1 from public.drivers where id=identity.driver_id for update;
 perform 1 from public.driver_auth_links where driver_id=identity.driver_id for update;
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 select version into v from public.driver_profile_preferences where driver_id=identity.driver_id for update;
 if expected_version is null or coalesce(v,0)<>expected_version then raise exception 'Profile changed' using errcode='40001'; end if;
 if action is null or action not in ('save','skip') or contacts is null then raise exception 'Invalid profile action' using errcode='22023'; end if;
 if action='save' then
  if jsonb_typeof(contacts) is distinct from 'object' or
   (select count(*) from jsonb_object_keys(contacts))<>4 or not(contacts ?& array['phone','wechat','whatsapp','licenseExpiry']) then
   raise exception 'Invalid contacts' using errcode='22023'; end if;
  for p in select value from jsonb_each(contacts) loop
   if jsonb_typeof(p) is distinct from 'string' then raise exception 'Invalid contact type' using errcode='22023'; end if;
  end loop;
  if length(contacts->>'phone')>100 or length(contacts->>'wechat')>200 or length(contacts->>'whatsapp')>200 then
   raise exception 'Contact too long' using errcode='22023'; end if;
  if contacts->>'licenseExpiry'<>'' then
   if contacts->>'licenseExpiry' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid expiry' using errcode='22023'; end if;
   expiry:=(contacts->>'licenseExpiry')::date;
  end if;
  update public.drivers set phone=btrim(contacts->>'phone'),wechat=btrim(contacts->>'wechat'),
   whatsapp=btrim(contacts->>'whatsapp'),license_expiry=expiry where id=identity.driver_id;
 elsif contacts<>'{}'::jsonb then raise exception 'Skip must not update contacts' using errcode='22023';
 end if;
 insert into public.driver_profile_preferences(driver_id,prompted,version) values(identity.driver_id,true,1)
 on conflict(driver_id) do update set prompted=true,version=driver_profile_preferences.version+1,updated_at=now();
 return public.driver_own_profile();
end; $$;
revoke all on function public.admin_driver_logins(),public.admin_driver_login_target(uuid),
 public.driver_own_profile(),public.update_driver_own_profile(bigint,text,jsonb) from public,anon;
grant execute on function public.admin_driver_logins(),public.admin_driver_login_target(uuid),
 public.driver_own_profile(),public.update_driver_own_profile(bigint,text,jsonb) to authenticated;
commit;
