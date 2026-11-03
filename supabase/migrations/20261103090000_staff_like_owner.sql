-- Staff work like the business owner (3 November 2026).
--
-- Staff may now do everything the owner does, except:
--   * delete anything: a customer (delete_customer, owner only), a loan (delete_loan,
--     admin only), a payment (reverse_payment, owner only), a photo or document file
--     (storage policy documents_remove, owner only). None of these change here;
--   * see or change logins (Users & Roles): the admin_* functions and is_admin() are
--     unchanged;
--   * change a password: hidden in the app. Supabase Auth lets any signed-in user change
--     their own password, so this one is not enforced by the database.
--
-- What staff newly get: give loans (create_loan), take payments and choose the periods
-- they cover (record_payment), waive interest, with a reason as before (record_payment,
-- waive_interest), move a payment date (reschedule_due), edit a loan (update_loan),
-- hand security back (release_collateral), move a customer to another collector
-- (guard_customer_update), read the activity log, and put a newer photo over an
-- existing one (documents_add; the older file is kept, nothing is removed).
--
-- Each function below is the latest definition, unchanged except for its role check.
-- "create or replace" keeps each function's grants; they are repeated at the end anyway.
-- Collectors are unchanged.

-- ---------------------------------------------------------------------------
-- Moving a customer to another collector: owner or staff
-- ---------------------------------------------------------------------------

create or replace function public.guard_customer_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb := to_jsonb(old) - 'updated_at';
  v_after jsonb := to_jsonb(new) - 'updated_at';
begin
  if new.collector_id is distinct from old.collector_id and coalesce(public.app_role(), '') not in ('owner', 'staff') and auth.uid() is not null then
    raise exception 'NOT_ALLOWED: only the owner or staff can change which collector a customer belongs to';
  end if;
  if v_before is distinct from v_after then
    perform public.log_activity('customer', 'Edited customer ' || new.name, null, new.id,
      jsonb_build_object(
        'before', (select jsonb_object_agg(key, value) from jsonb_each(v_before) where v_after -> key is distinct from value),
        'after', (select jsonb_object_agg(key, value) from jsonb_each(v_after) where v_before -> key is distinct from value)));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Give a loan: owner or staff
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
  if public.app_role() is null or public.app_role() not in ('owner', 'staff') then
    raise exception 'NOT_ALLOWED: only the owner or staff can give a new loan';
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

-- ---------------------------------------------------------------------------
-- Take a payment: owner, staff or the customer's collector; waive with it: owner or staff
-- ---------------------------------------------------------------------------

create or replace function public.record_payment(p_key uuid, p_loan_id text, p_version integer, p_payment jsonb, p_loan jsonb, p_dues jsonb,
  p_waive_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.app_role();
  v_loan public.loans;
  v_customer public.customers;
  v_existing public.payments;
  v_interest bigint := (p_payment ->> 'interest')::bigint;
  v_principal bigint := (p_payment ->> 'principal')::bigint;
  v_other bigint := (p_payment ->> 'other')::bigint;
  v_date date := (p_payment ->> 'date')::date;
  v_today date := public.today_ist();
  v_pay_id uuid := (p_payment ->> 'id')::uuid;
  v_left bigint;
  v_closed boolean;
  v_before jsonb;
  v_ids_before uuid[];
  v_created uuid[];
  v_parts_left bigint;
  v_sum_interest bigint := 0;
  v_sum_principal bigint := 0;
  v_sum_waived bigint := 0;
  v_allocs jsonb := '[]'::jsonb;
  v_first_due uuid;
  d jsonb;
  v_old public.dues;
  v_id uuid;
  di bigint;
  dp bigint;
  dw bigint;
  v_cancel boolean;
  v_period_start date;
begin
  if v_role is null then
    raise exception 'NOT_ALLOWED: you cannot record payments';
  end if;

  -- Lock the loan first, so a second request waits here until the first has finished.
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found or not public.can_see_loan(p_loan_id) then
    raise exception 'NOT_FOUND: loan not found';
  end if;

  -- A double tap or a network retry sends the same key: return the first result.
  select * into v_existing from public.payments where idempotency_key = p_key;
  if found then
    return jsonb_build_object('payment_id', v_existing.id, 'recorded_on', v_existing.recorded_on, 'version', v_loan.version, 'duplicate', true);
  end if;

  if v_loan.version <> p_version then
    raise exception 'CONFLICT: this loan was changed by someone else. Check it and try again';
  end if;
  if v_loan.status <> 'active' then
    raise exception 'LOAN_CLOSED: this loan is closed';
  end if;
  if v_interest is null or v_principal is null or v_other is null or v_interest < 0 or v_principal < 0 or v_other < 0 then
    raise exception 'INVALID_AMOUNT: enter a valid amount';
  end if;
  if v_interest + v_principal + v_other = 0 then
    raise exception 'ZERO_AMOUNT: enter the amount received';
  end if;
  if v_date is null or v_date > v_today then
    raise exception 'FUTURE_DATE: the payment date cannot be in the future';
  end if;
  if v_date < v_loan.start_date then
    raise exception 'BEFORE_LOAN_START: the payment date is before the loan was given';
  end if;
  if v_principal > v_loan.principal_left then
    raise exception 'PRINCIPAL_TOO_LARGE: this is more than the principal left on the loan';
  end if;
  if length(coalesce(p_payment ->> 'note', '')) > 500 or length(coalesce(p_waive_reason, '')) > 500 then
    raise exception 'INVALID_NOTE: the note is too long';
  end if;

  -- Every period that has started is on the books before the money is counted.
  perform public.accrue_dues(p_loan_id);
  select array_agg(id) into v_ids_before from public.dues where loan_id = p_loan_id;

  v_left := v_loan.principal_left - v_principal;

  select coalesce(sum(greatest(principal_amount - (paid - interest_paid), 0)), 0) into v_parts_left
  from public.dues where loan_id = p_loan_id and not cancelled and remaining > 0;

  -- Snapshot for an exact reversal later.
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_before
  from public.dues x
  where x.loan_id = p_loan_id and x.id in (select (e ->> 'id')::uuid from jsonb_array_elements(p_dues) e);

  for d in select * from jsonb_array_elements(p_dues) loop
    v_id := (d ->> 'id')::uuid;
    select * into v_old from public.dues where id = v_id;
    if not found then
      raise exception 'MISMATCH: unknown collection. Reload and try again';
    end if;
    if v_old.loan_id <> p_loan_id then
      raise exception 'DUE_MISMATCH: this collection belongs to a different loan';
    end if;

    di := (d ->> 'interest_paid')::bigint - v_old.interest_paid;
    dp := ((d ->> 'paid')::bigint - (d ->> 'interest_paid')::bigint) - (v_old.paid - v_old.interest_paid);
    dw := (d ->> 'waived')::bigint - v_old.waived;
    if di is null or dp is null or dw is null or di < 0 or dp < 0 or dw < 0 then
      raise exception 'MISMATCH: a payment cannot reduce what was already paid or waived';
    end if;
    if v_old.cancelled and di + dp + dw > 0 then
      raise exception 'MISMATCH: this collection is no longer expected';
    end if;

    v_cancel := coalesce((d ->> 'cancelled')::boolean, false);
    if v_cancel <> v_old.cancelled then
      -- Only one case: all principal is back and this collection's period had not begun
      -- by the payment date, so it was never owed. Nothing that was owed is dropped.
      select coalesce(max(coalesce(x.original_date, x.due_date)), v_loan.start_date) into v_period_start
      from public.dues x
      where x.loan_id = p_loan_id and coalesce(x.original_date, x.due_date) < coalesce(v_old.original_date, v_old.due_date);
      if v_old.cancelled or v_left <> 0 or v_old.paid <> 0 or v_old.waived <> 0 or di + dp + dw <> 0 or v_period_start < v_date then
        raise exception 'MISMATCH: pending interest can only be cleared by paying it or by the owner waiving it';
      end if;
    end if;

    -- the last-paid date changes only on a collection that received money, and only to this payment's date
    if (d ->> 'last_paid_date')::date is distinct from v_old.last_paid_date
       and ((d ->> 'last_paid_date')::date is distinct from v_date or di + dp = 0) then
      raise exception 'MISMATCH: the last-paid date does not match this payment';
    end if;

    -- amounts and the due date of a collection are never changed here
    update public.dues set
      paid = (d ->> 'paid')::bigint,
      interest_paid = (d ->> 'interest_paid')::bigint,
      waived = (d ->> 'waived')::bigint,
      last_paid_date = (d ->> 'last_paid_date')::date,
      cancelled = v_cancel
    where id = v_id;

    v_sum_interest := v_sum_interest + di;
    v_sum_principal := v_sum_principal + dp;
    v_sum_waived := v_sum_waived + dw;
    if di + dp + dw > 0 then
      v_allocs := v_allocs || jsonb_build_object('due_id', v_id, 'interest', di, 'principal', dp, 'waived', dw);
      v_first_due := coalesce(v_first_due, v_id);
    end if;
  end loop;

  if v_sum_interest <> v_interest then
    raise exception 'MISMATCH: interest received does not match the periods it was counted against. Nothing was saved';
  end if;
  -- principal pays the instalment parts already asked for; the rest just lowers the balance
  if v_sum_principal <> least(v_principal, v_parts_left) then
    raise exception 'MISMATCH: principal received does not match the collections. Nothing was saved';
  end if;
  if v_sum_waived > 0 then
    if v_role not in ('owner', 'staff') then
      raise exception 'NOT_ALLOWED: only the owner or staff can waive interest';
    end if;
    if coalesce(trim(p_waive_reason), '') = '' then
      raise exception 'REASON_NEEDED: say why this interest is being waived';
    end if;
  end if;

  -- The loan is finished only when the principal is back and nothing is pending.
  v_closed := v_left = 0 and not exists (select 1 from public.dues x where x.loan_id = p_loan_id and not x.cancelled and x.remaining > 0);
  if (p_loan ->> 'principal_left')::bigint is distinct from v_left
     or (p_loan ->> 'status') is distinct from (case when v_closed then 'closed' else 'active' end) then
    raise exception 'MISMATCH: the amounts do not add up. Nothing was saved';
  end if;
  if v_closed and v_date < coalesce((select max(payment_date) from public.payments where loan_id = p_loan_id and reversed_at is null), v_date) then
    raise exception 'BEFORE_LAST_PAYMENT: the loan cannot be closed on a date before its latest payment';
  end if;

  v_first_due := coalesce(v_first_due, (p_payment ->> 'due_id')::uuid);
  if v_first_due is not null and not exists (select 1 from public.dues x where x.id = v_first_due and x.loan_id = p_loan_id) then
    raise exception 'DUE_MISMATCH: this collection belongs to a different loan';
  end if;

  select * into v_customer from public.customers where id = v_loan.customer_id;

  update public.loans set
    principal_left = v_left,
    status = case when v_closed then 'closed' else 'active' end,
    closed_date = case when v_closed then v_date else null end,
    version = version + 1
  where id = p_loan_id;

  -- If everything is now paid ahead, the next collection opens (worked out here, not sent in).
  perform public.accrue_dues(p_loan_id);
  select coalesce(array_agg(id), '{}') into v_created from public.dues where loan_id = p_loan_id and id <> all (v_ids_before);

  insert into public.payments (id, loan_id, customer_id, due_id, payment_date, recorded_on, principal_before, interest, principal, other,
    method, note, idempotency_key, created_by, before_state)
  values (v_pay_id, p_loan_id, v_loan.customer_id, v_first_due, v_date, v_today, v_loan.principal_left,
    v_interest, v_principal, v_other, p_payment ->> 'method', nullif(trim(p_payment ->> 'note'), ''), p_key, auth.uid(),
    jsonb_build_object('loan', jsonb_build_object('principal_left', v_loan.principal_left, 'status', v_loan.status, 'closed_date', v_loan.closed_date),
      'dues', v_before, 'created_due_ids', to_jsonb(v_created)));

  insert into public.payment_allocations (payment_id, due_id, loan_id, interest, principal, waived)
  select v_pay_id, (a ->> 'due_id')::uuid, p_loan_id, (a ->> 'interest')::bigint, (a ->> 'principal')::bigint, (a ->> 'waived')::bigint
  from jsonb_array_elements(v_allocs) a;

  insert into public.waivers (by, by_name, loan_id, due_id, amount, reason, payment_id)
  select auth.uid(), coalesce((select name from public.profiles where id = auth.uid()), ''), p_loan_id, (a ->> 'due_id')::uuid,
    (a ->> 'waived')::bigint, trim(p_waive_reason), v_pay_id
  from jsonb_array_elements(v_allocs) a where (a ->> 'waived')::bigint > 0;

  perform public.log_activity('payment',
    'Received ' || public.rupee_text(v_interest + v_principal + v_other) || ' from ' || v_customer.name || ' · ' || p_loan_id
      || case when v_closed then ' · Loan closed' else '' end
      || case when v_sum_waived > 0 then ' · ' || public.rupee_text(v_sum_waived) || ' interest waived: ' || trim(p_waive_reason) else '' end
      || case when v_date < v_today then ' · backdated to ' || to_char(v_date, 'DD Mon YYYY') else '' end,
    p_loan_id, v_loan.customer_id,
    jsonb_build_object('payment_id', v_pay_id, 'interest', v_interest, 'principal', v_principal, 'other', v_other,
      'principal_before', v_loan.principal_left, 'principal_after', v_left, 'waived', v_sum_waived, 'waive_reason', p_waive_reason,
      'allocations', v_allocs));

  return jsonb_build_object('payment_id', v_pay_id, 'recorded_on', v_today, 'version', v_loan.version + 1, 'duplicate', false);
end $$;

-- ---------------------------------------------------------------------------
-- Waive interest without a payment: owner or staff (a reason is still needed)
-- ---------------------------------------------------------------------------

create or replace function public.waive_interest(p_loan_id text, p_version integer, p_waive jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
  v_today date := public.today_ist();
  v_name text;
  v_due public.dues;
  v_amount bigint;
  v_total bigint := 0;
  v_closed boolean;
  w jsonb;
begin
  if public.app_role() is null or public.app_role() not in ('owner', 'staff') then
    raise exception 'NOT_ALLOWED: only the owner or staff can waive interest';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'REASON_NEEDED: say why this interest is being waived';
  end if;
  if length(p_reason) > 500 then
    raise exception 'INVALID_NOTE: the reason is too long';
  end if;

  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'NOT_FOUND: loan not found';
  end if;
  if v_loan.version <> p_version then
    raise exception 'CONFLICT: this loan was changed by someone else. Check it and try again';
  end if;
  if v_loan.status <> 'active' then
    raise exception 'LOAN_CLOSED: this loan is closed';
  end if;
  if p_waive is null or jsonb_array_length(p_waive) = 0 then
    raise exception 'ZERO_AMOUNT: choose the interest to waive';
  end if;

  perform public.accrue_dues(p_loan_id);
  select name into v_name from public.profiles where id = auth.uid();

  for w in select * from jsonb_array_elements(p_waive) loop
    v_amount := (w ->> 'amount')::bigint;
    select * into v_due from public.dues where id = (w ->> 'due_id')::uuid and loan_id = p_loan_id and not cancelled;
    if not found then
      raise exception 'DUE_MISMATCH: this collection belongs to a different loan';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'INVALID_AMOUNT: enter a valid amount';
    end if;
    if v_amount > v_due.interest_amount - v_due.interest_paid - v_due.waived then
      raise exception 'WAIVE_TOO_LARGE: this is more than the interest pending for that period';
    end if;
    update public.dues set waived = waived + v_amount where id = v_due.id;
    insert into public.waivers (by, by_name, loan_id, due_id, amount, reason)
    values (auth.uid(), coalesce(v_name, ''), p_loan_id, v_due.id, v_amount, trim(p_reason));
    v_total := v_total + v_amount;
  end loop;

  v_closed := v_loan.principal_left = 0
    and not exists (select 1 from public.dues x where x.loan_id = p_loan_id and not x.cancelled and x.remaining > 0);
  update public.loans set
    status = case when v_closed then 'closed' else status end,
    closed_date = case when v_closed then v_today else closed_date end,
    version = version + 1
  where id = p_loan_id;

  perform public.log_activity('payment',
    'Waived ' || public.rupee_text(v_total) || ' interest on ' || p_loan_id || ' · ' || trim(p_reason) || case when v_closed then ' · Loan closed' else '' end,
    p_loan_id, v_loan.customer_id, jsonb_build_object('waived', v_total, 'reason', trim(p_reason), 'waive', p_waive));

  return jsonb_build_object('version', v_loan.version + 1, 'closed', v_closed, 'waived', v_total);
end $$;

-- ---------------------------------------------------------------------------
-- Move a payment date: owner, staff or the customer's collector
-- ---------------------------------------------------------------------------

create or replace function public.reschedule_due(p_due_id uuid, p_new_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_due public.dues;
  v_loan public.loans;
  v_name text;
begin
  if public.app_role() is null then
    raise exception 'NOT_ALLOWED: you cannot move a payment date';
  end if;
  select * into v_due from public.dues where id = p_due_id;
  if not found or not public.can_see_loan(v_due.loan_id) then
    raise exception 'NOT_FOUND: collection not found';
  end if;
  select * into v_loan from public.loans where id = v_due.loan_id for update;
  select * into v_due from public.dues where id = p_due_id;
  if v_loan.status <> 'active' or v_due.cancelled or v_due.interest_amount + v_due.principal_amount - v_due.paid - v_due.waived <= 0 then
    raise exception 'NOTHING_DUE: there is nothing left to collect on this date';
  end if;
  if p_new_date is null or not isfinite(p_new_date) or p_new_date < public.today_ist() then
    raise exception 'PAST_DATE: choose today or a later date';
  end if;
  if p_new_date > public.today_ist() + 365 then
    raise exception 'TOO_FAR: choose a date within one year';
  end if;
  if length(coalesce(p_reason, '')) > 500 then
    raise exception 'INVALID_NOTE: the reason is too long';
  end if;

  update public.dues set
    due_date = p_new_date,
    original_date = coalesce(original_date, due_date),
    reschedule_reason = coalesce(nullif(trim(p_reason), ''), '')
  where id = p_due_id;
  update public.loans set version = version + 1 where id = v_loan.id;

  select name into v_name from public.customers where id = v_loan.customer_id;
  perform public.log_activity('reschedule', 'Moved ' || v_name || '''s payment (' || v_loan.id || ') to ' || to_char(p_new_date, 'DD Mon YYYY'),
    v_loan.id, v_loan.customer_id, jsonb_build_object('due_id', p_due_id, 'from', v_due.due_date, 'to', p_new_date, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Edit a loan: owner or staff
-- ---------------------------------------------------------------------------

create or replace function public.update_loan(p_loan_id text, p_version integer, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
  v_no text := nullif(trim(p_patch ->> 'loan_no'), '');
  v_taken text;
begin
  if public.app_role() is null or public.app_role() not in ('owner', 'staff') then
    raise exception 'NOT_ALLOWED: only the owner or staff can edit a loan';
  end if;
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'NOT_FOUND: loan not found';
  end if;
  if v_loan.version <> p_version then
    raise exception 'CONFLICT: this loan was changed by someone else. Check it and try again';
  end if;
  if p_patch ? 'loan_no' and v_no is not null then
    if length(v_no) > 30 then
      raise exception 'LOAN_NO_TOO_LONG: keep the loan number under 30 characters';
    end if;
    v_taken := public.loan_with_no(v_no, p_loan_id);
    if v_taken is not null then
      raise exception 'LOAN_NO_TAKEN: loan number % is already used by loan %. Give this loan another number', v_no, v_taken;
    end if;
  end if;

  update public.loans set
    interest_style = coalesce(p_patch ->> 'interest_style', interest_style),
    interest_value = coalesce((p_patch ->> 'interest_value')::numeric, interest_value),
    interest_method = coalesce(p_patch ->> 'interest_method', interest_method),
    frequency = coalesce(p_patch ->> 'frequency', frequency),
    reference = case when p_patch ? 'reference' then nullif(trim(p_patch ->> 'reference'), '') else reference end,
    import_ref = case when p_patch ? 'loan_no' then v_no else import_ref end,
    referred_by = case when p_patch ? 'referred_by' then nullif(left(trim(p_patch ->> 'referred_by'), 80), '') else referred_by end,
    version = version + 1
  where id = p_loan_id;

  perform public.log_activity('loan', 'Edited loan ' || p_loan_id, p_loan_id, v_loan.customer_id,
    jsonb_build_object('before', jsonb_build_object('interest_style', v_loan.interest_style, 'interest_value', v_loan.interest_value,
      'interest_method', v_loan.interest_method, 'frequency', v_loan.frequency, 'reference', v_loan.reference,
      'loan_no', v_loan.import_ref, 'referred_by', v_loan.referred_by), 'after', p_patch));
end $$;

-- ---------------------------------------------------------------------------
-- Hand security back: owner or staff
-- ---------------------------------------------------------------------------

create or replace function public.release_collateral(p_loan_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_customer text;
begin
  if public.app_role() is null or public.app_role() not in ('owner', 'staff') then
    raise exception 'NOT_ALLOWED: only the owner or staff can release security';
  end if;
  update public.collateral set status = 'released', released_at = now(), released_by = auth.uid()
  where loan_id = p_loan_id and status = 'held';
  if not found then
    raise exception 'NOT_FOUND: no security is held for this loan';
  end if;
  select customer_id into v_customer from public.loans where id = p_loan_id;
  perform public.log_activity('security', 'Security released for ' || p_loan_id, p_loan_id, v_customer);
end $$;

revoke execute on function
  public.create_loan(uuid, jsonb, jsonb, jsonb),
  public.record_payment(uuid, text, integer, jsonb, jsonb, jsonb, text),
  public.waive_interest(text, integer, jsonb, text),
  public.reschedule_due(uuid, date, text),
  public.update_loan(text, integer, jsonb),
  public.release_collateral(text)
from public, anon;
grant execute on function
  public.create_loan(uuid, jsonb, jsonb, jsonb),
  public.record_payment(uuid, text, integer, jsonb, jsonb, jsonb, text),
  public.waive_interest(text, integer, jsonb, text),
  public.reschedule_due(uuid, date, text),
  public.update_loan(text, integer, jsonb),
  public.release_collateral(text)
to authenticated;

-- ---------------------------------------------------------------------------
-- The activity log: owner and staff read it
-- ---------------------------------------------------------------------------

drop policy activity_owner_read on public.activity;
create policy activity_owner_staff_read on public.activity for select to authenticated
  using ((select public.app_role()) in ('owner', 'staff'));

-- ---------------------------------------------------------------------------
-- Photos and documents: owner and staff add, also a newer file over an existing one.
-- Removing stays with the owner (documents_remove is unchanged).
-- ---------------------------------------------------------------------------

drop policy documents_add on storage.objects;
create policy documents_add on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select public.app_role()) in ('owner', 'staff')
    and objects.name ~ '^[^/]+/[a-z0-9]+-[0-9]+\.(jpg|png|webp|pdf)$'
    and (
      exists (select 1 from public.loans l where l.id = (storage.foldername(objects.name))[1])
      or exists (select 1 from public.customers c where c.id = (storage.foldername(objects.name))[1])
    )
  );
