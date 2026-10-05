-- Two things a real book needs that the first import could not carry:
--   * a period that is already part-paid on the day of the import
--     (interest_already_paid: counted on the loan's oldest unpaid collection);
--   * the day the customer last paid (last_paid_date), so "Last Paid" is not blank
--     for imported loans. Past payments themselves are still not imported.

alter table public.loans add column imported_last_paid_on date;

-- "Last Paid" = the latest interest payment recorded in the app, or, if none yet,
-- the date carried in by the import.
create or replace view public.loan_last_paid with (security_invoker = true) as
select l.id as loan_id,
  case when p.last_on is null then l.imported_last_paid_on
       when l.imported_last_paid_on is null then p.last_on
       else greatest(p.last_on, l.imported_last_paid_on) end as last_interest_paid_on
from public.loans l
left join (
  select loan_id, max(payment_date) as last_on from public.payments
  where reversed_at is null and interest > 0 group by loan_id
) p on p.loan_id = l.id
where p.last_on is not null or l.imported_last_paid_on is not null;

-- p_customers: [ { key, name, phone, alt_phone, area, address, id_ref, notes } ]
-- p_loans:     [ { customer_key, type, amount, principal_left, start_date, interest_style, interest_value,
--                  interest_method, frequency, principal_per_due, next_due_date, status, closed_date,
--                  reference, interest_already_paid, last_paid_date,
--                  collateral: { kind, details, search_text } | null } ]
create or replace function public.import_book(p_batch uuid, p_file text, p_customers jsonb, p_loans jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  l jsonb;
  v_ids jsonb := '{}'::jsonb;
  v_customer_id text;
  v_loan public.loans;
  v_new_customers integer := 0;
  v_loans integer := 0;
  v_interest bigint;
  v_principal bigint;
  v_already bigint;
  v_last_paid date;
begin
  if exists (select 1 from public.import_batches where id = p_batch) then
    return jsonb_build_object('duplicate', true);
  end if;
  insert into public.import_batches (id, file_name) values (p_batch, coalesce(p_file, ''));

  for c in select * from jsonb_array_elements(p_customers) loop
    -- a customer already in the system (same phone) is reused, never duplicated
    select id into v_customer_id from public.customers where phone = c ->> 'phone' order by id limit 1;
    if v_customer_id is null then
      insert into public.customers (name, phone, alt_phone, area, address, id_ref, notes, import_batch)
      values (c ->> 'name', c ->> 'phone', c ->> 'alt_phone', coalesce(c ->> 'area', ''), c ->> 'address', c ->> 'id_ref', c ->> 'notes', p_batch)
      returning id into v_customer_id;
      v_new_customers := v_new_customers + 1;
    end if;
    v_ids := v_ids || jsonb_build_object(c ->> 'key', v_customer_id);
  end loop;

  for l in select * from jsonb_array_elements(p_loans) loop
    v_customer_id := v_ids ->> (l ->> 'customer_key');
    if v_customer_id is null then
      raise exception 'IMPORT: a loan refers to a customer that is not in the file (%)', l ->> 'customer_key';
    end if;

    insert into public.loans (customer_id, type, amount, start_date, reference, interest_style, interest_value, interest_method,
      frequency, principal_per_due, principal_left, status, closed_date, idempotency_key, import_batch, imported_last_paid_on)
    values (v_customer_id, l ->> 'type', (l ->> 'amount')::bigint, (l ->> 'start_date')::date, nullif(l ->> 'reference', ''),
      l ->> 'interest_style', (l ->> 'interest_value')::numeric, l ->> 'interest_method', l ->> 'frequency',
      coalesce((l ->> 'principal_per_due')::bigint, 0), (l ->> 'principal_left')::bigint, l ->> 'status', (l ->> 'closed_date')::date,
      gen_random_uuid(), p_batch, (l ->> 'last_paid_date')::date)
    returning * into v_loan;
    v_loans := v_loans + 1;

    if v_loan.status = 'active' then
      -- the oldest collection still unpaid, as given in the file; later periods follow from it
      v_interest := public.period_interest(v_loan.interest_style, v_loan.interest_value, v_loan.interest_method, v_loan.amount, v_loan.principal_left);
      v_principal := least(v_loan.principal_per_due, v_loan.principal_left);
      if v_interest + v_principal <= 0 then
        raise exception 'IMPORT: loan for % has no interest and no principal per collection', l ->> 'customer_key';
      end if;
      if (l ->> 'next_due_date')::date <= v_loan.start_date then
        raise exception 'IMPORT: the next collection for % is not after the loan date', l ->> 'customer_key';
      end if;
      -- a period that was already part-paid before the import
      v_already := coalesce((l ->> 'interest_already_paid')::bigint, 0);
      v_last_paid := (l ->> 'last_paid_date')::date;
      if v_already < 0 or v_already >= v_interest then
        raise exception 'IMPORT: interest already paid for % must be less than one period (%)', l ->> 'customer_key', v_interest;
      end if;
      insert into public.dues (loan_id, due_date, interest_amount, principal_amount, paid, interest_paid, last_paid_date)
      values (v_loan.id, (l ->> 'next_due_date')::date, v_interest, v_principal, v_already, v_already,
        case when v_already > 0 then v_last_paid end);
      perform public.accrue_dues(v_loan.id);
    end if;

    if l -> 'collateral' is not null and jsonb_typeof(l -> 'collateral') = 'object' then
      insert into public.collateral (loan_id, kind, details, search_text, status)
      values (v_loan.id, l #>> '{collateral,kind}', coalesce(l #> '{collateral,details}', '{}'::jsonb), coalesce(l #>> '{collateral,search_text}', ''),
        case when v_loan.status = 'closed' then 'released' else 'held' end);
    end if;
  end loop;

  update public.import_batches set customers = v_new_customers, loans = v_loans where id = p_batch;
  insert into public.activity (by_name, kind, text, data)
  values ('Import', 'system', 'Imported ' || v_new_customers || ' customers and ' || v_loans || ' loans from ' || coalesce(nullif(p_file, ''), 'a file'),
    jsonb_build_object('batch', p_batch));

  return jsonb_build_object('duplicate', false, 'customers', v_new_customers, 'loans', v_loans);
end $$;

revoke execute on function public.import_book(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.import_book(uuid, text, jsonb, jsonb) to service_role;
