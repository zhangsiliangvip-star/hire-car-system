-- Isolated test project only; all synthetic fixtures rolled back.
begin;
set local statement_timeout='20s';
insert into public.regions(id,name) values('b2000000-0000-4000-8000-000000000001','Automatic rest test');
insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','auto-admin@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','auto-driver@example.invalid','{}');
update public.profiles set account_type='staff',role='admin' where id='b1000000-0000-4000-8000-000000000001';
insert into public.drivers(id,name,region_id) values
 ('b3000000-0000-4000-8000-000000000001','Auto rest driver','b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select public.bind_driver_identity('b1000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $test$
declare r jsonb; item uuid; req uuid:=gen_random_uuid(); n integer;
begin
 for n in 1..2 loop
  r:=public.driver_report_command(null,0,gen_random_uuid(),'checkout','{"useDefault":false,"address":"Synthetic depot","km":100}');
  item:=(r->>'id')::uuid;
  if n=1 then
   -- Simulate an existing legacy manual rest; current UI no longer creates one.
   r:=public.driver_report_command(item,1,gen_random_uuid(),'rest_start','{}');
  end if;
  req:=gen_random_uuid();
  r:=public.driver_report_command(item,(r->>'version')::bigint,req,'return','{"useDefault":false,"address":"Synthetic return","km":100}');
  if r->>'returnedAt' is null then raise exception 'Return failed'; end if;
  if n=1 and r->'rests'->0->>'endedAt' is distinct from r->>'returnedAt' then
   raise exception 'Legacy rest not ended atomically at return'; end if;
  if n=2 and r->'rests'<>'[]'::jsonb then raise exception 'Empty legacy history changed'; end if;
  if public.driver_report_command(item,(r->>'version')::bigint-1,req,'return',
    '{"useDefault":false,"address":"Synthetic return","km":100}')<>r then raise exception 'Replay changed return'; end if;
 end loop;
end;
$test$;
select 'automatic_return_checks_passed' as result;
rollback;
