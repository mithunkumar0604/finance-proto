-- One fingerprint per table. Run before a backup and after a restore: the two
-- outputs must be identical. (See BACKUP_RESTORE.md, "Test a restore".)
select 'profiles' as t, count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id), '')) from public.profiles x
union all select 'customers', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id), '')) from public.customers x
union all select 'loans', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id), '')) from public.loans x
union all select 'collateral', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.loan_id), '')) from public.collateral x
union all select 'dues', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id), '')) from public.dues x
union all select 'payments', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id), '')) from public.payments x
union all select 'allocations', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.payment_id, x.due_id), '')) from public.payment_allocations x
union all select 'waivers', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id), '')) from public.waivers x
union all select 'imports', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id), '')) from public.import_batches x
union all select 'activity', count(*), md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id), '')) from public.activity x
union all select 'logins', count(*), md5(coalesce(string_agg(md5(x.id::text || x.email || coalesce(x.encrypted_password, '')), '' order by x.id), '')) from auth.users x
union all select 'money', 0, md5((select coalesce(sum(principal_left), 0) from public.loans)::text || '/' || (select coalesce(sum(interest + principal + other), 0) from public.payments where reversed_at is null)::text
  || '/' || (select coalesce(sum(remaining), 0) from public.dues where not cancelled)::text || '/' || (select coalesce(sum(amount), 0) from public.waivers where reversed_at is null)::text)
order by 1;
