-- Who manages the logins (29 October 2026).
--
-- An ADMIN is an owner with one extra right: managing logins (add a user, change a
-- role or name, switch a login off or on, reset a password). The client's own login is
-- an owner WITHOUT that right: they run the business but cannot touch logins. Collector
-- and staff are unchanged.
--
-- Being an admin is a mark on the profile, not a separate role, so every business rule
-- that says "owner" keeps working for admins. The mark can only be set from the server
-- (not from the app), and logins are created and changed only through the
-- manage-users server function, which checks the mark first.

alter table public.profiles add column is_admin boolean not null default false;
alter table public.profiles add constraint profiles_admin_is_owner check (not is_admin or role = 'owner');

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid() and active), false)
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Profiles are no longer changed from the app at all; the server function does it.
drop policy profiles_owner_update on public.profiles;
revoke update on public.profiles from authenticated;

-- A login change is a business event: it goes in the owner's activity list.
create or replace function public.log_login_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity('system', 'Added login ' || new.name || ' (' || new.role || ')', null, null,
      jsonb_build_object('user', new.id, 'phone', new.phone, 'role', new.role));
  elsif (old.name, old.phone, old.role, old.active, old.area) is distinct from (new.name, new.phone, new.role, new.active, new.area) then
    perform public.log_activity('system',
      case
        when old.active and not new.active then 'Switched off login ' || new.name
        when not old.active and new.active then 'Switched on login ' || new.name
        when old.role <> new.role then 'Changed ' || new.name || ' from ' || old.role || ' to ' || new.role
        else 'Edited login ' || new.name
      end, null, null,
      jsonb_build_object('user', new.id,
        'before', jsonb_build_object('name', old.name, 'phone', old.phone, 'role', old.role, 'active', old.active, 'area', old.area),
        'after', jsonb_build_object('name', new.name, 'phone', new.phone, 'role', new.role, 'active', new.active, 'area', new.area)));
  end if;
  return new;
end $$;
create trigger profiles_log after insert or update on public.profiles for each row execute function public.log_login_change();

-- ---------------------------------------------------------------------------
-- What an admin does to a login. Called from the app with the admin's own sign-in, so
-- the activity list shows who did it. Creating the sign-in itself and resetting a
-- password need the server's key: the manage-users function does those, then calls
-- admin_add_profile with the admin's sign-in.
-- ---------------------------------------------------------------------------

create or replace function public.admin_add_profile(p_user uuid, p_name text, p_phone text, p_role text, p_area text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED: only an admin can add a login';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'NAME_NEEDED: enter the person''s name';
  end if;
  if p_role not in ('owner', 'staff', 'collector') then
    raise exception 'INVALID_ROLE: choose owner, staff or collector';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'NOT_FOUND: the sign-in was not created';
  end if;
  insert into public.profiles (id, name, phone, role, area, active)
  values (p_user, left(trim(p_name), 60), coalesce(p_phone, ''), p_role, nullif(trim(coalesce(p_area, '')), ''), true);
end $$;

-- p_patch: any of name, role, area, active
create or replace function public.admin_set_login(p_user uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.profiles;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED: only an admin can change a login';
  end if;
  select * into v from public.profiles where id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND: login not found';
  end if;
  if p_user = auth.uid() and ((p_patch ? 'role' and p_patch ->> 'role' <> v.role) or (p_patch ? 'active' and not (p_patch ->> 'active')::boolean)) then
    raise exception 'NOT_ALLOWED: you cannot switch off your own login or change your own role';
  end if;
  if v.is_admin and p_patch ? 'role' and p_patch ->> 'role' <> 'owner' then
    raise exception 'NOT_ALLOWED: an admin login stays an owner';
  end if;
  if p_patch ? 'role' and p_patch ->> 'role' not in ('owner', 'staff', 'collector') then
    raise exception 'INVALID_ROLE: choose owner, staff or collector';
  end if;
  if p_patch ? 'name' and coalesce(trim(p_patch ->> 'name'), '') = '' then
    raise exception 'NAME_NEEDED: enter the person''s name';
  end if;
  update public.profiles set
    name = case when p_patch ? 'name' then left(trim(p_patch ->> 'name'), 60) else name end,
    role = coalesce(p_patch ->> 'role', role),
    area = case when p_patch ? 'area' then nullif(trim(p_patch ->> 'area'), '') else area end,
    active = coalesce((p_patch ->> 'active')::boolean, active)
  where id = p_user;
end $$;

-- written by the manage-users function after it has reset a password (no password is kept)
create or replace function public.admin_log_password_reset(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED: only an admin can reset a password';
  end if;
  perform public.log_activity('system', 'Reset the password of ' || coalesce((select name from public.profiles where id = p_user), 'a login'), null, null,
    jsonb_build_object('user', p_user));
end $$;

revoke execute on function public.admin_add_profile(uuid, text, text, text, text), public.admin_set_login(uuid, jsonb), public.admin_log_password_reset(uuid) from public, anon;
grant execute on function public.admin_add_profile(uuid, text, text, text, text), public.admin_set_login(uuid, jsonb), public.admin_log_password_reset(uuid) to authenticated;
