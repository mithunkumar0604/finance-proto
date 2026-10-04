-- LedgerPro production schema.
-- Money is always whole paise (bigint). Dates of business events are plain dates in IST.
-- Tables that hold money (loans, dues, payments) are never written by the browser
-- directly: every change goes through the functions in the next migration, each of
-- which is one database transaction.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.today_ist() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  role text not null default 'staff' check (role in ('owner', 'staff', 'collector')),
  area text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create sequence public.customer_no start 1;
create sequence public.loan_no start 1001;

create or replace function public.next_customer_id() returns text
language sql volatile as $$
  select 'C' || lpad(n::text, greatest(3, length(n::text)), '0') from (select nextval('public.customer_no') as n) s
$$;

create table public.customers (
  id text primary key default public.next_customer_id(),
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  alt_phone text,
  area text not null default '',
  address text,
  id_ref text,
  notes text,
  collector_id uuid references public.profiles (id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_on date not null default public.today_ist(),
  created_by uuid default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now()
);

create index customers_name_trgm on public.customers using gin (name extensions.gin_trgm_ops);
create index customers_phone_trgm on public.customers using gin (phone extensions.gin_trgm_ops);
create index customers_area on public.customers (area);
create index customers_collector on public.customers (collector_id);

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------

create table public.loans (
  id text primary key default ('LP-' || nextval('public.loan_no')),
  customer_id text not null references public.customers (id),
  type text not null check (type in ('weekly', 'monthly', '15day', '30day', 'vehicle', 'jewel', 'custom')),
  amount bigint not null check (amount > 0),
  start_date date not null,
  reference text,
  interest_style text not null check (interest_style in ('percent', 'fixed', 'custom')),
  -- percent when style = percent, otherwise whole paise
  interest_value numeric(16, 4) not null check (interest_value >= 0),
  interest_method text not null check (interest_method in ('fixed', 'reducing', 'manual')),
  frequency text not null check (frequency in ('weekly', '15days', '30days', 'monthly', 'custom')),
  principal_per_due bigint not null default 0 check (principal_per_due >= 0),
  principal_left bigint not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  closed_date date,
  -- goes up by one with every change; the app sends the version it saw, so two
  -- people changing the same loan at once cannot overwrite each other
  version integer not null default 1,
  idempotency_key uuid not null unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (principal_left between 0 and amount),
  check ((status = 'closed') = (principal_left = 0)),
  check ((status = 'closed') = (closed_date is not null)),
  check (interest_style = 'percent' or interest_value = trunc(interest_value)),
  check (interest_style <> 'percent' or interest_value <= 100)
);

create index loans_customer on public.loans (customer_id);
create index loans_status on public.loans (status);

-- ---------------------------------------------------------------------------
-- Security held against a loan
-- ---------------------------------------------------------------------------

create table public.collateral (
  loan_id text primary key references public.loans (id),
  kind text not null check (kind in ('jewel', 'vehicle', 'document', 'other')),
  -- the fields of that kind (description, registration, packet number, ...)
  details jsonb not null default '{}'::jsonb,
  -- registration / packet / reference / description in one line, for search
  search_text text not null default '',
  status text not null default 'held' check (status in ('held', 'released')),
  released_at timestamptz,
  released_by uuid references public.profiles (id)
);

create index collateral_search_trgm on public.collateral using gin (search_text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Dues: one expected collection for a loan
-- ---------------------------------------------------------------------------

create table public.dues (
  id uuid primary key default gen_random_uuid(),
  loan_id text not null references public.loans (id),
  due_date date not null,
  interest_amount bigint not null check (interest_amount >= 0),
  principal_amount bigint not null check (principal_amount >= 0),
  paid bigint not null default 0 check (paid >= 0),
  interest_paid bigint not null default 0 check (interest_paid >= 0),
  -- written off when the loan was settled; never counted as received
  waived bigint not null default 0 check (waived >= 0),
  last_paid_date date,
  -- set when the date was moved: the day it was first expected, and why
  original_date date,
  reschedule_reason text,
  cancelled boolean not null default false,
  -- still to collect; kept by the database so the app can ask for "open" collections
  remaining bigint generated always as (interest_amount + principal_amount - paid - waived) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (interest_paid <= interest_amount),
  check (paid >= interest_paid),
  check (paid - interest_paid <= principal_amount),
  check (paid + waived <= interest_amount + principal_amount)
);

create index dues_loan on public.dues (loan_id);
create index dues_date on public.dues (due_date);
create index dues_open on public.dues (loan_id) where not cancelled and remaining > 0;

-- ---------------------------------------------------------------------------
-- Payments. Never edited or deleted: a wrong payment is reversed.
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key,
  loan_id text not null references public.loans (id),
  customer_id text not null references public.customers (id),
  due_id uuid references public.dues (id),
  -- when the customer paid; reports count money on this date
  payment_date date not null,
  -- when it was entered in the app
  recorded_on date not null default public.today_ist(),
  recorded_at timestamptz not null default now(),
  principal_before bigint not null check (principal_before >= 0),
  interest bigint not null check (interest >= 0),
  principal bigint not null check (principal >= 0),
  other bigint not null check (other >= 0),
  method text not null check (method in ('cash', 'bank', 'upi', 'other')),
  note text,
  -- one per press of "Confirm": a double tap or a retry sends the same key
  idempotency_key uuid not null unique,
  created_by uuid references public.profiles (id),
  -- the loan and its dues just before this payment, used to reverse it exactly
  before_state jsonb not null,
  reversed_at timestamptz,
  reversed_by uuid references public.profiles (id),
  reverse_reason text,
  check (interest + principal + other > 0),
  check (principal <= principal_before),
  check (payment_date <= recorded_on),
  check ((reversed_at is null) = (reversed_by is null))
);

create index payments_loan on public.payments (loan_id);
create index payments_customer on public.payments (customer_id);
create index payments_date on public.payments (payment_date);

-- ---------------------------------------------------------------------------
-- Activity: who did what. Only ever added to.
-- ---------------------------------------------------------------------------

create table public.activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by uuid references public.profiles (id),
  by_name text not null default '',
  kind text not null check (kind in ('payment', 'loan', 'customer', 'reschedule', 'security', 'system')),
  text text not null,
  loan_id text,
  customer_id text,
  -- old and new values for changes that need a trail
  data jsonb
);

create index activity_at on public.activity (at desc);
create index activity_loan on public.activity (loan_id);

-- ---------------------------------------------------------------------------
-- History cannot be rewritten
-- ---------------------------------------------------------------------------

create or replace function public.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'HISTORY_LOCKED: % rows cannot be changed or deleted', tg_table_name;
end $$;

create or replace function public.payments_only_reversal() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'reversed_at' - 'reversed_by' - 'reverse_reason')
     is distinct from (to_jsonb(old) - 'reversed_at' - 'reversed_by' - 'reverse_reason') then
    raise exception 'HISTORY_LOCKED: a recorded payment cannot be edited, only reversed';
  end if;
  if old.reversed_at is not null then
    raise exception 'HISTORY_LOCKED: this payment is already reversed';
  end if;
  return new;
end $$;

create trigger payments_no_delete before delete on public.payments for each row execute function public.forbid_change();
create trigger payments_no_edit before update on public.payments for each row execute function public.payments_only_reversal();
create trigger activity_no_change before update or delete on public.activity for each row execute function public.forbid_change();
create trigger loans_no_delete before delete on public.loans for each row execute function public.forbid_change();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger customers_touch before update on public.customers for each row execute function public.touch_updated_at();
create trigger loans_touch before update on public.loans for each row execute function public.touch_updated_at();
create trigger dues_touch before update on public.dues for each row execute function public.touch_updated_at();
