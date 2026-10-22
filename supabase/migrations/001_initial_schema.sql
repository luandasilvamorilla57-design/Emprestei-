create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Caixa principal',
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  whatsapp text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  principal numeric(14,2) not null check (principal > 0),
  total_receivable numeric(14,2) not null check (total_receivable >= principal),
  due_date date not null,
  loan_date date not null default current_date,
  status text not null default 'open' check (status in ('open','paid','renegotiated','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  loan_id uuid not null references public.loans(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists clients_owner_idx on public.clients(owner_id);
create index if not exists loans_owner_idx on public.loans(owner_id);
create index if not exists loans_client_idx on public.loans(client_id);
create index if not exists loans_due_date_idx on public.loans(due_date);
create index if not exists payments_owner_idx on public.payments(owner_id);
create index if not exists payments_loan_idx on public.payments(loan_id);

alter table public.profiles enable row level security;
alter table public.cash_accounts enable row level security;
alter table public.clients enable row level security;
alter table public.loans enable row level security;
alter table public.payments enable row level security;

create policy "profiles_owner_select" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_owner_insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_owner_update" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "cash_owner_select" on public.cash_accounts for select to authenticated using ((select auth.uid()) = owner_id);
create policy "cash_owner_insert" on public.cash_accounts for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "cash_owner_update" on public.cash_accounts for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "cash_owner_delete" on public.cash_accounts for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "clients_owner_select" on public.clients for select to authenticated using ((select auth.uid()) = owner_id);
create policy "clients_owner_insert" on public.clients for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "clients_owner_update" on public.clients for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "clients_owner_delete" on public.clients for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "loans_owner_select" on public.loans for select to authenticated using ((select auth.uid()) = owner_id);
create policy "loans_owner_insert" on public.loans for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "loans_owner_update" on public.loans for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "loans_owner_delete" on public.loans for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "payments_owner_select" on public.payments for select to authenticated using ((select auth.uid()) = owner_id);
create policy "payments_owner_insert" on public.payments for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "payments_owner_update" on public.payments for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "payments_owner_delete" on public.payments for delete to authenticated using ((select auth.uid()) = owner_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger cash_set_updated_at before update on public.cash_accounts for each row execute function public.set_updated_at();
create trigger clients_set_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger loans_set_updated_at before update on public.loans for each row execute function public.set_updated_at();
