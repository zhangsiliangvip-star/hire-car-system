-- One-time setup ONLY in zsipqwipauzgbqvppwjf via authorized SQL Editor.
-- Uses the existing staff admin as setup audit actor, not a logged-in driver's session.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $$
declare actor uuid; target uuid; service_day date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if exists(select 1 from public.regions where id='f2000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.drivers where id='f3000000-0000-4000-8000-000000000001')
     or exists(select 1 from public.orders where id in (
       'f4000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000002')) then
    raise exception 'Demo setup already exists; inspect instead of rerunning';
  end if;
  select id into actor from public.profiles
    where account_type='staff' and role='admin' order by id limit 1;
  select p.id into target from public.profiles p join auth.users u on u.id=p.id
    where u.email='driver-a@pwa-test.example.com' and u.email_confirmed_at is not null
      and p.account_type='pending' and p.role='user' for update of p;
  if actor is null or target is null then raise exception 'Confirmed pending test user and staff admin required'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.regions(id,name) values
    ('f2000000-0000-4000-8000-000000000001','PWA测试地域（虚构）');
  insert into public.drivers(id,name,region_id) values
    ('f3000000-0000-4000-8000-000000000001','测试司机A','f2000000-0000-4000-8000-000000000001');
  perform public.bind_driver_identity(target,'f3000000-0000-4000-8000-000000000001');
  insert into public.orders(id,date,end_date,status,pickup,destination,time,vehicle,region_id) values
    ('f4000000-0000-4000-8000-000000000001',service_day,service_day,'予約確定',
     '测试机场 · 第一航站楼','测试酒店 · 东京市区','13:30','测试埃尔法（虚构）','f2000000-0000-4000-8000-000000000001'),
    ('f4000000-0000-4000-8000-000000000002',service_day+1,service_day+1,'予約確定',
     '测试酒店 · 东京市区','测试景点 · 浅草','09:00','测试埃尔法（虚构）','f2000000-0000-4000-8000-000000000001');
  perform public.dispatch_test_driver_order('f4000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',service_day);
  perform public.dispatch_test_driver_order('f4000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000001',service_day+1);
end;
$$;
select 'demo_driver_a_ready' as result;
commit;
