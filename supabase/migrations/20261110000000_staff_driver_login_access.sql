begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function public.admin_driver_logins() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor_region uuid;
begin
 if not public.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
 select region_id into actor_region from public.profiles where id=auth.uid();
 return coalesce((select jsonb_agg(jsonb_build_object('driverId',l.driver_id,'userId',l.user_id,
  'email',u.email,'status',l.status,'version',l.version) order by l.driver_id)
 from public.driver_auth_links l
 join public.drivers d on d.id=l.driver_id and d.region_id=l.region_id
 join auth.users u on u.id=l.user_id
 where public.is_admin() or d.region_id=actor_region),'[]');
end;
$$;

create or replace function public.admin_driver_login_target(target_driver uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.drivers; l public.driver_auth_links; actor_region uuid;
begin
 if not public.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
 select region_id into actor_region from public.profiles where id=auth.uid();
 select * into d from public.drivers
  where id=target_driver and (public.is_admin() or region_id=actor_region);
 if not found then raise exception 'Driver missing or outside staff region' using errcode='42501'; end if;
 select * into l from public.driver_auth_links where driver_id=d.id and region_id=d.region_id;
 return jsonb_build_object('driverId',d.id,'name',d.name,'regionId',d.region_id,
  'userId',l.user_id,'status',l.status,'version',l.version);
end;
$$;

create or replace function public.bind_driver_identity(target_user uuid, target_driver uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
 actor uuid := (select auth.uid());
 driver_region uuid;
 target public.profiles%rowtype;
begin
 if not (select public.is_staff()) then
  raise exception 'Staff account required' using errcode = '42501';
 end if;
 if target_user = actor then
  raise exception 'Cannot bind your own staff account' using errcode = '42501';
 end if;
 select * into target from public.profiles where id = target_user for update;
 if not found or target.account_type <> 'pending' or target.role <> 'user' then
  raise exception 'Binding requires an unprivileged pending profile' using errcode = '22023';
 end if;
 select region_id into driver_region from public.drivers where id = target_driver for update;
 if not found or driver_region is null then
  raise exception 'Driver must have a confirmed region' using errcode = '22023';
 end if;
 if not (select public.is_admin()) and driver_region is distinct from
   (select region_id from public.profiles where id = actor) then
  raise exception 'Driver outside staff region' using errcode = '42501';
 end if;
 if target.region_id is not null and target.region_id <> driver_region then
  raise exception 'Profile and driver regions differ' using errcode = '22023';
 end if;
 update public.profiles set account_type = 'driver', region_id = driver_region
  where id = target_user;
 insert into public.driver_auth_links
  (driver_id, user_id, region_id, linked_by, updated_by)
 values (target_driver, target_user, driver_region, actor, actor);
end;
$$;

revoke all on function public.admin_driver_logins(),public.admin_driver_login_target(uuid) from public,anon;
grant execute on function public.admin_driver_logins(),public.admin_driver_login_target(uuid) to authenticated;
commit;
