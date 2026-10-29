begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.driver_finance_data(text)'::regprocedure);
 if position('a.status=''completed''' in definition)=0
 or position('a.status<>''revoked''' in definition)>0 then
  raise exception 'Unexpected driver finance data status baseline';
 end if;
 definition:=replace(definition,'a.status=''completed''','a.status<>''revoked''');
 if position('a.status<>''revoked''' in definition)=0 then
  raise exception 'Could not allow active assignments in driver finance data';
 end if;
 execute definition;

 definition:=pg_get_functiondef(
  'public.submit_driver_finance(uuid,text,bigint,uuid,jsonb,numeric)'::regprocedure);
 if position('a.status<>''completed''' in definition)=0
 or position('a.status=''revoked''' in definition)>0 then
  raise exception 'Unexpected driver finance submission status baseline';
 end if;
 definition:=replace(definition,'a.status<>''completed''','a.status=''revoked''');
 definition:=replace(definition,'Completed own trip required','Active own trip required');
 if position('a.status=''revoked''' in definition)=0 then
  raise exception 'Could not allow finance submissions before completion';
 end if;
 execute definition;

 definition:=pg_get_functiondef('public.can_access_driver_receipt(text,boolean)'::regprocedure);
 if position('a.status=''completed''' in definition)=0
 or position('a.status<>''revoked''' in definition)>0 then
  raise exception 'Unexpected driver finance receipt status baseline';
 end if;
 definition:=replace(definition,'a.status=''completed''','a.status<>''revoked''');
 if position('a.status<>''revoked''' in definition)=0 then
  raise exception 'Could not enable receipts for active assignments';
 end if;
 execute definition;

 definition:=pg_get_functiondef('public.has_driver_fuel_day(uuid,uuid,date)'::regprocedure);
 if position('a.status=''completed''' in definition)=0
 or position('a.status<>''revoked''' in definition)>0 then
  raise exception 'Unexpected daily fuel eligibility baseline';
 end if;
 definition:=replace(definition,'a.status=''completed''','a.status<>''revoked''');
 if position('a.status<>''revoked''' in definition)=0 then
  raise exception 'Could not enable fuel claims for active assignments';
 end if;
 execute definition;

 definition:=pg_get_functiondef(
  'public.submit_driver_daily_fuel(date,uuid,bigint,uuid,bigint,jsonb)'::regprocedure);
 if position('a.status<>''completed''' in definition)=0
 or position('a.status=''revoked''' in definition)>0 then
  raise exception 'Unexpected daily fuel submission status baseline';
 end if;
 definition:=replace(definition,'a.status<>''completed''','a.status=''revoked''');
 definition:=replace(definition,'Completed own day required','Active own day required');
 if position('a.status=''revoked''' in definition)=0 then
  raise exception 'Could not allow fuel submissions before completion';
 end if;
 execute definition;
end;
$migration$;

commit;
