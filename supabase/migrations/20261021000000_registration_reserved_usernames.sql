begin;

-- 1) Rezervovaná jména: obyčejná registrace je nesmí použít.
--    Kontrola je v databázi (ne jen v appce). app_metadata umí nastavit jen server,
--    takže účty z seed:admin a owner účet touhle kontrolou projdou.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_display_name text;
  v_is_staff boolean;
begin
  v_username := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
    'user_' || substr(new.id::text, 1, 8)
  );
  v_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'username'), '')
  );
  v_is_staff :=
    coalesce(new.raw_app_meta_data ->> 'role', '') = 'admin'
    or coalesce(new.raw_app_meta_data ->> 'dotaznicek_admin_owner', 'false') = 'true';

  if not v_is_staff
     and lower(regexp_replace(btrim(v_username), '\s+', ' ', 'g'))
         in ('admin', 'admin_owner', 'admin_old') then
    raise exception 'reserved username';
  end if;

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

-- 2) Kontrola přezdívky před registrací (jen pro hezčí chybu v appce;
--    skutečnou jedinečnost drží unikátní index profiles_username_normalized_unique).
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_username is not null
    and char_length(btrim(p_username)) between 2 and 32
    and lower(regexp_replace(btrim(p_username), '\s+', ' ', 'g'))
        not in ('admin', 'admin_owner', 'admin_old')
    and not exists (
      select 1
      from public.profiles existing_profile
      where existing_profile.username_normalized =
            lower(regexp_replace(btrim(p_username), '\s+', ' ', 'g'))
    );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

commit;
