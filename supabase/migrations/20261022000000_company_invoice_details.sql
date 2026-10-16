alter table public.companies
  add column bank_account text not null default '',
  add column tax_registration_number text not null default ''
    check (tax_registration_number = '' or tax_registration_number ~ '^T[0-9]{13}$');
