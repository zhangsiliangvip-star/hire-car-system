begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table public.driver_report_drafts (
  driver_id uuid not null,
  region_id uuid not null,
  service_date date not null,
  report_id uuid references public.driver_daily_reports(id) on delete cascade,
  report_version bigint not null default 0 check(report_version>=0),
  assignment text not null default '' check(length(assignment)<=100),
  fields jsonb not null default '{}'::jsonb
    check(jsonb_typeof(fields)='object' and octet_length(fields::text)<=120000),
  stop_ids jsonb not null default '[]'::jsonb
    check(jsonb_typeof(stop_ids)='array' and jsonb_array_length(stop_ids)<=100),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id),
  primary key(driver_id,service_date),
  foreign key(driver_id,region_id) references public.drivers(id,region_id) on delete cascade,
  check((report_id is null and report_version=0) or report_id is not null)
);
alter table public.driver_report_drafts enable row level security;
revoke all on public.driver_report_drafts from public,anon,authenticated;
create index driver_report_drafts_updated on public.driver_report_drafts(driver_id,updated_at desc);

create function public.driver_report_drafts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare identity record;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Driver required' using errcode='42501'; end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'serviceDate',d.service_date,'reportId',d.report_id,'version',d.report_version,
   'assignment',d.assignment,'fields',d.fields,'stopIds',d.stop_ids)
   order by d.updated_at desc)
  from (select * from public.driver_report_drafts
   where driver_id=identity.driver_id and region_id=identity.region_id
   order by updated_at desc limit 31) d
 ),'[]'::jsonb);
end;
$$;

create function public.driver_report_draft_save(
 target_service_date date,target_report uuid,target_version bigint,target_assignment text,
 target_fields jsonb,target_stop_ids jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 identity record; r public.driver_daily_reports%rowtype; previous public.driver_report_drafts%rowtype;
 previous_found boolean;
 stamp timestamptz:=clock_timestamp();
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Active driver required' using errcode='42501'; end if;
 if target_service_date is null or target_version is null or target_version<0
  or target_assignment is null or length(target_assignment)>100
  or jsonb_typeof(target_fields) is distinct from 'object'
  or jsonb_typeof(target_stop_ids) is distinct from 'array'
  or (select count(*) from jsonb_object_keys(target_fields))>800 or octet_length(target_fields::text)>120000
  or jsonb_array_length(target_stop_ids)>100
  or exists(select 1 from jsonb_each(target_fields) f
   where length(f.key)>150 or jsonb_typeof(f.value) is distinct from 'string' or length(f.value#>>'{}')>400)
  or exists(select 1 from jsonb_array_elements_text(target_stop_ids) s(value)
   where s.value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  or (select count(*)<>count(distinct value) from jsonb_array_elements_text(target_stop_ids) s(value)) then
  raise exception 'Invalid report draft' using errcode='22023';
 end if;

 select * into previous from public.driver_report_drafts
  where driver_id=identity.driver_id and service_date=target_service_date for update;
 previous_found:=found;
 if target_report is null then
  if target_version<>0 or exists(select 1 from public.driver_daily_reports
    where driver_id=identity.driver_id and region_id=identity.region_id and returned_at is null) then
   raise exception 'An active report exists or draft version is invalid' using errcode='40001';
  end if;
  if previous_found and previous.report_id is not null then
   raise exception 'Draft is already linked to a report' using errcode='40001';
  end if;
 else
  select * into r from public.driver_daily_reports
   where id=target_report and driver_id=identity.driver_id and region_id=identity.region_id
    and service_date=target_service_date and returned_at is null for update;
  if not found or r.version<>target_version then
   raise exception 'Report version changed or report is unavailable' using errcode='40001';
  end if;
  if previous_found and previous.report_id is not null and previous.report_id<>target_report then
   raise exception 'Draft belongs to another report' using errcode='40001';
  end if;
  delete from public.driver_report_drafts
   where driver_id=identity.driver_id and region_id=identity.region_id
    and report_id=target_report and service_date<>target_service_date;
 end if;

 insert into public.driver_report_drafts(driver_id,region_id,service_date,report_id,report_version,
  assignment,fields,stop_ids,updated_at,updated_by)
 values(identity.driver_id,identity.region_id,target_service_date,target_report,target_version,
  target_assignment,target_fields,target_stop_ids,stamp,(select auth.uid()))
 on conflict(driver_id,service_date) do update set
  report_id=excluded.report_id,report_version=excluded.report_version,assignment=excluded.assignment,
  fields=excluded.fields,stop_ids=excluded.stop_ids,updated_at=excluded.updated_at,updated_by=excluded.updated_by
 returning * into previous;
 return jsonb_build_object('serviceDate',previous.service_date,'reportId',previous.report_id,
  'version',previous.report_version,'assignment',previous.assignment,'fields',previous.fields,'stopIds',previous.stop_ids);
end;
$$;

create function public.clear_driver_report_draft_on_return() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from public.driver_report_drafts
  where driver_id=new.driver_id and region_id=new.region_id
   and service_date=new.service_date and report_id=new.id;
 return new;
end;
$$;
create function public.driver_report_draft_delete(target_service_date date) returns void
language plpgsql security definer set search_path='' as $$
declare identity record;
begin
 select * into identity from public.driver_identity();
 if not found then raise exception 'Active driver required' using errcode='42501'; end if;
 delete from public.driver_report_drafts
  where driver_id=identity.driver_id and region_id=identity.region_id
   and service_date=target_service_date;
end;
$$;
create trigger driver_report_draft_cleanup_after_return
 after update of returned_at on public.driver_daily_reports
 for each row when (old.returned_at is null and new.returned_at is not null)
 execute function public.clear_driver_report_draft_on_return();

revoke all on function public.driver_report_drafts(),
 public.driver_report_draft_save(date,uuid,bigint,text,jsonb,jsonb),
 public.driver_report_draft_delete(date), public.clear_driver_report_draft_on_return()
 from public,anon,authenticated;
grant execute on function public.driver_report_drafts(),
 public.driver_report_draft_save(date,uuid,bigint,text,jsonb,jsonb),
 public.driver_report_draft_delete(date) to authenticated;

commit;
