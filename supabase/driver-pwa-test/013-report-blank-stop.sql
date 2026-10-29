-- Isolated test project only. Requires 012. Persist empty pending stops.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare d text;
begin
 d:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 if position('Invalid departure correction' in d)=0 then raise exception 'Verify 012 first'; end if;
 d:=replace(d,'length(btrim(payload->>''address'')) not between 1 and 300',
  'length(btrim(payload->>''address'')) not between 0 and 300');
 if position('not between 0 and 300' in d)=0 then raise exception 'Could not allow blank new stop'; end if;
 execute d;
 d:=pg_get_functiondef('public.validate_driver_report(public.driver_daily_reports)'::regprocedure);
 d:=replace(d,'length(btrim(s->>''address'')) not between 1 and 300',
  '(jsonb_typeof(s->''address'') is distinct from ''string'' or length(btrim(s->>''address''))>300
   or (length(btrim(s->>''address''))=0 and (s->>''arrivedAt'' is not null or s->>''departedAt'' is not null)))');
 if position('length(btrim(s->>''address''))=0' in d)=0 then raise exception 'Could not validate blank pending stop'; end if;
 execute d;
end;
$migration$;
commit;
