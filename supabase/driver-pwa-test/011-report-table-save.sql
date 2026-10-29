-- Isolated test project only. Requires 010. Save all stop edits in one transaction/version.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare d text;
begin
 d:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 if position('when ''edit_stops''' in d)>0 or position('Invalid new stop times' in d)=0 then
  raise exception 'Unexpected report command definition: verify 010 first';
 end if;
 d:=replace(d,'when ''edit_stop'' then array[','when ''edit_stops'' then array[''stops''] when ''edit_stop'' then array[');
 d:=replace(d,'target_action<>''edit_stop''','target_action not in (''edit_stop'',''edit_stops'')');
 d:=replace(d,'elsif target_action=''add_stop'' then','
  elsif target_action=''edit_stops'' then
   if jsonb_typeof(payload->''stops'') is distinct from ''array''
   or jsonb_array_length(payload->''stops'')<>jsonb_array_length(r.stops)
   or jsonb_array_length(payload->''stops'')>100 then
    raise exception ''Stop list changed'' using errcode=''22023'';
   end if;
   for idx in 0..jsonb_array_length(r.stops)-1 loop
    s:=payload->''stops''->idx;
    if jsonb_typeof(s) is distinct from ''object''
    or s->>''id'' is distinct from r.stops->idx->>''id''
    or not(s ?& array[''id'',''address'',''arrivedAt'',''arrivedKm'',''departedAt'',''departedKm''])
    or exists(select 1 from jsonb_object_keys(s) field where field<>all(array[
      ''id'',''address'',''arrivedAt'',''arrivedKm'',''departedAt'',''departedKm'',''plannedKm'']))
    or jsonb_typeof(s->''address'') is distinct from ''string''
    or jsonb_typeof(s->''arrivedAt'') not in (''null'',''string'')
    or jsonb_typeof(s->''departedAt'') not in (''null'',''string'')
    or jsonb_typeof(s->''arrivedKm'') not in (''null'',''number'')
    or jsonb_typeof(s->''departedKm'') not in (''null'',''number'')
    or (s->>''arrivedAt'' is not null and s->>''arrivedAt'' !~ ''(Z|[+-][0-9]{2}:[0-9]{2})$'')
    or (s->>''departedAt'' is not null and s->>''departedAt'' !~ ''(Z|[+-][0-9]{2}:[0-9]{2})$'') then
     raise exception ''Invalid stop list'' using errcode=''22023'';
    end if;
    s:=s||jsonb_build_object(''plannedKm'',case when s ? ''plannedKm''
      then s->''plannedKm'' else r.stops->idx->''plannedKm'' end);
    r.stops:=jsonb_set(r.stops,array[idx::text],s);
   end loop;
  elsif target_action=''add_stop'' then');
 if position('Invalid stop list' in d)=0 then raise exception 'Could not add table save'; end if;
 execute d;
end;
$migration$;
commit;
