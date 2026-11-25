begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

create index driver_report_service_history
 on public.driver_daily_reports(driver_id,region_id,service_date,departed_at desc);

create function public.driver_report_history(target_month text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity record; first_day date;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 if target_month is null or target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  or left(target_month,4)='0000' then
  raise exception 'Invalid month' using errcode='22023';
 end if;
 first_day:=make_date(left(target_month,4)::integer,right(target_month,2)::integer,1);
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',r.id,'serviceDate',r.service_date,'returnedAt',r.returned_at)
  order by r.service_date desc,r.departed_at desc,r.id)
  from public.driver_daily_reports r
  where r.driver_id=identity.driver_id and r.region_id=identity.region_id
   and r.service_date>=first_day and r.service_date<(first_day+interval '1 month')::date),'[]'::jsonb);
end;
$$;

create function public.driver_report_detail(target_report uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity record; result jsonb;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 select public.driver_report_projection(r) into result from public.driver_daily_reports r
  where r.id=target_report and r.driver_id=identity.driver_id and r.region_id=identity.region_id;
 return result;
end;
$$;

revoke all on function public.driver_report_history(text),public.driver_report_detail(uuid) from public,anon,authenticated;
grant execute on function public.driver_report_history(text),public.driver_report_detail(uuid) to authenticated;
commit;
