-- Missed interest (confirmed by the client).
--
-- Interest falls due every period whether or not the last period was paid, and every
-- missed period stays pending on its own until it is paid, part-paid, or waived by the
-- owner with a reason. Nothing older is ever cleared because something newer was paid.
-- The owner decides which periods a payment covers.
--
-- What changes:
--   * accrue_dues     brings a loan's collections up to today (mirrors accrueDues in
--                     src/lib/finance/engine.ts; a test checks they agree)
--   * record_payment  accepts interest against several collections, and an explicit waiver
--   * waive_interest  the owner writes off pending interest without receiving money
--   * a loan closes only when the principal is back AND no interest is pending
--   * payment_allocations and waivers keep a row for everything a payment or waiver did

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

-- Before: closed <=> principal 0. Now a loan whose principal is back can stay open
-- while interest is pending, so only one direction holds.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.loans'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%principal_left = 0%' loop
    execute format('alter table public.loans drop constraint %I', c);
  end loop;
end $$;
alter table public.loans add constraint loans_closed_means_repaid check (status <> 'closed' or principal_left = 0);

-- A waiver only ever writes off interest, never a principal part.
alter table public.dues add constraint dues_waived_is_interest check (interest_paid + waived <= interest_amount);

-- ---------------------------------------------------------------------------
-- What each payment did to each collection
-- ---------------------------------------------------------------------------

create table public.payment_allocations (
  payment_id uuid not null references public.payments (id),
  due_id uuid not null references public.dues (id),
  loan_id text not null references public.loans (id),
  interest bigint not null default 0 check (interest >= 0),
  principal bigint not null default 0 check (principal >= 0),
  waived bigint not null default 0 check (waived >= 0),
  primary key (payment_id, due_id),
  check (interest + principal + waived > 0)
);
create index payment_allocations_due on public.payment_allocations (due_id);
create index payment_allocations_loan on public.payment_allocations (loan_id);

-- Every waiver: who, when, which collection, how much, and why.
create table public.waivers (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by uuid references public.profiles (id),
  by_name text not null default '',
  loan_id text not null references public.loans (id),
  due_id uuid not null references public.dues (id),
  amount bigint not null check (amount > 0),
  reason text not null check (length(trim(reason)) > 0),
  -- set when the waiver was part of a payment
  payment_id uuid references public.payments (id),
  -- set when that payment was reversed
  reversed_at timestamptz
);
create index waivers_loan on public.waivers (loan_id);

create or replace function public.waivers_only_reversal() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'reversed_at') is distinct from (to_jsonb(old) - 'reversed_at') or old.reversed_at is not null then
    raise exception 'HISTORY_LOCKED: a waiver cannot be edited';
  end if;
  return new;
end $$;

create trigger payment_allocations_no_change before update or delete on public.payment_allocations for each row execute function public.forbid_change();
create trigger waivers_no_delete before delete on public.waivers for each row execute function public.forbid_change();
create trigger waivers_no_edit before update on public.waivers for each row execute function public.waivers_only_reversal();

alter table public.payment_allocations enable row level security;
alter table public.waivers enable row level security;
revoke all on public.payment_allocations, public.waivers from anon, authenticated;
grant select on public.payment_allocations, public.waivers to authenticated;
create policy payment_allocations_read on public.payment_allocations for select to authenticated using (public.can_see_loan(loan_id));
create policy waivers_read on public.waivers for select to authenticated using (public.can_see_loan(loan_id));

-- ---------------------------------------------------------------------------
-- Collections fall due by the calendar
-- ---------------------------------------------------------------------------

-- Adds one collection for every period that has started since the loan's last one,
-- and the next one if everything is paid ahead. Only ever adds. Returns how many.
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
    values (p_loan_id, public.next_due_date(coalesce(v_last, v_loan.start_date), v_loan.frequency, v_loan.start_date), v_interest, v_principal);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Brings every running loan the caller can see up to today. The app calls this when it opens.
create or replace function public.accrue_all() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.today_ist();
  r record;
  n integer := 0;
begin
  if public.app_role() is null then
    raise exception 'NOT_ALLOWED: sign in first';
  end if;
  for r in
    select l.id from public.loans l
    where l.status = 'active' and l.principal_left > 0 and public.can_see_customer(l.customer_id)
      and (not exists (select 1 from public.dues d where d.loan_id = l.id and not d.cancelled and d.remaining > 0)
           or (select max(coalesce(d.original_date, d.due_date)) from public.dues d where d.loan_id = l.id) < v_today)
    order by l.id
  loop
    n := n + public.accrue_dues(r.id);
  end loop;
  return n;
end $$;

-- After a reversal: removes untouched collections at the end of a loan's calendar that
-- would not exist had the reversed payment never been made (a "next" one opened only
-- because everything had been paid ahead).
create or replace function public.trim_dues(p_loan_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.today_ist();
  v_last public.dues;
  v_prev date;
begin
  loop
    select * into v_last from public.dues where loan_id = p_loan_id order by coalesce(original_date, due_date) desc, due_date desc limit 1;
    exit when not found or v_last.paid <> 0 or v_last.waived <> 0 or v_last.cancelled or v_last.original_date is not null;
    select max(coalesce(original_date, due_date)) into v_prev from public.dues where loan_id = p_loan_id and id <> v_last.id;
    exit when v_prev is null or v_prev < v_today;
    exit when not exists (select 1 from public.dues where loan_id = p_loan_id and id <> v_last.id and not cancelled and remaining > 0);
    exit when exists (select 1 from public.payment_allocations where due_id = v_last.id);
    delete from public.dues where id = v_last.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- New loan: also brings a loan with an earlier start date up to today
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
  if (p_first_due ->> 'due_date')::date <> public.next_due_date(v_start, p_loan ->> 'frequency', v_start)
     or (p_first_due ->> 'interest_amount')::bigint <> public.period_interest(p_loan ->> 'interest_style', (p_loan ->> 'interest_value')::numeric,
          p_loan ->> 'interest_method', v_amount, v_amount)
     or (p_first_due ->> 'principal_amount')::bigint <> least(coalesce((p_loan ->> 'principal_per_due')::bigint, 0), v_amount) then
    raise exception 'MISMATCH: the first collection does not match the loan terms. Nothing was saved';
  end if;
  if (p_first_due ->> 'interest_amount')::bigint + (p_first_due ->> 'principal_amount')::bigint <= 0 then
    raise exception 'INVALID_TERMS: set an interest amount or a principal amount for each collection';
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

  -- a loan entered with an earlier date: every period since then is pending
  perform public.accrue_dues(v_loan.id);

  perform public.log_activity('loan', 'New loan ' || v_loan.id || ' · ' || public.rupee_text(v_amount) || ' given to ' || v_customer.name,
    v_loan.id, v_customer.id, jsonb_build_object('loan', p_loan, 'first_due', p_first_due));

  return jsonb_build_object('loan_id', v_loan.id, 'duplicate', false);
end $$;

-- ---------------------------------------------------------------------------
-- Receive a payment
-- ---------------------------------------------------------------------------
-- p_payment: { id, due_id, date, interest, principal, other, method, note }
-- p_loan:    { principal_left, status }                         the loan after the payment
-- p_dues:    [ { id, paid, interest_paid, waived, last_paid_date, cancelled } ]
--            every EXISTING collection the payment changed. New collections are never
--            sent: the database adds them itself (accrue_dues).
-- p_waive_reason: needed when any collection's `waived` goes up (owner only).

drop function if exists public.record_payment(uuid, text, integer, jsonb, jsonb, jsonb);

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
    if v_role <> 'owner' then
      raise exception 'NOT_ALLOWED: only the owner can waive interest';
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
-- Waive pending interest without receiving money (owner only, reason required)
-- ---------------------------------------------------------------------------
-- p_waive: [ { due_id, amount } ]

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
  if public.app_role() is distinct from 'owner' then
    raise exception 'NOT_ALLOWED: only the owner can waive interest';
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
-- Reverse a wrong payment
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
  if v_pay.before_state -> 'loan' is null then
    raise exception 'NOT_REVERSIBLE: this payment was imported from older records and cannot be reversed here';
  end if;

  select id into v_latest from public.payments
  where loan_id = v_pay.loan_id and reversed_at is null order by recorded_at desc, id desc limit 1;
  if v_latest <> p_payment_id then
    raise exception 'NOT_LATEST: only the most recent payment on a loan can be reversed. Reverse the later ones first';
  end if;
  if exists (select 1 from public.waivers where loan_id = v_pay.loan_id and reversed_at is null
             and payment_id is distinct from p_payment_id and at > v_pay.recorded_at) then
    raise exception 'NOT_LATEST: interest was waived on this loan after this payment, so it cannot be reversed';
  end if;

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
  update public.waivers set reversed_at = now() where payment_id = p_payment_id;

  -- put the loan's calendar back as it would have been without this payment
  perform public.trim_dues(v_pay.loan_id);
  perform public.accrue_dues(v_pay.loan_id);

  perform public.log_activity('payment',
    'Reversed payment of ' || public.rupee_text(v_pay.interest + v_pay.principal + v_pay.other) || ' on ' || v_pay.loan_id || ' · ' || trim(p_reason),
    v_pay.loan_id, v_pay.customer_id,
    jsonb_build_object('payment_id', p_payment_id, 'interest', v_pay.interest, 'principal', v_pay.principal, 'other', v_pay.other));

  return jsonb_build_object('loan_id', v_pay.loan_id, 'version', v_loan.version + 1);
end $$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.accrue_dues(text), public.trim_dues(text) from authenticated;
grant execute on function
  public.record_payment(uuid, text, integer, jsonb, jsonb, jsonb, text),
  public.waive_interest(text, integer, jsonb, text),
  public.accrue_all()
to authenticated;
-- test hook: lets tests/db bring one loan up to date and compare with the engine
grant execute on function public.accrue_dues(text) to service_role;
