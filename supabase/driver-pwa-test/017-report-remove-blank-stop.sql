-- Isolated test project only. Requires 016. Delete only a fully empty stored row.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare d text;
begin
 d:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 if position('when ''remove_stop''' in d)>0
 or position('public.apply_driver_report_header' in d)=0
 or position('elsif target_action=''edit_stops'' then' in d)=0 then
  raise exception 'Unexpected report command: verify 016 first';
 end if;
 d:=replace(d,'when ''edit_stops'' then array[',
  'when ''remove_stop'' then array[''stopId''] when ''edit_stops'' then array[');
 d:=replace(d,'elsif target_action=''edit_stops'' then','
  elsif target_action=''remove_stop'' then
   if jsonb_typeof(payload->''stopId'') is distinct from ''string'' then
    raise exception ''Stop ID required'' using errcode=''22023'';
   end if;
   select ordinality::integer-1,value into idx,s from jsonb_array_elements(r.stops) with ordinality
    where (value->>''id'')::uuid=(payload->>''stopId'')::uuid;
   if idx is null then raise exception ''Stop not found'' using errcode=''P0002''; end if;
   if btrim(s->>''address'') is distinct from ''''
   or s->>''arrivedAt'' is not null or s->>''departedAt'' is not null
   or s->>''arrivedKm'' is not null or s->>''departedKm'' is not null
   or s->>''plannedKm'' is not null then
    raise exception ''Only empty stops can be removed'' using errcode=''22023'';
   end if;
   r.stops:=r.stops-idx;
  elsif target_action=''edit_stops'' then');
 if position('Only empty stops can be removed' in d)=0
 or position('when ''remove_stop'' then array[''stopId'']' in d)=0 then
  raise exception 'Could not wire blank stop removal';
 end if;
 execute d;
end;
$migration$;
commit;
