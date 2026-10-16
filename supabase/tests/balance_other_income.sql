begin;

do $$
declare
  v_income uuid := gen_random_uuid();
  v_expense uuid := gen_random_uuid();
  v_company text := gen_random_uuid()::text;
begin
  insert into public.balance_expense_items (id, region_id, company_name, name, monthly_amounts)
    values (v_expense, '60000000-0000-4000-8000-000000000001', v_company, 'Same project', '{"2026-10":400}');
  insert into public.balance_expense_items (id, region_id, company_name, kind, name, monthly_amounts)
    values (v_income, '60000000-0000-4000-8000-000000000001', v_company, 'income', 'Same project', '{"2026-10":200,"2026-11":300}');
  if not exists (select 1 from public.balance_expense_items where id = v_expense and kind = 'expense') then
    raise exception 'Existing/default projects must remain expenses';
  end if;
  update public.balance_expense_items set monthly_amounts = '{"2026-10":500,"2026-11":300}'
    where id = v_income;
  if not exists (select 1 from public.balance_expense_items where id = v_income
    and monthly_amounts ->> '2026-10' = '500' and monthly_amounts ->> '2026-11' = '300'
    and last_operation is not null) then
    raise exception 'Income must persist per month with operation metadata';
  end if;
  begin
    insert into public.balance_expense_items (region_id, company_name, kind, name)
      values ('60000000-0000-4000-8000-000000000001', v_company, 'invalid', 'Bad');
    raise exception 'Invalid classification accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.balance_expense_items (region_id, company_name, kind, name)
      values ('60000000-0000-4000-8000-000000000001', v_company, 'income', 'Same project');
    raise exception 'Duplicate same-kind project accepted';
  exception when unique_violation then null;
  end;
  delete from public.balance_expense_items where id = v_income;
  if (select count(*) from public.audit_logs where record_id = v_income) <> 3 then
    raise exception 'Income insert, update and delete history must be retained';
  end if;
  if not exists (select 1 from public.audit_logs where record_id = v_income
    and action = 'DELETE' and before_data ->> 'kind' = 'income'
    and before_data -> 'monthly_amounts' ->> '2026-10' = '500') then
    raise exception 'Deleted income details must remain in history';
  end if;
end;
$$;

select 'PASS: default expenses preserved, income/expense same names isolated, monthly income persisted, invalid/duplicate kinds rejected, complete income history retained' as result;
rollback;
