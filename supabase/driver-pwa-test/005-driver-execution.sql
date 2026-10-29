-- Isolated zsipqwipauzgbqvppwjf test project only. Retains all assignments and events.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

alter table public.driver_assignments drop constraint driver_assignments_status_check;
alter table public.driver_assignments add constraint driver_assignments_status_check
  check (status in ('assigned','acknowledged','en_route','arrived','in_service','completed','revoked'));
alter table public.driver_assignment_events drop constraint driver_assignment_events_event_type_check;
alter table public.driver_assignment_events add constraint driver_assignment_events_event_type_check
  check (event_type in ('acknowledged','en_route','arrived','in_service','completed','revoked'));
alter table public.driver_assignment_events
  add column expected_version bigint,
  add column result_version bigint;
-- Before this expansion, every acknowledgement was the single assigned v1 -> acknowledged v2.
update public.driver_assignment_events set expected_version=1,result_version=2
  where event_type='acknowledged';
alter table public.driver_assignment_events add constraint driver_event_versions_check check (
  (event_type='revoked' and expected_version is null and result_version is null)
  or (event_type<>'revoked' and expected_version is not null and expected_version>0
      and result_version is not null and result_version=expected_version+1 and request_id is not null)
);

create function public.transition_driver_assignment(
  target_assignment uuid, expected_version bigint, target_request uuid, target_state text
) returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  link public.driver_auth_links%rowtype;
  item public.driver_assignments%rowtype;
  previous public.driver_assignment_events%rowtype;
  next_state text;
begin
  if target_request is null or expected_version is null or expected_version < 1
     or expected_version >= 9007199254740991 or target_state is null
     or target_state not in ('acknowledged','en_route','arrived','in_service','completed') then
    raise exception 'Valid request, version and state required' using errcode='22023';
  end if;
  -- Match dispatch and order-edit lock ordering.
  perform 1 from public.orders o join public.driver_assignments a on a.order_id=o.id
    where a.id=target_assignment for share of o;
  select * into link from public.driver_auth_links
    where user_id=(select auth.uid()) and status='active' for share;
  if not found or not exists(select 1 from public.driver_identity()) then
    raise exception 'Active driver identity required' using errcode='42501';
  end if;
  select * into item from public.driver_assignments
    where id=target_assignment and driver_id=link.driver_id and region_id=link.region_id for update;
  if not found or item.status='revoked'
     or not exists(select 1 from public.driver_orders(null,target_assignment)) then
    raise exception 'Assignment not available' using errcode='P0002';
  end if;
  select * into previous from public.driver_assignment_events
    where actor_user_id=(select auth.uid()) and request_id=target_request;
  if found then
    if previous.assignment_id<>target_assignment or previous.event_type<>target_state
       or previous.expected_version is distinct from expected_version then
      raise exception 'Idempotency key payload conflict' using errcode='40001';
    end if;
    return previous.result_version;
  end if;
  next_state:=case item.status when 'assigned' then 'acknowledged'
    when 'acknowledged' then 'en_route' when 'en_route' then 'arrived'
    when 'arrived' then 'in_service' when 'in_service' then 'completed' else null end;
  if item.version<>expected_version or next_state is distinct from target_state then
    raise exception 'Assignment version/state conflict' using errcode='40001';
  end if;
  insert into public.driver_assignment_events(
    assignment_id,actor_user_id,event_type,request_id,expected_version,result_version)
    values(item.id,(select auth.uid()),target_state,target_request,expected_version,expected_version+1);
  update public.driver_assignments set status=target_state,version=version+1,
    acknowledged_at=case when target_state='acknowledged' then now() else acknowledged_at end
    where id=item.id returning version into item.version;
  return item.version;
end;
$$;

create or replace function public.acknowledge_driver_assignment(
  target_assignment uuid, expected_version bigint, target_request uuid
) returns bigint language sql security definer set search_path = ''
as $$
  select public.transition_driver_assignment(target_assignment,expected_version,target_request,'acknowledged');
$$;
revoke all on function public.transition_driver_assignment(uuid,bigint,uuid,text) from public,anon;
grant execute on function public.transition_driver_assignment(uuid,bigint,uuid,text) to authenticated;
commit;
