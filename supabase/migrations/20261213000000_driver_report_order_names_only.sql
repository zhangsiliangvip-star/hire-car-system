begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $migration$
declare definition text; original text;
begin
 definition:=replace(pg_get_functiondef('public.driver_report_defaults(date)'::regprocedure),chr(13),'');
 original:='CREATE OR REPLACE FUNCTION public.driver_report_defaults(';
 if position(original in definition)=0 then
  raise exception 'Unexpected report defaults function definition'; end if;
 definition:=replace(definition,original,'CREATE FUNCTION public.driver_report_defaults_v2(');
 original:='''assignmentId'',a.assignment_id,''time'',a.departure_time,''pickup'',a.pickup';
 if position(original in definition)=0 then
  raise exception 'Unexpected report defaults order projection'; end if;
 definition:=replace(definition,original,
  '''assignmentId'',a.assignment_id,''orderName'',o.customer,''time'',a.departure_time,''pickup'',a.pickup');
 execute definition;

 definition:=replace(pg_get_functiondef(
  'public.report_order_options(public.driver_daily_reports)'::regprocedure),chr(13),'');
 original:='''label'',concat_ws('' · '',x.time,x.customer,x.pickup||'' → ''||x.destination),';
 if position(original in definition)=0 then
  raise exception 'Unexpected report order option label'; end if;
 definition:=replace(definition,original,
  '''label'',coalesce(nullif(btrim(x.customer),''''),''未命名订单''),');
 execute definition;
end;
$migration$;

revoke all on function public.driver_report_defaults_v2(date) from public, anon;
grant execute on function public.driver_report_defaults_v2(date) to authenticated;

commit;
