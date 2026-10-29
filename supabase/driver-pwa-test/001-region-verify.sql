begin transaction read only;
set local statement_timeout = '10s';

select 'region_columns' as check_name,
       jsonb_build_object(
         'count', count(*),
         'nullable', bool_and(is_nullable = 'YES'),
         'no_default', bool_and(column_default is null)
       ) as result
from information_schema.columns
where table_schema = 'public' and column_name = 'region_id'
union all
select 'regions',
       jsonb_build_object(
         'rows', (select count(*) from public.regions),
         'rls', c.relrowsecurity,
         'anon_select', has_table_privilege('anon', 'public.regions', 'SELECT'),
         'authenticated_select', has_table_privilege('authenticated', 'public.regions', 'SELECT')
       )
from pg_catalog.pg_class c where c.oid = 'public.regions'::regclass
union all
select 'legacy_orders',
       jsonb_build_object('count', count(*), 'assigned_region_count', count(region_id))
from public.orders
union all
select 'legacy_profiles',
       jsonb_build_object('count', count(*), 'assigned_region_count', count(region_id))
from public.profiles;
rollback;
