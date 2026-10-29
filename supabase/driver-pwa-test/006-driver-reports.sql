-- Isolated zsipqwipauzgbqvppwjf only. No financial or existing business records are updated.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create table public.driver_report_depots (
  driver_id uuid primary key,
  region_id uuid not null,
  name text not null check(length(name) between 1 and 100),
  address text not null check(length(address) between 1 and 300),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  foreign key(driver_id,region_id) references public.drivers(id,region_id) on delete restrict
);
create table public.driver_daily_reports (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null, region_id uuid not null,
  service_date date not null,
  departed_at timestamptz not null, departure_address text not null, departure_km numeric not null,
  returned_at timestamptz, return_address text, return_km numeric,
  stops jsonb not null default '[]', rests jsonb not null default '[]',
  version bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
  foreign key(driver_id,region_id) references public.drivers(id,region_id) on delete restrict,
  check(version>0 and departure_km>=0 and departure_km<=9999999),
  check(jsonb_typeof(stops)='array' and jsonb_typeof(rests)='array'),
  check((returned_at is null and return_address is null and return_km is null)
    or (returned_at>=departed_at and length(return_address) between 1 and 300 and return_km>=departure_km))
);
create unique index driver_report_one_open on public.driver_daily_reports(driver_id) where returned_at is null;
create index driver_report_history on public.driver_daily_reports(driver_id,departed_at desc);
create table public.driver_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.driver_daily_reports(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id),
  request_id uuid not null, command jsonb not null,
  before_data jsonb, after_data jsonb not null,
  occurred_at timestamptz not null default now(),
  unique(actor_user_id,request_id)
);
alter table public.driver_report_depots enable row level security;
alter table public.driver_daily_reports enable row level security;
alter table public.driver_report_events enable row level security;
revoke all on public.driver_report_depots,public.driver_daily_reports,public.driver_report_events from public,anon,authenticated;

create function public.driver_report_projection(r public.driver_daily_reports) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'serviceDate',r.service_date,'version',r.version,
 'departedAt',r.departed_at,'departureAddress',r.departure_address,'departureKm',r.departure_km,
 'returnedAt',r.returned_at,'returnAddress',r.return_address,'returnKm',r.return_km,'stops',r.stops,'rests',r.rests);
$$;
create function public.driver_reports() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('reports',coalesce((select jsonb_agg(public.driver_report_projection(r) order by r.departed_at desc)
 from (select d.* from public.driver_daily_reports d join public.driver_identity() i
 on d.driver_id=i.driver_id and d.region_id=i.region_id order by d.departed_at desc limit 31) r),'[]'::jsonb),
 'depot',(select jsonb_build_object('name',d.name,'address',d.address) from public.driver_report_depots d
 join public.driver_identity() i on d.driver_id=i.driver_id and d.region_id=i.region_id));
$$;

create function public.validate_driver_report(r public.driver_daily_reports) returns void
language plpgsql set search_path='' as $$
declare s jsonb; t timestamptz:=r.departed_at; k numeric:=r.departure_km;
 a timestamptz; b timestamptz; n numeric; pending boolean:=false; stop_ids text[]:='{}';
 finish timestamptz:=coalesce(r.returned_at,clock_timestamp());
begin
 if jsonb_array_length(r.stops)>100 or jsonb_array_length(r.rests)>100 then
  raise exception 'Maximum 100 stops and rest periods' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(r.stops) loop
  if pending or length(btrim(s->>'address')) not between 1 and 300 or s->>'id'=any(stop_ids) then
   raise exception 'Finish previous stop or check address' using errcode='22023'; end if;
  stop_ids:=array_append(stop_ids,s->>'id');
  a:=(s->>'arrivedAt')::timestamptz; b:=(s->>'departedAt')::timestamptz;
  n:=(s->>'arrivedKm')::numeric;
  if (a is null)<>(n is null) or (a is null and b is not null) then
   raise exception 'Arrival time and odometer required together' using errcode='22023'; end if;
  if a is not null then
   if a<t or a>finish or n<k or n>9999999 or n<>round(n,1) then
    raise exception 'Arrival time or odometer out of order' using errcode='22023'; end if;
   t:=a; k:=n;
  end if;
  n:=(s->>'departedKm')::numeric;
  if (b is null)<>(n is null) then raise exception 'Departure time and odometer required together' using errcode='22023'; end if;
  if b is not null then
   if b<t or b>finish or n<k or n>9999999 or n<>round(n,1) then
    raise exception 'Departure time or odometer out of order' using errcode='22023'; end if;
   t:=b; k:=n;
  else pending:=true; end if;
 end loop;
 if r.returned_at is not null and (pending or r.returned_at<t or r.return_km<k) then
  raise exception 'Finish stops and check return odometer' using errcode='22023'; end if;
 t:=r.departed_at; pending:=false;
 for s in select value from jsonb_array_elements(r.rests) loop
  a:=(s->>'startedAt')::timestamptz; b:=(s->>'endedAt')::timestamptz;
  if pending or a is null or a<t or a>finish or (b is not null and (b<a or b>finish)) then
   raise exception 'Rest periods overlap or exceed shift' using errcode='22023'; end if;
  if b is null then pending:=true; else t:=b; end if;
 end loop;
 if pending and r.returned_at is not null then raise exception 'End rest before return' using errcode='22023'; end if;
end;
$$;

create function public.driver_report_command(
 target_report uuid, expected_version bigint, target_request uuid, target_action text, payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 link public.driver_auth_links%rowtype; r public.driver_daily_reports%rowtype;
 previous public.driver_report_events%rowtype; old_data jsonb; result jsonb;
 cmd jsonb; address text; km numeric; stamp timestamptz:=clock_timestamp();
 idx integer; s jsonb; allowed text[];
begin
 select * into link from public.driver_auth_links where user_id=(select auth.uid()) and status='active' for update;
 if not found or not exists(select 1 from public.driver_identity()) then
  raise exception 'Active driver required' using errcode='42501'; end if;
 if target_request is null or expected_version is null or expected_version<0 or expected_version>=9007199254740991
 or target_action is null or jsonb_typeof(payload) is distinct from 'object' then
  raise exception 'Invalid report command' using errcode='22023'; end if;
 allowed:=case target_action when 'checkout' then array['useDefault','address','km'] when 'return' then array['useDefault','address','km']
 when 'add_stop' then array['address'] when 'arrive' then array['stopId','km'] when 'depart' then array['stopId','km']
 when 'edit_stop' then array['id','address','arrivedAt','arrivedKm','departedAt','departedKm','reason']
 when 'rest_start' then array[]::text[] when 'rest_end' then array[]::text[] else null end;
 if allowed is null or not (payload ?& allowed) or exists(select 1 from jsonb_object_keys(payload) k where not(k=any(allowed))) then
  raise exception 'Unexpected or missing report fields' using errcode='22023'; end if;
 cmd:=jsonb_build_object('reportId',target_report,'version',expected_version,'action',target_action,'payload',payload);
 select * into previous from public.driver_report_events where actor_user_id=(select auth.uid()) and request_id=target_request;
 if found then
  if previous.command<>cmd then raise exception 'Request key conflict' using errcode='40001'; end if;
  return previous.after_data;
 end if;
 if target_action in ('checkout','return','arrive','depart') then
  if jsonb_typeof(payload->'km')<>'number' then raise exception 'Numeric odometer required' using errcode='22023'; end if;
  km:=(payload->>'km')::numeric;
  if km<0 or km>9999999 or km<>round(km,1) then raise exception 'Invalid odometer' using errcode='22023'; end if;
 end if;
 if target_action in ('checkout','return') then
  if jsonb_typeof(payload->'useDefault')<>'boolean' or jsonb_typeof(payload->'address')<>'string' then
   raise exception 'Invalid location' using errcode='22023'; end if;
  if (payload->>'useDefault')::boolean then
   select d.address into address from public.driver_report_depots d where d.driver_id=link.driver_id and d.region_id=link.region_id;
  else address:=btrim(payload->>'address'); end if;
  if address is null or length(address) not between 1 and 300 then raise exception 'Depot not configured or location missing' using errcode='22023'; end if;
 end if;
 if target_action='checkout' then
  if target_report is not null or expected_version<>0 or exists(select 1 from public.driver_daily_reports where driver_id=link.driver_id and returned_at is null) then
   raise exception 'Open report already exists or invalid version' using errcode='40001'; end if;
  insert into public.driver_daily_reports(driver_id,region_id,service_date,departed_at,departure_address,departure_km,created_by,updated_by)
   values(link.driver_id,link.region_id,(stamp at time zone 'Asia/Tokyo')::date,stamp,address,km,(select auth.uid()),(select auth.uid())) returning * into r;
 else
  select * into r from public.driver_daily_reports where id=target_report and driver_id=link.driver_id and region_id=link.region_id for update;
  if not found then raise exception 'Report not available' using errcode='P0002'; end if;
  if r.version<>expected_version or (r.returned_at is not null and target_action<>'edit_stop') then
   raise exception 'Report version or state changed' using errcode='40001'; end if;
  old_data:=public.driver_report_projection(r);
  if target_action='return' then r.returned_at:=stamp; r.return_address:=address; r.return_km:=km;
  elsif target_action='add_stop' then
   if jsonb_typeof(payload->'address')<>'string' or length(btrim(payload->>'address')) not between 1 and 300 then
    raise exception 'Stop address required' using errcode='22023'; end if;
   r.stops:=r.stops||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'address',btrim(payload->>'address'),
    'arrivedAt',null,'arrivedKm',null,'departedAt',null,'departedKm',null));
  elsif target_action in ('arrive','depart','edit_stop') then
   select ordinality::integer-1,value into idx,s from jsonb_array_elements(r.stops) with ordinality
    where value->>'id'=case when target_action='edit_stop' then payload->>'id' else payload->>'stopId' end;
   if idx is null then raise exception 'Stop not found' using errcode='P0002'; end if;
   if target_action='edit_stop' then
    if jsonb_typeof(payload->'address')<>'string' or jsonb_typeof(payload->'reason')<>'string'
      or length(btrim(payload->>'reason')) not between 1 and 300
      or jsonb_typeof(payload->'arrivedAt') not in ('null','string') or jsonb_typeof(payload->'departedAt') not in ('null','string')
      or jsonb_typeof(payload->'arrivedKm') not in ('null','number') or jsonb_typeof(payload->'departedKm') not in ('null','number')
    then raise exception 'Correction needs valid fields and reason' using errcode='22023'; end if;
    s:=payload-'reason';
   elsif target_action='arrive' then
    if s->>'arrivedAt' is not null then raise exception 'Already arrived' using errcode='40001'; end if;
    s:=s||jsonb_build_object('arrivedAt',stamp,'arrivedKm',km);
   else
    if s->>'arrivedAt' is null or s->>'departedAt' is not null then raise exception 'Arrival required before departure' using errcode='40001'; end if;
    s:=s||jsonb_build_object('departedAt',stamp,'departedKm',km);
   end if;
   r.stops:=jsonb_set(r.stops,array[idx::text],s);
  elsif target_action='rest_start' then
   r.rests:=r.rests||jsonb_build_array(jsonb_build_object('startedAt',stamp,'endedAt',null));
  elsif target_action='rest_end' then
   idx:=jsonb_array_length(r.rests)-1;
   if idx<0 or r.rests->idx->>'endedAt' is not null then raise exception 'No active rest' using errcode='40001'; end if;
   r.rests:=jsonb_set(r.rests,array[idx::text,'endedAt'],to_jsonb(stamp));
  end if;
  perform public.validate_driver_report(r);
  update public.driver_daily_reports set returned_at=r.returned_at,return_address=r.return_address,return_km=r.return_km,
   stops=r.stops,rests=r.rests,version=version+1,updated_at=stamp,updated_by=(select auth.uid())
   where id=r.id returning * into r;
 end if;
 result:=public.driver_report_projection(r);
 insert into public.driver_report_events(report_id,actor_user_id,request_id,command,before_data,after_data)
  values(r.id,(select auth.uid()),target_request,cmd,old_data,result);
 return result;
end;
$$;
revoke all on function public.driver_report_projection(public.driver_daily_reports),
 public.validate_driver_report(public.driver_daily_reports) from public,anon,authenticated;
revoke all on function public.driver_reports(),public.driver_report_command(uuid,bigint,uuid,text,jsonb) from public,anon;
grant execute on function public.driver_reports(),public.driver_report_command(uuid,bigint,uuid,text,jsonb) to authenticated;
commit;
