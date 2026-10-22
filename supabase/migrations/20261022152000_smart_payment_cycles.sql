-- Smart payment cycles for Emprestei
alter table public.loans
  add column if not exists interest_amount numeric,
  add column if not exists outstanding_principal numeric,
  add column if not exists current_interest_due numeric,
  add column if not exists cycle_number integer not null default 1,
  add column if not exists last_payment_type text,
  add column if not exists last_payment_at timestamptz;

update public.loans
set
  interest_amount = coalesce(interest_amount, greatest(total_receivable - principal, 0)),
  outstanding_principal = coalesce(outstanding_principal, principal),
  current_interest_due = coalesce(current_interest_due, greatest(total_receivable - principal, 0));

alter table public.loans
  alter column interest_amount set default 0,
  alter column interest_amount set not null,
  alter column outstanding_principal set default 0,
  alter column outstanding_principal set not null,
  alter column current_interest_due set default 0,
  alter column current_interest_due set not null;

alter table public.loans drop constraint if exists loans_status_check;
alter table public.loans
  add constraint loans_status_check check (status = any (array['open'::text, 'interest_paid'::text, 'paid'::text, 'renegotiated'::text, 'cancelled'::text]));

alter table public.payments
  add column if not exists payment_type text not null default 'partial',
  add column if not exists applied_to_interest numeric not null default 0,
  add column if not exists applied_to_principal numeric not null default 0,
  add column if not exists cycle_number integer not null default 1,
  add column if not exists renewed_due_date date;

create index if not exists loans_owner_due_status_idx on public.loans(owner_id, due_date, status);
create index if not exists payments_loan_type_idx on public.payments(loan_id, payment_type);

create or replace function public.record_loan_payment(
  p_loan_id uuid,
  p_payment_type text,
  p_amount numeric default null,
  p_new_due_date date default null,
  p_renew_interest boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_loan public.loans%rowtype;
  v_amount numeric;
  v_interest_applied numeric := 0;
  v_principal_applied numeric := 0;
  v_new_interest numeric;
  v_new_principal numeric;
  v_new_status text;
  v_new_cycle integer;
  v_new_due_date date;
begin
  if p_payment_type not in ('interest', 'full', 'partial') then raise exception 'Tipo de pagamento inválido'; end if;

  select * into v_loan from public.loans
  where id = p_loan_id and owner_id = (select auth.uid()) and status <> 'cancelled'
  for update;
  if not found then raise exception 'Empréstimo não encontrado ou sem permissão'; end if;
  if v_loan.status = 'paid' then raise exception 'Este empréstimo já está quitado'; end if;

  v_new_interest := v_loan.current_interest_due;
  v_new_principal := v_loan.outstanding_principal;
  v_new_status := v_loan.status;
  v_new_cycle := v_loan.cycle_number;
  v_new_due_date := v_loan.due_date;

  if p_payment_type = 'full' then
    v_amount := v_loan.current_interest_due + v_loan.outstanding_principal;
    v_interest_applied := v_loan.current_interest_due;
    v_principal_applied := v_loan.outstanding_principal;
    v_new_interest := 0; v_new_principal := 0; v_new_status := 'paid';
  elsif p_payment_type = 'interest' then
    if v_loan.current_interest_due <= 0 then raise exception 'Não há juros pendentes neste ciclo'; end if;
    if p_new_due_date is null or p_new_due_date <= current_date then raise exception 'Informe um próximo vencimento futuro'; end if;
    v_amount := v_loan.current_interest_due;
    v_interest_applied := v_amount;
    v_new_status := 'interest_paid';
    v_new_due_date := p_new_due_date;
    if p_renew_interest then v_new_interest := v_loan.interest_amount; v_new_cycle := v_loan.cycle_number + 1; else v_new_interest := 0; end if;
  else
    if p_amount is null or p_amount <= 0 then raise exception 'Informe um valor parcial válido'; end if;
    if p_amount > (v_loan.current_interest_due + v_loan.outstanding_principal) then raise exception 'O pagamento ultrapassa o saldo em aberto'; end if;
    v_amount := p_amount;
    v_interest_applied := least(v_amount, v_loan.current_interest_due);
    v_principal_applied := least(v_amount - v_interest_applied, v_loan.outstanding_principal);
    v_new_interest := v_loan.current_interest_due - v_interest_applied;
    v_new_principal := v_loan.outstanding_principal - v_principal_applied;
    if v_new_interest = 0 and v_new_principal = 0 then v_new_status := 'paid'; elsif v_new_interest = 0 then v_new_status := 'interest_paid'; else v_new_status := 'open'; end if;
  end if;

  insert into public.payments(owner_id, loan_id, amount, payment_type, applied_to_interest, applied_to_principal, cycle_number, renewed_due_date)
  values ((select auth.uid()), p_loan_id, v_amount, p_payment_type, v_interest_applied, v_principal_applied, v_loan.cycle_number, case when p_payment_type = 'interest' then p_new_due_date else null end);

  update public.loans set outstanding_principal = v_new_principal, current_interest_due = v_new_interest, status = v_new_status,
    cycle_number = v_new_cycle, due_date = v_new_due_date, last_payment_type = p_payment_type, last_payment_at = now(), updated_at = now()
  where id = p_loan_id and owner_id = (select auth.uid());

  return jsonb_build_object('amount', v_amount, 'status', v_new_status, 'outstanding_principal', v_new_principal, 'current_interest_due', v_new_interest, 'cycle_number', v_new_cycle, 'due_date', v_new_due_date);
end;
$$;

grant execute on function public.record_loan_payment(uuid, text, numeric, date, boolean) to authenticated;
