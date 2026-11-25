begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $migration$
declare definition text; original text; previous text;
begin
 definition:=replace(pg_get_functiondef('public.driver_finance_data(text)'::regprocedure),chr(13),'');
 previous:=' and a.service_date <= (now() at time zone ''Asia/Tokyo'')::date';
 if position(previous in definition)=0 then
  raise exception 'Unexpected driver finance date filter'; end if;
 definition:=replace(definition,previous,'');
 execute definition;

 definition:=replace(pg_get_functiondef(
  'public.submit_driver_finance(uuid,text,bigint,uuid,jsonb,numeric)'::regprocedure),chr(13),'');
 previous:='or a.service_date>(now() at time zone ''Asia/Tokyo'')::date or a.service_date<o.date';
 if position(previous in definition)=0 then
  raise exception 'Unexpected driver finance submission date guard'; end if;
 definition:=replace(definition,previous,
  'or (a.service_date>(now() at time zone ''Asia/Tokyo'')::date and target_category not in (''company'',''trip'')) or a.service_date<o.date');
 execute definition;

 definition:=replace(pg_get_functiondef(
  'public.submit_driver_finance(uuid,text,bigint,uuid,jsonb,numeric)'::regprocedure),chr(13),'');
 original:='c:=public.apply_driver_finance_revision(c.claim_id,previous);';
 if position(original in definition)=0 then
  raise exception 'Unexpected driver finance revision posting'; end if;
 definition:=replace(definition,original,
  E'if target_category not in (''company'',''trip'') or a.service_date<=(now() at time zone ''Asia/Tokyo'')::date then\n  c:=public.apply_driver_finance_revision(c.claim_id,previous);\n end if;');
 execute definition;
end;
$migration$;

commit;
