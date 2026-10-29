begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.driver_report_defaults(date)'::regprocedure);
 definition:=replace(definition,chr(13),'');
 if position('coalesce(nullif(v.plate,''''),day.plate,'''')' in definition)=0
 or position('coalesce(o.finance_by_date->target_date::text->>''vehiclePlate'',' in definition)=0 then
  raise exception 'Unexpected vehicle defaults baseline';
 end if;
 definition:=replace(definition,'coalesce(nullif(v.plate,''''),day.plate,'''')','coalesce(day.plate,'''')');
 definition:=regexp_replace(definition,
 $old$coalesce\(o.finance_by_date->target_date::text->>'vehicle',o.vehicle\) as vehicle,[[:space:]]*coalesce\(o.finance_by_date->target_date::text->>'vehiclePlate',[[:space:]]*to_jsonb\(o\)->>'vehicle_plate',to_jsonb\(o\)->>'plate'\) as plate$old$,
 $new$case when coalesce(o.finance_by_date->target_date::text->>'vehicle','')<>'' then
       o.finance_by_date->target_date::text->>'vehicle' else o.vehicle end as vehicle,
     case when coalesce(o.finance_by_date->target_date::text->>'vehicle','')<>'' then
       coalesce(o.finance_by_date->target_date::text->>'vehiclePlate','')
       else coalesce(to_jsonb(o)->>'vehicle_plate',to_jsonb(o)->>'plate','') end as plate$new$);
 if position('case when coalesce(o.finance_by_date' in definition)=0 then raise exception 'Vehicle selection replacement failed'; end if;
 definition:=replace(definition,'matched.name=day.vehicle','false');
 definition:=replace(definition,'other.name=day.vehicle','false');
 execute definition;
end;
$migration$;
commit;
