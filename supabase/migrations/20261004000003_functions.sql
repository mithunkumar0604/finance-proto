-- Every change to money goes through one of these functions. Each call is a single
-- transaction: either all of it is saved or none of it.
--
-- The amounts themselves (interest for a period, the split of a payment, the next
-- collection) are worked out by the tested engine in src/lib/finance. These functions
-- do not repeat those formulas. They lock the loan, check that what the engine sent is
-- consistent with what is stored (principal adds up, nothing is overpaid, nobody else
-- changed the loan meanwhile), and then save it.
--
-- Errors are raised as 'CODE: message'. The app shows a friendly message per CODE.

create or replace function public.log_activity(p_kind text, p_text text, p_loan_id text, p_customer_id text, p_data jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.activity (by, by_name, kind, text, loan_id, customer_id, data)
  values (auth.uid(), coalesce((select name from public.profiles where id = auth.uid()), ''), p_kind, p_text, p_loan_id, p_customer_id, p_data)
$$;

create or replace function public.rupee_text(p bigint) returns text
language sql immutable as $$
  select '₹' || trim(to_char(p / 100, 'FM999,999,999,999')) || case when p % 100 = 0 then '' else '.' || lpad((p % 100)::text, 2, '0') end
$$;

create or replace function public.log_new_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity('customer', 'Added customer ' || new.name, null, new.id);
  return new;
end $$;

create trigger customers_log_insert after insert on public.customers for each row execute function public.log_new_customer();

-- ---------------------------------------------------------------------------
-- New loan
-- ---------------------------------------------------------------------------

create or replace function public.create_loan(p_key uuid, p_loan jsonb, p_first_due jsonb, p_collateral jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
  v_customer public.customers;
  v_amount bigint := (p_loan ->> 'amount')::bigint;
  v_start date := (p_loan ->> 'start_date')::date;
begin
  if public.app_role() is distinct from 'owner' then
    raise exception 'NOT_ALLOWED: only the owner can give a new loan';
  end if;

  -- a retry of the same request returns the loan that was already created
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
  if (p_first_due ->> 'due_date')::date <= v_start then
    raise exception 'INVALID_DUE: the first collection must be after the loan date';
  end if;
  if (p_first_due ->> 'principal_amount')::bigint > v_amount then
    raise exception 'INVALID_DUE: the first collection asks for more principal than was given';
  end if;

  insert into public.loans (customer_id, type, amount, start_date, reference, interest_style, interest_value, interest_method,
    frequency, principal_per_due, principal_left, idempotency_key, created_by)
  values (v_customer.id, p_loan ->> 'type', v_amount, v_start, nullif(trim(p_loan ->> 'reference'), ''),
    p_loan ->> 'interest_style', (p_loan ->> 'interest_value')::numeric, p_loan ->> 'interest_method',
    p_loan ->> 'frequency', coalesce((p_loan ->> 'principal_per_due')::bigint, 0), v_amount, p_key, auth.uid())
  returning * into v_loan;

  insert into public.dues (id, loan_id, due_date, interest_amount, principal_amount)
  values ((p_first_due ->> 'id')::uuid, v_loan.id, (p_first_due ->> 'due_date')::date,
    (p_first_due ->> 'interest_amount')::bigint, (p_first_due ->> 'principal_amount')::bigint);

  if p_collateral is not null then
    insert into public.collateral (loan_id, kind, details, search_text)
    values (v_loan.id, p_collateral ->> 'kind', coalesce(p_collateral -> 'details', '{}'::jsonb), coalesce(p_collateral ->> 'search_text', ''));
  end if;

  perform public.log_activity('loan', 'New loan ' || v_loan.id || ' · ' || public.rupee_text(v_amount) || ' given to ' || v_customer.name,
    v_loan.id, v_customer.id, jsonb_build_object('loan', p_loan, 'first_due', p_first_due));

  return jsonb_build_object('loan_id', v_loan.id, 'duplicate', false);
end $$;

-- ---------------------------------------------------------------------------
-- Receive a payment
-- ---------------------------------------------------------------------------
-- p_payment: { id, due_id, date, interest, principal, other, method, note }
-- p_loan:    { principal_left, status, closed_date }          the loan after the payment
-- p_dues:    [ { id, due_date, interest_amount, principal_amount, paid, interest_paid,
--               waived, last_paid_date, cancelled } ]          every due the payment touched

create or replace function public.record_payment(p_key uuid, p_loan_id text, p_version integer, p_payment jsonb, p_loan jsonb, p_dues jsonb)
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
  v_left bigint;
  v_closed boolean;
  v_before jsonb;
  v_new_ids uuid[] := '{}';
  v_interest_delta bigint := 0;
  v_principal_delta bigint := 0;
  d jsonb;
  v_old public.dues;
  v_id uuid;
begin
  if v_role is null or v_role = 'staff' then
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

  v_left := v_loan.principal_left - v_principal;
  v_closed := v_left = 0;
  if (p_loan ->> 'principal_left')::bigint is distinct from v_left
     or (p_loan ->> 'status') is distinct from (case when v_closed then 'closed' else 'active' end) then
    raise exception 'MISMATCH: the amounts do not add up. Nothing was saved';
  end if;

  -- Snapshot for an exact reversal later.
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_before
  from public.dues x
  where x.loan_id = p_loan_id and x.id in (select (e ->> 'id')::uuid from jsonb_array_elements(p_dues) e);

  for d in select * from jsonb_array_elements(p_dues) loop
    v_id := (d ->> 'id')::uuid;
    select * into v_old from public.dues where id = v_id;
    if found then
      if v_old.loan_id <> p_loan_id then
        raise exception 'DUE_MISMATCH: this collection belongs to a different loan';
      end if;
      if (d ->> 'waived')::bigint <> v_old.waived and not v_closed then
        raise exception 'MISMATCH: interest can only be written off when the loan is settled';
      end if;
      if coalesce((d ->> 'cancelled')::boolean, false) <> v_old.cancelled and not v_closed then
        raise exception 'MISMATCH: a collection can only be cancelled when the loan is settled';
      end if;
      v_interest_delta := v_interest_delta + (d ->> 'interest_paid')::bigint - v_old.interest_paid;
      v_principal_delta := v_principal_delta + ((d ->> 'paid')::bigint - (d ->> 'interest_paid')::bigint) - (v_old.paid - v_old.interest_paid);
      if (d ->> 'interest_paid')::bigint < v_old.interest_paid or (d ->> 'paid')::bigint < v_old.paid then
        raise exception 'MISMATCH: a payment cannot reduce what was already paid';
      end if;
      -- amounts and the due date of an existing collection are never changed here
      update public.dues set
        paid = (d ->> 'paid')::bigint,
        interest_paid = (d ->> 'interest_paid')::bigint,
        waived = (d ->> 'waived')::bigint,
        last_paid_date = (d ->> 'last_paid_date')::date,
        cancelled = coalesce((d ->> 'cancelled')::boolean, false)
      where id = v_id;
    else
      -- the next period's collection, opened because this one is now fully paid
      if v_closed or array_length(v_new_ids, 1) is not null then
        raise exception 'MISMATCH: unexpected new collection';
      end if;
      if (d ->> 'paid')::bigint <> 0 or (d ->> 'interest_paid')::bigint <> 0 or coalesce((d ->> 'waived')::bigint, 0) <> 0 then
        raise exception 'MISMATCH: a new collection must start unpaid';
      end if;
      if (d ->> 'principal_amount')::bigint > v_left then
        raise exception 'MISMATCH: the next collection asks for more principal than is left';
      end if;
      insert into public.dues (id, loan_id, due_date, interest_amount, principal_amount)
      values (v_id, p_loan_id, (d ->> 'due_date')::date, (d ->> 'interest_amount')::bigint, (d ->> 'principal_amount')::bigint);
      v_new_ids := v_new_ids || v_id;
    end if;
  end loop;

  if v_interest_delta <> v_interest then
    raise exception 'MISMATCH: interest received does not match the collection. Nothing was saved';
  end if;
  if v_principal_delta > v_principal or v_principal_delta < 0 then
    raise exception 'MISMATCH: principal received does not match the collection. Nothing was saved';
  end if;
  if not v_closed and array_length(v_new_ids, 1) is null
     and not exists (select 1 from public.dues x where x.loan_id = p_loan_id and not x.cancelled
                     and x.interest_amount + x.principal_amount - x.paid - x.waived > 0) then
    raise exception 'MISMATCH: a running loan must have a next collection';
  end if;

  select * into v_customer from public.customers where id = v_loan.customer_id;

  insert into public.payments (id, loan_id, customer_id, due_id, payment_date, recorded_on, principal_before, interest, principal, other,
    method, note, idempotency_key, created_by, before_state)
  values ((p_payment ->> 'id')::uuid, p_loan_id, v_loan.customer_id, (p_payment ->> 'due_id')::uuid, v_date, v_today, v_loan.principal_left,
    v_interest, v_principal, v_other, p_payment ->> 'method', nullif(trim(p_payment ->> 'note'), ''), p_key, auth.uid(),
    jsonb_build_object('loan', jsonb_build_object('principal_left', v_loan.principal_left, 'status', v_loan.status, 'closed_date', v_loan.closed_date),
      'dues', v_before, 'created_due_ids', to_jsonb(v_new_ids)));

  update public.loans set
    principal_left = v_left,
    status = case when v_closed then 'closed' else 'active' end,
    closed_date = case when v_closed then v_date else null end,
    version = version + 1
  where id = p_loan_id;

  perform public.log_activity('payment',
    'Received ' || public.rupee_text(v_interest + v_principal + v_other) || ' from ' || v_customer.name || ' · ' || p_loan_id
      || case when v_closed then ' · Loan closed' else '' end
      || case when v_date < v_today then ' · backdated to ' || to_char(v_date, 'DD Mon YYYY') else '' end,
    p_loan_id, v_loan.customer_id,
    jsonb_build_object('payment_id', p_payment ->> 'id', 'interest', v_interest, 'principal', v_principal, 'other', v_other,
      'principal_before', v_loan.principal_left, 'principal_after', v_left));

  return jsonb_build_object('payment_id', p_payment ->> 'id', 'recorded_on', v_today, 'version', v_loan.version + 1, 'duplicate', false);
end $$;

-- ---------------------------------------------------------------------------
-- Reverse a wrong payment (owner only). The payment row stays, marked reversed.
-- Only the latest payment on a loan can be reversed, so the loan returns exactly
-- to the state it was in before that payment.
-- ---------------------------------------------------------------------------

create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pay public.payments;
  v_loan public.loans;
  v_latest uuid;
  d jsonb;
begin
  if public.app_role() is distinct from 'owner' then
    raise exception 'NOT_ALLOWED: only the owner can reverse a payment';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'REASON_NEEDED: say why this payment is being reversed';
  end if;

  select * into v_pay from public.payments where id = p_payment_id;
  if not found then
    raise exception 'NOT_FOUND: payment not found';
  end if;
  select * into v_loan from public.loans where id = v_pay.loan_id for update;
  -- read again now that the loan is locked
  select * into v_pay from public.payments where id = p_payment_id;
  if v_pay.reversed_at is not null then
    raise exception 'ALREADY_REVERSED: this payment is already reversed';
  end if;

  select id into v_latest from public.payments
  where loan_id = v_pay.loan_id and reversed_at is null order by recorded_at desc, id desc limit 1;
  if v_latest <> p_payment_id then
    raise exception 'NOT_LATEST: only the most recent payment on a loan can be reversed. Reverse the later ones first';
  end if;

  if exists (select 1 from public.dues x
             where x.id in (select (e #>> '{}')::uuid from jsonb_array_elements(v_pay.before_state -> 'created_due_ids') e)
               and (x.paid <> 0 or x.waived <> 0)) then
    raise exception 'NOT_LATEST: a later collection has already been paid';
  end if;
  delete from public.dues
  where id in (select (e #>> '{}')::uuid from jsonb_array_elements(v_pay.before_state -> 'created_due_ids') e);

  for d in select * from jsonb_array_elements(v_pay.before_state -> 'dues') loop
    update public.dues set
      paid = (d ->> 'paid')::bigint,
      interest_paid = (d ->> 'interest_paid')::bigint,
      waived = (d ->> 'waived')::bigint,
      last_paid_date = (d ->> 'last_paid_date')::date,
      cancelled = (d ->> 'cancelled')::boolean
    where id = (d ->> 'id')::uuid;
  end loop;

  update public.loans set
    principal_left = (v_pay.before_state #>> '{loan,principal_left}')::bigint,
    status = v_pay.before_state #>> '{loan,status}',
    closed_date = (v_pay.before_state #>> '{loan,closed_date}')::date,
    version = version + 1
  where id = v_pay.loan_id;

  update public.payments set reversed_at = now(), reversed_by = auth.uid(), reverse_reason = trim(p_reason) where id = p_payment_id;

  perform public.log_activity('payment',
    'Reversed payment of ' || public.rupee_text(v_pay.interest + v_pay.principal + v_pay.other) || ' on ' || v_pay.loan_id || ' · ' || trim(p_reason),
    v_pay.loan_id, v_pay.customer_id,
    jsonb_build_object('payment_id', p_payment_id, 'interest', v_pay.interest, 'principal', v_pay.principal, 'other', v_pay.other));

  return jsonb_build_object('loan_id', v_pay.loan_id, 'version', v_loan.version + 1);
end $$;

-- ---------------------------------------------------------------------------
-- Move a collection date
-- ---------------------------------------------------------------------------

create or replace function public.reschedule_due(p_due_id uuid, p_new_date date, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_due public.dues;
  v_loan public.loans;
  v_name text;
begin
  if public.app_role() is null or public.app_role() = 'staff' then
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
  if p_new_date is null or p_new_date < public.today_ist() then
    raise exception 'PAST_DATE: choose today or a later date';
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
-- Edit loan terms (owner). Old and new values are kept in the activity log.
-- Collections already opened keep their amounts; new terms apply from the next one.
-- ---------------------------------------------------------------------------

create or replace function public.update_loan(p_loan_id text, p_version integer, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
begin
  if public.app_role() is distinct from 'owner' then
    raise exception 'NOT_ALLOWED: only the owner can edit a loan';
  end if;
  select * into v_loan from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'NOT_FOUND: loan not found';
  end if;
  if v_loan.version <> p_version then
    raise exception 'CONFLICT: this loan was changed by someone else. Check it and try again';
  end if;

  update public.loans set
    interest_style = coalesce(p_patch ->> 'interest_style', interest_style),
    interest_value = coalesce((p_patch ->> 'interest_value')::numeric, interest_value),
    interest_method = coalesce(p_patch ->> 'interest_method', interest_method),
    frequency = coalesce(p_patch ->> 'frequency', frequency),
    reference = case when p_patch ? 'reference' then nullif(trim(p_patch ->> 'reference'), '') else reference end,
    version = version + 1
  where id = p_loan_id;

  perform public.log_activity('loan', 'Edited loan ' || p_loan_id, p_loan_id, v_loan.customer_id,
    jsonb_build_object('before', jsonb_build_object('interest_style', v_loan.interest_style, 'interest_value', v_loan.interest_value,
      'interest_method', v_loan.interest_method, 'frequency', v_loan.frequency, 'reference', v_loan.reference), 'after', p_patch));
end $$;

-- ---------------------------------------------------------------------------
-- Hand security back to the customer (owner)
-- ---------------------------------------------------------------------------

create or replace function public.release_collateral(p_loan_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_customer text;
begin
  if public.app_role() is distinct from 'owner' then
    raise exception 'NOT_ALLOWED: only the owner can release security';
  end if;
  update public.collateral set status = 'released', released_at = now(), released_by = auth.uid()
  where loan_id = p_loan_id and status = 'held';
  if not found then
    raise exception 'NOT_FOUND: no security is held for this loan';
  end if;
  select customer_id into v_customer from public.loans where id = p_loan_id;
  perform public.log_activity('security', 'Security released for ' || p_loan_id, p_loan_id, v_customer);
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_loan(uuid, jsonb, jsonb, jsonb),
  public.record_payment(uuid, text, integer, jsonb, jsonb, jsonb),
  public.reverse_payment(uuid, text),
  public.reschedule_due(uuid, date, text),
  public.update_loan(text, integer, jsonb),
  public.release_collateral(text)
to authenticated;
