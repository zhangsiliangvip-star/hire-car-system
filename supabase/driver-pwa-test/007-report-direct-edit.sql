-- Isolated test project only. Preserve existing records; future commands keep no content history.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
create or replace function public.driver_report_command(
 target_report uuid, expected_version bigint, target_request uuid, target_action text, payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 link public.driver_auth_links%rowtype; r public.driver_daily_reports%rowtype;
 previous public.driver_report_events%rowtype; result jsonb;
 cmd jsonb; fingerprint jsonb; address text; km numeric; stamp timestamptz;
 idx integer; s jsonb; allowed text[];
begin
 select * into link from public.driver_auth_links where user_id=(select auth.uid()) and status='active' for update;
 if not found or not exists(select 1 from public.driver_identity()) then
  raise exception 'Active driver required' using errcode='42501'; end if;
 stamp:=clock_timestamp();
 if target_request is null or expected_version is null or expected_version<0 or expected_version>=9007199254740991
 or target_action is null or jsonb_typeof(payload) is distinct from 'object' then
  raise exception 'Invalid report command' using errcode='22023'; end if;
 allowed:=case target_action when 'checkout' then array['useDefault','address','km'] when 'return' then array['useDefault','address','km']
 when 'add_stop' then array['address'] when 'arrive' then array['stopId','km'] when 'depart' then array['stopId','km']
 when 'edit_stop' then array['id','address','arrivedAt','arrivedKm','departedAt','departedKm']
 when 'rest_start' then array[]::text[] when 'rest_end' then array[]::text[] else null end;
 if allowed is null or not (payload ?& allowed) or exists(select 1 from jsonb_object_keys(payload) k where not(k=any(allowed))) then
  raise exception 'Unexpected or missing report fields' using errcode='22023'; end if;
 cmd:=jsonb_build_object('reportId',target_report,'version',expected_version,'action',target_action,'payload',payload);
 fingerprint:=jsonb_build_object('fingerprint',encode(sha256(convert_to(cmd::text,'UTF8')),'hex'));
 select * into previous from public.driver_report_events where actor_user_id=(select auth.uid()) and request_id=target_request;
 if found then
  if previous.command<>fingerprint and previous.command<>cmd then
   raise exception 'Request key conflict' using errcode='40001'; end if;
  select * into r from public.driver_daily_reports
   where id=previous.report_id and driver_id=link.driver_id and region_id=link.region_id;
  if not found then raise exception 'Report not available' using errcode='P0002'; end if;
  return public.driver_report_projection(r);
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
    if jsonb_typeof(payload->'address')<>'string'
      or jsonb_typeof(payload->'arrivedAt') not in ('null','string') or jsonb_typeof(payload->'departedAt') not in ('null','string')
      or jsonb_typeof(payload->'arrivedKm') not in ('null','number') or jsonb_typeof(payload->'departedKm') not in ('null','number')
    then raise exception 'Correction needs valid fields' using errcode='22023'; end if;
    s:=payload;
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
 -- Keep only duplicate-request protection, not addresses, readings or before/after snapshots.
 insert into public.driver_report_events(report_id,actor_user_id,request_id,command,before_data,after_data)
  values(r.id,(select auth.uid()),target_request,fingerprint,null,'{}'::jsonb);
 return result;
end;
$$;
revoke all on function public.driver_report_command(uuid,bigint,uuid,text,jsonb) from public,anon;
grant execute on function public.driver_report_command(uuid,bigint,uuid,text,jsonb) to authenticated;
commit;
