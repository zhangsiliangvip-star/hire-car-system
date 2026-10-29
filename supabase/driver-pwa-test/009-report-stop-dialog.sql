-- Isolated test project only. Requires 008. Keep odometer drafts without clocking arrival.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare d text; original text;
begin
 d:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 if position('plannedKm' in d)>0 then raise exception '009 already applied; verify rather than overwrite'; end if;
 original:=d;
 d:=replace(d,'when ''add_stop'' then array[''address'']','when ''add_stop'' then array[''address'',''km'']');
 d:=replace(d,'array[''id'',''address'',''arrivedAt'',''arrivedKm'',''departedAt'',''departedKm'']',
  'array[''id'',''address'',''arrivedAt'',''arrivedKm'',''departedAt'',''departedKm'',''plannedKm'']');
 d:=replace(d,'payload ?& allowed','payload ?& (case when target_action=''add_stop'' then array_remove(allowed,''km'') when target_action=''edit_stop'' then array_remove(allowed,''plannedKm'') else allowed end)');
 d:=replace(d,'if target_action in (''checkout'',''return'',''arrive'',''depart'') then',
  'if target_action in (''checkout'',''return'',''arrive'',''depart'') or (target_action=''add_stop'' and payload ? ''km'') then');
 d:=regexp_replace(d,'''arrivedAt'',null,\s*''arrivedKm'',null,\s*''departedAt'',null,\s*''departedKm'',null',
  '''arrivedAt'',null,''arrivedKm'',null,''departedAt'',null,''departedKm'',null,''plannedKm'',payload->''km''');
 d:=regexp_replace(d,'s:=payload;', 's:=payload||jsonb_build_object(''plannedKm'',case when payload ? ''plannedKm'' then payload->''plannedKm'' else s->''plannedKm'' end);');
 if d=original or position('''plannedKm'',payload->''km''' in d)=0
 or position('array_remove(allowed,''plannedKm'')' in d)=0
 or position('''plannedKm'',case when payload' in d)=0 then
  raise exception 'Unexpected command definition; verify 008 first';
 end if;
 execute d;
 d:=pg_get_functiondef('public.validate_driver_report(public.driver_daily_reports)'::regprocedure);
 if position('Invalid draft odometer' in d)>0 then raise exception 'Draft validation already applied'; end if;
 original:=d;
 d:=replace(d,'a:=(s->>''arrivedAt'')::timestamptz;','
  if s->>''plannedKm'' is not null then
   if jsonb_typeof(s->''plannedKm'')<>''number'' then raise exception ''Invalid draft odometer'' using errcode=''22023''; end if;
   n:=(s->>''plannedKm'')::numeric;
   if n<k or n>9999999 or n<>round(n,1) then raise exception ''Invalid draft odometer'' using errcode=''22023''; end if;
  end if;
  a:=(s->>''arrivedAt'')::timestamptz;');
 if d=original then raise exception 'Unexpected validation definition'; end if;
 execute d;
end;
$migration$;
commit;
