begin;

do $$
declare
  v_definition text;
  v_updated text;
  v_table text;
begin
  v_definition := pg_get_functiondef('public.record_business_audit()'::regprocedure);
  v_updated := regexp_replace(v_definition,
    $pattern$coalesce\(\s*nullif\(\s*full_name\s*,\s*''\s*\)\s*,\s*email\s*\)$pattern$,
    'coalesce(nullif(btrim(full_name), ''''), ''未填写姓名'')');
  if v_updated = v_definition then
    raise exception 'Unexpected audit function definition; name-only migration not applied';
  end if;
  execute v_updated;

  update public.audit_logs as log
  set actor_name = coalesce((
    select nullif(btrim(profile.full_name), '')
    from public.profiles as profile where profile.id = log.actor_id
  ), '未填写姓名')
  where position('@' in log.actor_name) > 0;

  foreach v_table in array array[
    'orders', 'drivers', 'vehicles', 'order_sources', 'companies',
    'vehicle_monthly_finances', 'balance_expense_items', 'invoice_numbers'
  ] loop
    execute format('alter table public.%I disable trigger business_operation_stamp', v_table);
    execute format('alter table public.%I disable trigger business_audit', v_table);
    execute format(
      'update public.%I as record
       set last_operation = jsonb_set(last_operation, ''{actorName}'',
         to_jsonb(coalesce((
           select nullif(btrim(profile.full_name), '''')
           from public.profiles as profile
           where profile.id::text = record.last_operation ->> ''actorId''
         ), ''未填写姓名'')::text))
       where position(''@'' in last_operation ->> ''actorName'') > 0',
      v_table
    );
    execute format('alter table public.%I enable trigger business_operation_stamp', v_table);
    execute format('alter table public.%I enable trigger business_audit', v_table);
  end loop;
end;
$$;

commit;
