-- An admin can delete a loan (30 October 2026).
--
-- A loan entered by mistake (wrong customer, typed twice, a test) can be deleted by an
-- ADMIN, with everything attached to it: its collections, payments, what each payment
-- did to each collection, waivers, the security held and the notes. The customer stays.
-- The plain owner (the client), staff and collectors cannot.
--
-- Payments, what they did, waivers and loans are history and stay locked against any
-- change or delete. The one way past the locks is this function: while it runs it names
-- the one loan it is deleting in a setting that lasts only until the end of its own
-- transaction, and the locks let through a delete of a row of THAT loan only. Nothing
-- else (the app, the service key, another function) sets it, and the app's sign-in has
-- no right to delete rows of these tables in the first place.
--
-- Nothing is lost: one activity entry keeps a full copy of every row deleted. Older
-- activity entries stay; they just stop pointing at the loan.
--
-- Security photos are in storage under "<loan id>/". The function returns their names;
-- the app removes them through the storage service after the delete (removing a file
-- straight from the storage tables would leave the file itself behind).

-- ---------------------------------------------------------------------------
-- The locks
-- ---------------------------------------------------------------------------

create or replace function public.loan_history_locked() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and old.loan_id = current_setting('app.deleting_loan', true) then
    return old;
  end if;
  raise exception 'HISTORY_LOCKED: % rows cannot be changed or deleted', tg_table_name;
end $$;
revoke execute on function public.loan_history_locked() from public, anon, authenticated;

drop trigger payments_no_delete on public.payments;
create trigger payments_no_delete before delete on public.payments for each row execute function public.loan_history_locked();
drop trigger payment_allocations_no_change on public.payment_allocations;
create trigger payment_allocations_no_change before update or delete on public.payment_allocations for each row execute function public.loan_history_locked();
drop trigger waivers_no_delete on public.waivers;
create trigger waivers_no_delete before delete on public.waivers for each row execute function public.loan_history_locked();

create or replace function public.loans_no_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.id = current_setting('app.deleting_loan', true) then
    return old;
  end if;
  if coalesce(current_setting('app.undo_import', true), '') = 'on' and old.import_batch is not null then
    return old;
  end if;
  raise exception 'HISTORY_LOCKED: loans rows cannot be changed or deleted';
end $$;

-- The activity log stays locked. Two changes are allowed on an entry: its link to a
-- customer is cleared, or its link to a loan is cleared. Nothing else may change with
-- them, and nothing can be deleted.
create or replace function public.activity_locked() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and ((old.customer_id is not null and new.customer_id is null) or (old.loan_id is not null and new.loan_id is null))
     and (new.customer_id is null or new.customer_id = old.customer_id)
     and (new.loan_id is null or new.loan_id = old.loan_id)
     and (to_jsonb(new) - 'customer_id' - 'loan_id') is not distinct from (to_jsonb(old) - 'customer_id' - 'loan_id') then
    return new;
  end if;
  raise exception 'HISTORY_LOCKED: % rows cannot be changed or deleted', tg_table_name;
end $$;

-- ---------------------------------------------------------------------------
-- Deleting
-- ---------------------------------------------------------------------------

create or replace function public.delete_loan(p_loan_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.loans;
  v_name text;
  v_paid integer;
  v_copy jsonb;
  v_files jsonb;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED: only an administrator can delete a loan';
  end if;
  select * into v from public.loans where id = p_loan_id for update;
  if not found then
    raise exception 'NOT_FOUND: this loan was not found. It may already be deleted';
  end if;
  select name into v_name from public.customers where id = v.customer_id;
  select count(*) into v_paid from public.payments where loan_id = v.id and reversed_at is null;

  -- what is deleted is kept in the log, in full
  v_copy := jsonb_build_object(
    'loan', to_jsonb(v),
    'dues', (select coalesce(jsonb_agg(to_jsonb(d) order by d.due_date, d.id), '[]') from public.dues d where d.loan_id = v.id),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p) order by p.recorded_at, p.id), '[]') from public.payments p where p.loan_id = v.id),
    'allocations', (select coalesce(jsonb_agg(to_jsonb(a) order by a.payment_id, a.due_id), '[]') from public.payment_allocations a where a.loan_id = v.id),
    'waivers', (select coalesce(jsonb_agg(to_jsonb(w) order by w.id), '[]') from public.waivers w where w.loan_id = v.id),
    'collateral', (select to_jsonb(c) from public.collateral c where c.loan_id = v.id),
    'notes', (select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]') from public.loan_notes n where n.loan_id = v.id));
  select coalesce(jsonb_agg(o.name order by o.name), '[]') into v_files
  from storage.objects o where o.bucket_id = 'documents' and (storage.foldername(o.name))[1] = v.id;

  perform set_config('app.deleting_loan', v.id, true);
  delete from public.payment_allocations where loan_id = v.id;
  delete from public.waivers where loan_id = v.id;
  delete from public.payments where loan_id = v.id;
  delete from public.dues where loan_id = v.id;
  delete from public.collateral where loan_id = v.id;
  delete from public.loan_notes where loan_id = v.id;
  delete from public.loans where id = v.id;
  perform set_config('app.deleting_loan', '', true);

  update public.activity set loan_id = null where loan_id = v.id;
  perform public.log_activity('loan',
    'Deleted loan ' || coalesce(v.import_ref, v.id) || ' of ' || coalesce(v_name, v.customer_id) || ', ' || public.rupee_text(v.amount)
      || ', ' || v_paid || case when v_paid = 1 then ' payment' else ' payments' end,
    null, v.customer_id, v_copy);

  return jsonb_build_object('deleted', v.id, 'files', v_files);
end $$;

-- Several loans at once, all or nothing: if one cannot be deleted, none is.
create or replace function public.delete_loans(p_ids text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_res jsonb;
  v_deleted jsonb := '[]';
  v_files jsonb := '[]';
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED: only an administrator can delete a loan';
  end if;
  if coalesce(cardinality(p_ids), 0) = 0 then
    raise exception 'NOTHING_CHOSEN: choose the loans to delete';
  end if;
  -- in one order, so two admins deleting overlapping lists cannot block each other
  for v_id in select distinct x from unnest(p_ids) x order by x loop
    v_res := public.delete_loan(v_id);
    v_deleted := v_deleted || jsonb_build_array(v_res -> 'deleted');
    v_files := v_files || (v_res -> 'files');
  end loop;
  return jsonb_build_object('deleted', v_deleted, 'files', v_files);
end $$;

revoke execute on function public.delete_loan(text), public.delete_loans(text[]) from public, anon;
grant execute on function public.delete_loan(text), public.delete_loans(text[]) to authenticated;
