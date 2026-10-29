begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $migration$
declare definition text; original text;
begin
 definition:=pg_get_functiondef('public.validate_driver_report(public.driver_daily_reports)'::regprocedure);
 if position('finish timestamptz:=coalesce(r.returned_at,clock_timestamp());' in definition)=0 then
  raise exception 'Unexpected report validation baseline';
 end if;
 definition:=replace(definition,'finish timestamptz:=coalesce(r.returned_at,clock_timestamp());',
  'finish timestamptz:=coalesce(r.returned_at,''infinity''::timestamptz); duty_start timestamptz; duty_end timestamptz;');
 definition:=replace(definition,'begin', $body$
begin
 duty_start:=((r.header->>'dutyStartDate')::date+(r.header->>'dutyStartTime')::time) at time zone 'Asia/Tokyo';
 duty_end:=((r.header->>'dutyEndDate')::date+(r.header->>'dutyEndTime')::time) at time zone 'Asia/Tokyo';
 if duty_start>r.departed_at then
  raise exception '出勤点呼时间不能晚于出库时间，请检查日期和时间。' using errcode='PDT01';
 end if;
 if duty_end<r.departed_at then
  raise exception '退勤点呼时间不能早于出库时间，请检查日期和时间。' using errcode='PDT02';
 end if;
 if duty_end<r.returned_at then
  raise exception '退勤点呼时间不能早于归库时间，请检查日期和时间。' using errcode='PDT03';
 end if;
 if duty_start is not null and duty_end<duty_start then
  raise exception '退勤点呼时间不能早于出勤点呼时间。' using errcode='PDT04';
 end if;
 finish:=coalesce(r.returned_at,duty_end,'infinity'::timestamptz);
 $body$);
 execute definition;

 definition:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 original:=definition;
 if position('or (s->>''departedAt'')::timestamptz>stamp' in definition)=0
 or position('or (s->>''returnedAt'')::timestamptz>stamp' in definition)=0 then
  raise exception 'Unexpected manual report future checks';
 end if;
 definition:=replace(definition,'or (s->>''departedAt'')::timestamptz>stamp','');
 definition:=replace(definition,'or (s->>''returnedAt'')::timestamptz>stamp','');
 if definition=original then raise exception 'Expected manual report future checks'; end if;
 execute definition;

 definition:=pg_get_functiondef('public.apply_driver_report_header(public.driver_daily_reports,jsonb,timestamptz)'::regprocedure);
 if position('if r.departed_at>stamp or r.returned_at>stamp then' in definition)=0 then
  raise exception 'Expected header date validation';
 end if;
 definition:=replace(definition,
  'if r.departed_at>stamp or r.returned_at>stamp then raise exception ''Report date is in future'' using errcode=''22023''; end if;',
  '');
 execute definition;

 definition:=pg_get_functiondef('public.staff_operation_report_command(jsonb)'::regprocedure);
 if position('r.departed_at>stamp or r.returned_at>stamp or ' in definition)=0 then
  raise exception 'Expected staff report future checks';
 end if;
 definition:=replace(definition,'r.departed_at>stamp or r.returned_at>stamp or ','');
 execute definition;
end;
$migration$;
commit;
