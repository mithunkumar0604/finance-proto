-- Supabase's advisor flags functions that do not fix their search_path. The functions
-- that run with elevated rights already did; this pins the remaining plain helpers and
-- trigger functions too, so none of them can be redirected to another schema.

alter function public.today_ist() set search_path = public;
alter function public.next_customer_id() set search_path = public;
alter function public.rupee_text(bigint) set search_path = public;
alter function public.period_interest(text, numeric, text, bigint, bigint) set search_path = public;
alter function public.next_due_date(date, text, date) set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.forbid_change() set search_path = public;
alter function public.payments_only_reversal() set search_path = public;
alter function public.waivers_only_reversal() set search_path = public;
alter function public.loans_no_delete() set search_path = public;
