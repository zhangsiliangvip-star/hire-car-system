-- Isolated zsipqwipauzgbqvppwjf only. No orders or financial records are changed.
begin;
set local lock_timeout='3s';
set local statement_timeout='25s';

do $migration$
declare d text;
begin
 d:=pg_get_functiondef('public.apply_driver_report_header(public.driver_daily_reports,jsonb,timestamptz)'::regprocedure);
 if position('dutyStartDate' in d)>0 then raise exception 'Duty dates already installed'; end if;
 d:=replace(d,'''dutyStartTime'',''dutyEndTime'']','''dutyStartTime'',''dutyEndTime'',''dutyStartDate'',''dutyEndDate'']');
 d:=replace(d,'return r;', $body$
 r.header:=r.header||jsonb_build_object(
  'dutyStartDate',case when h ? 'dutyStartDate' then h->'dutyStartDate'
    when r.header->>'dutyStartDate' is not null then to_jsonb(((r.header->>'dutyStartDate')::date+delta)::date) else 'null'::jsonb end,
  'dutyEndDate',case when h ? 'dutyEndDate' then h->'dutyEndDate'
    when r.header->>'dutyEndDate' is not null then to_jsonb(((r.header->>'dutyEndDate')::date+delta)::date) else 'null'::jsonb end);
 if exists(select 1 from jsonb_each(r.header) e where e.key in ('dutyStartDate','dutyEndDate')
  and (jsonb_typeof(e.value) not in ('string','null')
   or (jsonb_typeof(e.value)='string' and (e.value#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or (e.value#>>'{}')::date<date '0001-01-01'))))
 or (r.header->>'dutyStartDate' is not null and r.header->>'dutyStartTime' is null)
 or (r.header->>'dutyEndDate' is not null and r.header->>'dutyEndTime' is null)
 or ((r.header->>'dutyEndDate')::date+(r.header->>'dutyEndTime')::time <
     (r.header->>'dutyStartDate')::date+(r.header->>'dutyStartTime')::time) then
  raise exception 'Invalid duty dates or time order' using errcode='22023';
 end if;
 return r;
 $body$);
 -- Preserve explicit dates before the original header projection replaces the object.
 d:=replace(d,'r.header:=jsonb_build_object(', 'r.header:=jsonb_build_object(''dutyStartDate'',r.header->''dutyStartDate'',''dutyEndDate'',r.header->''dutyEndDate'',');
 if position('Invalid duty dates or time order' in d)=0
 or position('''dutyEndDate'']' in d)=0 then raise exception 'Unknown header implementation'; end if;
 execute d;
end;
$migration$;

create function public.staff_operation_reports(target_month text, target_region uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare first_day date; result jsonb; actor_region uuid;
begin
 if not public.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
 select region_id into actor_region from public.profiles where id=auth.uid();
 if not public.is_admin() and (actor_region is null or (target_region is not null and target_region<>actor_region)) then
  raise exception 'Region denied' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
  raise exception 'Invalid month' using errcode='22023'; end if;
 first_day:=(target_month||'-01')::date;
 select coalesce(jsonb_agg(jsonb_build_object('regionId',r.region_id,'driverName',d.name,
  'company',vehicle.owner_company,'report',public.driver_report_projection(r))
  order by r.service_date desc,r.departed_at desc,r.id),'[]'::jsonb)
 into result from public.driver_daily_reports r
 join public.drivers d on d.id=r.driver_id and d.region_id=r.region_id
 left join lateral (
  select min(v.owner_company) as owner_company from public.vehicles v
  where v.region_id=r.region_id and nullif(btrim(r.header->>'vehicleNumber'),'') is not null
   and btrim(v.plate)=btrim(r.header->>'vehicleNumber')
  having count(*)=1
 ) vehicle on true
 where r.service_date>=first_day and r.service_date<first_day+interval '1 month'
  and (target_region is null or r.region_id=target_region)
  and (public.is_admin() or r.region_id=actor_region);
 return result;
end;
$fn$;

create function public.staff_operation_report_command(command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare r public.driver_daily_reports%rowtype; old_data jsonb; doc jsonb; part jsonb;
 actor uuid:=auth.uid(); actor_region uuid; target uuid; ver bigint; request uuid;
 previous public.driver_report_events%rowtype; result jsonb; stamp timestamptz:=clock_timestamp();
 action text; field text; n numeric;
begin
 if not public.is_staff() then raise exception 'Staff required' using errcode='42501'; end if;
 action:=command->>'action';
 if jsonb_typeof(command) is distinct from 'object' or action is null or action not in ('edit','delete') then
  raise exception 'Invalid command' using errcode='22023'; end if;
 if action='delete' then
  if not(command ?& array['action','reportId','expectedVersion']) or
   exists(select 1 from jsonb_object_keys(command) k where k<>all(array['action','reportId','expectedVersion'])) then
   raise exception 'Invalid deletion fields' using errcode='22023'; end if;
  target:=(command->>'reportId')::uuid; n:=(command->>'expectedVersion')::numeric;
 else
  if not(command ?& array['action','report','requestId','reason']) or
   exists(select 1 from jsonb_object_keys(command) k where k<>all(array['action','report','requestId','reason']))
   or jsonb_typeof(command->'reason') is distinct from 'string' or length(btrim(command->>'reason')) not between 1 and 300
   or jsonb_typeof(command->'report') is distinct from 'object' then
   raise exception 'Invalid edit fields' using errcode='22023'; end if;
  doc:=command->'report'; target:=(doc->>'id')::uuid; n:=(doc->>'version')::numeric;
  request:=(command->>'requestId')::uuid;
  if request is null then raise exception 'Request required' using errcode='22023'; end if;
 end if;
 if target is null or n is null or n<1 or n<>trunc(n) or n>=9007199254740991
 or (action='delete' and jsonb_typeof(command->'expectedVersion') is distinct from 'number')
 or (action='edit' and jsonb_typeof(doc->'version') is distinct from 'number') then
  raise exception 'Invalid target/version' using errcode='22023'; end if;
 ver:=n;
 select * into r from public.driver_daily_reports where id=target for update;
 if not found then raise exception 'Report missing' using errcode='P0002'; end if;
 select region_id into actor_region from public.profiles where id=actor;
 if not public.is_admin() and (actor_region is null or actor_region<>r.region_id) then
  raise exception 'Region denied' using errcode='42501'; end if;
 if action='edit' then
  select * into previous from public.driver_report_events where actor_user_id=actor and request_id=request;
  if found then
   if previous.report_id<>r.id or previous.command is distinct from command then
    raise exception 'Idempotency conflict' using errcode='40001'; end if;
   return jsonb_build_object('action','edit','report',public.driver_report_projection(r));
  end if;
 end if;
 if r.version<>ver then raise exception 'Report version changed' using errcode='40001'; end if;
 if action='delete' then
  -- Explicitly requested permanent erasure, including all before/after snapshots.
  delete from public.driver_report_events where report_id=r.id;
  delete from public.driver_daily_reports where id=r.id;
  return jsonb_build_object('action','delete','deletedId',r.id);
 end if;
 old_data:=public.driver_report_projection(r);
 if not(doc ?& array['id','version','serviceDate','header','departedAt','departureAddress','departureKm',
   'returnedAt','returnAddress','returnKm','stops','rests'])
 or exists(select 1 from jsonb_object_keys(doc) k where k<>all(array['id','version','serviceDate','header','departedAt',
   'departureAddress','departureKm','returnedAt','returnAddress','returnKm','stops','rests']))
 or jsonb_typeof(doc->'serviceDate') is distinct from 'string' or doc->>'serviceDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or jsonb_typeof(doc->'departureAddress') is distinct from 'string' or length(btrim(doc->>'departureAddress')) not between 1 and 300
 or jsonb_typeof(doc->'departureKm') is distinct from 'number'
 or jsonb_typeof(doc->'stops') is distinct from 'array' or jsonb_typeof(doc->'rests') is distinct from 'array'
 or jsonb_array_length(doc->'stops')>100 or jsonb_array_length(doc->'rests')>100 then
  raise exception 'Invalid report fields' using errcode='22023'; end if;
 foreach field in array array['departedAt','returnedAt'] loop
  if (field='departedAt' and jsonb_typeof(doc->field) is distinct from 'string')
  or jsonb_typeof(doc->field) not in ('string','null')
  or (doc->>field is not null and doc->>field !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$') then
   raise exception 'Invalid report timestamp' using errcode='22023'; end if;
 end loop;
 if jsonb_typeof(doc->'returnKm') not in ('null','number') or jsonb_typeof(doc->'returnAddress') not in ('null','string')
 or (doc->>'returnAddress' is not null and length(btrim(doc->>'returnAddress')) not between 1 and 300) then
  raise exception 'Invalid return fields' using errcode='22023'; end if;
 for part in select value from jsonb_array_elements(doc->'stops') loop
  if jsonb_typeof(part) is distinct from 'object'
  or not(part ?& array['id','address','arrivedAt','arrivedKm','departedAt','departedKm'])
  or exists(select 1 from jsonb_object_keys(part) k where k<>all(array['id','address','arrivedAt','arrivedKm','departedAt','departedKm','plannedKm']))
  or part->>'id' is null or jsonb_typeof(part->'address') is distinct from 'string'
  or length(part->>'address')>300 then raise exception 'Invalid stop fields' using errcode='22023'; end if;
  perform (part->>'id')::uuid;
  foreach field in array array['arrivedAt','departedAt'] loop
   if jsonb_typeof(part->field) not in ('null','string')
   or (part->>field is not null and part->>field !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$') then
    raise exception 'Invalid stop timestamp' using errcode='22023'; end if;
  end loop;
  foreach field in array array['arrivedKm','departedKm','plannedKm'] loop
   if (part ? field) then
    n:=(part->>field)::numeric;
    if jsonb_typeof(part->field) not in ('null','number') or n<0 or n>9999999 or n<>round(n,1) then
     raise exception 'Invalid stop odometer' using errcode='22023'; end if;
   end if;
  end loop;
 end loop;
 for part in select value from jsonb_array_elements(doc->'rests') loop
  if jsonb_typeof(part) is distinct from 'object' or not(part ?& array['startedAt','endedAt'])
  or exists(select 1 from jsonb_object_keys(part) k where k<>all(array['startedAt','endedAt']))
  or jsonb_typeof(part->'startedAt') is distinct from 'string'
  or jsonb_typeof(part->'endedAt') not in ('string','null')
  or part->>'startedAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
  or (part->>'endedAt' is not null and part->>'endedAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$') then
   raise exception 'Invalid rest fields' using errcode='22023'; end if;
 end loop;
 r.service_date:=(doc->>'serviceDate')::date;
 r.departed_at:=(doc->>'departedAt')::timestamptz; r.departure_address:=btrim(doc->>'departureAddress');
 r.departure_km:=(doc->>'departureKm')::numeric;
 r.returned_at:=(doc->>'returnedAt')::timestamptz; r.return_address:=btrim(doc->>'returnAddress');
 r.return_km:=(doc->>'returnKm')::numeric; r.stops:=doc->'stops'; r.rests:=doc->'rests';
 r:=public.apply_driver_report_header(r,(doc->'header')||jsonb_build_object('serviceDate',r.service_date),stamp);
 if r.departed_at>stamp or r.returned_at>stamp or r.departure_km<0 or r.departure_km>9999999
 or r.departure_km<>round(r.departure_km,1) or r.return_km>9999999 or r.return_km<>round(r.return_km,1)
 or (r.returned_at is null and (r.return_address is not null or r.return_km is not null))
 or (r.returned_at is not null and (r.return_address is null or r.return_km is null))
 or (r.departed_at at time zone 'Asia/Tokyo')::date<>r.service_date then
  raise exception 'Invalid departure/return' using errcode='22023'; end if;
 perform public.validate_driver_report(r);
 update public.driver_daily_reports set service_date=r.service_date,header=r.header,
  departed_at=r.departed_at,departure_address=r.departure_address,departure_km=r.departure_km,
  returned_at=r.returned_at,return_address=r.return_address,return_km=r.return_km,
  stops=r.stops,rests=r.rests,version=version+1,updated_at=stamp,updated_by=actor where id=r.id returning * into r;
 result:=public.driver_report_projection(r);
 insert into public.driver_report_events(report_id,actor_user_id,request_id,command,before_data,after_data)
 values(r.id,actor,request,command,old_data,result);
 return jsonb_build_object('action','edit','report',result);
end;
$fn$;
revoke all on function public.staff_operation_reports(text,uuid),public.staff_operation_report_command(jsonb) from public,anon;
grant execute on function public.staff_operation_reports(text,uuid),public.staff_operation_report_command(jsonb) to authenticated;
commit;
