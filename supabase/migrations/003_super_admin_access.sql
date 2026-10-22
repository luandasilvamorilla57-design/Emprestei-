create schema if not exists private;

create table if not exists private.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on private.app_admins from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.app_admins a
    where a.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

insert into private.app_admins (user_id)
select id
from auth.users
where lower(email) = lower('luandasilvamorilla57@gmail.com')
on conflict (user_id) do nothing;

create policy "profiles_admin_all" on public.profiles
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "cash_admin_all" on public.cash_accounts
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "clients_admin_all" on public.clients
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "loans_admin_all" on public.loans
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "payments_admin_all" on public.payments
for all to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));
