-- Isolated test project only. Requires 011. Atomic departure and stop edits.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $migration$
declare d text;
begin
 d:=pg_get_functiondef('public.driver_report_command(uuid,bigint,uuid,text,jsonb)'::regprocedure);
 if position('Invalid stop list' in d)=0 or position('Invalid departure correction' in d)>0 then
  raise exception 'Unexpected report command definition: verify 011 first';
 end if;
 d:=replace(d,'when ''edit_stops'' then array[''stops'']','when ''edit_stops'' then array[''stops'',''departure'']');
 d:=replace(d,'payload ?& (case when','payload ?& (case when target_action=''edit_stops'' then array[''stops''] when');
 d:=replace(d,'elsif target_action=''edit_stops'' then','
  elsif target_action=''edit_stops'' then
   if payload ? ''departure'' then
    s:=payload->''departure'';
    if jsonb_typeof(s) is distinct from ''object''
    or not(s ?& array[''address'',''km'',''departedAt''])
    or exists(select 1 from jsonb_object_keys(s) f where f<>all(array[''address'',''km'',''departedAt'']))
    or jsonb_typeof(s->''address'') is distinct from ''string''
    or length(btrim(s->>''address'')) not between 1 and 300
    or jsonb_typeof(s->''km'') is distinct from ''number''
    or jsonb_typeof(s->''departedAt'') is distinct from ''string''
    or s->>''departedAt'' !~ ''(Z|[+-][0-9]{2}:[0-9]{2})$'' then
     raise exception ''Invalid departure correction'' using errcode=''22023'';
    end if;
    km:=(s->>''km'')::numeric;
    if km<0 or km>9999999 or km<>round(km,1)
    or (s->>''departedAt'')::timestamptz>stamp
    or ((s->>''departedAt'')::timestamptz at time zone ''Asia/Tokyo'')::date
      <> (r.departed_at at time zone ''Asia/Tokyo'')::date then
     raise exception ''Departure date or reading invalid'' using errcode=''22023'';
    end if;
    r.departure_address:=btrim(s->>''address'');
    r.departure_km:=km;
    r.departed_at:=(s->>''departedAt'')::timestamptz;
   end if;');
 d:=replace(d,'set returned_at=r.returned_at,','set departed_at=r.departed_at,departure_address=r.departure_address,departure_km=r.departure_km,returned_at=r.returned_at,');
 if position('Invalid departure correction' in d)=0 or position('set departed_at=r.departed_at' in d)=0
 or position('target_action=''edit_stops'' then array[''stops''] when' in d)=0 then
  raise exception 'Could not add departure correction';
 end if;
 execute d;
end;
$migration$;
commit;
