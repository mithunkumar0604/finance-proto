-- Row Level Security. Nothing is readable without signing in, and the browser can
-- write only customer details. Money tables change only through the functions in
-- the next migration.
--
-- Roles:  owner     sees and does everything
--         staff     sees customers and loans, adds / edits customers
--         collector sees only the customers assigned to them, records collections

-- The signed-in user's role, or null when not signed in / switched off.
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.can_see_customer(p_customer_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.app_role()
    when 'owner' then true
    when 'staff' then true
    when 'collector' then exists (select 1 from public.customers c where c.id = p_customer_id and c.collector_id = auth.uid())
    else false
  end
$$;

create or replace function public.can_see_loan(p_loan_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.app_role()
    when 'owner' then true
    when 'staff' then true
    when 'collector' then exists (
      select 1 from public.loans l join public.customers c on c.id = l.customer_id
      where l.id = p_loan_id and c.collector_id = auth.uid())
    else false
  end
$$;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.loans enable row level security;
alter table public.collateral enable row level security;
alter table public.dues enable row level security;
alter table public.payments enable row level security;
alter table public.activity enable row level security;

-- Start from nothing, then grant exactly what is needed.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- Postgres lets everyone run a new function unless told otherwise, and the per-schema line
-- above cannot take that away. This one does, for every function created from now on.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant execute on function public.app_role(), public.today_ist(), public.can_see_customer(text), public.can_see_loan(text), public.next_customer_id() to authenticated;
grant usage on sequence public.customer_no to authenticated;

-- profiles: any active user can see the team; only the owner changes roles.
grant select on public.profiles to authenticated;
grant update (name, phone, role, area, active) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using ((select public.app_role()) is not null);
create policy profiles_owner_update on public.profiles for update to authenticated
  using ((select public.app_role()) = 'owner') with check ((select public.app_role()) = 'owner');

-- customers
grant select on public.customers to authenticated;
grant insert (name, phone, alt_phone, area, address, id_ref, notes, collector_id) on public.customers to authenticated;
grant update (name, phone, alt_phone, area, address, id_ref, notes, collector_id, status) on public.customers to authenticated;
create policy customers_read on public.customers for select to authenticated
  using ((select public.app_role()) in ('owner', 'staff') or ((select public.app_role()) = 'collector' and collector_id = (select auth.uid())));
create policy customers_insert on public.customers for insert to authenticated
  with check ((select public.app_role()) in ('owner', 'staff'));
create policy customers_update on public.customers for update to authenticated
  using ((select public.app_role()) in ('owner', 'staff')) with check ((select public.app_role()) in ('owner', 'staff'));

-- loans, dues, payments, collateral: read only from the browser
grant select on public.loans, public.dues, public.collateral to authenticated;
-- every payment column except the internal snapshot
grant select (id, loan_id, customer_id, due_id, payment_date, recorded_on, recorded_at, principal_before, interest, principal, other,
  method, note, created_by, reversed_at, reversed_by, reverse_reason) on public.payments to authenticated;

create policy loans_read on public.loans for select to authenticated using (public.can_see_customer(customer_id));
create policy dues_read on public.dues for select to authenticated using (public.can_see_loan(loan_id));
create policy collateral_read on public.collateral for select to authenticated using (public.can_see_loan(loan_id));
create policy payments_read on public.payments for select to authenticated using (public.can_see_customer(customer_id));

-- activity: the owner's log
grant select on public.activity to authenticated;
create policy activity_owner_read on public.activity for select to authenticated using ((select public.app_role()) = 'owner');

-- ---------------------------------------------------------------------------
-- Private storage for collateral photos and documents
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Files are stored as <loan id>/<file name>. Whoever can see the loan can see its files;
-- only owner and staff add them; only the owner removes them.
create policy documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.can_see_loan((storage.foldername(name))[1]));
create policy documents_add on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (select public.app_role()) in ('owner', 'staff') and public.can_see_loan((storage.foldername(name))[1]));
create policy documents_remove on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (select public.app_role()) = 'owner');
