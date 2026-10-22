alter table public.payments alter column payment_type drop default;

alter table public.payments drop constraint if exists payments_payment_type_check;
alter table public.payments
  add constraint payments_payment_type_check
  check (payment_type in ('interest', 'full'));

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
  if p_payment_type not in ('interest', 'full') then
    raise exception 'O Emprestei aceita somente pagamento dos juros ou quitação total';
  end if;

  select * into v_loan
  from public.loans
  where id = p_loan_id
    and owner_id = (select auth.uid())
    and status <> 'cancelled'
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
    v_new_interest := 0;
    v_new_principal := 0;
    v_new_status := 'paid';
  else
    if v_loan.current_interest_due <= 0 then raise exception 'Não há juros pendentes neste ciclo'; end if;
    if p_new_due_date is null or p_new_due_date <= current_date then raise exception 'Informe um próximo vencimento futuro'; end if;

    v_amount := v_loan.current_interest_due;
    v_interest_applied := v_loan.current_interest_due;
    v_principal_applied := 0;
    v_new_principal := v_loan.outstanding_principal;
    v_new_interest := v_loan.interest_amount;
    v_new_status := 'interest_paid';
    v_new_cycle := v_loan.cycle_number + 1;
    v_new_due_date := p_new_due_date;
  end if;

  insert into public.payments(owner_id, loan_id, amount, payment_type, applied_to_interest, applied_to_principal, cycle_number, renewed_due_date)
  values ((select auth.uid()), p_loan_id, v_amount, p_payment_type, v_interest_applied, v_principal_applied, v_loan.cycle_number, case when p_payment_type = 'interest' then p_new_due_date else null end);

  update public.loans
  set outstanding_principal = v_new_principal,
      current_interest_due = v_new_interest,
      status = v_new_status,
      cycle_number = v_new_cycle,
      due_date = v_new_due_date,
      last_payment_type = p_payment_type,
      last_payment_at = now(),
      updated_at = now()
  where id = p_loan_id and owner_id = (select auth.uid());

  return jsonb_build_object('amount', v_amount, 'status', v_new_status, 'outstanding_principal', v_new_principal, 'current_interest_due', v_new_interest, 'cycle_number', v_new_cycle, 'due_date', v_new_due_date);
end;
$$;

grant execute on function public.record_loan_payment(uuid, text, numeric, date, boolean) to authenticated;
