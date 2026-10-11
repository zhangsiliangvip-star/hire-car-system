create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  company text not null default '',
  position text not null default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  email_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  vehicle text not null default '',
  date date not null,
  end_date date not null,
  off_dates date[] not null default '{}',
  customer text not null default '',
  phone text not null default '',
  pickup text not null default '',
  destination text not null default '',
  time text not null default '',
  status text not null check (status in ('仮予約', '予約確定', '運行中', '完了', 'キャンセル')),
  notes text not null default '',
  driver text not null default '',
  order_source text not null default '',
  company text not null default '',
  sales_rep text not null default ''
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text not null default '',
  wechat text not null default '',
  whatsapp text not null default '',
  license_expiry date
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plate text not null default '',
  owner_company text not null default '',
  seats text not null default '',
  fuel_type text not null default '',
  inspection_expiry date,
  liability_expiry date,
  notes text not null default '',
  status text not null default '运营中' check (status in ('运营中', '停运中'))
);

create table public.order_sources (
  id uuid primary key default gen_random_uuid(),
  company_name text not null unique,
  contact_name text not null default '',
  contact_info text not null default '',
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$')
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  operations_manager text not null default '',
  maintenance_manager text not null default '',
  phone text not null default '',
  roll_call_address text not null default '',
  garage_address text not null default ''
);

create index orders_date_range_idx on public.orders (date, end_date);
create index vehicles_owner_company_idx on public.vehicles (owner_company);
create unique index vehicles_plate_unique_idx on public.vehicles (plate) where plate <> '';

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create function public.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id, email, full_name, company, position, email_confirmed
  )
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'company', ''),
    coalesce(new.raw_user_meta_data ->> 'position', ''),
    new.email_confirmed_at is not null
  )
  on conflict (id) do update set
    email = excluded.email,
    email_confirmed = excluded.email_confirmed;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.handle_auth_user();

revoke all on function public.handle_auth_user() from public, anon, authenticated;

create function public.prevent_last_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_count integer;
begin
  if old.role <> 'admin' or (tg_op = 'UPDATE' and new.role = 'admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(1819047530);

  select count(*) into admin_count
  from public.profiles
  where role = 'admin';

  if admin_count <= 1 then
    raise exception 'Cannot remove the last administrator';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.prevent_last_admin_removal() from public, anon, authenticated;

create trigger prevent_last_admin_removal
  before delete or update of role on public.profiles
  for each row execute function public.prevent_last_admin_removal();

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.order_sources enable row level security;
alter table public.companies enable row level security;

revoke all on public.profiles, public.orders, public.drivers, public.vehicles,
  public.order_sources, public.companies from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.orders, public.drivers, public.vehicles,
  public.order_sources, public.companies to authenticated;

create policy "Users can read own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "Admins can read all profiles"
  on public.profiles for select to authenticated
  using ((select public.is_admin()));

create policy "Authenticated users can manage orders"
  on public.orders for all to authenticated
  using (true) with check (true);
create policy "Authenticated users can manage drivers"
  on public.drivers for all to authenticated
  using (true) with check (true);
create policy "Authenticated users can manage vehicles"
  on public.vehicles for all to authenticated
  using (true) with check (true);
create policy "Authenticated users can manage order sources"
  on public.order_sources for all to authenticated
  using (true) with check (true);
create policy "Authenticated users can manage companies"
  on public.companies for all to authenticated
  using (true) with check (true);

insert into public.vehicles (id, name, plate) values
  ('10000000-0000-4000-8000-000000000001', 'Alphard 01', ''),
  ('10000000-0000-4000-8000-000000000002', 'Alphard 02', ''),
  ('10000000-0000-4000-8000-000000000003', 'Alphard 03', ''),
  ('10000000-0000-4000-8000-000000000004', 'Hiace 01', ''),
  ('10000000-0000-4000-8000-000000000005', 'Crown 01', '');

insert into public.drivers (id, name) values
  ('20000000-0000-4000-8000-000000000001', '藤原 拓也'),
  ('20000000-0000-4000-8000-000000000002', 'CHO / FUSHIN'),
  ('20000000-0000-4000-8000-000000000003', 'FUJIWARA / TAKUYA');

insert into public.order_sources (id, company_name, color) values
  ('30000000-0000-4000-8000-000000000001', '直接客户', '#0f766e'),
  ('30000000-0000-4000-8000-000000000002', '合作公司', '#2563eb'),
  ('30000000-0000-4000-8000-000000000003', '旅行社', '#7c3aed'),
  ('30000000-0000-4000-8000-000000000004', '网络平台', '#ea580c'),
  ('30000000-0000-4000-8000-000000000005', '其他', '#475569');

insert into public.companies (id, name) values
  ('40000000-0000-4000-8000-000000000001', '本公司'),
  ('40000000-0000-4000-8000-000000000002', '合作公司 A'),
  ('40000000-0000-4000-8000-000000000003', '合作公司 B');

insert into public.orders (
  id, vehicle, date, end_date, customer, pickup, destination, time, status
) values
  ('50000000-0000-4000-8000-000000000001', 'Alphard 01', '2026-09-30', '2026-09-30', '王先生', '东京', '成田机场', '08:30', '予約確定'),
  ('50000000-0000-4000-8000-000000000002', 'Alphard 02', '2026-10-02', '2026-10-02', '田中様', '羽田机场', '银座', '14:00', '予約確定');
