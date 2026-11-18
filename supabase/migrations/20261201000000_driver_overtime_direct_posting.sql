begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $patch$
declare definition text; original text;
begin
 definition:=replace(pg_get_functiondef(
  'public.apply_driver_finance_revision(uuid,public.driver_finance_claims)'::regprocedure),chr(13),'');
 original:=definition;
 if position('if c.category=''overtime'' and previous.status is distinct from ''approved'' then return c; end if;' in definition)=0
  or position('if coalesce((f->>''driverOvertimeHours'')::numeric,0)<>previous.overtime_hours then' in definition)=0 then
  raise exception 'Unexpected overtime posting baseline'; end if;
 definition:=replace(definition,
  ' if c.category=''overtime'' and previous.status is distinct from ''approved'' then return c; end if;','');
 definition:=replace(definition,
  'if coalesce((f->>''driverOvertimeHours'')::numeric,0)<>previous.overtime_hours then',
  'if previous.status=''approved'' and coalesce((f->>''driverOvertimeHours'')::numeric,0)<>previous.overtime_hours then');
 if definition=original then raise exception 'Could not enable overtime direct posting'; end if;
 execute definition;
end;
$patch$;

commit;
