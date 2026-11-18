begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

alter table public.orders add column split_group_id uuid;
create index orders_split_group_idx on public.orders (split_group_id) where split_group_id is not null;

create or replace function public.merge_split_orders(
  target_order uuid, source_order uuid, target_version jsonb, source_version jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  first_order public.orders;
  second_order public.orders;
  part public.orders;
  actor_region uuid;
  day date;
  entry jsonb;
  merged_finance jsonb := '{}'::jsonb;
  defaults jsonb := '{"tripSummary":"","dailyFare":0,"etcCompanyReport":0,"etcTripReport":0,
    "fuelCost":0,"fuelConsumption":0,"driverAdvanceCompanyReport":0,"driverAdvanceTripReport":0,
    "companyAdvanceCompanyReport":0,"companyAdvanceTripReport":0,"driverOvertimeHours":0,
    "driverOvertimeRate":0,"driverOvertimeFee":0,"driverWageMode":"fixed",
    "driverWagePercentage":50,"driverWage":0,"driverBonusWage":0}'::jsonb;
  shared_fields text[] := array[
    'customer','phone','pickup','destination','time','status','notes','order_source','company',
    'sales_rep','accounting_status','invoice_status','invoice_sent_date','deposit_method',
    'deposit_date','accounting_assignee','finance_note','import_batch_id','import_batch_index'
  ];
  field text;
  total_price bigint;
begin
  if auth.uid() is null or target_order is null or source_order is null or target_order = source_order then
    raise exception 'Two distinct orders and staff authentication required' using errcode = '22023';
  end if;
  select region_id into actor_region from public.profiles where id = auth.uid() and account_type = 'staff';
  if not found then raise exception 'Staff required' using errcode = '42501'; end if;
  perform 1 from public.orders where id in (target_order, source_order) order by id for update;
  select * into first_order from public.orders where id = target_order;
  if not found then raise exception 'Target no longer exists' using errcode = 'P0002'; end if;
  select * into second_order from public.orders where id = source_order;
  if not found then raise exception 'Source no longer exists' using errcode = 'P0002'; end if;
  if first_order.region_id is distinct from second_order.region_id
    or (not public.is_admin() and first_order.region_id is distinct from actor_region) then
    raise exception 'Same-region access required' using errcode = '42501';
  end if;
  if first_order.split_group_id is null or first_order.split_group_id is distinct from second_order.split_group_id then
    raise exception 'Only segments split from the same original order can merge' using errcode = '22023';
  end if;
  if first_order.last_operation is distinct from target_version
    or second_order.last_operation is distinct from source_version then
    raise exception 'Orders changed since selection' using errcode = '40001';
  end if;
  foreach field in array shared_fields loop
    if (to_jsonb(first_order) -> field) is distinct from (to_jsonb(second_order) -> field) then
      raise exception 'Shared order details differ' using errcode = '22023';
    end if;
  end loop;
  if not (first_order.end_date + 1 = second_order.date or second_order.end_date + 1 = first_order.date)
    or greatest(first_order.end_date, second_order.end_date) - least(first_order.date, second_order.date) > 3659 then
    raise exception 'Non-overlapping adjacent ranges required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(first_order.finance_by_date) k
    where second_order.finance_by_date ? k
      or k between second_order.date::text and second_order.end_date::text
  ) or exists (
    select 1 from jsonb_object_keys(second_order.finance_by_date) k
    where k between first_order.date::text and first_order.end_date::text
  ) then raise exception 'Duplicate finance dates' using errcode = '22023'; end if;
  if exists (select 1 from public.invoice_numbers where order_id in (target_order, source_order)) then
    raise exception 'Issued invoice numbers must not be discarded' using errcode = '22023';
  end if;

  for part in select * from public.orders where id in (target_order, source_order) order by date loop
    merged_finance := merged_finance || part.finance_by_date;
    for day in select part.date + n from generate_series(0, part.end_date - part.date) n loop
      entry := coalesce(part.finance_by_date -> day::text, '{}'::jsonb);
      entry := defaults || entry || jsonb_build_object(
        'driver', coalesce(entry ->> 'driver', part.driver),
        'vehicle', coalesce(nullif(entry ->> 'vehicle', ''), part.vehicle),
        'vehiclePlate', case when nullif(entry ->> 'vehicle', '') is not null
          then coalesce(entry ->> 'vehiclePlate', '') else part.vehicle_plate end,
        'vehicleOverride', true
      );
      if day = part.date and part.order_price > 0 and not exists (
        select 1 from jsonb_each(part.finance_by_date) f where (f.value ->> 'dailyFare')::numeric > 0
      ) then entry := jsonb_set(entry, '{dailyFare}', to_jsonb(part.order_price)); end if;
      merged_finance := jsonb_set(merged_finance, array[day::text], entry);
    end loop;
  end loop;
  select coalesce(sum((value ->> 'dailyFare')::bigint), 0) into total_price from jsonb_each(merged_finance);
  if total_price > 99999999999999 then
    raise exception 'Merged fare exceeds limit' using errcode = '22023';
  end if;
  update public.driver_assignments set order_id = target_order where order_id = source_order;
  update public.driver_historical_finance_links set order_id = target_order where order_id = source_order;
  update public.orders set
    date = least(first_order.date, second_order.date),
    end_date = greatest(first_order.end_date, second_order.end_date),
    off_dates = array(select distinct d from unnest(first_order.off_dates || second_order.off_dates) d order by d),
    finance_by_date = merged_finance,
    order_price = total_price
  where id = target_order;
  delete from public.orders where id = source_order;
  return target_order;
end;
$$;
revoke all on function public.merge_split_orders(uuid,uuid,jsonb,jsonb) from public, anon;
grant execute on function public.merge_split_orders(uuid,uuid,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
