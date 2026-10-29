begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

do $migration$
declare
 definition text;
 without_completed text:='a.status in (''assigned'',''acknowledged'',''en_route'',''arrived'',''in_service'')';
 with_completed text:='a.status in (''assigned'',''acknowledged'',''en_route'',''arrived'',''in_service'',''completed'')';
begin
 definition:=pg_get_functiondef('public.staff_driver_execution_status()'::regprocedure);
 if position(without_completed in definition)>0 then
  definition:=replace(definition,without_completed,with_completed);
  execute definition;
 elsif position(with_completed in definition)=0 then
  raise exception 'Unexpected daily driver status filter';
 end if;
 if position(with_completed in definition)=0 then
  raise exception 'Could not include completed driver status';
 end if;
end;
$migration$;

commit;
