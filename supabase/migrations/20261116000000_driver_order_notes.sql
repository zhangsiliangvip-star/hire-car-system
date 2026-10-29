begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.update_driver_order_notes(
  target_assignment uuid, expected_notes text, target_notes text
) returns text language plpgsql security definer set search_path='' as $$
declare
  item public.orders%rowtype;
  link public.driver_auth_links%rowtype;
  assignment public.driver_assignments%rowtype;
begin
  if target_assignment is null or expected_notes is null or target_notes is null
    or char_length(target_notes)>5000 then
    raise exception 'Valid assignment and notes required' using errcode='22023';
  end if;
  -- Keep the order, identity and assignment lock order used by dispatch.
  select o.* into item from public.orders o
    join public.driver_assignments a on a.order_id=o.id
    where a.id=target_assignment for update of o;
  select * into link from public.driver_auth_links
    where user_id=(select auth.uid()) and status='active' for share;
  if not found or not exists(select 1 from public.driver_identity()) then
    raise exception 'Active driver identity required' using errcode='42501';
  end if;
  select * into assignment from public.driver_assignments
    where id=target_assignment and driver_id=link.driver_id and region_id=link.region_id for update;
  if not found or assignment.status='revoked' or item.id is null
    or item.region_id is distinct from link.region_id
    or not exists(select 1 from public.driver_orders(null,target_assignment)) then
    raise exception 'Assignment not available' using errcode='P0002';
  end if;
  if coalesce(item.notes,'')=target_notes then return target_notes; end if;
  if coalesce(item.notes,'') is distinct from expected_notes then
    raise exception 'Order notes changed' using errcode='40001';
  end if;
  update public.orders set notes=target_notes where id=item.id;
  return target_notes;
end;
$$;
revoke all on function public.update_driver_order_notes(uuid,text,text) from public,anon;
grant execute on function public.update_driver_order_notes(uuid,text,text) to authenticated;
commit;
