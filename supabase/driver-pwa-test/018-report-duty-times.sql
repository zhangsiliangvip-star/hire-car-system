-- Isolated test project only. Requires 017. Optional manual Japan-local clock times.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare d text;
begin
 d:=pg_get_functiondef('public.apply_driver_report_header(public.driver_daily_reports,jsonb,timestamptz)'::regprocedure);
 if position('dutyStartTime' in d)>0 then raise exception 'Duty times already installed'; end if;
 d:=replace(d, 'k<>all(array[''serviceDate'',''vehicleNumber'',''driverName'',''passengerCount''])',
  'k<>all(array[''serviceDate'',''vehicleNumber'',''driverName'',''passengerCount'',''dutyStartTime'',''dutyEndTime''])');
 d:=replace(d,'day:=(h->>''serviceDate'')::date;', $body$
 if exists(select 1 from jsonb_each(h) e where e.key in ('dutyStartTime','dutyEndTime')
  and (jsonb_typeof(e.value) not in ('string','null')
   or (jsonb_typeof(e.value)='string' and e.value#>>'{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))) then
  raise exception 'Invalid duty roll-call time' using errcode='22023';
 end if;
 day:=(h->>'serviceDate')::date;
 $body$);
 d:=replace(d,'r.header:=jsonb_build_object(', 'r.header:=jsonb_build_object(''dutyStartTime'',coalesce(h->''dutyStartTime'',r.header->''dutyStartTime'',''null''::jsonb),''dutyEndTime'',coalesce(h->''dutyEndTime'',r.header->''dutyEndTime'',''null''::jsonb),');
 if position('Invalid duty roll-call time' in d)=0
 or position('r.header:=jsonb_build_object(''dutyStartTime''' in d)=0
 or position('''passengerCount'',''dutyStartTime'',''dutyEndTime'']' in d)=0 then
  raise exception 'Unknown header implementation';
 end if;
 execute d;
end;
$migration$;
commit;
