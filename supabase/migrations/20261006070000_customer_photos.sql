-- A customer's photo and ID photos.
--
-- Files in the private "documents" bucket were kept only under a loan
-- (<loan id>/<tile>-<number>.<ext>). They may now also be kept under a customer
-- (<customer id>/...), with the same rules:
--   * read: whoever can see that loan or that customer (a collector: only their own);
--   * add: owner and staff, under a loan or customer that exists, with the app's file
--     names; staff only into a tile that has no file yet;
--   * remove: the owner only (unchanged).
-- Loan ids (LP-1001) and customer ids (C001) never look alike, so one folder name can
-- only ever mean one of the two.

-- true when the tile this file name belongs to already has a file
-- (asked about a loan or customer the caller cannot see, it says nothing: always false)
create or replace function public.document_tile_filled(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.can_see_loan((storage.foldername(p_name))[1]) or public.can_see_customer((storage.foldername(p_name))[1]))
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'documents'
        and (storage.foldername(o.name))[1] = (storage.foldername(p_name))[1]
        and split_part(storage.filename(o.name), '-', 1) = split_part(storage.filename(p_name), '-', 1)
    )
$$;

drop policy documents_read on storage.objects;
create policy documents_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (public.can_see_loan((storage.foldername(name))[1]) or public.can_see_customer((storage.foldername(name))[1]))
  );

drop policy documents_add on storage.objects;
create policy documents_add on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select public.app_role()) in ('owner', 'staff')
    and objects.name ~ '^[^/]+/[a-z0-9]+-[0-9]+\.(jpg|png|webp|pdf)$'
    and (
      exists (select 1 from public.loans l where l.id = (storage.foldername(objects.name))[1])
      or exists (select 1 from public.customers c where c.id = (storage.foldername(objects.name))[1])
    )
    and ((select public.app_role()) = 'owner' or not public.document_tile_filled(objects.name))
  );
