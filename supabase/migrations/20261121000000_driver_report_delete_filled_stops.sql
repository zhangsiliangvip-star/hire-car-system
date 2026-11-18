begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

do $migration$
declare definition text; original text;
begin
 definition:=pg_get_functiondef('public.validate_driver_report(public.driver_daily_reports)'::regprocedure);
 if position('force_order boolean' in definition)=0
 or position('Invalid draft odometer' in definition)=0
 or position('if n<k or n>9999999 or n<>round(n,1) then' in definition)=0
 or (position('if (pending and (s->>''arrivedAt'' is not null or s->>''departedAt'' is not null)) or length(btrim(s->>''address'')) not between 1 and 300' in definition)=0
  and position('if (pending and (s->>''arrivedAt'' is not null or s->>''departedAt'' is not null)) or (jsonb_typeof(s->''address'') is distinct from ''string''' in definition)=0)
 or position('(pending or (not force_order and (r.returned_at<t or r.return_km<k)))' in definition)=0 then
  raise exception 'Unexpected report validator definition';
 end if;
 definition:=replace(definition,'if n<k or n>9999999 or n<>round(n,1) then',
  'if (not force_order and n<k) or n>9999999 or n<>round(n,1) then');
 if position('if (not force_order and n<k) or n>9999999 or n<>round(n,1) then' in definition)=0 then
  raise exception 'Could not bypass draft odometer order in forced saves';
 end if;
 definition:=replace(definition,'(pending or (not force_order and (r.returned_at<t or r.return_km<k)))',
  '(not force_order and (pending or r.returned_at<t or r.return_km<k))');
 if position('(not force_order and (pending or r.returned_at<t or r.return_km<k))' in definition)=0 then
  raise exception 'Could not permit incomplete stops in forced saves';
 end if;
 definition:=replace(definition,
  'if (pending and (s->>''arrivedAt'' is not null or s->>''departedAt'' is not null)) or length(btrim(s->>''address'')) not between 1 and 300',
  'if (pending and not force_order and (s->>''arrivedAt'' is not null or s->>''departedAt'' is not null)) or length(btrim(s->>''address'')) not between 1 and 300');
 definition:=replace(definition,
  'if (pending and (s->>''arrivedAt'' is not null or s->>''departedAt'' is not null)) or (jsonb_typeof(s->''address'') is distinct from ''string''',
  'if (pending and not force_order and (s->>''arrivedAt'' is not null or s->>''departedAt'' is not null)) or (jsonb_typeof(s->''address'') is distinct from ''string''');
 if position('if (pending and not force_order and (s->>''arrivedAt'' is not null or s->>''departedAt'' is not null)) or length(btrim(s->>''address'')) not between 1 and 300' in definition)=0
 and position('if (pending and not force_order and (s->>''arrivedAt'' is not null or s->>''departedAt'' is not null)) or (jsonb_typeof(s->''address'') is distinct from ''string''' in definition)=0 then
  raise exception 'Could not permit subsequent stops in forced saves';
 end if;
 execute definition;

 definition:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 original:=definition;
 if position('Only empty stops can be removed' in definition)=0
 or position('when ''remove_stop'' then array[''stopId'']' in definition)=0 then
  raise exception 'Unexpected report command definition';
 end if;
 definition:=regexp_replace(definition,
  '   if btrim\(s->>''address''\) is distinct from ''''[[:space:]]+or s->>''arrivedAt'' is not null or s->>''departedAt'' is not null[[:space:]]+or s->>''arrivedKm'' is not null or s->>''departedKm'' is not null[[:space:]]+or s->>''plannedKm'' is not null then[[:space:]]+raise exception ''Only empty stops can be removed'' using errcode=''22023'';[[:space:]]+end if;',
  '');
 if definition=original or position('Only empty stops can be removed' in definition)>0 then
  raise exception 'Could not allow removal of filled stops';
 end if;
 execute definition;
end;
$migration$;

commit;
