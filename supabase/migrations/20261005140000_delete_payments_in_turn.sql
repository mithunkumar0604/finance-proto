-- Deleting payments one after another.
--
-- The owner deletes the latest payment on a loan, and may then delete the one before it.
-- That second delete was refused by the database in this case:
--   1. an interest payment is recorded; the database opens the next collection;
--   2. a principal-only payment is recorded; it is noted against that next collection;
--   3. the principal payment is deleted (fine);
--   4. the interest payment is deleted: the collection opened in step 1 has to go, but the
--      deleted payment from step 2 still pointed at it, so the whole delete failed.
-- No money figure was ever wrong (the failed delete changed nothing); the owner simply
-- could not finish the correction.
--
-- Fix: when a collection is removed, a payment that is ALREADY deleted lets go of its
-- pointer to it. Everything else about a deleted payment stays locked, and a payment that
-- is not deleted keeps its collection (the collection then stays).

create or replace function public.payments_only_reversal() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.reversed_at is not null then
    -- the one change allowed on a deleted payment: its link to a collection being removed is cleared
    if old.due_id is not null and new.due_id is null
       and (to_jsonb(new) - 'due_id') is not distinct from (to_jsonb(old) - 'due_id') then
      return new;
    end if;
    raise exception 'HISTORY_LOCKED: this payment is already reversed';
  end if;
  if (to_jsonb(new) - 'reversed_at' - 'reversed_by' - 'reverse_reason')
     is distinct from (to_jsonb(old) - 'reversed_at' - 'reversed_by' - 'reverse_reason') then
    raise exception 'HISTORY_LOCKED: a recorded payment cannot be edited, only reversed';
  end if;
  return new;
end $$;

-- Same rules as before for which collection may go (the last one, untouched, for a period
-- that has not begun, while an earlier one is still open). Two lines are new: a payment
-- that still counts keeps its collection, and a deleted payment lets go of it.
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
    exit when exists (select 1 from public.payments where due_id = v_last.id and reversed_at is null);
    update public.payments set due_id = null where due_id = v_last.id and reversed_at is not null;
    delete from public.dues where id = v_last.id;
  end loop;
end $$;
