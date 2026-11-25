begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $migration$
declare definition text; original text;
begin
 definition:=replace(pg_get_functiondef('public.driver_finance_data(text)'::regprocedure),chr(13),'');
 original:='CREATE OR REPLACE FUNCTION public.driver_finance_data(';
 if position(original in definition)=0 then
  raise exception 'Unexpected live finance function definition'; end if;
 definition:=replace(definition,original,'CREATE FUNCTION public.driver_finance_data_v2(');
 original:='''pickup'',o.pickup,''destination'',o.destination,';
 if position(original in definition)=0 then
  raise exception 'Unexpected live finance order projection'; end if;
 definition:=replace(definition,original,
  '''orderName'',o.customer,''pickup'',o.pickup,''destination'',o.destination,');
 execute definition;

 definition:=replace(pg_get_functiondef(
  'public.driver_historical_finance_data(text)'::regprocedure),chr(13),'');
 original:='CREATE OR REPLACE FUNCTION public.driver_historical_finance_data(';
 if position(original in definition)=0 then
  raise exception 'Unexpected historical finance function definition'; end if;
 definition:=replace(definition,original,'CREATE FUNCTION public.driver_historical_finance_data_v2(');
 original:='''date'',l.service_date,''pickup'',h.pickup,''destination'',h.destination,';
 if position(original in definition)=0 then
  raise exception 'Unexpected historical finance order projection'; end if;
 definition:=replace(definition,original,
  '''date'',l.service_date,''orderName'',h.order_name,''pickup'',h.pickup,''destination'',h.destination,');
 execute definition;
end;
$migration$;

revoke all on function public.driver_finance_data_v2(text),
  public.driver_historical_finance_data_v2(text) from public, anon;
grant execute on function public.driver_finance_data_v2(text),
  public.driver_historical_finance_data_v2(text) to authenticated;

commit;
