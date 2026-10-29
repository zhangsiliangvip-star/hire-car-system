drop trigger revoke_test_order_assignments on public.orders;
revoke all on function public.dispatch_test_driver_order(uuid,uuid,date) from authenticated;

create function public.service_driver_name(item public.orders, day date) returns text
language sql immutable set search_path='' as $$
  select case when item.finance_by_date->day::text->>'driverPaymentType'='company_advance'
    then coalesce(btrim(substring(item.finance_by_date->day::text->>'companyAdvancePaymentNote'
      from '(?m)^外注司机：([^\r\n]*)')),item.driver,'')
    else coalesce(item.finance_by_date->day::text->>'driver',item.driver,'') end;
$$;
revoke all on function public.service_driver_name(public.orders,date) from public,anon,authenticated;

create function public.sync_driver_order(target_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
  item public.orders;
  day date;
  target uuid;
  previous public.driver_assignments;
  today date := (now() at time zone 'Asia/Tokyo')::date;
  matches integer;
begin
  select * into item from public.orders where id=target_order for update;
  if not found then return; end if;
  if item.end_date-item.date>3659 then
    raise exception 'Driver synchronization supports at most 3660 service days' using errcode='22023';
  end if;
  for day in
    select (greatest(item.date,today)+n)::date
      from generate_series(0,item.end_date-greatest(item.date,today)) n
    union select service_date from public.driver_assignments
      where order_id=item.id and status<>'revoked'
    order by 1
  loop
    target:=null;
    if item.status<>'キャンセル' and day between item.date and item.end_date
      and not (day=any(item.off_dates)) then
      select count(*), (array_agg(d.id))[1] into matches,target
      from public.drivers d where d.region_id=item.region_id
        and d.name=public.service_driver_name(item,day) and d.name<>'';
      if matches<>1 or not exists(select 1 from public.driver_auth_links l
        join public.profiles p on p.id=l.user_id
        where l.driver_id=target and l.region_id=item.region_id and l.status='active'
          and p.account_type='driver' and p.role='user' and p.region_id=l.region_id) then
        target:=null;
      end if;
    end if;
    select * into previous from public.driver_assignments
      where order_id=item.id and service_date=day and status<>'revoked' for update;
    if found and previous.driver_id is not distinct from target
      and previous.region_id=item.region_id then continue; end if;
    if previous.id is not null then
      update public.driver_assignments set status='revoked',version=version+1,revoked_at=now()
        where id=previous.id;
      insert into public.driver_assignment_events(assignment_id,actor_user_id,event_type)
        values(previous.id,auth.uid(),'revoked');
    end if;
    if target is not null and day>=today then
      if auth.uid() is null then
        raise exception 'Authenticated staff actor required for dispatch' using errcode='42501';
      end if;
      insert into public.driver_assignments(order_id,driver_id,region_id,service_date,created_by)
        values(item.id,target,item.region_id,day,auth.uid());
    end if;
  end loop;
end;
$$;
revoke all on function public.sync_driver_order(uuid) from public,anon,authenticated;

create function public.sync_driver_order_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public.sync_driver_order(new.id);
  return new;
end;
$$;
revoke all on function public.sync_driver_order_change() from public,anon,authenticated;
create trigger sync_driver_order_after_change after insert or update on public.orders
  for each row execute function public.sync_driver_order_change();

create function public.sync_driver_identity_orders() returns trigger
language plpgsql security definer set search_path='' as $$
declare item record;
begin
  for item in select o.id from public.orders o
    where o.region_id=new.region_id
      and (o.end_date>=(now() at time zone 'Asia/Tokyo')::date
        or exists(select 1 from public.driver_assignments a
          where a.order_id=o.id and a.driver_id=new.driver_id and a.status<>'revoked'))
    order by o.id
  loop
    perform public.sync_driver_order(item.id);
  end loop;
  return new;
end;
$$;
revoke all on function public.sync_driver_identity_orders() from public,anon,authenticated;
create trigger sync_driver_identity_orders after insert or update of status on public.driver_auth_links
  for each row execute function public.sync_driver_identity_orders();

create function public.retain_driver_order_history() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.driver_assignments where order_id=old.id) then
    raise exception '订单已关联司机派单或执行历史，不能永久删除；请改为取消订单。' using errcode='PDR01';
  end if;
  return old;
end;
$$;
revoke all on function public.retain_driver_order_history() from public,anon,authenticated;
create trigger retain_driver_order_history before delete on public.orders
  for each row execute function public.retain_driver_order_history();

create function public.sync_driver_name_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare item record;
begin
  if new.name is not distinct from old.name and new.region_id is not distinct from old.region_id then
    return new;
  end if;
  for item in select o.id from public.orders o
    where o.region_id in (old.region_id,new.region_id)
      and (o.end_date>=(now() at time zone 'Asia/Tokyo')::date
        or exists(select 1 from public.driver_assignments a
          where a.order_id=o.id and a.driver_id=new.id and a.status<>'revoked'))
    order by o.id
  loop
    perform public.sync_driver_order(item.id);
  end loop;
  return new;
end;
$$;
revoke all on function public.sync_driver_name_change() from public,anon,authenticated;
create trigger sync_driver_name_change after update of name,region_id on public.drivers
  for each row execute function public.sync_driver_name_change();

create or replace function public.handle_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if nullif(new.raw_user_meta_data->>'region_id','') is null then
    insert into public.profiles(id,email,full_name,company,position,email_confirmed)
    values(new.id,lower(new.email),coalesce(new.raw_user_meta_data->>'full_name',''),
      coalesce(new.raw_user_meta_data->>'company',''),coalesce(new.raw_user_meta_data->>'position',''),
      new.email_confirmed_at is not null)
    on conflict(id) do update set email=excluded.email,email_confirmed=excluded.email_confirmed;
  else
    insert into public.profiles(id,email,full_name,company,position,region_id,email_confirmed)
    values(new.id,lower(new.email),coalesce(new.raw_user_meta_data->>'full_name',''),
      coalesce(new.raw_user_meta_data->>'company',''),coalesce(new.raw_user_meta_data->>'position',''),
      (new.raw_user_meta_data->>'region_id')::uuid,new.email_confirmed_at is not null)
    on conflict(id) do update set email=excluded.email,email_confirmed=excluded.email_confirmed;
  end if;
  return new;
end;
$$;

create or replace function public.current_region_id() returns uuid
language sql stable security definer set search_path='' as $$
  select region_id from public.profiles where id=auth.uid() and account_type='staff';
$$;

do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.allocate_invoice_number(uuid,uuid)'::regprocedure);
  if position('v_order.region_id = public.current_region_id()' in definition)=0 then
    raise exception 'Unexpected invoice authorization implementation';
  end if;
  definition:=replace(definition,'v_order.region_id = public.current_region_id()',
    '(public.is_staff() and v_order.region_id = public.current_region_id())');
  execute definition;
end;
$$;

do $$
begin
  if exists (
    select 1 from driver_production_before b
    full join (
      select 'profiles'::text as table_name,id,to_jsonb(p)-'account_type' as current_data from public.profiles p
      union all select 'orders',id,to_jsonb(o) from public.orders o
      union all select 'drivers',id,to_jsonb(d) from public.drivers d
      union all select 'driver_wage_items',id,to_jsonb(w) from public.driver_wage_items w
    ) current_rows using(table_name,id)
    where b.original is distinct from current_rows.current_data
  ) then raise exception 'Existing business data changed during migration'; end if;
  if exists(select 1 from public.driver_auth_links)
    or exists(select 1 from public.driver_assignments) then
    raise exception 'Initial migration must not introduce driver accounts or dispatch fixtures';
  end if;
end;
$$;
