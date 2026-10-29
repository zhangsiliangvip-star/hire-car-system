-- Isolated test project only. Requires 013. Multiple pending rows, ordered actual times.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare d text;
begin
 d:=pg_get_functiondef('public.validate_driver_report(public.driver_daily_reports)'::regprocedure);
 if position('length(btrim(s->>''address''))=0' in d)=0
 or position('if pending or ' in d)=0 then raise exception 'Unexpected validator: verify 013 first'; end if;
 d:=replace(d,'if pending or ',
  'if (pending and (s->>''arrivedAt'' is not null or s->>''departedAt'' is not null)) or ');
 execute d;
end;
$migration$;
commit;
