-- "Delete Payment" for the owner.
--
-- What happens to the money is unchanged: the payment is marked as taken back, the loan
-- and its collections go back to exactly how they were, and the payment row and an
-- activity entry are kept for good. This only changes what the owner is asked and told:
--   * a reason is no longer required: an empty one is recorded as "Entered by mistake";
--   * the activity log and the messages say "deleted", not "reversed".

create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pay public.payments;
  v_loan public.loans;
  v_latest uuid;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'Entered by mistake');
  d jsonb;
begin
  if public.app_role() is distinct from 'owner' then
    raise exception 'NOT_ALLOWED: only the owner can delete a payment';
  end if;
  if length(v_reason) > 300 then
    raise exception 'REASON_TOO_LONG: keep the reason short';
  end if;

  select * into v_pay from public.payments where id = p_payment_id;
  if not found then
    raise exception 'NOT_FOUND: payment not found';
  end if;
  select * into v_loan from public.loans where id = v_pay.loan_id for update;
  -- read again now that the loan is locked
  select * into v_pay from public.payments where id = p_payment_id;
  if v_pay.reversed_at is not null then
    raise exception 'ALREADY_REVERSED: this payment is already deleted';
  end if;
  if v_pay.before_state -> 'loan' is null then
    raise exception 'NOT_REVERSIBLE: this payment was imported from older records and cannot be deleted here';
  end if;

  select id into v_latest from public.payments
  where loan_id = v_pay.loan_id and reversed_at is null order by recorded_at desc, id desc limit 1;
  if v_latest <> p_payment_id then
    raise exception 'NOT_LATEST: only the latest payment on a loan can be deleted. Delete the later ones first';
  end if;
  if exists (select 1 from public.waivers where loan_id = v_pay.loan_id and reversed_at is null
             and payment_id is distinct from p_payment_id and at > v_pay.recorded_at) then
    raise exception 'NOT_LATEST: interest was waived on this loan after this payment, so it cannot be deleted';
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

  update public.payments set reversed_at = now(), reversed_by = auth.uid(), reverse_reason = v_reason where id = p_payment_id;
  update public.waivers set reversed_at = now() where payment_id = p_payment_id;

  -- put the loan's calendar back as it would have been without this payment
  perform public.trim_dues(v_pay.loan_id);
  perform public.accrue_dues(v_pay.loan_id);

  perform public.log_activity('payment',
    'Deleted payment of ' || public.rupee_text(v_pay.interest + v_pay.principal + v_pay.other) || ' on ' || v_pay.loan_id || ' · ' || v_reason,
    v_pay.loan_id, v_pay.customer_id,
    jsonb_build_object('payment_id', p_payment_id, 'interest', v_pay.interest, 'principal', v_pay.principal, 'other', v_pay.other,
                       'payment_date', v_pay.payment_date, 'reason', v_reason));

  return jsonb_build_object('loan_id', v_pay.loan_id, 'version', v_loan.version + 1);
end $$;
