begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

drop trigger if exists retain_driver_order_history on public.orders;
drop function if exists public.retain_driver_order_history();

create function public.delete_orders_with_related_data(target_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_region uuid;
  order_ids uuid[];
  assignment_ids uuid[];
  historical_link_ids uuid[];
  report_ids uuid[];
  receipt_paths jsonb;
begin
  if auth.uid() is null or target_order_ids is null or cardinality(target_order_ids) = 0 then
    raise exception 'Authenticated user and order IDs required' using errcode = '22023';
  end if;

  select array_agg(distinct target_order_id order by target_order_id)
    into order_ids
    from unnest(target_order_ids) as requested(target_order_id);
  if cardinality(order_ids) <> cardinality(target_order_ids) then
    raise exception 'Duplicate order IDs are not allowed' using errcode = '22023';
  end if;

  select region_id into actor_region from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Staff profile required' using errcode = '42501';
  end if;
  if not public.is_admin() and exists (
    select 1 from public.orders
    where id = any(order_ids) and region_id is distinct from actor_region
  ) then
    raise exception 'Order deletion denied for another region' using errcode = '42501';
  end if;

  perform 1 from public.orders where id = any(order_ids) order by id for update;
  if (select count(*) from public.orders where id = any(order_ids)) <> cardinality(order_ids) then
    raise exception 'One or more orders no longer exist' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into assignment_ids
    from public.driver_assignments where order_id = any(order_ids);
  select coalesce(array_agg(id), '{}'::uuid[]) into historical_link_ids
    from public.driver_historical_finance_links where order_id = any(order_ids);
  select coalesce(array_agg(id), '{}'::uuid[]) into report_ids
    from public.driver_daily_reports
    where header ->> 'assignmentId' = any(
      select assignment_id::text from unnest(assignment_ids) as linked(assignment_id)
    );

  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'path', path)), '[]'::jsonb)
    into receipt_paths
    from (
      select distinct 'driver-finance-receipts'::text as bucket, receipt.path
      from public.driver_finance_claims claim
      cross join lateral jsonb_array_elements(coalesce(claim.expenses, '[]'::jsonb)) expense(item)
      cross join lateral jsonb_array_elements_text(
        coalesce(expense.item -> 'receipts', '[]'::jsonb)
      ) receipt(path)
      where claim.assignment_id = any(assignment_ids)
        or claim.historical_link_id = any(historical_link_ids)
      union
      select distinct 'driver-fuel-receipts'::text as bucket, receipt.path
      from public.driver_daily_fuel fuel
      cross join lateral jsonb_array_elements_text(coalesce(fuel.receipts, '[]'::jsonb)) receipt(path)
      where fuel.assignment_id = any(assignment_ids)
    ) linked_receipts;

  delete from public.driver_report_events where report_id = any(report_ids);
  delete from public.driver_daily_reports where id = any(report_ids);
  delete from public.driver_daily_fuel_events
    where fuel_id in (select id from public.driver_daily_fuel where assignment_id = any(assignment_ids));
  delete from public.driver_daily_fuel where assignment_id = any(assignment_ids);
  delete from public.driver_finance_events
    where assignment_id = any(assignment_ids) or historical_link_id = any(historical_link_ids);
  delete from public.driver_finance_claims
    where assignment_id = any(assignment_ids) or historical_link_id = any(historical_link_ids);
  delete from public.driver_assignment_events where assignment_id = any(assignment_ids);
  delete from public.driver_assignments where id = any(assignment_ids);
  delete from public.driver_historical_finance_links where id = any(historical_link_ids);
  delete from public.orders where id = any(order_ids);

  return receipt_paths;
end;
$$;

revoke all on function public.delete_orders_with_related_data(uuid[]) from public, anon;
grant execute on function public.delete_orders_with_related_data(uuid[]) to authenticated;

commit;
