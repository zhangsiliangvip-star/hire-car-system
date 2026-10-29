-- Only for the inspected zsipqwipauzgbqvppwjf test project.
-- Does not enable driver login or assign regions to legacy records.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

lock table public.profiles, public.drivers in access exclusive mode;
do $$
begin
  if to_regclass('public.regions') is null
     or to_regclass('public.driver_auth_links') is not null then
    raise exception 'Unexpected test schema; inspect before running';
  end if;
  if (select count(*) from public.profiles) <> 2 then
    raise exception 'Expected the two inspected legacy staff profiles';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles'
               and column_name = 'account_type') then
    raise exception 'Identity expansion already present';
  end if;
end;
$$;

create temporary table driver_identity_before on commit drop as
select id, to_jsonb(p) as original from public.profiles p;

alter table public.profiles add column account_type text not null default 'pending'
  check (account_type in ('pending', 'staff', 'driver'));
update public.profiles set account_type = 'staff';

alter table public.drivers add constraint driver_identity_region_key unique (id, region_id);
alter table public.profiles add constraint driver_profile_identity_key
  unique (id, region_id, account_type, role);

create function public.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and account_type = 'staff'
  );
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and account_type = 'staff' and role = 'admin'
  );
$$;
revoke all on function public.is_staff(), public.is_admin() from public, anon;
grant execute on function public.is_staff(), public.is_admin() to authenticated;

-- A restrictive gate ANDs with existing permissive policies, even if they use true.
-- This preserves the inspected legacy staff rules without granting drivers those rules.
do $$
declare target text;
begin
  foreach target in array array[
    'orders', 'drivers', 'vehicles', 'companies', 'order_sources',
    'vehicle_monthly_finances', 'balance_expense_items'
  ] loop
    execute format(
      'create policy driver_identity_staff_gate on public.%I as restrictive for all to authenticated
       using ((select public.is_staff())) with check ((select public.is_staff()))', target
    );
  end loop;
end;
$$;

-- Existing self-profile SELECT stays available. Clients cannot promote themselves.
revoke insert, update, delete, truncate, references, trigger
  on public.profiles from public, anon, authenticated;

create table public.driver_auth_links (
  driver_id uuid primary key,
  user_id uuid not null unique references auth.users(id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  account_type text not null default 'driver' check (account_type = 'driver'),
  profile_role text not null default 'user' check (profile_role = 'user'),
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  linked_at timestamptz not null default now(),
  linked_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  foreign key (driver_id, region_id)
    references public.drivers(id, region_id) on delete restrict,
  foreign key (user_id, region_id, account_type, profile_role)
    references public.profiles(id, region_id, account_type, role) on delete restrict
);
alter table public.driver_auth_links enable row level security;
revoke all on public.driver_auth_links from public, anon, authenticated;

create table public.driver_identity_audit (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_auth_links(driver_id) on delete restrict,
  region_id uuid not null references public.regions(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('linked', 'active', 'suspended', 'revoked')),
  version bigint not null,
  occurred_at timestamptz not null default now(),
  unique (driver_id, version)
);
alter table public.driver_identity_audit enable row level security;
revoke all on public.driver_identity_audit from public, anon, authenticated;

create function public.driver_identity_audit_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authenticated actor required' using errcode = '42501';
  end if;
  insert into public.driver_identity_audit
    (driver_id, region_id, actor_user_id, event_type, version)
  values
    (new.driver_id, new.region_id, (select auth.uid()),
     case when tg_op = 'INSERT' then 'linked' else new.status end, new.version);
  return new;
end;
$$;
revoke all on function public.driver_identity_audit_change() from public, anon, authenticated;
create trigger audit_driver_identity after insert or update on public.driver_auth_links
  for each row execute function public.driver_identity_audit_change();

create function public.bind_driver_identity(target_user uuid, target_driver uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  driver_region uuid;
  target public.profiles%rowtype;
begin
  if not (select public.is_admin()) then
    raise exception 'Staff administrator required' using errcode = '42501';
  end if;
  if target_user = actor then
    raise exception 'Cannot bind your own administrator account' using errcode = '42501';
  end if;
  select * into target from public.profiles where id = target_user for update;
  if not found or target.account_type <> 'pending' or target.role <> 'user' then
    raise exception 'Binding requires an unprivileged pending profile' using errcode = '22023';
  end if;
  select region_id into driver_region from public.drivers where id = target_driver for update;
  if not found or driver_region is null then
    raise exception 'Driver must have a confirmed region' using errcode = '22023';
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

create function public.set_driver_identity_status(
  target_driver uuid, next_status text, expected_version bigint
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  link public.driver_auth_links%rowtype;
begin
  if not (select public.is_admin()) then
    raise exception 'Staff administrator required' using errcode = '42501';
  end if;
  if next_status is null or next_status not in ('active', 'suspended', 'revoked') then
    raise exception 'Invalid identity status' using errcode = '22023';
  end if;
  select * into link from public.driver_auth_links where driver_id = target_driver for update;
  if not found then
    raise exception 'Driver link not found' using errcode = '22023';
  end if;
  if expected_version is null or link.version <> expected_version then
    raise exception 'Identity version conflict' using errcode = '40001';
  end if;
  if link.status = 'revoked' then
    raise exception 'Revoked identities cannot be reactivated' using errcode = '22023';
  end if;
  if link.status = next_status then return link.version; end if;
  update public.driver_auth_links
    set status = next_status, version = version + 1,
        updated_at = now(), updated_by = (select auth.uid())
    where driver_id = target_driver
    returning version into link.version;
  return link.version;
end;
$$;

create function public.driver_identity()
returns table (driver_id uuid, region_id uuid, driver_name text, version bigint)
language sql stable security definer set search_path = ''
as $$
  select l.driver_id, l.region_id, d.name, l.version
  from public.driver_auth_links l
  join public.profiles p on p.id = l.user_id and p.region_id = l.region_id
  join public.drivers d on d.id = l.driver_id and d.region_id = l.region_id
  where l.user_id = (select auth.uid()) and l.status = 'active'
    and p.account_type = 'driver' and p.role = 'user';
$$;

revoke all on function public.bind_driver_identity(uuid, uuid),
  public.set_driver_identity_status(uuid, text, bigint), public.driver_identity()
  from public, anon;
grant execute on function public.bind_driver_identity(uuid, uuid),
  public.set_driver_identity_status(uuid, text, bigint), public.driver_identity()
  to authenticated;

do $$
begin
  if exists (
    select 1 from driver_identity_before b
    full join public.profiles p using (id)
    where b.original is distinct from (to_jsonb(p) - 'account_type')
  ) then
    raise exception 'Legacy profile preservation failed';
  end if;
end;
$$;
select 'driver_identity_prepared' as result,
       (select count(*) from driver_identity_before) as preserved_profiles,
       (select count(*) from public.driver_auth_links) as driver_links;
commit;
