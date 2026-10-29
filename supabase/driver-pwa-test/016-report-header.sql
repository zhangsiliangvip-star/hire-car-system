-- Isolated test project only. Requires 015. Manual header/date, never changes driver ownership.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
alter table public.driver_daily_reports add column header jsonb not null
 default '{"vehicleNumber":"","driverName":"","passengerCount":null}'::jsonb;
create function public.apply_driver_report_header(r public.driver_daily_reports, h jsonb, stamp timestamptz)
returns public.driver_daily_reports language plpgsql set search_path='' as $fn$
declare day date; delta interval; n numeric;
begin
 if jsonb_typeof(h) is distinct from 'object'
 or not(h ?& array['serviceDate','vehicleNumber','driverName','passengerCount'])
 or exists(select 1 from jsonb_object_keys(h) k where k<>all(array['serviceDate','vehicleNumber','driverName','passengerCount']))
 or jsonb_typeof(h->'serviceDate') is distinct from 'string' or h->>'serviceDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or jsonb_typeof(h->'vehicleNumber') is distinct from 'string' or length(h->>'vehicleNumber')>100
 or jsonb_typeof(h->'driverName') is distinct from 'string' or length(h->>'driverName')>100
 or jsonb_typeof(h->'passengerCount') not in ('null','number') then
  raise exception 'Invalid report header' using errcode='22023';
 end if;
 day:=(h->>'serviceDate')::date;
 if day<date '0001-01-01' or day>date '9999-12-31' then raise exception 'Invalid report date' using errcode='22023'; end if;
 n:=(h->>'passengerCount')::numeric;
 if n is not null and (n<0 or n>999 or n<>trunc(n)) then raise exception 'Invalid passenger count' using errcode='22023'; end if;
 delta:=make_interval(secs=>(day-r.service_date)*86400.0);
 r.departed_at:=r.departed_at+delta; r.returned_at:=r.returned_at+delta;
 select coalesce(jsonb_agg(jsonb_build_object('startedAt',(value->>'startedAt')::timestamptz+delta,
  'endedAt',(value->>'endedAt')::timestamptz+delta) order by ordinality),'[]'::jsonb)
 into r.rests from jsonb_array_elements(r.rests) with ordinality;
 if r.departed_at>stamp or r.returned_at>stamp then raise exception 'Report date is in future' using errcode='22023'; end if;
 r.service_date:=day;
 r.header:=jsonb_build_object('vehicleNumber',btrim(h->>'vehicleNumber'),'driverName',btrim(h->>'driverName'),'passengerCount',n);
 return r;
end;
$fn$;
revoke all on function public.apply_driver_report_header(public.driver_daily_reports,jsonb,timestamptz) from public,anon,authenticated;
do $migration$
declare d text;
begin
 d:=pg_get_functiondef('public.driver_report_projection(public.driver_daily_reports)'::regprocedure);
 d:=replace(d,'''serviceDate'',r.service_date,','''serviceDate'',r.service_date,''header'',r.header,');
 if position('''header'',r.header' in d)=0 then raise exception 'Unknown report projection'; end if;
 execute d;
 d:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 if position('Invalid manual return' in d)=0 then raise exception 'Verify 015 first'; end if;
 d:=replace(d,'when ''checkout'' then array[''useDefault'',''address'',''km'']',
  'when ''checkout'' then array[''useDefault'',''address'',''km'',''header'']');
 d:=replace(d,'when ''edit_stops'' then array[''stops'',''departure'',''return'']',
  'when ''edit_stops'' then array[''stops'',''departure'',''return'',''header'']');
 d:=replace(d,'payload ?& (case when','payload ?& (case when target_action=''checkout'' then array_remove(allowed,''header'') when');
 d:=replace(d,'if target_action=''return'' then r.returned_at:=stamp;',
  'if target_action=''edit_stops'' and payload ? ''header'' then
    r:=public.apply_driver_report_header(r,payload->''header'',stamp);
   end if;
   if target_action=''return'' then r.returned_at:=stamp;');
 d:=replace(d,'(select auth.uid())) returning * into r;',
  '(select auth.uid())) returning * into r;
   if payload ? ''header'' then
    r:=public.apply_driver_report_header(r,payload->''header'',stamp);
    perform public.validate_driver_report(r);
    update public.driver_daily_reports set header=r.header,service_date=r.service_date,departed_at=r.departed_at where id=r.id returning * into r;
   end if;');
 d:=replace(d,'set departed_at=r.departed_at,','set header=r.header,service_date=r.service_date,departed_at=r.departed_at,');
 if position('r:=public.apply_driver_report_header' in d)=0
 or position('set header=r.header,service_date=r.service_date,departed_at=r.departed_at,departure_address' in d)=0
 or position('array_remove(allowed,''header'')' in d)=0 then raise exception 'Could not wire report header'; end if;
 execute d;
end;
$migration$;
commit;
