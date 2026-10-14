begin;

alter table public.profiles
  add column if not exists role text default 'user',
  add column if not exists is_owner boolean default false;

update public.profiles
set role = coalesce(role, 'user'),
    is_owner = coalesce(is_owner, false)
where role is null or is_owner is null;

alter table public.profiles
  alter column role set default 'user',
  alter column role set not null,
  alter column is_owner set default false,
  alter column is_owner set not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_display_name text;
begin
  v_username := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    'user_' || substr(new.id::text, 1, 8)
  );
  v_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'username'), '')
  );

  insert into public.profiles (id, username, role, is_owner, display_name)
  values (new.id, v_username, 'user', false, v_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop policy if exists profiles_service_role_manage on public.profiles;
create policy profiles_service_role_manage on public.profiles
  for all to service_role
  using (true)
  with check (true);

create or replace function public.bootstrap_admin_owner(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_owner uuid;
  v_is_marked boolean;
begin
  select coalesce(
    auth_user.raw_app_meta_data ->> 'dotaznicek_admin_owner' = 'true'
      and auth_user.email ~ '^admin-[0-9a-f]{64}@dotaznicek[.]invalid$',
    false
  )
  into v_is_marked
  from auth.users auth_user
  where auth_user.id = p_user_id;

  if not coalesce(v_is_marked, false) then
    raise exception 'owner account is not eligible';
  end if;

  insert into private.admin_owner (singleton, user_id)
  values (true, p_user_id)
  on conflict (singleton) do nothing;

  select owner_record.user_id
  into v_current_owner
  from private.admin_owner owner_record
  where owner_record.singleton
  for update;

  if v_current_owner <> p_user_id then
    raise exception 'an owner is already configured';
  end if;

  insert into private.user_roles (user_id, role)
  values (p_user_id, 'owner')
  on conflict (user_id) do nothing;

  update public.profiles existing_profile
  set username = case
    when exists (
      select 1
      from public.profiles reserved_profile
      where reserved_profile.username_normalized = 'admin_old'
        and reserved_profile.id <> existing_profile.id
    )
      then 'admin_old_' || substr(existing_profile.id::text, 1, 8)
    else 'admin_old'
  end
  where existing_profile.username_normalized = 'admin'
    and existing_profile.id <> p_user_id;

  insert into public.profiles (id, username, role, is_owner, display_name)
  values (p_user_id, 'admin_owner', 'admin', true, 'admin')
  on conflict (id) do update
    set username = 'admin_owner',
        role = 'admin',
        is_owner = true;
end;
$$;

grant usage on schema public to service_role;
grant select, insert, update on public.profiles to service_role;

commit;
