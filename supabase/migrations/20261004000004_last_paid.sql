-- The day each loan last received interest. The app loads only recent payments at
-- start-up; this lets reports show "Last Paid" for a loan that has not paid for a
-- long time without reading its whole history.
-- security_invoker: the view shows a user only the loans they are allowed to see.

create view public.loan_last_paid with (security_invoker = true) as
select loan_id, max(payment_date) as last_interest_paid_on
from public.payments
where reversed_at is null and interest > 0
group by loan_id;

revoke all on public.loan_last_paid from anon, authenticated;
grant select on public.loan_last_paid to authenticated;

-- Used once when existing records are imported with their own ids: makes new
-- customers and loans continue after the highest imported number. Not callable
-- from the app (service role only).
create or replace function public.set_id_counters(p_customer bigint, p_loan bigint) returns void
language sql security definer set search_path = public as $$
  select setval('public.customer_no', greatest(p_customer, 1)), setval('public.loan_no', greatest(p_loan, 1000));
$$;
revoke execute on function public.set_id_counters(bigint, bigint) from public, anon, authenticated;
grant execute on function public.set_id_counters(bigint, bigint) to service_role;
