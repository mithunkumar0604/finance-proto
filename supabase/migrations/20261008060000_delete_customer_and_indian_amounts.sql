-- 1. Amounts in the activity list the Indian way: ₹1,00,000, not ₹100,000.
-- 2. The owner can delete a customer who has no loans (a wrong or duplicate entry).

-- ---------------------------------------------------------------------------
-- 1. Amounts
-- ---------------------------------------------------------------------------
-- The last three digits form one group, the rest go in twos: 12345678 -> 1,23,45,678.
-- Only the wording of new activity entries changes; no amount is stored as text.

create or replace function public.rupee_text(p bigint) returns text
language sql immutable set search_path = public as $$
  select '₹'
    || case
         when p / 100 < 1000 then (p / 100)::text
         else regexp_replace((p / 100000)::text, '(\d)(?=(\d\d)+$)', '\1,', 'g') || ',' || lpad(((p / 100) % 1000)::text, 3, '0')
       end
    || case when p % 100 = 0 then '' else '.' || lpad((p % 100)::text, 2, '0') end
$$;

-- ---------------------------------------------------------------------------
-- 2. Deleting a customer
-- ---------------------------------------------------------------------------
-- A customer who has, or ever had, a loan is never deleted: loans, payments and reports
-- point at them. A customer with no loan at all has nothing but activity entries
-- ("Added customer …", "Edited customer …") pointing at them. Those entries stay in the
-- log; they just stop pointing at a customer that no longer exists.

-- The activity log stays locked. One change is allowed on an entry: its link to a
-- customer is cleared. Nothing else may change with it, and nothing can be deleted.
create or replace function public.activity_locked() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.customer_id is not null and new.customer_id is null
     and (to_jsonb(new) - 'customer_id') is not distinct from (to_jsonb(old) - 'customer_id') then
    return new;
  end if;
  raise exception 'HISTORY_LOCKED: % rows cannot be changed or deleted', tg_table_name;
end $$;

drop trigger activity_no_change on public.activity;
create trigger activity_no_change before update or delete on public.activity for each row execute function public.activity_locked();

create or replace function public.delete_customer(p_customer_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.customers;
begin
  if public.app_role() is distinct from 'owner' then
    raise exception 'NOT_ALLOWED: only the owner can delete a customer';
  end if;
  select * into v from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'NOT_FOUND: this customer was not found. It may already be deleted';
  end if;
  if exists (select 1 from public.loans where customer_id = p_customer_id) then
    raise exception 'HAS_LOANS: this customer has loans, so it cannot be deleted';
  end if;

  update public.activity set customer_id = null where customer_id = p_customer_id;
  delete from public.customers where id = p_customer_id;

  -- what was deleted is kept in the log, in full
  perform public.log_activity('customer', 'Deleted customer ' || v.name || ' (' || v.id || ')', null, null,
    jsonb_build_object('customer', to_jsonb(v)));

  return jsonb_build_object('deleted', v.id);
end $$;

revoke execute on function public.delete_customer(text) from public, anon;
grant execute on function public.delete_customer(text) to authenticated;
