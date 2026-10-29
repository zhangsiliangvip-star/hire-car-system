-- Isolated test project only. Requires 014. Atomic manual return and table corrections.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare d text;
begin
 d:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 if position('Invalid departure correction' in d)=0 or position('Invalid manual return' in d)>0 then
  raise exception 'Unexpected command definition: verify 014 first';
 end if;
 d:=replace(d,'when ''edit_stops'' then array[''stops'',''departure'']',
  'when ''edit_stops'' then array[''stops'',''departure'',''return'']');
 d:=replace(d,'perform public.validate_driver_report(r);','
  if target_action=''edit_stops'' and payload ? ''return'' then
   s:=payload->''return'';
   if jsonb_typeof(s) is distinct from ''object''
   or not(s ?& array[''address'',''km'',''returnedAt''])
   or exists(select 1 from jsonb_object_keys(s) f where f<>all(array[''address'',''km'',''returnedAt'']))
   or jsonb_typeof(s->''address'') is distinct from ''string''
   or length(btrim(s->>''address'')) not between 1 and 300
   or jsonb_typeof(s->''km'') is distinct from ''number''
   or jsonb_typeof(s->''returnedAt'') is distinct from ''string''
   or s->>''returnedAt'' !~ ''(Z|[+-][0-9]{2}:[0-9]{2})$'' then
    raise exception ''Invalid manual return'' using errcode=''22023'';
   end if;
   km:=(s->>''km'')::numeric;
   if km<0 or km>9999999 or km<>round(km,1)
   or (s->>''returnedAt'')::timestamptz>stamp then
    raise exception ''Invalid manual return reading or time'' using errcode=''22023'';
   end if;
   r.return_address:=btrim(s->>''address''); r.return_km:=km;
   r.returned_at:=(s->>''returnedAt'')::timestamptz;
   select coalesce(jsonb_agg(case when value->>''endedAt'' is null then
    value||jsonb_build_object(''endedAt'',r.returned_at) else value end order by ordinality),''[]''::jsonb)
    into r.rests from jsonb_array_elements(r.rests) with ordinality;
  end if;
  perform public.validate_driver_report(r);');
 if position('Invalid manual return' in d)=0 or position('''departure'',''return'']' in d)=0 then
  raise exception 'Could not add manual return';
 end if;
 execute d;
end;
$migration$;
commit;
