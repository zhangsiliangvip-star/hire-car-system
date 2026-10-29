-- Run only on zsipqwipauzgbqvppwjf after 002-driver-identity.sql.
-- All synthetic Auth users, profiles, drivers, regions, links and audit events roll back.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create temporary table driver_identity_results (
  test_name text primary key,
  passed boolean not null check (passed)
) on commit drop;
grant select, insert on driver_identity_results to authenticated, anon;

insert into public.regions (id, name) values
  ('d2000000-0000-4000-8000-000000000001', 'Identity Test A'),
  ('d2000000-0000-4000-8000-000000000002', 'Identity Test B');
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-4000-8000-000000000001', 'identity-admin@example.invalid', '{}'),
  ('d1000000-0000-4000-8000-000000000002', 'identity-staff@example.invalid', '{}'),
  ('d1000000-0000-4000-8000-000000000003', 'identity-driver-a@example.invalid', '{"account_type":"staff","role":"admin"}'),
  ('d1000000-0000-4000-8000-000000000004', 'identity-driver-a2@example.invalid', '{}'),
  ('d1000000-0000-4000-8000-000000000005', 'identity-driver-b@example.invalid', '{}'),
  ('d1000000-0000-4000-8000-000000000006', 'identity-pending@example.invalid', '{}');

insert into driver_identity_results
select 'new Auth users default pending despite forged metadata',
       count(*) = 6 and bool_and(account_type = 'pending' and role = 'user')
from public.profiles where id::text like 'd1000000-%';

update public.profiles
set account_type = 'staff', role = case when id::text like '%0001' then 'admin' else 'user' end,
    region_id = 'd2000000-0000-4000-8000-000000000001'
where id in ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002');
update public.profiles set region_id = 'd2000000-0000-4000-8000-000000000002'
where id = 'd1000000-0000-4000-8000-000000000006';
insert into public.drivers (id, name, region_id) values
  ('d3000000-0000-4000-8000-000000000001', 'Identity Driver A', 'd2000000-0000-4000-8000-000000000001'),
  ('d3000000-0000-4000-8000-000000000002', 'Identity Driver A2', 'd2000000-0000-4000-8000-000000000001'),
  ('d3000000-0000-4000-8000-000000000003', 'Identity Driver B', 'd2000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select public.bind_driver_identity('d1000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000001');
select public.bind_driver_identity('d1000000-0000-4000-8000-000000000004', 'd3000000-0000-4000-8000-000000000002');
select public.bind_driver_identity('d1000000-0000-4000-8000-000000000005', 'd3000000-0000-4000-8000-000000000003');

do $$
begin
  begin
    perform public.bind_driver_identity('d1000000-0000-4000-8000-000000000006', 'd3000000-0000-4000-8000-000000000001');
    raise exception 'Cross-region bind unexpectedly allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.bind_driver_identity('d1000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000002');
    raise exception 'Duplicate user bind unexpectedly allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.bind_driver_identity('d1000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001');
    raise exception 'Administrator self-binding unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
insert into driver_identity_results values
  ('admin binding; cross-region, duplicate and self-binding rejected', true);

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
insert into driver_identity_results
select 'driver identity returns only self', count(*) = 1
  and bool_and(driver_id = 'd3000000-0000-4000-8000-000000000001'
               and region_id = 'd2000000-0000-4000-8000-000000000001')
from public.driver_identity();
insert into driver_identity_results
select 'driver is neither staff nor administrator', not public.is_staff() and not public.is_admin();
insert into driver_identity_results
select 'driver sees own profile only', count(*) = 1
from public.profiles;

do $$
declare target text; visible bigint; affected bigint;
begin
  foreach target in array array['orders','drivers','vehicles','companies','order_sources',
                                'vehicle_monthly_finances','balance_expense_items'] loop
    execute format('select count(*) from public.%I', target) into visible;
    if visible <> 0 then raise exception 'Driver read leaked from %', target; end if;
    execute format('delete from public.%I where id = $1', target)
      using 'd3000000-0000-4000-8000-000000000001'::uuid;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Driver delete succeeded on %', target; end if;
  end loop;
  begin
    insert into public.drivers (name) values ('Forbidden driver write');
    raise exception 'Driver insert unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  update public.drivers set name = 'Forbidden' where id = 'd3000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Driver update unexpectedly allowed'; end if;
  begin
    update public.profiles set account_type = 'staff' where id = (select auth.uid());
    raise exception 'Self-promotion unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.bind_driver_identity('d1000000-0000-4000-8000-000000000006', 'd3000000-0000-4000-8000-000000000001');
    raise exception 'Driver binding RPC unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_driver_identity_status('d3000000-0000-4000-8000-000000000001', 'suspended', 1);
    raise exception 'Driver status-admin RPC unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.driver_auth_links;
    raise exception 'Raw link table read unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.driver_identity_audit;
    raise exception 'Raw audit table read unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
insert into driver_identity_results values
  ('driver direct REST-equivalent reads and writes denied on all seven legacy tables', true),
  ('driver cannot promote, bind, administrate identities or read raw links/audit', true);

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
insert into driver_identity_results
select 'same-region second driver sees only self', count(*) = 1
  and bool_and(driver_id = 'd3000000-0000-4000-8000-000000000002')
from public.driver_identity();
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000005', true);
insert into driver_identity_results
select 'different-region driver sees only self', count(*) = 1
  and bool_and(driver_id = 'd3000000-0000-4000-8000-000000000003'
               and region_id = 'd2000000-0000-4000-8000-000000000002')
from public.driver_identity();

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000006', true);
insert into driver_identity_results
select 'pending identity has no business access',
  not public.is_staff() and not public.is_admin()
  and not exists (select 1 from public.driver_identity())
  and not exists (select 1 from public.orders)
  and not exists (select 1 from public.drivers);

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
insert into driver_identity_results
select 'ordinary staff retains inspected legacy visibility',
  public.is_staff() and not public.is_admin()
  and (select count(*) from public.orders) = 7
  and exists (select 1 from public.drivers where id = 'd3000000-0000-4000-8000-000000000003');
do $$
begin
  begin
    perform public.bind_driver_identity('d1000000-0000-4000-8000-000000000006', 'd3000000-0000-4000-8000-000000000001');
    raise exception 'Non-admin staff binding unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
insert into driver_identity_results values ('ordinary staff cannot bind identities', true);

select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select public.set_driver_identity_status('d3000000-0000-4000-8000-000000000001', 'suspended', 1);
do $$
begin
  begin
    perform public.set_driver_identity_status('d3000000-0000-4000-8000-000000000001', 'active', 1);
    raise exception 'Stale version unexpectedly accepted';
  exception when serialization_failure then null; end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
insert into driver_identity_results
select 'suspension immediately removes identity and preserves staff denial',
  not exists (select 1 from public.driver_identity())
  and not public.is_staff() and not exists (select 1 from public.orders);
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select public.set_driver_identity_status('d3000000-0000-4000-8000-000000000001', 'active', 2);
select public.set_driver_identity_status('d3000000-0000-4000-8000-000000000001', 'revoked', 3);
do $$
begin
  begin
    perform public.set_driver_identity_status('d3000000-0000-4000-8000-000000000001', 'active', 4);
    raise exception 'Revoked identity reactivated';
  exception when invalid_parameter_value then null; end;
end;
$$;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);
insert into driver_identity_results
select 'revocation immediately removes identity', not exists (select 1 from public.driver_identity());

reset role;
do $$
begin
  begin
    update public.profiles set region_id = 'd2000000-0000-4000-8000-000000000002'
      where id = 'd1000000-0000-4000-8000-000000000004';
    raise exception 'Linked profile region drift accepted';
  exception when foreign_key_violation then null; end;
  begin
    update public.profiles set account_type = 'staff'
      where id = 'd1000000-0000-4000-8000-000000000004';
    raise exception 'Linked driver promoted to staff';
  exception when foreign_key_violation then null; end;
  begin
    update public.driver_auth_links set user_id = 'd1000000-0000-4000-8000-000000000004'
      where driver_id = 'd3000000-0000-4000-8000-000000000003';
    raise exception 'Duplicate user assignment accepted';
  exception when unique_violation or foreign_key_violation then null; end;
end;
$$;
insert into driver_identity_results values
  ('version conflicts and revoked reactivation rejected', true),
  ('composite constraints prevent region drift, role escalation and duplicate user', true);
insert into driver_identity_results
select 'binding and status audit generated by server',
  count(*) = 6 and count(*) filter (where event_type = 'linked') = 3
  and bool_and(actor_user_id = 'd1000000-0000-4000-8000-000000000001')
from public.driver_identity_audit;

set local role anon;
do $$
begin
  begin
    perform public.driver_identity();
    raise exception 'Anonymous identity RPC unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.bind_driver_identity('d1000000-0000-4000-8000-000000000006', 'd3000000-0000-4000-8000-000000000001');
    raise exception 'Anonymous bind RPC unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
insert into driver_identity_results values ('anonymous RPC access denied', true);
reset role;
select count(*) as passed_checks, bool_and(passed) as all_passed,
       'ROLLBACK: synthetic users and all fixtures are discarded' as fixture_policy
from driver_identity_results;
rollback;
