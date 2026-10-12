-- From the client's paper ledger (12 October 2026). Every line of their book has their
-- own loan number, who referred the customer, and remarks. This adds the three:
--
--   1. Loan number   the client's own number for a loan (their book's serial, e.g. 6845).
--                    Typed when the loan is given (the app suggests the next one) and
--                    unique. It is kept in loans.import_ref, the column an import already
--                    fills from the sheet's loan_ref, so imported and new loans share one
--                    numbering. The app's own id (LP-1001) stays the permanent key.
--   2. Referred by   a name, per loan.
--   3. Notes         dated remarks on a loan that are not a payment ("will pay next week"),
--                    with an optional promised date. No effect on any amount.

alter table public.loans add column referred_by text;
create index loans_referred_by on public.loans (lower(referred_by)) where referred_by is not null;

-- ---------------------------------------------------------------------------
-- 1 + 2. New loan and Edit loan carry the loan number and "referred by"
-- ---------------------------------------------------------------------------

-- which loan already has this number (ignoring capitals and outer spaces), if any
create or replace function public.loan_with_no(p_no text, p_except text default null) returns text
language sql stable security definer set search_path = public as $$
  select id from public.loans where lower(import_ref) = lower(trim(p_no)) and id is distinct from p_except limit 1
$$;
revoke execute on function public.loan_with_no(text, text) from public, anon, authenticated;

create or replace function public.create_loan(p_key uuid, p_loan jsonb, p_first_due jsonb, p_collateral jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
  v_customer public.customers;
  v_amount bigint := (p_loan ->> 'amount')::bigint;
  v_start date := (p_loan ->> 'start_date')::date;
  v_no text := nullif(trim(p_loan ->> 'loan_no'), '');
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
  if length(v_no) > 30 then
    raise exception 'LOAN_NO_TOO_LONG: keep the loan number under 30 characters';
  end if;
  if v_no is not null then
    v_taken := public.loan_with_no(v_no);
    if v_taken is not null then
      raise exception 'LOAN_NO_TAKEN: loan number % is already used by loan %. Give this loan another number', v_no, v_taken;
    end if;
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
    frequency, principal_per_due, principal_left, idempotency_key, created_by, import_ref, referred_by)
  values (v_customer.id, p_loan ->> 'type', v_amount, v_start, nullif(trim(p_loan ->> 'reference'), ''),
    p_loan ->> 'interest_style', (p_loan ->> 'interest_value')::numeric, p_loan ->> 'interest_method',
    p_loan ->> 'frequency', coalesce((p_loan ->> 'principal_per_due')::bigint, 0), v_amount, p_key, auth.uid(),
    v_no, nullif(left(trim(p_loan ->> 'referred_by'), 80), ''))
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

create or replace function public.update_loan(p_loan_id text, p_version integer, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
  v_no text := nullif(trim(p_patch ->> 'loan_no'), '');
  v_taken text;
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
-- 3. Notes on a loan
-- ---------------------------------------------------------------------------

create table public.loan_notes (
  id bigint generated always as identity primary key,
  loan_id text not null references public.loans (id) on delete cascade,
  customer_id text not null references public.customers (id),
  at timestamptz not null default now(),
  by uuid references public.profiles (id),
  by_name text not null default '',
  text text not null check (length(trim(text)) between 1 and 500),
  -- the day the customer said they would pay, when the note records a promise
  promised_on date
);
create index loan_notes_loan on public.loan_notes (loan_id, at desc);

alter table public.loan_notes enable row level security;
revoke all on public.loan_notes from anon, authenticated;
grant select on public.loan_notes to authenticated;
create policy loan_notes_read on public.loan_notes for select to authenticated using (public.can_see_loan(loan_id));
-- written only through add_loan_note; a note is a record of what was said, so it is not edited afterwards
create trigger loan_notes_no_edit before update on public.loan_notes for each row execute function public.forbid_change();

-- the newest note of each loan (for the collection lists and the Excel sheet)
create view public.loan_latest_note with (security_invoker = true) as
select distinct on (loan_id) id, loan_id, customer_id, at, by_name, text, promised_on
from public.loan_notes
order by loan_id, at desc, id desc;
revoke all on public.loan_latest_note from anon, authenticated;
grant select on public.loan_latest_note to authenticated;

-- Anyone who can see the loan may add a note to it (owner, staff, the customer's collector).
create or replace function public.add_loan_note(p_loan_id text, p_text text, p_promised_on date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
  v_text text := trim(coalesce(p_text, ''));
  v_id bigint;
begin
  if public.app_role() is null or not public.can_see_loan(p_loan_id) then
    raise exception 'NOT_ALLOWED: you cannot add a note to this loan';
  end if;
  select * into v_loan from public.loans where id = p_loan_id;
  if not found then
    raise exception 'NOT_FOUND: loan not found';
  end if;
  if v_text = '' then
    raise exception 'NOTE_NEEDED: type the note';
  end if;
  if length(v_text) > 500 then
    raise exception 'NOTE_TOO_LONG: keep the note under 500 letters';
  end if;
  if p_promised_on is not null and (p_promised_on < public.today_ist() or p_promised_on > public.today_ist() + 366) then
    raise exception 'INVALID_DATE: the promised date must be today or later, within a year';
  end if;

  insert into public.loan_notes (loan_id, customer_id, by, by_name, text, promised_on)
  values (p_loan_id, v_loan.customer_id, auth.uid(), coalesce((select name from public.profiles where id = auth.uid()), ''), v_text, p_promised_on)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

revoke execute on function public.add_loan_note(text, text, date) from public, anon;
grant execute on function public.add_loan_note(text, text, date) to authenticated;
