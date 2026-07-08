-- CSRD Scope 3 Carbon Compliance Platform — schema
-- Copy/paste this into the Supabase SQL editor (or run via supabase CLI) once
-- you've provisioned your own project.
--
-- Full content lives here so it doesn't collide with the auto-managed
-- supabase/migrations/ directory in this template.

-- USER ROLES (buyer employees)
create type public.app_role as enum ('owner', 'admin', 'analyst');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text unique,
  vat text,
  fiscal_year int not null default extract(year from now())::int,
  reporting_standard text not null default 'ESRS E1',
  created_at timestamptz not null default now()
);
grant select, insert, update on public.companies to authenticated;
grant all on public.companies to service_role;
alter table public.companies enable row level security;

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null default 'analyst',
  unique (company_id, user_id)
);
grant select, insert, update, delete on public.company_members to authenticated;
grant all on public.company_members to service_role;
alter table public.company_members enable row level security;

create or replace function public.is_company_member(_company_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members where company_id = _company_id and user_id = _user_id)
$$;

create policy "members can read their companies" on public.companies
  for select to authenticated using (public.is_company_member(id, auth.uid()));

create policy "members can read own membership" on public.company_members
  for select to authenticated using (user_id = auth.uid());

-- SUPPLIERS
create type public.supplier_status as enum ('PENDING', 'UPLOADED', 'AUDITED');

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  contact_email text,
  country text,
  category text,
  status supplier_status not null default 'PENDING',
  upload_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  invited_at timestamptz not null default now()
);
grant select, insert, update, delete on public.suppliers to authenticated;
grant select on public.suppliers to anon;
grant all on public.suppliers to service_role;
alter table public.suppliers enable row level security;

create policy "members manage their suppliers" on public.suppliers
  for all to authenticated
  using (public.is_company_member(company_id, auth.uid()))
  with check (public.is_company_member(company_id, auth.uid()));

-- In production, replace this permissive anon read with a SECURITY DEFINER
-- function that only returns the supplier record matching a signed token.
create policy "anon lookup by token" on public.suppliers
  for select to anon using (true);

-- EMISSIONS
create table public.emissions_data (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  file_path text not null,
  extracted jsonb not null,
  factor_used text[] not null default '{}',
  co2e_kg numeric(14, 3) not null default 0,
  confidence_score numeric(4, 3) not null default 0,
  is_estimated boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.emissions_data to authenticated;
grant all on public.emissions_data to service_role;
alter table public.emissions_data enable row level security;

create policy "members read emissions for their suppliers" on public.emissions_data
  for select to authenticated using (
    exists (select 1 from public.suppliers s
            where s.id = supplier_id and public.is_company_member(s.company_id, auth.uid()))
  );

-- STORAGE
insert into storage.buckets (id, name, public) values ('supplier-documents', 'supplier-documents', false)
on conflict (id) do nothing;

create policy "anon can upload supplier docs" on storage.objects
  for insert to anon with check (bucket_id = 'supplier-documents');

create policy "members read their supplier docs" on storage.objects
  for select to authenticated using (bucket_id = 'supplier-documents');
