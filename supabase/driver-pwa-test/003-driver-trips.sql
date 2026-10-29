-- Isolated test project zsipqwipauzgbqvppwjf only; NOT a production dispatch migration.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $$
begin
  if to_regclass('public.driver_auth_links') is null
     or to_regclass('public.driver_assignments') is not null then
    raise exception 'Unexpected test identity schema';
  end if;
end;
$$;
alter table public.orders add constraint driver_order_region_key unique (id, region_id);
create table public.driver_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  driver_id uuid not null,
  region_id uuid not null references public.regions(id) on delete restrict,
  service_date date not null,
  status text not null default 'assigned' check (status in ('assigned','acknowledged','revoked')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  acknowledged_at timestamptz,
  revoked_at timestamptz,
  foreign key (order_id, region_id) references public.orders(id, region_id) on delete restrict,
  foreign key (driver_id, region_id) references public.drivers(id, region_id) on delete restrict
);
create unique index driver_assignment_active_day on public.driver_assignments(order_id,service_date)
  where status <> 'revoked';
create index driver_assignment_own_date on public.driver_assignments(driver_id,service_date,id);
create table public.driver_assignment_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.driver_assignments(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('acknowledged','revoked')),
  request_id uuid,
  occurred_at timestamptz not null default now(),
  unique (actor_user_id, request_id)
);
alter table public.driver_assignments enable row level security;
alter table public.driver_assignment_events enable row level security;
revoke all on public.driver_assignments,public.driver_assignment_events from public,anon,authenticated;

create function public.dispatch_test_driver_order(
  target_order uuid, target_driver uuid, target_date date
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  item public.orders%rowtype;
  link public.driver_auth_links%rowtype;
  result uuid;
begin
  if not (select public.is_admin()) then
    raise exception 'Staff administrator required' using errcode = '42501';
  end if;
  select * into item from public.orders where id = target_order for update;
  if not found or item.region_id is null or target_date is null
     or target_date < item.date or target_date > item.end_date
     or target_date = any(item.off_dates) or item.status = 'キャンセル' then
    raise exception 'Order has no eligible service day' using errcode = '22023';
  end if;
  select * into link from public.driver_auth_links where driver_id = target_driver for share;
  if not found or link.status <> 'active' or link.region_id <> item.region_id then
    raise exception 'Active same-region driver required' using errcode = '22023';
  end if;
  insert into public.driver_assignments(order_id,driver_id,region_id,service_date,created_by)
    values(target_order,target_driver,item.region_id,target_date,(select auth.uid()))
    returning id into result;
  return result;
end;
$$;

-- Conservative test safety: ANY order edit revokes existing assignments in the same transaction.
-- Production needs explicit atomic split/reassignment, not this test-only invalidation rule.
create function public.revoke_test_order_assignments()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare changed record;
begin
  for changed in
    update public.driver_assignments set status='revoked',version=version+1,revoked_at=now()
    where order_id=old.id and status <> 'revoked' returning id
  loop
    insert into public.driver_assignment_events(assignment_id,actor_user_id,event_type)
      values(changed.id,(select auth.uid()),'revoked');
  end loop;
  return new;
end;
$$;
create trigger revoke_test_order_assignments before update on public.orders
  for each row execute function public.revoke_test_order_assignments();

create function public.driver_orders(target_date date default null, target_assignment uuid default null)
returns table (
  assignment_id uuid, order_id uuid, service_date date, departure_time text,
  pickup text, destination text, vehicle text, status text, version bigint
) language sql stable security definer set search_path = ''
as $$
  select a.id,a.order_id,a.service_date,o.time,o.pickup,o.destination,o.vehicle,a.status,a.version
  from public.driver_identity() identity
  join public.driver_assignments a on a.driver_id=identity.driver_id and a.region_id=identity.region_id
  join public.orders o on o.id=a.order_id and o.region_id=a.region_id
  where a.status <> 'revoked' and o.status <> 'キャンセル'
    and a.service_date between o.date and o.end_date
    and not (a.service_date = any(o.off_dates))
    and ((target_assignment is null and a.service_date=target_date)
         or (target_assignment is not null and a.id=target_assignment))
  order by a.service_date,o.time,a.id limit 200;
$$;

create function public.acknowledge_driver_assignment(
  target_assignment uuid, expected_version bigint, target_request uuid
) returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  link public.driver_auth_links%rowtype;
  item public.driver_assignments%rowtype;
  previous public.driver_assignment_events%rowtype;
  eligible boolean;
begin
  if target_request is null or expected_version is null or expected_version < 1 then
    raise exception 'Request id and version required' using errcode = '22023';
  end if;
  -- Match dispatch/order invalidation lock ordering: order, link, assignment.
  perform 1 from public.orders o join public.driver_assignments a on a.order_id=o.id
    where a.id=target_assignment for share of o;
  select * into link from public.driver_auth_links
    where user_id=(select auth.uid()) and status='active' for share;
  if not found or not exists(select 1 from public.driver_identity()) then
    raise exception 'Active driver identity required' using errcode = '42501';
  end if;
  select * into item from public.driver_assignments
    where id=target_assignment and driver_id=link.driver_id and region_id=link.region_id for update;
  if not found or item.status='revoked' then
    raise exception 'Assignment not available' using errcode = 'P0002';
  end if;
  select exists(select 1 from public.driver_orders(null,target_assignment)) into eligible;
  if not eligible then raise exception 'Assignment not available' using errcode = 'P0002'; end if;
  select * into previous from public.driver_assignment_events
    where actor_user_id=(select auth.uid()) and request_id=target_request;
  if found then
    if previous.assignment_id <> target_assignment or item.version <> expected_version+1 then
      raise exception 'Idempotency key payload conflict' using errcode = '40001';
    end if;
    return item.version;
  end if;
  if item.version <> expected_version or item.status <> 'assigned' then
    raise exception 'Assignment version/state conflict' using errcode = '40001';
  end if;
  insert into public.driver_assignment_events(assignment_id,actor_user_id,event_type,request_id)
    values(item.id,(select auth.uid()),'acknowledged',target_request);
  update public.driver_assignments set status='acknowledged',version=version+1,acknowledged_at=now()
    where id=item.id returning version into item.version;
  return item.version;
end;
$$;

revoke all on function public.revoke_test_order_assignments() from public,anon,authenticated;
revoke all on function public.dispatch_test_driver_order(uuid,uuid,date),
  public.driver_orders(date,uuid),public.acknowledge_driver_assignment(uuid,bigint,uuid)
  from public,anon;
grant execute on function public.dispatch_test_driver_order(uuid,uuid,date),
  public.driver_orders(date,uuid),public.acknowledge_driver_assignment(uuid,bigint,uuid)
  to authenticated;
select 'driver_trips_prepared' as result;
commit;
