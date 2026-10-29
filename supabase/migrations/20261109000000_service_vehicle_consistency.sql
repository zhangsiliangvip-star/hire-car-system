begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.service_vehicle_name(item public.orders, day date) returns text
language sql immutable set search_path='' as $$
 select case when coalesce(item.finance_by_date->day::text->>'vehicle','')<>''
 then item.finance_by_date->day::text->>'vehicle' else coalesce(item.vehicle,'') end;
$$;
create function public.service_vehicle_plate(item public.orders, day date) returns text
language sql immutable set search_path='' as $$
 select case when coalesce(item.finance_by_date->day::text->>'vehicle','')<>''
 then coalesce(item.finance_by_date->day::text->>'vehiclePlate','')
 else coalesce(item.vehicle_plate,'') end;
$$;
revoke all on function public.service_vehicle_name(public.orders,date),
 public.service_vehicle_plate(public.orders,date) from public,anon,authenticated;

create function public.normalize_service_vehicle_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare entry record; old_day jsonb;
begin
 if (new.vehicle,new.vehicle_plate) is distinct from (old.vehicle,old.vehicle_plate) then
  for entry in select key,value from jsonb_each(coalesce(new.finance_by_date,'{}'::jsonb)) loop
   old_day:=old.finance_by_date->entry.key;
   if entry.key between new.date::text and new.end_date::text
    and (entry.value->>'vehicle',entry.value->>'vehiclePlate') is not distinct from
      (old_day->>'vehicle',old_day->>'vehiclePlate')
    and (new.date=new.end_date and entry.key=new.date::text
      or (coalesce(entry.value->>'vehicleOverride','false')<>'true'
        and old_day->>'vehicle'=old.vehicle and coalesce(old_day->>'vehiclePlate','')=coalesce(old.vehicle_plate,''))) then
    new.finance_by_date:=jsonb_set(new.finance_by_date,array[entry.key],
     entry.value||jsonb_build_object('vehicle',new.vehicle,'vehiclePlate',new.vehicle_plate));
   end if;
  end loop;
 end if;
 if new.date=new.end_date and coalesce(new.finance_by_date->new.date::text->>'vehicle','')<>'' then
  new.vehicle:=public.service_vehicle_name(new,new.date);
  new.vehicle_plate:=public.service_vehicle_plate(new,new.date);
 end if;
 return new;
end;
$$;
revoke all on function public.normalize_service_vehicle_change() from public,anon,authenticated;
create trigger normalize_service_vehicle_change before update on public.orders
 for each row execute function public.normalize_service_vehicle_change();

create function public.linked_report_header(r public.driver_daily_reports) returns jsonb
language sql stable set search_path='' as $$
 select coalesce((
  select r.header||jsonb_build_object('vehicleNumber',public.service_vehicle_plate(o,r.service_date))
  from public.driver_assignments a join public.orders o on o.id=a.order_id and o.region_id=a.region_id
  where a.id=nullif(r.header->>'assignmentId','')::uuid and a.driver_id=r.driver_id
   and a.region_id=r.region_id and a.service_date=r.service_date
 ),r.header);
$$;
create function public.report_order_options(r public.driver_daily_reports) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('assignmentId',x.id,
  'label',concat_ws(' · ',x.time,x.customer,x.pickup||' → '||x.destination),
  'vehicleNumber',x.plate) order by x.time,x.id),'[]'::jsonb)
 from (
  select distinct on (a.order_id) a.id,o.time,o.customer,o.pickup,o.destination,
   public.service_vehicle_plate(o,r.service_date) as plate
  from public.driver_assignments a join public.orders o on o.id=a.order_id and o.region_id=a.region_id
  where a.driver_id=r.driver_id and a.region_id=r.region_id and a.service_date=r.service_date
   and (public.is_staff() or (a.status<>'revoked' and o.status<>'キャンセル'))
  order by a.order_id,case when a.id::text=coalesce(jsonb_extract_path_text(r.header,'assignmentId'),'') then 0 else 1 end,
   a.created_at desc,a.id limit 200
 ) x;
$$;
revoke all on function public.linked_report_header(public.driver_daily_reports),
 public.report_order_options(public.driver_daily_reports) from public,anon,authenticated;

alter function public.apply_driver_report_header(public.driver_daily_reports,jsonb,timestamptz)
 rename to apply_driver_report_header_fields;
create function public.apply_driver_report_header(r public.driver_daily_reports, h jsonb, stamp timestamptz)
returns public.driver_daily_reports language plpgsql set search_path='' as $$
declare previous_link text:=r.header->>'assignmentId'; target uuid; a public.driver_assignments;
 item public.orders; baseline text; selected_plate text; model text; matches integer; result public.driver_daily_reports;
begin
 if (h ? 'assignmentId' and jsonb_typeof(h->'assignmentId') not in ('string','null'))
 or (h ? 'vehicleBaseline' and jsonb_typeof(h->'vehicleBaseline') is distinct from 'string') then
  raise exception 'Invalid vehicle link fields' using errcode='22023';
 end if;
 result:=public.apply_driver_report_header_fields(r,h-'assignmentId'-'vehicleBaseline',stamp);
 target:=nullif(case when h ? 'assignmentId' then h->>'assignmentId' else previous_link end,'')::uuid;
 if target is null then
  result.header:=result.header||jsonb_build_object('assignmentId',null);
  return result;
 end if;
 select * into a from public.driver_assignments where id=target;
 if not found or a.driver_id<>r.driver_id or a.region_id<>r.region_id or a.service_date<>result.service_date
 or (not public.is_staff() and target::text is distinct from previous_link and a.status='revoked') then
  raise exception '订单关联与司机或服务日不一致，请重新选择。' using errcode='PVS01';
 end if;
 select * into item from public.orders where id=a.order_id and region_id=r.region_id for update;
 if not found then raise exception '关联订单已不存在，请重新选择。' using errcode='PVS01'; end if;
 if not public.is_staff() and not exists(select 1 from public.driver_identity() i
   where i.driver_id=r.driver_id and i.region_id=r.region_id) then
  raise exception 'Report vehicle change denied' using errcode='42501';
 end if;
 selected_plate:=public.service_vehicle_plate(item,result.service_date);
 baseline:=h->>'vehicleBaseline';
 if baseline is not null and btrim(h->>'vehicleNumber') is distinct from baseline then
  if selected_plate is distinct from baseline then
   raise exception '订单車両番号已变化，请刷新后重试。' using errcode='40001';
  end if;
  selected_plate:=btrim(h->>'vehicleNumber');
  if selected_plate<>'' then
   select count(*),min(v.name) into matches,model from public.vehicles v
    where v.region_id=r.region_id and v.plate=selected_plate;
   if matches<>1 then
    raise exception '请填写本地域已登记且唯一的車両番号。' using errcode='PVS02';
   end if;
  else model:=public.service_vehicle_name(item,result.service_date);
  end if;
  update public.orders set finance_by_date=jsonb_set(coalesce(finance_by_date,'{}'::jsonb),
   array[result.service_date::text],
   coalesce(finance_by_date->result.service_date::text,'{}'::jsonb)||
     jsonb_build_object('vehicle',model,'vehiclePlate',selected_plate,'vehicleOverride',true))
   where id=item.id;
 end if;
 result.header:=result.header||jsonb_build_object('assignmentId',target,'vehicleNumber',selected_plate);
 return result;
end;
$$;
revoke all on function public.apply_driver_report_header(public.driver_daily_reports,jsonb,timestamptz),
 public.apply_driver_report_header_fields(public.driver_daily_reports,jsonb,timestamptz)
 from public,anon,authenticated;

do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.driver_report_projection(public.driver_daily_reports)'::regprocedure);
 if position('''header'',r.header' in definition)=0 then raise exception 'Unexpected report projection baseline'; end if;
 definition:=replace(definition,'''header'',r.header',
  '''header'',public.linked_report_header(r),''orderOptions'',public.report_order_options(r)');
 execute definition;
 definition:=pg_get_functiondef('public.driver_reports()'::regprocedure);
 if position('''reports'',coalesce' in definition)=0 then raise exception 'Unexpected report data baseline'; end if;
 definition:=replace(definition,'''reports'',coalesce','''vehicleLinking'',true,''reports'',coalesce');
 execute definition;
 definition:=pg_get_functiondef('public.staff_operation_reports(text,uuid)'::regprocedure);
 if position('r.header->>''vehicleNumber''' in definition)=0 then raise exception 'Unexpected operation vehicle baseline'; end if;
 definition:=replace(definition,'r.header->>''vehicleNumber''','public.linked_report_header(r)->>''vehicleNumber''');
 execute definition;
 definition:=pg_get_functiondef('public.staff_operation_report_command(jsonb)'::regprocedure);
 if position('''departureAddress'',''departureKm'',''returnedAt''' in definition)=0 then
  raise exception 'Unexpected staff report command baseline';
 end if;
 definition:=replace(definition,'''departureAddress'',''departureKm'',''returnedAt''',
  '''orderOptions'',''departureAddress'',''departureKm'',''returnedAt''');
 execute definition;
 definition:=pg_get_functiondef('public.driver_orders(date,uuid)'::regprocedure);
 if position('o.destination,o.vehicle,a.status' in definition)=0 then raise exception 'Unexpected driver vehicle baseline'; end if;
 definition:=replace(definition,'o.destination,o.vehicle,a.status',
  'o.destination,public.service_vehicle_name(o,a.service_date),a.status');
 execute definition;
end;
$migration$;

with candidates as (
 select r.id,min(a.id::text)::uuid as assignment_id
 from public.driver_daily_reports r
 join public.driver_assignments a on a.driver_id=r.driver_id and a.region_id=r.region_id and a.service_date=r.service_date
 join public.orders o on o.id=a.order_id and o.region_id=r.region_id
 where nullif(r.header->>'assignmentId','') is null
 group by r.id having count(distinct a.order_id)=1
)
update public.driver_daily_reports r set header=r.header||jsonb_build_object('assignmentId',c.assignment_id),
 version=r.version+1,updated_at=clock_timestamp()
from candidates c where c.id=r.id;
commit;
