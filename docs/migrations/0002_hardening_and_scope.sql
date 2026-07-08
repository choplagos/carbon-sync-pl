-- 0002_hardening_and_scope.sql
-- Extends 0001 (docs/supabase-schema.sql). Run after the base schema.
-- Fixes: (a) anon-readable-all-suppliers RLS hole, (b) missing scope 1/2/3
-- separation, (c) no audit trail, (d) unversioned emission factors,
-- (e) mutable reports with no assurance-grade snapshot.

-- ============================================================
-- A. FIX: token-scoped anon access to suppliers (was `using (true)`)
-- ============================================================
drop policy if exists "anon lookup by token" on public.suppliers;

-- Suppliers are looked up by their own upload_token, never listed.
-- This function is the ONLY way an anon caller can read a supplier row,
-- and it returns exactly one row (or none) — never the full table.
create or replace function public.get_supplier_by_token(_token text)
returns table (
  id uuid,
  name text,
  country text,
  category text,
  status public.supplier_status
) language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.country, s.category, s.status
  from public.suppliers s
  where s.upload_token = _token
$$;

revoke all on function public.get_supplier_by_token(text) from public;
grant execute on function public.get_supplier_by_token(text) to anon, authenticated;

-- No blanket anon SELECT policy is (re)created on public.suppliers.
-- Anonymous clients now have zero direct table privileges; all token-based
-- lookups go through the SECURITY DEFINER function above.
revoke select on public.suppliers from anon;

-- ============================================================
-- B. Scope 1 / 2 / 3 + GHG Protocol category separation
-- ============================================================
create type public.ghg_scope as enum ('scope_1', 'scope_2', 'scope_3');

-- GHG Protocol Scope 3 has 15 standard categories. Scope 1/2 rows use
-- ghg_category = null (they aren't categorized the same way).
alter table public.emissions_data
  add column if not exists scope public.ghg_scope not null default 'scope_3',
  add column if not exists ghg_category smallint,
  add constraint emissions_data_ghg_category_range
    check (ghg_category is null or (ghg_category between 1 and 15)),
  add constraint emissions_data_scope3_requires_category
    check (scope <> 'scope_3' or ghg_category is not null);

comment on column public.emissions_data.ghg_category is
  'GHG Protocol Scope 3 category 1-15. Null for scope_1/scope_2 rows. '
  '1=Purchased goods & services, 4=Upstream transportation, 6=Business travel, '
  '7=Employee commuting, etc. — see GHG Protocol Scope 3 Standard Table 5.2.';

-- ============================================================
-- C. Emission factors: versioned, referenced (not just stored as text[])
-- ============================================================
create table public.emission_factors (
  id uuid primary key default gen_random_uuid(),
  source text not null,               -- e.g. 'DEFRA', 'EPA', 'ADEME', 'IPCC_AR6'
  version text not null,               -- e.g. '2023_v3.1'
  factor_key text not null,            -- e.g. 'energy:natural_gas', 'material:steel'
  unit text not null,                  -- e.g. 'kg_co2e_per_kwh', 'kg_co2e_per_kg'
  value numeric(12, 6) not null,
  valid_from date not null default '2000-01-01',
  valid_to date,                       -- null = still current
  created_at timestamptz not null default now(),
  unique (source, version, factor_key)
);
grant select on public.emission_factors to authenticated, anon;
grant all on public.emission_factors to service_role;
alter table public.emission_factors enable row level security;

-- Reference data is public read (it's not tenant-scoped or sensitive).
create policy "anyone can read emission factors" on public.emission_factors
  for select to authenticated, anon using (true);

-- Link each emissions_data row to the exact factor version applied.
alter table public.emissions_data
  add column if not exists emission_factor_id uuid references public.emission_factors(id);

-- Seed the factors currently hardcoded in src/lib/carbon-factors.ts so the
-- app can be switched from static constants to a DB-backed lookup.
insert into public.emission_factors (source, version, factor_key, unit, value) values
  ('DEFRA', '2023_v3.1', 'energy:electricity_eu_grid', 'kg_co2e_per_kwh', 0.253),
  ('DEFRA', '2023_v3.1', 'energy:electricity_us_grid', 'kg_co2e_per_kwh', 0.386),
  ('DEFRA', '2023_v3.1', 'energy:natural_gas',         'kg_co2e_per_kwh', 0.202),
  ('DEFRA', '2023_v3.1', 'energy:diesel',              'kg_co2e_per_l',   2.68),
  ('DEFRA', '2023_v3.1', 'energy:gasoline',             'kg_co2e_per_l',   2.31),
  ('DEFRA', '2023_v3.1', 'energy:heating_oil',          'kg_co2e_per_l',   2.52),
  ('DEFRA', '2023_v3.1', 'energy:lpg',                  'kg_co2e_per_kg',  2.94),
  ('DEFRA', '2023_v3.1', 'energy:coal',                 'kg_co2e_per_kg',  2.42),
  ('DEFRA', '2023_v3.1', 'material:steel',              'kg_co2e_per_kg',  1.85),
  ('DEFRA', '2023_v3.1', 'material:aluminum',           'kg_co2e_per_kg',  8.24),
  ('DEFRA', '2023_v3.1', 'material:plastic_pet',        'kg_co2e_per_kg',  3.15),
  ('DEFRA', '2023_v3.1', 'material:plastic_hdpe',       'kg_co2e_per_kg',  2.02),
  ('DEFRA', '2023_v3.1', 'material:cardboard',          'kg_co2e_per_kg',  0.94),
  ('DEFRA', '2023_v3.1', 'material:paper',              'kg_co2e_per_kg',  1.09),
  ('DEFRA', '2023_v3.1', 'material:glass',              'kg_co2e_per_kg',  0.85),
  ('DEFRA', '2023_v3.1', 'material:concrete',           'kg_co2e_per_kg',  0.11),
  ('DEFRA', '2023_v3.1', 'material:cotton',             'kg_co2e_per_kg',  8.3)
on conflict (source, version, factor_key) do nothing;

-- ============================================================
-- D. Immutable audit trail (trigger-populated, not app-written)
-- ============================================================
create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id uuid references auth.users(id),
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now()
);
-- No update/delete grants to anyone, including service_role via the API —
-- this table is append-only by design. Direct SQL/superuser access can
-- still modify it, which is an accepted operational trust boundary.
grant select on public.audit_log to authenticated;
grant insert on public.audit_log to service_role;
alter table public.audit_log enable row level security;

create policy "members read their company audit log" on public.audit_log
  for select to authenticated using (public.is_company_member(company_id, auth.uid()));

-- Generic trigger function: resolves company_id from either a direct column
-- or via the suppliers join for emissions_data, and logs before/after state.
create or replace function public.log_audit_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _company_id uuid;
  _row_id uuid;
begin
  if tg_table_name = 'emissions_data' then
    select s.company_id into _company_id
    from public.suppliers s
    where s.id = coalesce(new.supplier_id, old.supplier_id);
    _row_id := coalesce(new.id, old.id);
  elsif tg_table_name = 'suppliers' then
    _company_id := coalesce(new.company_id, old.company_id);
    _row_id := coalesce(new.id, old.id);
  else
    _company_id := coalesce(new.id, old.id); -- companies table itself
    _row_id := coalesce(new.id, old.id);
  end if;

  insert into public.audit_log (company_id, table_name, row_id, action, actor_user_id, before, after)
  values (
    _company_id,
    tg_table_name,
    _row_id,
    tg_op,
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

create trigger audit_emissions_data
  after insert or update or delete on public.emissions_data
  for each row execute function public.log_audit_event();

create trigger audit_suppliers
  after insert or update or delete on public.suppliers
  for each row execute function public.log_audit_event();

-- ============================================================
-- E. Manual correction support (compliance officer overrides an AI value)
-- ============================================================
alter table public.emissions_data
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists override_co2e_kg numeric(14, 3),
  add column if not exists override_reason text;

comment on column public.emissions_data.override_co2e_kg is
  'If set, this value supersedes co2e_kg in all reporting queries. '
  'The original AI-extracted co2e_kg is preserved for audit comparison.';

-- ============================================================
-- F. Frozen report snapshots (not a live view)
-- ============================================================
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fiscal_year int not null,
  reporting_standard text not null default 'ESRS E1',
  status text not null default 'draft' check (status in ('draft', 'final', 'submitted')),
  snapshot jsonb not null,             -- frozen aggregate payload at generation time
  generated_by uuid references auth.users(id),
  generated_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (company_id, fiscal_year, reporting_standard, status)
    deferrable initially deferred
);
grant select, insert on public.reports to authenticated;
grant all on public.reports to service_role;
alter table public.reports enable row level security;

create policy "members manage their reports" on public.reports
  for all to authenticated
  using (public.is_company_member(company_id, auth.uid()))
  with check (public.is_company_member(company_id, auth.uid()));

-- Once a report is 'final' or 'submitted', block further UPDATE at the DB
-- layer — this is what actually enforces "frozen," not just app logic.
create or replace function public.prevent_finalized_report_edits()
returns trigger language plpgsql as $$
begin
  if old.status in ('final', 'submitted') then
    raise exception 'Report % is % and cannot be modified', old.id, old.status;
  end if;
  return new;
end;
$$;

create trigger lock_finalized_reports
  before update on public.reports
  for each row execute function public.prevent_finalized_report_edits();

-- ============================================================
-- G. Role expansion: add supplier_contributor and auditor_readonly
-- ============================================================
alter type public.app_role add value if not exists 'auditor_readonly';
-- Note: supplier-side users authenticate via upload_token, not app_role
-- membership, so no 'supplier_contributor' company_members row is needed —
-- suppliers never become company_members rows for the buyer's company.
