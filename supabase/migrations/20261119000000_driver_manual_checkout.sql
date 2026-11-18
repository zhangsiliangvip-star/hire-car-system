begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $migration$
declare definition text; original text;
begin
 definition:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 original:=definition;
 if position('when ''checkout'' then array[''useDefault'',''address'',''km'',''header'']' in definition)=0
 or position('payload ?& (case when target_action=''checkout'' then array_remove(allowed,''header'') when' in definition)=0
 or position('values(link.driver_id,link.region_id,(stamp at time zone ''Asia/Tokyo'')::date,stamp,address,km,(select auth.uid()),(select auth.uid()))' in definition)=0 then
  raise exception 'Unexpected manual checkout function definition';
 end if;
 definition:=replace(definition,
  'when ''checkout'' then array[''useDefault'',''address'',''km'',''header'']',
  'when ''checkout'' then array[''useDefault'',''address'',''km'',''departedAt'',''header'']');
 definition:=replace(definition,
  'payload ?& (case when target_action=''checkout'' then array_remove(allowed,''header'') when',
  'payload ?& (case when target_action=''checkout'' then array_remove(array_remove(allowed,''header''),''departedAt'') when');
 definition:=replace(definition,
  'values(link.driver_id,link.region_id,(stamp at time zone ''Asia/Tokyo'')::date,stamp,address,km,(select auth.uid()),(select auth.uid()))',
  'values(link.driver_id,link.region_id,(stamp at time zone ''Asia/Tokyo'')::date,coalesce((payload->>''departedAt'')::timestamptz,stamp),address,km,(select auth.uid()),(select auth.uid()))');
 if definition=original
 or position('''departedAt'',''header''' in definition)=0
 or position('array_remove(array_remove(allowed,''header''),''departedAt'')' in definition)=0
 or position('coalesce((payload->>''departedAt'')::timestamptz,stamp),address,km' in definition)=0 then
  raise exception 'Could not configure manual checkout time';
 end if;
 execute definition;
end;
$migration$;

commit;
