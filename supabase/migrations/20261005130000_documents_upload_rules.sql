-- Tighter rules for adding photos and documents, now that the app's upload buttons work.
--
-- Before: owner and staff could add a file under any name, anywhere in the bucket.
-- Now a file must
--   * sit directly under a loan that exists:  <loan id>/<tile>-<number>.<jpg|png|webp|pdf>
--   * and, for staff, go to a tile that has no file yet. The app shows the newest file of
--     a tile, so a second file would replace what everyone sees. Only the owner replaces.
-- Reading (whoever can see the loan) and removing (owner only) are unchanged.

-- true when the tile this file name belongs to already has a file
-- (asked about a loan the caller cannot see, it says nothing: always false)
create or replace function public.document_tile_filled(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_see_loan((storage.foldername(p_name))[1]) and exists (
    select 1 from storage.objects o
    where o.bucket_id = 'documents'
      and (storage.foldername(o.name))[1] = (storage.foldername(p_name))[1]
      and split_part(storage.filename(o.name), '-', 1) = split_part(storage.filename(p_name), '-', 1)
  )
$$;
revoke execute on function public.document_tile_filled(text) from public, anon;
grant execute on function public.document_tile_filled(text) to authenticated;

drop policy documents_add on storage.objects;
create policy documents_add on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select public.app_role()) in ('owner', 'staff')
    and objects.name ~ '^[^/]+/[a-z0-9]+-[0-9]+\.(jpg|png|webp|pdf)$'
    and exists (select 1 from public.loans l where l.id = (storage.foldername(objects.name))[1])
    and ((select public.app_role()) = 'owner' or not public.document_tile_filled(objects.name))
  );
