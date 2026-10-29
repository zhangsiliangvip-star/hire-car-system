-- Isolated test project only. No persisted data or identity changes.
begin;
do $test$
declare r public.driver_daily_reports; updated public.driver_daily_reports; h jsonb; bad jsonb;
begin
 r.service_date:=(clock_timestamp() at time zone 'Asia/Tokyo')::date-2;
 r.departed_at:=r.service_date::timestamp at time zone 'Asia/Tokyo';
 r.rests:='[]'; r.header:='{}';
 h:=jsonb_build_object('serviceDate',r.service_date,'vehicleNumber','TEST','driverName','Manual',
  'passengerCount',null,'dutyStartTime','23:30','dutyEndTime','02:15');
 updated:=public.apply_driver_report_header(r,h,clock_timestamp());
 if updated.header->>'dutyStartTime'<>'23:30' or updated.header->>'dutyEndTime'<>'02:15'
 or updated.departed_at<>r.departed_at then raise exception 'Duty times not independent'; end if;
 r:=updated;
 updated:=public.apply_driver_report_header(r,h-'dutyStartTime'-'dutyEndTime',clock_timestamp());
 if updated.header<>r.header then raise exception 'Legacy save erased duty times'; end if;
 updated:=public.apply_driver_report_header(r,h||'{"dutyStartTime":null,"dutyEndTime":null}',clock_timestamp());
 if updated.header->>'dutyStartTime' is not null or updated.header->>'dutyEndTime' is not null then
  raise exception 'Duty time clearing failed'; end if;
 for bad in select value from jsonb_array_elements('["24:00","12:60","9:00","",123,true,{}]') loop
  begin
   perform public.apply_driver_report_header(r,jsonb_set(h,'{dutyStartTime}',bad),clock_timestamp());
   raise exception 'Invalid duty time accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
end;
$test$;
select 'report_duty_time_checks_passed' as result;
rollback;
