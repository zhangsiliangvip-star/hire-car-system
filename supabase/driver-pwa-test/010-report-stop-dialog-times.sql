-- Isolated test project only. Requires 009. Add a stop and optional manual times atomically.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare d text; original text;
 old_fields text := 'when ''add_stop'' then array[''address'',''km'']';
 old_required text := 'when target_action=''add_stop'' then array_remove(allowed,''km'')';
 old_stop text := '''arrivedAt'',null,''arrivedKm'',null,''departedAt'',null,''departedKm'',null,''plannedKm'',payload->''km''';
begin
 d:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 if position(old_fields in d)=0 or position(old_required in d)=0 or position(old_stop in d)=0 then
  raise exception 'Unexpected report command definition: verify 009 before applying 010';
 end if;
 original:=d;
 d:=replace(d,old_fields,'when ''add_stop'' then array[''address'',''km'',''arrivedAt'',''departedAt'']');
 d:=replace(d,old_required,'when target_action=''add_stop'' then array[''address'']');
 d:=replace(d,old_stop,'
    ''arrivedAt'',payload->''arrivedAt'',
    ''arrivedKm'',case when payload->>''arrivedAt'' is not null then payload->''km'' else ''null''::jsonb end,
    ''departedAt'',payload->''departedAt'',
    ''departedKm'',case when payload->>''departedAt'' is not null then payload->''km'' else ''null''::jsonb end,
    ''plannedKm'',payload->''km''');
 d:=replace(d,'elsif target_action=''add_stop'' then','
  elsif target_action=''add_stop'' then
   if (payload ? ''arrivedAt'' and jsonb_typeof(payload->''arrivedAt'') not in (''null'',''string''))
   or (payload ? ''departedAt'' and jsonb_typeof(payload->''departedAt'') not in (''null'',''string''))
   or ((payload->>''arrivedAt'' is not null or payload->>''departedAt'' is not null) and not(payload ? ''km'')) then
    raise exception ''Invalid new stop times'' using errcode=''22023'';
   end if;
   if (payload->>''arrivedAt'' is not null and payload->>''arrivedAt'' !~ ''(Z|[+-][0-9]{2}:[0-9]{2})$'')
   or (payload->>''departedAt'' is not null and payload->>''departedAt'' !~ ''(Z|[+-][0-9]{2}:[0-9]{2})$'') then
    raise exception ''Time offset required'' using errcode=''22023'';
   end if;');
 if d=original or position('Invalid new stop times' in d)=0 then raise exception 'Could not update stop command'; end if;
 execute d;
end;
$migration$;
commit;
