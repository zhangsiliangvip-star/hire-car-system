do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 if position('''departedAt'',''header''' in definition)=0
 or position('array_remove(array_remove(allowed,''header''),''departedAt'')' in definition)=0
 or position('coalesce((payload->>''departedAt'')::timestamptz,stamp),address,km' in definition)=0 then
  raise exception 'Manual departure time is not persisted by checkout';
 end if;
end;
$$;
