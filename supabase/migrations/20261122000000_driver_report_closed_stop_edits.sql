begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

do $migration$
declare definition text; original text;
begin
 definition:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 original:=definition;
 if position('target_action not in (''edit_stop'',''edit_stops'')' in definition)=0
 or position('elsif target_action=''add_stop'' then' in definition)=0
 or position('perform public.validate_driver_report(r)' in definition)=0 then
  raise exception 'Unexpected report command lifecycle guard';
 end if;
 definition:=replace(definition,
  'target_action not in (''edit_stop'',''edit_stops'')',
  'target_action not in (''edit_stop'',''edit_stops'',''add_stop'',''remove_stop'')');
 definition:=replace(definition,
  'elsif target_action=''add_stop'' then',
  'elsif target_action=''add_stop'' then
   if r.returned_at is not null then perform set_config(''app.driver_report_force'',''true'',true); end if;');
 definition:=replace(definition,
  'elsif target_action=''remove_stop'' then',
  'elsif target_action=''remove_stop'' then
   if r.returned_at is not null then perform set_config(''app.driver_report_force'',''true'',true); end if;');
 if definition=original
 or position('target_action not in (''edit_stop'',''edit_stops'',''add_stop'',''remove_stop'')' in definition)=0
 or position('elsif target_action=''add_stop'' then
   if r.returned_at is not null then perform set_config(''app.driver_report_force'',''true'',true); end if;' in definition)=0
 or position('elsif target_action=''remove_stop'' then
   if r.returned_at is not null then perform set_config(''app.driver_report_force'',''true'',true); end if;' in definition)=0 then
  raise exception 'Could not enable stop edits on returned reports';
 end if;
 execute definition;
end;
$migration$;

commit;
