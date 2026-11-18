begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $patch$
declare definition text; needle text;
begin
 definition:=replace(pg_get_functiondef(
  'public.staff_switch_advance_category(uuid,date,uuid,bigint,text)'::regprocedure),chr(13),'');
 if position('set expenses=''[]'',version=version+1' in definition)=0
  or position('select * into dest from public.driver_finance_claims' in definition)=0 then
  raise exception 'Unexpected advance switch definition'; end if;
 definition:=replace(definition,'staff_switch_advance_category(', 'staff_switch_advance_item(');
 definition:=replace(definition,'target_category text)', 'target_category text, target_expense uuid)');
 definition:=replace(definition,'moved jsonb;', 'moved jsonb; remaining jsonb; original_amount numeric;');
 needle:='select * into dest from public.driver_finance_claims';
 definition:=replace(definition,needle,$code$
 select coalesce(sum((e->>'amount')::numeric),0) into original_amount from jsonb_array_elements(c.expenses) e;
 if target_expense is null then remaining:='[]';
 else
  select coalesce(jsonb_agg(e order by n),'[]') into remaining
   from jsonb_array_elements(c.expenses) with ordinality x(e,n) where e->>'id'<>target_expense::text;
  select coalesce(jsonb_agg(e order by n),'[]') into c.expenses
   from jsonb_array_elements(c.expenses) with ordinality x(e,n) where e->>'id'=target_expense::text;
  if jsonb_array_length(c.expenses)<>1 then
   raise exception 'Expense changed; refresh' using errcode='40001'; end if;
 end if;
 select * into dest from public.driver_finance_claims
 $code$);
 definition:=replace(definition,'if source_amount<amount then','if source_amount<original_amount then');
 definition:=replace(definition,'set expenses=''[]'',version=version+1',
  'set expenses=remaining,version=version+1');
 execute definition;
 definition:=replace(pg_get_functiondef('public.staff_order_advances(uuid,date)'::regprocedure),chr(13),'');
 needle:='''version'',c.version,''amount''';
 if position(needle in definition)=0 then raise exception 'Unexpected advance list definition'; end if;
 definition:=replace(definition,needle,'''expenses'',c.expenses,''version'',c.version,''amount''');
 execute definition;
end;
$patch$;

create or replace function public.staff_switch_advance_category(target_order uuid,target_date date,target_claim uuid,
 expected_version bigint,target_category text) returns jsonb
language sql security definer set search_path='' as $$
 select public.staff_switch_advance_item(target_order,target_date,target_claim,expected_version,target_category,null);
$$;
revoke all on function public.staff_switch_advance_item(uuid,date,uuid,bigint,text,uuid) from public,anon;
grant execute on function public.staff_switch_advance_item(uuid,date,uuid,bigint,text,uuid) to authenticated;
commit;
