begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.driver_assignment_events drop constraint driver_assignment_events_event_type_check;
alter table public.driver_assignment_events add constraint driver_assignment_events_event_type_check
 check(event_type in ('assigned','acknowledged','en_route','arrived','in_service','completed','revoked'));

do $migration$
declare definition text; original text;
begin
 definition:=pg_get_functiondef('public.transition_driver_assignment(uuid,bigint,uuid,text)'::regprocedure);
 if position('next_state is distinct from target_state' in definition)=0
 or position('target_state not in (''acknowledged''' in definition)=0 then
  raise exception 'Unexpected assignment transition baseline';
 end if;
 definition:=replace(definition,'target_state not in (''acknowledged''',
  'target_state not in (''assigned'',''acknowledged''');
 definition:=replace(definition,'next_state is distinct from target_state', $rule$
 (next_state is distinct from target_state and target_state is distinct from
  (case item.status when 'acknowledged' then 'assigned' when 'en_route' then 'acknowledged'
   when 'arrived' then 'en_route' when 'in_service' then 'arrived'
   when 'completed' then 'in_service' else null end))
 $rule$);
 definition:=replace(definition,
  'acknowledged_at=case when target_state=''acknowledged'' then now() else acknowledged_at end',
  'acknowledged_at=case when target_state=''assigned'' then null
   when target_state=''acknowledged'' and acknowledged_at is null then now() else acknowledged_at end');
 execute definition;

 definition:=pg_get_functiondef('public.staff_driver_execution_status()'::regprocedure);
 original:=definition;
 definition:=replace(definition,
  'a.status in (''assigned'',''acknowledged'',''en_route'',''arrived'',''in_service'')',
  'a.status in (''assigned'',''acknowledged'',''en_route'',''arrived'',''in_service'',''completed'')');
 if definition=original then raise exception 'Unexpected daily status baseline'; end if;
 execute definition;
end;
$migration$;
commit;
