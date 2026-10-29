-- Isolated test project only. Requires 007; preserve legacy rest history.
begin;
do $migration$
declare
 definition text;
 old_branch text;
 new_branch text := '
   select coalesce(jsonb_agg(case when value->>''endedAt'' is null
    then value||jsonb_build_object(''endedAt'',stamp) else value end order by ordinal),''[]''::jsonb)
    into r.rests from jsonb_array_elements(r.rests) with ordinality as entries(value,ordinal);';
begin
 definition := pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 if position(new_branch in definition)>0 then return; end if;
 old_branch := substring(definition from 'if target_action=''return'' then r\.returned_at:=stamp;\s*r\.return_address:=address;\s*r\.return_km:=km;');
 if old_branch is null then
  raise exception 'Unexpected report command definition: apply 007 first';
 end if;
 execute replace(definition,old_branch,old_branch||new_branch);
end;
$migration$;
commit;
