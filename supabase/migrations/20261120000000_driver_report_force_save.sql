begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $migration$
declare definition text; original text; constraint_name text;
begin
 definition:=pg_get_functiondef('public.validate_driver_report(public.driver_daily_reports)'::regprocedure);
 if position('a<t or a>finish or n<k or n>9999999 or n<>round(n,1)' in definition)=0
 or position('b<t or b>finish or n<k or n>9999999 or n<>round(n,1)' in definition)=0
 or position('r.returned_at<t or r.return_km<k' in definition)=0
 or position('duty_start>r.departed_at' in definition)=0 then
  raise exception 'Unexpected report validator definition';
 end if;
 definition:=replace(definition,'duty_start timestamptz; duty_end timestamptz;',
  'duty_start timestamptz; duty_end timestamptz; force_order boolean:=coalesce(current_setting(''app.driver_report_force'',true),''false'')=''true'';');
 definition:=replace(definition,'if a<t or a>finish or n<k or n>9999999 or n<>round(n,1) then',
  'if (not force_order and (a<t or a>finish or n<k)) or n>9999999 or n<>round(n,1) then');
 definition:=replace(definition,'if b<t or b>finish or n<k or n>9999999 or n<>round(n,1) then',
  'if (not force_order and (b<t or b>finish or n<k)) or n>9999999 or n<>round(n,1) then');
 definition:=replace(definition,'(pending or r.returned_at<t or r.return_km<k)',
  '(pending or (not force_order and (r.returned_at<t or r.return_km<k)))');
 definition:=replace(definition,'if duty_start>r.departed_at then','if not force_order and duty_start>r.departed_at then');
 definition:=replace(definition,'if duty_end<r.departed_at then','if not force_order and duty_end<r.departed_at then');
 definition:=replace(definition,'if duty_end<r.returned_at then','if not force_order and duty_end<r.returned_at then');
 definition:=replace(definition,'if duty_start is not null and duty_end<duty_start then',
  'if not force_order and duty_start is not null and duty_end<duty_start then');
 if position('force_order boolean' in definition)=0
 or position('not force_order and (a<t or a>finish or n<k)' in definition)=0
 or position('not force_order and (b<t or b>finish or n<k)' in definition)=0
 or position('not force_order and (r.returned_at<t or r.return_km<k)' in definition)=0 then
  raise exception 'Could not configure forced report validation';
 end if;
 execute definition;

 definition:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 original:=definition;
 if position('when ''checkout'' then array[''useDefault'',''address'',''km'',''departedAt'',''header'']' in definition)=0
 or position('when ''edit_stops'' then array[''stops'',''departure'',''return'',''header'']' in definition)=0
 or position('cmd:=jsonb_build_object(''reportId'',target_report' in definition)=0 then
  raise exception 'Unexpected report command definition';
 end if;
 definition:=replace(definition,
  'when ''checkout'' then array[''useDefault'',''address'',''km'',''departedAt'',''header'']',
  'when ''checkout'' then array[''useDefault'',''address'',''km'',''departedAt'',''header'',''force'']');
 definition:=replace(definition,
  'when ''edit_stops'' then array[''stops'',''departure'',''return'',''header'']',
  'when ''edit_stops'' then array[''stops'',''departure'',''return'',''header'',''force'']');
 definition:=replace(definition,
  'array_remove(array_remove(allowed,''header''),''departedAt'')',
  'array_remove(array_remove(array_remove(allowed,''header''),''departedAt''),''force'')');
 definition:=replace(definition,
  'cmd:=jsonb_build_object(''reportId'',target_report',
  'if payload ? ''force'' and (target_action not in (''checkout'',''edit_stops'') or jsonb_typeof(payload->''force'') is distinct from ''boolean'') then raise exception ''Invalid force-save request'' using errcode=''22023''; end if;
 perform set_config(''app.driver_report_force'',case when payload->''force''=''true''::jsonb then ''true'' else ''false'' end,true);
 cmd:=jsonb_build_object(''reportId'',target_report');
 if definition=original
 or position('''force'']' in definition)=0
 or position('array_remove(array_remove(array_remove(allowed,''header''),''departedAt''),''force'')' in definition)=0
 or position('app.driver_report_force' in definition)=0
 or position('Invalid force-save request' in definition)=0 then
  raise exception 'Could not enable forced report saves';
 end if;
 execute definition;

 for constraint_name in
  select conname from pg_constraint
  where conrelid='public.driver_daily_reports'::regclass and contype='c'
   and lower(pg_get_constraintdef(oid)) like '%returned_at >= departed_at%'
   and lower(pg_get_constraintdef(oid)) like '%return_km >= departure_km%'
 loop
  execute format('alter table public.driver_daily_reports drop constraint %I',constraint_name);
 end loop;
 if exists(select 1 from pg_constraint where conrelid='public.driver_daily_reports'::regclass
   and contype='c' and lower(pg_get_constraintdef(oid)) like '%returned_at >= departed_at%') then
  raise exception 'Report sequence constraint was not removed';
 end if;
 alter table public.driver_daily_reports add constraint driver_daily_reports_return_shape_check
  check ((returned_at is null and return_address is null and return_km is null)
   or (returned_at is not null and length(btrim(return_address)) between 1 and 300
    and return_km is not null and return_km between 0 and 9999999 and return_km=round(return_km,1)));
end;
$migration$;

commit;
