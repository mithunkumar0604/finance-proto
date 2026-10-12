-- One-time loans (the "Custom" kind of loan).
--
-- The client lends for a set number of days (5, 18, even 1) and the customer returns
-- everything on that day. It does not repeat. Until now "Custom" only put the first
-- collection 30 days after the loan, like any other.
--
-- A one-time loan has frequency 'once' and a return date. It has exactly ONE collection,
-- on that date: the interest for the whole loan plus all of the principal. When the date
-- passes nothing is added by the app: the same collection simply shows as overdue. (The
-- owner can move the date, take part payments, add a charge by hand, or waive interest,
-- as on any loan.) No other kind of loan changes.

alter table public.loans add column return_date date;
alter table public.loans drop constraint loans_frequency_check;
alter table public.loans add constraint loans_frequency_check check (frequency in ('weekly', '15days', '30days', 'monthly', 'custom', 'once'));
alter table public.loans add constraint loans_once_has_return_date
  check (frequency <> 'once' or (return_date is not null and return_date > start_date));

-- ---------------------------------------------------------------------------
-- Collections: a one-time loan never gets a second one
-- ---------------------------------------------------------------------------

create or replace function public.accrue_dues(p_loan_id text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
  v_today date := public.today_ist();
  v_last date;
  v_open boolean;
  v_unscheduled bigint;
  v_interest bigint;
  v_principal bigint;
  n integer := 0;
begin
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or v_loan.status <> 'active' or v_loan.principal_left <= 0 then
    return 0;
  end if;
  while n < 600 loop
    select max(coalesce(original_date, due_date)) into v_last from public.dues where loan_id = p_loan_id;
    -- a one-time loan has its one collection and never another: nothing is added when the date passes
    exit when v_loan.frequency = 'once' and v_last is not null;
    select exists (select 1 from public.dues where loan_id = p_loan_id and not cancelled and remaining > 0) into v_open;
    -- the collection for a period appears once that period has started
    exit when v_last is not null and v_last >= v_today and v_open;

    v_interest := public.period_interest(v_loan.interest_style, v_loan.interest_value, v_loan.interest_method, v_loan.amount, v_loan.principal_left);
    -- never schedule more principal than is owed and not already asked for
    select greatest(v_loan.principal_left - coalesce(sum(greatest(principal_amount - (paid - interest_paid), 0)), 0), 0) into v_unscheduled
    from public.dues where loan_id = p_loan_id and not cancelled and remaining > 0;
    v_principal := least(v_loan.principal_per_due, v_unscheduled);
    exit when v_interest + v_principal <= 0;

    insert into public.dues (loan_id, due_date, interest_amount, principal_amount)
    values (p_loan_id,
      case when v_loan.frequency = 'once' then v_loan.return_date
           else public.next_due_date(coalesce(v_last, v_loan.start_date), v_loan.frequency, v_loan.start_date) end,
      v_interest, v_principal);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- New loan: a one-time loan's collection is on its return date and carries all the principal
-- ---------------------------------------------------------------------------

create or replace function public.create_loan(p_key uuid, p_loan jsonb, p_first_due jsonb, p_collateral jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
  v_customer public.customers;
  v_amount bigint := (p_loan ->> 'amount')::bigint;
  v_start date := (p_loan ->> 'start_date')::date;
  v_no text := nullif(trim(p_loan ->> 'loan_no'), '');
  v_once boolean := (p_loan ->> 'frequency') = 'once';
  v_return date := case when (p_loan ->> 'frequency') = 'once' then (p_loan ->> 'return_date')::date end;
  v_taken text;
begin
  if public.app_role() is distinct from 'owner' then
    raise exception 'NOT_ALLOWED: only the owner can give a new loan';
  end if;

  select * into v_loan from public.loans where idempotency_key = p_key;
  if found then
    return jsonb_build_object('loan_id', v_loan.id, 'duplicate', true);
  end if;

  select * into v_customer from public.customers where id = p_loan ->> 'customer_id';
  if not found then
    raise exception 'NOT_FOUND: customer not found';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'INVALID_AMOUNT: enter the amount given';
  end if;
  if v_start is null or v_start > public.today_ist() then
    raise exception 'FUTURE_DATE: the loan date cannot be in the future';
  end if;
  if v_once then
    if v_return is null then
      raise exception 'RETURN_DATE_NEEDED: choose the date the loan is to be returned';
    end if;
    if v_return <= v_start then
      raise exception 'RETURN_DATE_EARLY: the return date must be after the day the loan is given';
    end if;
    if v_return > v_start + 3660 then
      raise exception 'RETURN_DATE_FAR: the return date is too far away';
    end if;
    if coalesce((p_loan ->> 'principal_per_due')::bigint, 0) < v_amount then
      raise exception 'INVALID_TERMS: a one-time loan is returned in full on its return date';
    end if;
  end if;
  if length(v_no) > 30 then
    raise exception 'LOAN_NO_TOO_LONG: keep the loan number under 30 characters';
  end if;
  if v_no is not null then
    v_taken := public.loan_with_no(v_no);
    if v_taken is not null then
      raise exception 'LOAN_NO_TAKEN: loan number % is already used by loan %. Give this loan another number', v_no, v_taken;
    end if;
  end if;
  if (p_first_due ->> 'due_date')::date <> (case when v_once then v_return else public.next_due_date(v_start, p_loan ->> 'frequency', v_start) end)
     or (p_first_due ->> 'interest_amount')::bigint <> public.period_interest(p_loan ->> 'interest_style', (p_loan ->> 'interest_value')::numeric,
          p_loan ->> 'interest_method', v_amount, v_amount)
     or (p_first_due ->> 'principal_amount')::bigint <> least(coalesce((p_loan ->> 'principal_per_due')::bigint, 0), v_amount) then
    raise exception 'MISMATCH: the first collection does not match the loan terms. Nothing was saved';
  end if;
  if (p_first_due ->> 'interest_amount')::bigint + (p_first_due ->> 'principal_amount')::bigint <= 0 then
    raise exception 'INVALID_TERMS: set an interest amount or a principal amount for each collection';
  end if;

  insert into public.loans (customer_id, type, amount, start_date, reference, interest_style, interest_value, interest_method,
    frequency, principal_per_due, principal_left, idempotency_key, created_by, import_ref, referred_by, return_date)
  values (v_customer.id, p_loan ->> 'type', v_amount, v_start, nullif(trim(p_loan ->> 'reference'), ''),
    p_loan ->> 'interest_style', (p_loan ->> 'interest_value')::numeric, p_loan ->> 'interest_method',
    p_loan ->> 'frequency', coalesce((p_loan ->> 'principal_per_due')::bigint, 0), v_amount, p_key, auth.uid(),
    v_no, nullif(left(trim(p_loan ->> 'referred_by'), 80), ''), v_return)
  returning * into v_loan;

  insert into public.dues (id, loan_id, due_date, interest_amount, principal_amount)
  values ((p_first_due ->> 'id')::uuid, v_loan.id, (p_first_due ->> 'due_date')::date,
    (p_first_due ->> 'interest_amount')::bigint, (p_first_due ->> 'principal_amount')::bigint);

  if p_collateral is not null then
    insert into public.collateral (loan_id, kind, details, search_text)
    values (v_loan.id, p_collateral ->> 'kind', coalesce(p_collateral -> 'details', '{}'::jsonb), coalesce(p_collateral ->> 'search_text', ''));
  end if;

  -- a loan entered with an earlier date: every period since then is pending
  perform public.accrue_dues(v_loan.id);

  perform public.log_activity('loan', 'New loan ' || v_loan.id || coalesce(' (No. ' || v_no || ')', '') || ' · ' || public.rupee_text(v_amount) || ' given to ' || v_customer.name,
    v_loan.id, v_customer.id, jsonb_build_object('loan', p_loan, 'first_due', p_first_due));

  return jsonb_build_object('loan_id', v_loan.id, 'duplicate', false);
exception
  -- two people saving the same number at the same moment: the second is told, not shown a database error
  when unique_violation then
    if sqlerrm like '%loans_import_ref%' then
      raise exception 'LOAN_NO_TAKEN: loan number % is already used. Give this loan another number', v_no;
    end if;
    raise;
end $$;

-- Edit Loan cannot turn a repeating loan into a one-time one or back: that would need a
-- return date and a different collection. (The return date itself is moved with Reschedule.)
create or replace function public.loans_keep_once() returns trigger
language plpgsql set search_path = public as $$
begin
  if (old.frequency = 'once') <> (new.frequency = 'once') then
    raise exception 'INVALID_TERMS: a one-time loan cannot be changed into a repeating one, or the other way round';
  end if;
  return new;
end $$;
create trigger loans_keep_once before update of frequency on public.loans for each row execute function public.loans_keep_once();
