-- Importing the business's existing customers and loans (see IMPORT.md).
--
-- A file is checked first by src/lib/import/validate.ts. Only a file with no errors
-- is sent here, and this function saves the whole file in one transaction: every
-- row, or nothing. It is not callable from the app, only by an administrator with
-- the service key.

alter table public.customers add column import_batch uuid;
alter table public.loans add column import_batch uuid;

create table public.import_batches (
  id uuid primary key,
  at timestamptz not null default now(),
  file_name text not null default '',
  customers integer not null default 0,
  loans integer not null default 0,
  undone_at timestamptz
);
alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;
create policy import_batches_owner_read on public.import_batches for select to authenticated using ((select public.app_role()) = 'owner');

-- Imported customers get one activity line for the whole file, not one each.
create or replace function public.log_new_customer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.import_batch is null then
    perform public.log_activity('customer', 'Added customer ' || new.name, null, new.id);
  end if;
  return new;
end $$;

-- p_customers: [ { key, name, phone, alt_phone, area, address, id_ref, notes } ]
-- p_loans:     [ { customer_key, type, amount, principal_left, start_date, interest_style, interest_value,
--                  interest_method, frequency, principal_per_due, next_due_date, status, closed_date,
--                  reference, collateral: { kind, details, search_text } | null } ]
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
      frequency, principal_per_due, principal_left, status, closed_date, idempotency_key, import_batch)
    values (v_customer_id, l ->> 'type', (l ->> 'amount')::bigint, (l ->> 'start_date')::date, nullif(l ->> 'reference', ''),
      l ->> 'interest_style', (l ->> 'interest_value')::numeric, l ->> 'interest_method', l ->> 'frequency',
      coalesce((l ->> 'principal_per_due')::bigint, 0), (l ->> 'principal_left')::bigint, l ->> 'status', (l ->> 'closed_date')::date,
      gen_random_uuid(), p_batch)
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
      insert into public.dues (loan_id, due_date, interest_amount, principal_amount)
      values (v_loan.id, (l ->> 'next_due_date')::date, v_interest, v_principal);
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

-- Loans are never deleted, with one exception: taking back an import that turned out
-- to be wrong, before anything has been collected on it.
create or replace function public.loans_no_delete() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.undo_import', true), '') = 'on' and old.import_batch is not null then
    return old;
  end if;
  raise exception 'HISTORY_LOCKED: loans rows cannot be changed or deleted';
end $$;
drop trigger loans_no_delete on public.loans;
create trigger loans_no_delete before delete on public.loans for each row execute function public.loans_no_delete();

create or replace function public.undo_import(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_loans integer;
  v_customers integer;
begin
  if not exists (select 1 from public.import_batches where id = p_batch and undone_at is null) then
    raise exception 'IMPORT: no such import, or it was already taken back';
  end if;
  if exists (select 1 from public.payments p join public.loans l on l.id = p.loan_id where l.import_batch = p_batch)
     or exists (select 1 from public.waivers w join public.loans l on l.id = w.loan_id where l.import_batch = p_batch) then
    raise exception 'IMPORT: payments or waivers have been recorded on these loans, so the import cannot be taken back';
  end if;
  if exists (select 1 from public.loans l join public.customers c on c.id = l.customer_id
             where c.import_batch = p_batch and l.import_batch is distinct from p_batch) then
    raise exception 'IMPORT: new loans have been given to imported customers, so the import cannot be taken back';
  end if;

  perform set_config('app.undo_import', 'on', true);
  delete from public.collateral where loan_id in (select id from public.loans where import_batch = p_batch);
  delete from public.dues where loan_id in (select id from public.loans where import_batch = p_batch);
  delete from public.loans where import_batch = p_batch;
  get diagnostics v_loans = row_count;
  delete from public.customers where import_batch = p_batch;
  get diagnostics v_customers = row_count;
  perform set_config('app.undo_import', 'off', true);

  update public.import_batches set undone_at = now() where id = p_batch;
  insert into public.activity (by_name, kind, text, data)
  values ('Import', 'system', 'Took back an import: ' || v_customers || ' customers and ' || v_loans || ' loans removed', jsonb_build_object('batch', p_batch));
  return jsonb_build_object('customers', v_customers, 'loans', v_loans);
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public.import_book(uuid, text, jsonb, jsonb), public.undo_import(uuid) from authenticated;
grant execute on function public.import_book(uuid, text, jsonb, jsonb), public.undo_import(uuid) to service_role;
