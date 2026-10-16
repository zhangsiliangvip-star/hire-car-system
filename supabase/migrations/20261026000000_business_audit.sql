begin;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_name text not null,
  region_id uuid,
  table_name text not null,
  record_id uuid not null,
  record_label text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before_data jsonb,
  after_data jsonb
);

create index audit_logs_time_idx on public.audit_logs (occurred_at desc, id desc);
create index audit_logs_region_time_idx on public.audit_logs (region_id, occurred_at desc, id desc);
create index audit_logs_actor_time_idx on public.audit_logs (actor_id, occurred_at desc, id desc);
create index audit_logs_record_time_idx on public.audit_logs (table_name, record_id, occurred_at desc);

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from public, anon, authenticated;
grant select on public.audit_logs to authenticated;
create policy "Only administrators can read audit history"
  on public.audit_logs for select to authenticated
  using ((select public.is_admin()));

create function public.audit_business_snapshot(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_data ? 'seal_image'
    then (p_data - 'last_operation' - 'created_at' - 'seal_image') ||
      jsonb_build_object('seal_image', case when coalesce(p_data ->> 'seal_image', '') = ''
        then '' else '[PNG:' || md5(p_data ->> 'seal_image') || ']' end)
    else p_data - 'last_operation' - 'created_at'
  end;
$$;

create function public.record_business_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_record jsonb;
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_time timestamptz := clock_timestamp();
  v_region uuid;
  v_label text;
begin
  if tg_op <> 'INSERT' then
    v_before := public.audit_business_snapshot(to_jsonb(old));
  end if;
  if tg_op <> 'DELETE' then
    v_after := public.audit_business_snapshot(to_jsonb(new));
  end if;
  if tg_op = 'UPDATE' and v_before = v_after then
    new.last_operation := old.last_operation;
    return new;
  end if;

  select coalesce(nullif(full_name, ''), email) into v_actor_name
    from public.profiles where id = v_actor;
  v_actor_name := coalesce(v_actor_name, '系统/数据库操作');
  if tg_when = 'BEFORE' then
    new.last_operation := jsonb_build_object(
      'actorId', v_actor, 'actorName', v_actor_name, 'at', v_time
    );
    return new;
  end if;
  if tg_op <> 'DELETE' then
    v_time := (new.last_operation ->> 'at')::timestamptz;
  end if;
  v_record := coalesce(v_after, v_before);
  v_region := (v_record ->> 'region_id')::uuid;
  if tg_table_name = 'invoice_numbers' then
    select region_id into v_region from public.companies
      where id = (v_record ->> 'company_id')::uuid;
    v_label := 'INV-' || lpad(v_record ->> 'serial_number',
      greatest(6, length(v_record ->> 'serial_number')), '0');
  else
    v_label := coalesce(nullif(v_record ->> 'customer', ''),
      nullif(v_record ->> 'name', ''), nullif(v_record ->> 'company_name', ''),
      v_record ->> 'vehicle_id', v_record ->> 'id');
  end if;

  insert into public.audit_logs (
    occurred_at, actor_id, actor_name, region_id, table_name, record_id,
    record_label, action, before_data, after_data
  ) values (
    v_time, v_actor, v_actor_name, v_region, tg_table_name,
    coalesce(v_record ->> 'id', v_record ->> 'order_id')::uuid,
    v_label, tg_op, v_before, v_after
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'orders', 'drivers', 'vehicles', 'order_sources', 'companies',
    'vehicle_monthly_finances', 'balance_expense_items', 'invoice_numbers'
  ] loop
    execute format('alter table public.%I add column last_operation jsonb', v_table);
    execute format(
      'create trigger business_operation_stamp before insert or update on public.%I
       for each row execute function public.record_business_audit()', v_table
    );
    execute format(
      'create trigger business_audit after insert or update or delete on public.%I
       for each row execute function public.record_business_audit()', v_table
    );
  end loop;
end;
$$;

revoke all on function public.audit_business_snapshot(jsonb) from public, anon, authenticated;
revoke all on function public.record_business_audit() from public, anon, authenticated;

commit;
